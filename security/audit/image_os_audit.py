"""Offline image package/secret audit. Scanner never gets the Docker socket."""
import subprocess,json,uuid,time,argparse,re,hashlib
from pathlib import Path
cli=argparse.ArgumentParser(description=__doc__)
cli.add_argument('--images',type=Path,required=True,help='Private JSON object mapping labels to exact local image IDs')
cli.add_argument('--out',type=Path,required=True)
cli.add_argument('--docker',default='docker')
a=cli.parse_args();out=a.out.resolve();out.mkdir(parents=True,exist_ok=True);d=a.docker
images=json.loads(a.images.read_text(encoding='utf-8'))
if not isinstance(images,dict) or not images:raise ValueError('Nonempty image map required')
for key,value in images.items():
 if not re.fullmatch(r'[A-Za-z0-9_-]{1,64}',key) or not isinstance(value,str) or not re.fullmatch(r'sha256:[0-9a-f]{64}',value):raise ValueError('Safe labels and exact local image IDs required')
 if (out/(key+'.json')).exists():raise ValueError('Use a fresh output directory; stale reports must not be reused')
scanner='aquasec/trivy@sha256:790fd66d1697395d8693d1acaa1ea702406a20f109b6fc7bac8db623eca6c06c'
prefix='lh-os-audit-'+uuid.uuid4().hex[:10];cache=prefix+'-cache';inputs=prefix+'-input';results=prefix+'-results'
created=[];report=[]
def run(args,**kw):return subprocess.run([d,*args],check=True,capture_output=True,timeout=kw.pop('timeout',90),**kw)
try:
 for v in [cache,inputs,results]:run(['volume','create',v]);created.append(v)
 run(['run','--rm','--network','none','--cap-drop','ALL','--cap-add','CHOWN','--read-only','--entrypoint','sh','-v',cache+':/cache','-v',results+':/results',scanner,'-c','chown 1000:1000 /cache /results'])
 common=['run','--rm','--read-only','--user','1000:1000','--cap-drop','ALL','--security-opt','no-new-privileges:true','--memory','2g','--cpus','2','--pids-limit','128','--tmpfs','/tmp:rw,noexec,nosuid,nodev,size=512m','-v',cache+':/cache']
 run([*common,scanner,'image','--download-db-only','--cache-dir','/cache','--skip-version-check','--disable-telemetry'],timeout=240)
 print('Public vulnerability database downloaded; subsequent scans have network=none.',flush=True)
 for key,image in images.items():
  inspection=json.loads(run(['image','inspect',image]).stdout)[0]
  if inspection['Id']!=image:raise ValueError('Image identity mismatch')
  print('Scanning image:',key,flush=True)
  save=subprocess.Popen([d,'image','save',image],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
  try:
   writer=subprocess.run([d,'run','--rm','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--entrypoint','sh','-i','-v',inputs+':/input',scanner,'-c','cat > /input/current.tar'],stdin=save.stdout,capture_output=True,timeout=240)
   save.stdout.close();save.wait(timeout=20)
   if writer.returncode or save.returncode:raise RuntimeError('Image snapshot failed')
  finally:
   if save.poll() is None:save.kill();save.wait()
  r=run([*common,'--network','none','-v',inputs+':/input:ro','-v',results+':/results',scanner,'image','--input','/input/current.tar','--cache-dir','/cache','--cache-backend','memory','--offline-scan','--skip-db-update','--skip-java-db-update','--skip-version-check','--disable-telemetry','--scanners','vuln,secret','--format','json','--output','/results/'+key+'.json','--timeout','10m'],timeout=630)
  (out/(key+'-scanner.log')).write_bytes(r.stderr)
  reader=prefix+'-reader'
  run(['create','--name',reader,'--network','none','--read-only','-v',results+':/results:ro','--entrypoint','/bin/false',scanner])
  try:run(['cp',reader+':/results/'+key+'.json',str(out/(key+'.json'))])
  finally:run(['rm','-v',reader])
  data=json.loads((out/(key+'.json')).read_text(encoding='utf-8'));vulns=[];secrets=[]
  if data.get('Metadata',{}).get('DiffIDs')!=inspection.get('RootFS',{}).get('Layers'):raise ValueError('Scanned filesystem layers do not match inspected image')
  for section in data.get('Results',[]):
   for v in section.get('Vulnerabilities',[]):vulns.append({k:v.get(k) for k in ['VulnerabilityID','PkgName','InstalledVersion','FixedVersion','Severity','Status']})
   for s in section.get('Secrets',[]):secrets.append({'target':section.get('Target'),'rule':s.get('RuleID'),'severity':s.get('Severity')})
  item={'imageKey':key,'image':image,'vulnerabilities':vulns,'secretLocations':secrets,'offline':True,'status':'scanned','reportSha256':hashlib.sha256((out/(key+'.json')).read_bytes()).hexdigest(),'reportedImageConfig':data.get('Metadata',{}).get('ImageID'),'database':data.get('Trivy',{})};report.append(item)
  (out/'summary.json').write_text(json.dumps({'scanner':scanner,'images':report,'time':time.time()},indent=2))
  print(json.dumps({'image':key,'vulnerabilities':len(vulns),'secretLocations':len(secrets)}),flush=True)
finally:
 for v in reversed(created):
  try:run(['volume','rm',v])
  except Exception as e:print('Owned audit volume cleanup pending:',v,str(e)[:100],flush=True)
