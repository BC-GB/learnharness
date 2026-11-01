"""Optional disposable tests. Never connects to a production container/volume."""
import argparse,subprocess,json,time,uuid
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--docker',required=True);p.add_argument('--app-image',required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args();a.out.mkdir(parents=True,exist_ok=True)
if not a.app_image.startswith('sha256:') or len(a.app_image)!=71:raise ValueError('Use an exact locally installed image ID')
result={'time':time.time(),'image':a.app_image,'status':'incomplete','checks':[],'limits':'These exercise specific privacy paths and deliberate hostile containment probes, not every latent app branch.'}
try:
 subprocess.run([a.docker,'version','--format','{{.Server.Version}}'],capture_output=True,check=True,timeout=8)
 for filename in ['payload-canary.mjs','background-canary.mjs']:
  name='lh-audit-'+uuid.uuid4().hex[:10]
  try:
   cmd=[a.docker,'run','--rm','--name',name,'--pull','never','--network','none','--read-only','--user','1000:1000','--cap-drop','ALL','--security-opt','no-new-privileges:true','--memory','512m','--cpus','1','--pids-limit','64','--tmpfs','/tmp:rw,noexec,nosuid,nodev,size=64m,uid=1000,gid=1000','-w','/app','-i','--entrypoint','node',a.app_image,'--import','tsx','--input-type=module','-']
   r=subprocess.run(cmd,input=(Path(__file__).parent/filename).read_text(),capture_output=True,text=True,timeout=60)
   result['checks'].append({'test':filename,'passed':r.returncode==0,'stdout':r.stdout[-6000:],'stderr':r.stderr[-2000:]})
  finally:subprocess.run([a.docker,'rm','-f',name],capture_output=True,timeout=10)
 hostile=Path(__file__).parent.parent/'broker/test-hostile-app.py'
 r=subprocess.run(['python','-I','-S',str(hostile),'--docker',a.docker,'--app-image',a.app_image,'--evidence',str(a.out/'delayed-hostile.json')],capture_output=True,text=True,timeout=100)
 result['checks'].append({'test':'deliberate delayed/document/restart containment','passed':r.returncode==0,'stdout':r.stdout[-2000:],'stderr':r.stderr[-2000:]})
 result['status']='passed' if all(x['passed'] for x in result['checks']) else 'failed'
except Exception as e:result['error']=str(e)[:500]
(a.out/'runtime.json').write_text(json.dumps(result,indent=2));print(json.dumps({'runtime':result['status'],'checks':len(result['checks']),'error':result.get('error')}))
# An unavailable daemon is an explicit incomplete stage, not a clean pass.
raise SystemExit(0 if result['status']=='passed' else 2)
