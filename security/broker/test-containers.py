"""Synthetic-only isolated integration test; never mounts user files or credentials."""
import argparse,json,os,subprocess,time,uuid
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--docker',default='docker');p.add_argument('--app-image',required=True);p.add_argument('--node-image',required=True);p.add_argument('--evidence',required=True);a=p.parse_args()
assert a.app_image.startswith('sha256:') and '@sha256:' in a.node_image
root=Path(__file__).resolve().parent;project='lh-broker-fixture-'+uuid.uuid4().hex[:10];tag=project+':broker';events=[]
def run(args,check=True):
 r=subprocess.run([a.docker,*args],capture_output=True,text=True,encoding='utf-8',timeout=90,env=env)
 events.append({'args':args,'exit':r.returncode,'stdout':r.stdout,'stderr':r.stderr})
 if check and r.returncode:raise RuntimeError(r.stderr)
 return r
env=os.environ.copy();env['APP_IMAGE']=a.app_image;env['BROKER_IMAGE']=tag
base=['compose','--project-name',project,'--file',str(root/'compose.test.yaml')]
try:
 run(['build','--network','none','--pull=false','--build-arg','NODE_IMAGE='+a.node_image,'--tag',tag,str(root)])
 env['BROKER_IMAGE']=json.loads(run(['image','inspect',tag]).stdout)[0]['Id']
 run(base+['up','-d','broker','mock'])
 for _ in range(100):
  if run(base+['exec','-T','broker','node','admin.mjs','list'],False).returncode==0:break
  time.sleep(.1)
 else:raise RuntimeError('Broker did not become ready')
 run(base+['up','-d','client'])
 hashes=[]
 for turn in range(3):
  for _ in range(40):
   jobs=json.loads(run(base+['exec','-T','broker','node','admin.mjs','list']).stdout)
   if jobs:break
   time.sleep(.1)
  else:raise RuntimeError('No request arrived')
  assert len(jobs)==1;j=jobs[0]
  review=json.loads(run(base+['exec','-T','broker','node','admin.mjs','show',j['id']]).stdout)
  assert review['destination']=='isolated mock provider'
  assert 'SYNTHETIC_BROKER_INTEGRATION' in review['exactUtf8Body']
  hashes.append(review['sha256'])
  run(base+['exec','-T','broker','node','admin.mjs','approve',j['id'],review['sha256']])
  assert run(base+['exec','-T','broker','node','admin.mjs','approve',j['id'],review['sha256']],False).returncode!=0
 client=run(base+['ps','-a','-q','client']).stdout.strip()
 for _ in range(100):
  state=json.loads(run(['inspect',client]).stdout)[0]
  if state['State']['Status']=='exited':break
  time.sleep(.1)
 assert state['State']['Status']=='exited' and state['State']['ExitCode']==0
 assert state['HostConfig']['NetworkMode']=='none'
 assert all(m['Type']=='volume' and m['Destination']=='/broker' and m['RW'] is False for m in state['Mounts'])
 logs=run(base+['logs','--no-log-prefix','mock']).stdout
 receipts=[json.loads(line) for line in logs.splitlines() if line.startswith('{')]
 assert [r['sha256'] for r in receipts]==hashes
 run(base+['logs','--no-log-prefix','client'])
 run(base+['restart','broker'])
 for _ in range(100):
  result=run(base+['exec','-T','broker','node','admin.mjs','list'],False)
  if result.returncode==0:break
  time.sleep(.1)
 assert json.loads(result.stdout)==[]
 print('PASS: two SDK learning streams plus normal chat-route persistence; exact payload approvals; isolated app; no credential/control mount; replay denied; broker restart.')
finally:
 run(base+['down','--volumes','--remove-orphans'],False)
 run(['image','rm',tag],False)
 Path(a.evidence).write_text(json.dumps(events,indent=2),encoding='utf-8')
