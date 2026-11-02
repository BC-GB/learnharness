"""Bounded second pass for oversized members; no extraction or execution."""
import argparse,importlib.util,json,hashlib,base64,tarfile,io,time
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--root',type=Path,required=True);p.add_argument('--tooling',type=Path,required=True);p.add_argument('--run',type=Path,required=True);a=p.parse_args()
spec=importlib.util.spec_from_file_location('audit_scanner',Path(__file__).with_name('scan.py'));mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
audit=mod.Audit(argparse.Namespace(root=a.root,tooling=a.tooling,out=a.run.parent/(a.run.name+'-supplement'),fetch_deps=False))
groups={}
for path,v in json.loads((a.root/'package-lock.json').read_text())['packages'].items():
 if path and v.get('resolved'):groups[(v.get('name') or path.split('node_modules/')[-1])+'@'+str(v.get('version'))]=v
gaps=json.loads((a.run/'gaps.json').read_text());remaining=[];closed=[]
for gap in gaps:
 if gap['reason']!='File exceeds scan size bound':remaining.append(gap);continue
 try:
  label=next(k for k in groups if gap['path'].startswith(k+'/'));v=groups[label];filename=gap['path'][len(label)+1:]
  archive=a.run.parent/'cache/archives'/(mod.sha(v['resolved'].encode())+'.tgz');data=archive.read_bytes()
  token=next(x for x in v['integrity'].split() if x.startswith(('sha512-','sha256-')));algorithm,expected=token.split('-',1)
  assert base64.b64encode(hashlib.new(algorithm,data).digest()).decode()==expected
  with tarfile.open(fileobj=io.BytesIO(data),mode='r:gz') as t:
   member=t.getmember(filename);assert member.isfile() and member.size<=256*1024*1024
   body=t.extractfile(member).read(256*1024*1024+1);assert len(body)<=256*1024*1024
   audit.scan('npm/'+label+'/'+filename,body,label)
   closed.append({'path':gap['path'],'bytes':len(body),'sha256':mod.sha(body),'scope':'Signature scan only; not native-code disassembly'})
  print('Additional signature scan:',label,flush=True)
 except Exception as e:remaining.append({**gap,'followupError':str(e)[:250]})
# Re-snapshot source after creating/testing the audit toolkit.
audit.source();audit.manifest.close()
mod.save(audit.out/'closed-gaps.json',closed);mod.save(audit.out/'remaining-gaps.json',remaining+audit.errors);mod.save(audit.out/'matches.json',audit.rows)
mod.save(audit.out/'summary.json',{'time':time.time(),'closedGaps':len(closed),'remainingGaps':len(remaining+audit.errors),**audit.counts,'rulesAndScannerHash':audit.identity})
print(json.dumps({'closedGaps':len(closed),'remainingGaps':len(remaining+audit.errors),'sourceRefreshed':True}))
