import argparse,sys,importlib.util,tempfile,json,hashlib,tarfile,io,base64
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--tooling',type=Path,required=True);a=p.parse_args()
spec=importlib.util.spec_from_file_location('audit_scanner',Path(__file__).with_name('scan.py'));mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
with tempfile.TemporaryDirectory(prefix='lh-audit-selftest-') as temporary:
 root=Path(temporary).resolve();assert root.parent==Path(tempfile.gettempdir()).resolve()
 audit=mod.Audit(argparse.Namespace(root=root,out=root/'run',tooling=a.tooling,fetch_deps=False))
 url='https://registry.npmjs.org/audit-synthetic/-/audit-synthetic-1.0.0.tgz';content=io.BytesIO()
 with tarfile.open(fileobj=content,mode='w:gz') as t:
  data=json.dumps({'name':'audit-synthetic','version':'1.0.0','scripts':{'postinstall':'node would-execute.js'}}).encode()
  m=tarfile.TarInfo('package/package.json');m.size=len(data);t.addfile(m,io.BytesIO(data))
  data=b"require('fs').writeFileSync('/host/PWNED', 'bad');"
  m=tarfile.TarInfo('../../would-execute.js');m.size=len(data);t.addfile(m,io.BytesIO(data))
  m=tarfile.TarInfo('package/escape');m.type=tarfile.SYMTYPE;m.linkname='/host';t.addfile(m)
 body=content.getvalue();destination=audit.cache/'archives'/(mod.sha(url.encode())+'.tgz');destination.write_bytes(body)
 entry={'version':'1.0.0','resolved':url,'integrity':'sha512-'+base64.b64encode(hashlib.sha512(body).digest()).decode()}
 audit.archive((url,[('node_modules/audit-synthetic',entry)]))
 assert audit.packages[0]['lifecycleScripts']['postinstall']=='node would-execute.js'
 assert any('link/special' in x['reason'] for x in audit.errors)
 assert not (root/'would-execute.js').exists() and not (root.parent/'would-execute.js').exists()
 # Cached archives are integrity-checked on every run, before parsing.
 destination.write_bytes(b'changed');audit.archive((url,[('node_modules/audit-synthetic',entry)]))
 assert any('INTEGRITY MISMATCH' in x['reason'] for x in audit.errors)
 audit.manifest.close();audit.local.db.close()
print('PASS archive paths never extracted, links not followed, install hooks never executed, integrity failure recorded.')
