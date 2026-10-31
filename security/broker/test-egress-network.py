"""Hostile raw sockets, independent of relay code; no credentials or user mounts."""
import argparse, json, subprocess, time, uuid
from pathlib import Path
p=argparse.ArgumentParser()
p.add_argument('--docker',default='docker')
p.add_argument('--firewall-image',required=True)
p.add_argument('--node-image',required=True)
p.add_argument('--evidence',required=True)
a=p.parse_args(); prefix='lh-egress-test-'+uuid.uuid4().hex[:10]; owned=[]; evidence=[]
def run(args,check=True):
 r=subprocess.run([a.docker,*args],capture_output=True,text=True,timeout=60)
 if check and r.returncode: raise RuntimeError(r.stderr or r.stdout)
 return r
def create(suffix,extra):
 name=prefix+suffix;owned.append(name)
 run(['run','-d','--pull','never','--name',name,'--read-only','--cap-drop','ALL','--cap-add','NET_ADMIN','--cap-add','SETPCAP','--security-opt','no-new-privileges:true','--tmpfs','/run:rw,noexec,nosuid,nodev,size=1m',*extra,a.firewall_image]);return name
def ready(name):
 for _ in range(30):
  if run(['exec',name,'test','-f','/run/fw-ready'],False).returncode==0:return
  time.sleep(.2)
 raise RuntimeError('Firewall not ready')
probe=r'''
const net=require('net'),{Resolver}=require('dns').promises;
async function connects(host,port){return new Promise(r=>{const s=net.connect({host,port});s.setTimeout(800,()=>{s.destroy();r(false)});s.on('error',()=>r(false));s.on('connect',()=>{s.destroy();r(true)})})}
(async()=>{const out=[];for(const [h,p,expected]of [['1.1.1.1',443,true],['1.1.1.1',80,false],['8.8.8.8',443,false],['192.168.1.1',443,false],['10.0.0.1',443,false],['169.254.169.254',80,false],['127.0.0.1',443,false],['::1',443,false],['2606:4700:4700::1111',443,false]])out.push({test:h+':'+p,expected,actual:await connects(h,p)});
for(const server of ['127.0.0.11','1.1.1.1']){const r=new Resolver({timeout:800,tries:1});r.setServers([server]);let resolved=false;try{await r.resolve4('example.com');resolved=true}catch{}out.push({test:'DNS '+server,expected:false,actual:resolved})}
console.log(JSON.stringify(out));if(out.some(x=>x.actual!==x.expected))process.exitCode=1})()
'''
try:
 name=create('-net',['--env','LH_AUTH_IPV4=1.1.1.1','--env','LH_API_IPV4=1.0.0.1']);ready(name)
 for phase in ['initial','restart']:
  if phase=='restart':run(['restart',name]);ready(name)
  caps=run(['exec',name,'cat','/proc/1/status']).stdout
  assert 'CapBnd:\t0000000000000000' in caps
  result=run(['run','--rm','--pull','never','--network','container:'+name,'--read-only','--user','1000:1000','--cap-drop','ALL','--security-opt','no-new-privileges:true','--entrypoint','node',a.node_image,'-e',probe],False)
  evidence.append({'phase':phase,'checks':json.loads(result.stdout),'exit':result.returncode})
  assert result.returncode==0, 'Raw socket policy failed: '+result.stdout
 for suffix,extra in [('-missing',[]),('-invalid',['--env','LH_AUTH_IPV4=not-an-ip','--env','LH_API_IPV4=1.0.0.1']),('-forced',['--env','LH_AUTH_IPV4=1.1.1.1','--env','LH_API_IPV4=1.0.0.1','--env','LH_EGRESS_FAIL_INIT=1'])]:
  bad=create(suffix,extra);code=run(['wait',bad]).stdout.strip();assert code!='0'
  evidence.append({'phase':suffix,'exit':code})
 print('PASS: raw socket restrictions, DNS/IPv6 denial, restart and fail-closed initialization')
finally:
 for name in reversed(owned):run(['rm','-f',name],False)
 Path(a.evidence).write_text(json.dumps(evidence,indent=2),encoding='utf-8')
