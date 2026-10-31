"""End-to-end synthetic restricted view; no host port exposed during testing."""
import argparse,json,os,subprocess,time,uuid,tempfile
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--docker',default='docker');p.add_argument('--app-image',required=True);p.add_argument('--node-image',required=True);p.add_argument('--evidence',required=True);a=p.parse_args()
assert a.app_image.startswith('sha256:') and '@sha256:' in a.node_image
root=Path(__file__).resolve().parent;project='lh-view-fixture-'+uuid.uuid4().hex[:10];tag=project+':broker';events=[];env=os.environ.copy();env.update(APP_IMAGE=a.app_image,BROKER_IMAGE=tag)
def run(args,check=True):
 r=subprocess.run([a.docker,*args],capture_output=True,text=True,encoding='utf-8',timeout=90,env=env);events.append({'args':args,'exit':r.returncode,'stdout':r.stdout,'stderr':r.stderr})
 if check and r.returncode:raise RuntimeError(r.stderr+r.stdout)
 return r
with tempfile.TemporaryDirectory(prefix='lh-view-fixture-') as tmp:
 override=Path(tmp)/'no-ports.yaml';override.write_text('services:\n  view:\n    ports: !reset []\n    environment:\n      LH_VIEW_HOST: 127.0.0.1:8080\n',encoding='utf-8')
 base=['compose','--project-name',project,'--file',str(root/'compose.mock.yaml'),'--file',str(override)]
 try:
  run(['build','--network','none','--pull=false','--build-arg','NODE_IMAGE='+a.node_image,'--tag',tag,str(root)])
  env['BROKER_IMAGE']=json.loads(run(['image','inspect',tag]).stdout)[0]['Id']
  run(base+['up','-d'])
  result=run(base+['exec','-T','view','node','check-view-stack.mjs']);summary=json.loads(result.stdout.strip().splitlines()[-1])
  for service in ['app','broker','view']:
   cid=run(base+['ps','-q',service]).stdout.strip();state=json.loads(run(['inspect',cid]).stdout)[0]
   assert not state['HostConfig'].get('PortBindings') and not state['HostConfig']['Privileged']
   assert all(m['Type']=='volume' for m in state['Mounts'])
   if service=='app':
    assert state['HostConfig']['NetworkMode']=='none'
    assert not any(m['Destination'] in ['/control','/view-secret','/run/secrets'] for m in state['Mounts'])
  run(base+['restart','app'])
  run(base+['exec','-T','view','node','check-view-stack.mjs',summary['chatId']])
  print('PASS: restricted view -> app IPC -> normal chat -> broker review/approval -> mock stream -> saved lesson; app restart preserves lesson; no host ports or credentials.')
 finally:
  run(base+['logs','--no-log-prefix','--tail','40'],False)
  run(base+['down','--volumes','--remove-orphans'],False);run(['image','rm',tag],False)
  Path(a.evidence).write_text(json.dumps(events,indent=2),encoding='utf-8')
