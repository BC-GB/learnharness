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
  data=json.dumps({'name':'nested','version':'2.0.0'}).encode()
  m=tarfile.TarInfo('package/node_modules/nested/package.json');m.size=len(data);t.addfile(m,io.BytesIO(data))
  data=b"require('fs').writeFileSync('/host/PWNED', 'bad');"
  m=tarfile.TarInfo('../../would-execute.js');m.size=len(data);t.addfile(m,io.BytesIO(data))
  m=tarfile.TarInfo('package/escape');m.type=tarfile.SYMTYPE;m.linkname='/host';t.addfile(m)
 body=content.getvalue();destination=audit.cache/'archives'/(mod.sha(url.encode())+'.tgz');destination.write_bytes(body)
 entry={'version':'1.0.0','resolved':url,'integrity':'sha512-'+base64.b64encode(hashlib.sha512(body).digest()).decode()}
 audit.archive((url,[('node_modules/audit-synthetic',entry)]))
 assert audit.packages[0]['lifecycleScripts']['postinstall']=='node would-execute.js'
 bundled={'path':'node_modules/audit-synthetic/node_modules/nested','version':'2.0.0','inBundle':True}
 assert audit.check_bundled([bundled])==[bundled['path']]
 assert audit.check_bundled([{**bundled,'version':'3.0.0'}])==[]
 assert any('no verified matching archive' in x['reason'] for x in audit.errors)
 assert any('link/special' in x['reason'] for x in audit.errors)
 assert not (root/'would-execute.js').exists() and not (root.parent/'would-execute.js').exists()
 # Cached archives are integrity-checked on every run, before parsing.
 destination.write_bytes(b'changed');audit.archive((url,[('node_modules/audit-synthetic',entry)]))
 assert any('INTEGRITY MISMATCH' in x['reason'] for x in audit.errors)
 # Excessive members are reported, not silently treated as complete.
 destination.write_bytes(body);mod.MAX_MEMBERS=1
 audit.archive((url,[('node_modules/audit-synthetic',entry)]))
 assert any('member count bound' in x['reason'] for x in audit.errors)
 # External, cleartext and credential-bearing redirects fail before dispatch.
 handler=mod.RegistryRedirects();request=mod.urllib.request.Request(url)
 for target in ['http://registry.npmjs.org/x','https://127.0.0.1/x','https://registry.npmjs.org.evil.invalid/x','https://user:secret@registry.npmjs.org/x','https://registry.npmjs.org:444/x']:
  try:handler.redirect_request(request,None,302,'Found',{},target)
  except ValueError:pass
  else:raise AssertionError('Unsafe registry redirect accepted')
 assert handler.redirect_request(request,None,302,'Found',{},'https://registry.npmjs.org/safe').full_url=='https://registry.npmjs.org/safe'
 audit.manifest.close();audit.local.db.close()
print('PASS no extraction/execution, integrity and member bounds enforced, unsafe redirects rejected before dispatch.')
