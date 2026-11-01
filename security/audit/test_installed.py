import importlib.util
from pathlib import Path
spec=importlib.util.spec_from_file_location('installed',Path(__file__).with_name('verify_installed_dependencies.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
lock={'node_modules/@types/sample':{'resolved':'https://registry.npmjs.org/example','version':'1.0.0'}}
reference={}
m.add_reference(reference,{'package':'@types/sample@1.0.0','path':'npm/@types/sample@1.0.0/sample/index.d.ts','sha256':'good'})
installed=[{'path':'image/app/node_modules/@types/sample/index.d.ts','sha256':'good'}]
assert m.compare(lock,installed,reference)['passed']
assert not m.compare(lock,[{**installed[0],'sha256':'tampered'}],reference)['passed']
assert not m.compare({'node_modules/@types/sample':{**lock['node_modules/@types/sample'],'version':'2.0.0'}},installed,reference)['passed']
m.add_reference(reference,{'package':'@types/sample@1.0.0','path':'npm/@types/sample@1.0.0/other/index.d.ts','sha256':'conflicting'})
assert not m.compare(lock,installed,reference)['passed']
assert not m.compare(lock,[],reference)['passed']
print('PASS archive-root normalization, tampering, wrong version, ambiguous paths and empty evidence.')
