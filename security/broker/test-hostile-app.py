"""Deliberate delayed/persistent hostile code, not observation of benign startup."""
import argparse,json,subprocess,uuid
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--docker',default='docker');p.add_argument('--app-image',required=True);p.add_argument('--evidence',required=True);a=p.parse_args()
name='lh-hostile-'+uuid.uuid4().hex[:10];volume=name+'-state';events=[]
def run(args):
 r=subprocess.run([a.docker,*args],capture_output=True,text=True,timeout=60)
 if r.returncode:raise RuntimeError(r.stderr or r.stdout)
 return r.stdout
payload=r'''
const fs=require('fs'),os=require('os'),net=require('net'),cp=require('child_process');
async function probe(trigger){const checks=[];const check=(name,pass)=>checks.push({name,pass});
for(const p of ['/subscription/accounts/accounts.json','/control/admin.sock','/egress/tunnel.sock','/view-secret/token','/var/run/docker.sock','/mnt/c/Users','/host','/dev/input','/dev/video0','/tmp/.X11-unix'])check('not exposed: '+p,!fs.existsSync(p));
check('no external network interface',Object.values(os.networkInterfaces()).flat().every(x=>x.internal));
const status=fs.readFileSync('/proc/self/status','utf8');check('capabilities absent',/CapEff:\s+0000000000000000/.test(status));check('no-new-privileges',/NoNewPrivs:\s+1/.test(status));
try{fs.writeFileSync('/app/.malicious-write','x');check('image write blocked',false)}catch(e){check('image write blocked',['EROFS','EACCES'].includes(e.code))}
check('user namespace creation denied',cp.spawnSync('unshare',['-Ur','true']).status!==0);
for(const host of ['192.168.1.1','10.0.0.1','169.254.169.254','1.1.1.1']){const denied=await new Promise(r=>{const s=net.connect({host,port:443});s.setTimeout(500,()=>{s.destroy();r(true)});s.on('error',()=>r(true));s.on('connect',()=>{s.destroy();r(false)})});check('raw TCP denied: '+host,denied)}
console.log(JSON.stringify({trigger,checks}));if(checks.some(x=>!x.pass))process.exitCode=1;}
(async()=>{if(fs.existsSync('/state/persistent-trigger')){await new Promise(r=>setTimeout(r,1000));await probe('persisted trigger after restart');}else{await new Promise(r=>setTimeout(r,1500));await probe('timer after startup');fs.writeFileSync('/state/document-trigger','ACTIVATE');if(fs.readFileSync('/state/document-trigger','utf8')==='ACTIVATE')await probe('document content trigger');fs.writeFileSync('/state/persistent-trigger','ACTIVATE');}})().catch(()=>process.exitCode=1);
'''
try:
 run(['volume','create',volume])
 run(['create','--name',name,'--pull','never','--network','none','--read-only','--user','1000:1000','--cap-drop','ALL','--security-opt','no-new-privileges:true','--pids-limit','32','--memory','128m','--mount','type=volume,src='+volume+',dst=/state','--entrypoint','node',a.app_image,'-e',payload])
 for phase in ['initial','restart']:
  out=run(['start','-a',name]);state=json.loads(run(['inspect',name]))[0]
  assert state['State']['ExitCode']==0
  records=[json.loads(line) for line in out.splitlines() if line.startswith('{')]
  assert records and all(all(c['pass'] for c in r['checks']) for r in records)
  events.append({'phase':phase,'records':records})
 assert len(events[0]['records'])==2 and len(events[1]['records'])==1
 print('PASS: deliberate timer, document-triggered and restart-persisted hostile payloads')
finally:
 subprocess.run([a.docker,'rm','-f',name],capture_output=True)
 subprocess.run([a.docker,'volume','rm',volume],capture_output=True)
 Path(a.evidence).write_text(json.dumps(events,indent=2),encoding='utf-8')
