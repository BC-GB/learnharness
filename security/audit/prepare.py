"""Fetch only pinned scanner wheels; extract tools, never a target package."""
import argparse,hashlib,json,urllib.request,zipfile,io
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--tooling',type=Path,required=True);a=p.parse_args();dest=a.tooling.resolve();dest.mkdir(parents=True,exist_ok=True)
pins=json.loads((Path(__file__).parent/'tool-pins.json').read_text())
for name,digest in pins.items():
 package,version=name.split('-')[:2];package=package.replace('_','-')
 archive=dest/name
 if not archive.exists():
  with urllib.request.urlopen(f'https://pypi.org/pypi/{package}/{version}/json',timeout=30) as r:meta=json.load(r)
  item=next(x for x in meta['urls'] if x['filename']==name)
  if item['digests']['sha256']!=digest:raise RuntimeError('Published scanner hash differs from pinned review')
  with urllib.request.urlopen(item['url'],timeout=60) as r:data=r.read(40*1024*1024)
  if hashlib.sha256(data).hexdigest()!=digest:raise RuntimeError('Downloaded scanner hash mismatch')
  archive.write_bytes(data)
 data=archive.read_bytes()
 if hashlib.sha256(data).hexdigest()!=digest:raise RuntimeError('Cached scanner hash mismatch')
 with zipfile.ZipFile(io.BytesIO(data)) as z:
  for member in z.infolist():
   if member.is_dir():continue
   if name.startswith('guarddog'):
    if not member.filename.endswith(('.yar','.meta')):continue
    target=dest/'rules'/Path(member.filename).name
   else:target=dest/'yara-x'/member.filename
   if not target.resolve().is_relative_to(dest):raise RuntimeError('Unsafe scanner wheel path')
   target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(z.read(member))
print('Pinned scanner prepared. No target dependency installed or executed.')
