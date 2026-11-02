"""Read-only malware triage. Never imports, installs or executes the target.

GuardDog source rules via YARA-X, augmented with explicit review candidates.
This is not the GuardDog CLI or an interprocedural data-flow proof.
"""
import argparse,base64,concurrent.futures,hashlib,io,json,os,re,sqlite3,subprocess,sys,tarfile,threading,time,urllib.request,urllib.parse,zipfile
from pathlib import Path

TOOL_PINS={
 'guarddog-3.2.0-py3-none-any.whl':'e503812dc8cf79b74327b7a85a819d62bfb420e3fa8739a7f2f29a93a372c84d',
}
MAX_FILE=64*1024*1024
MAX_ARCHIVE=256*1024*1024
MAX_EXPANDED=1024*1024*1024
MAX_MEMBERS=100000
SCRIPT=Path(__file__).resolve().parent

def sha(data):return hashlib.sha256(data).hexdigest()
def save(path,obj):path.write_text(json.dumps(obj,indent=2),encoding='utf-8')

def validate_registry_url(url):
 parsed=urllib.parse.urlsplit(url)
 if parsed.scheme!='https' or parsed.hostname!='registry.npmjs.org' or parsed.username or parsed.password or parsed.port not in (None,443):
  raise ValueError('Non-public-registry URL not fetched')

class RegistryRedirects(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,req,fp,code,msg,headers,newurl):
  # Check before urllib sends a request, not after reaching another host.
  validate_registry_url(newurl)
  return super().redirect_request(req,fp,code,msg,headers,newurl)

def load_engine(tooling):
 # Verify extracted engine against its pinned wheel before loading native code.
 pin=json.loads((SCRIPT/'tool-pins.json').read_text())
 expected_rules=set()
 for filename,digest in pin.items():
  wheel=tooling/filename
  if sha(wheel.read_bytes())!=digest:raise RuntimeError('Scanner wheel hash mismatch: '+filename)
  with zipfile.ZipFile(wheel) as z:
   if filename.startswith('yara_x'):
    for name in z.namelist():
     if name.endswith('/'):continue
     p=(tooling/'yara-x'/name).resolve()
     if not p.is_relative_to((tooling/'yara-x').resolve()) or sha(p.read_bytes())!=sha(z.read(name)):raise RuntimeError('Extracted scanner mismatch')
   else:
    for name in z.namelist():
     if name.endswith(('.yar','.meta')):
      expected_rules.add(Path(name).name)
      if (tooling/'rules'/Path(name).name).read_bytes()!=z.read(name):raise RuntimeError('Rule mismatch')
 if {p.name for p in (tooling/'rules').iterdir()}!=expected_rules:raise RuntimeError('Unexpected scanner rule file')
 sys.path.insert(0,str(tooling/'yara-x'))
 import yara_x
 compiler=yara_x.Compiler();compiler.add_include_dir(str(tooling/'rules'))
 sources=sorted((tooling/'rules').glob('*.yar'))+[SCRIPT/'extra.yar']
 for f in sources:compiler.add_source(f.read_text(encoding='utf-8'),origin=str(f))
 rules=compiler.build()
 identity=sha(b''.join(f.read_bytes() for f in sources)+json.dumps(pin,sort_keys=True).encode()+Path(__file__).read_bytes())
 return yara_x,rules,identity,len(sources)

class Audit:
 def __init__(self,a):
  self.a=a;self.root=a.root.resolve();self.out=a.out.resolve();self.out.mkdir(parents=True,exist_ok=True)
  self.cache=self.out.parent/'cache';self.cache.mkdir(exist_ok=True);(self.cache/'archives').mkdir(exist_ok=True)
  self.yara,self.rules,self.identity,self.rule_count=load_engine(a.tooling.resolve())
  self.local=threading.local();self.lock=threading.Lock();self.rows=[];self.errors=[];self.packages=[];self.bundled={};self.counts={'files':0,'bytes':0,'cacheHits':0,'nativeFiles':0}
  db=sqlite3.connect(self.cache/'scan.sqlite');db.execute('PRAGMA journal_mode=WAL');db.execute('CREATE TABLE IF NOT EXISTS results (key TEXT PRIMARY KEY, value TEXT)');db.close()
  self.manifest=(self.out/'files.jsonl').open('w',encoding='utf-8')
 def error(self,where,reason):
  with self.lock:self.errors.append({'path':where,'reason':str(reason)[:300]})
 def scan(self,where,data,package):
  digest=sha(data);key=self.identity+digest;native=data.startswith((b'\x7fELF',b'MZ',b'\x00asm'))
  if not hasattr(self.local,'scanner'):
   self.local.scanner=self.yara.Scanner(self.rules);self.local.scanner.set_timeout(10);self.local.scanner.max_matches_per_pattern(10)
   self.local.db=sqlite3.connect(self.cache/'scan.sqlite',timeout=60)
  db=self.local.db;cached=db.execute('SELECT value FROM results WHERE key=?',(key,)).fetchone()
  if cached:matches=json.loads(cached[0])
  else:
   result=self.local.scanner.scan(data);matches=[]
   for rule in result.matching_rules:
    meta=dict(rule.metadata);locations=[]
    for pattern in rule.patterns:
     for m in list(pattern.matches)[:2]:locations.append({'offset':m.offset,'line':data.count(b'\n',0,m.offset)+1})
    matches.append({'rule':rule.identifier,'identifies':meta.get('identifies',''), 'description':meta.get('description',''),'locations':locations[:4]})
   db.execute('INSERT OR REPLACE INTO results VALUES (?,?)',(key,json.dumps(matches)));db.commit()
  with self.lock:
   self.counts['files']+=1;self.counts['bytes']+=len(data);self.counts['nativeFiles']+=int(native);self.counts['cacheHits']+=int(bool(cached))
   self.manifest.write(json.dumps({'path':where,'sha256':digest,'bytes':len(data),'native':native,'package':package})+'\n')
   if matches:self.rows.append({'path':where,'sha256':digest,'package':package,'native':native,'matches':matches})
 def source(self):
  paths=subprocess.check_output(['git','ls-files','-z','--cached','--others','--exclude-standard'],cwd=self.root).decode().split('\0')
  for rel in filter(None,paths):
   p=self.root/rel
   if p.is_symlink() or (hasattr(p,'is_junction') and p.is_junction()):self.error(rel,'Link not followed');continue
   if not p.resolve().is_relative_to(self.root):self.error(rel,'Outside source root');continue
   try:
    if p.stat().st_size>MAX_FILE:self.error(rel,'File exceeds scan size bound');continue
    self.scan('source/'+rel,p.read_bytes(),'first-party')
   except Exception as e:self.error(rel,e)
 def archive(self,item):
  url,entries=item;entry=entries[0][1];name=entry.get('name') or entries[0][0].split('node_modules/')[-1];version=entry.get('version');label=name+'@'+str(version)
  try:
   validate_registry_url(url)
   integrity=entry.get('integrity','');tokens=integrity.split();token=next((x for x in tokens if x.startswith('sha512-')),next((x for x in tokens if x.startswith('sha256-')),None))
   if not token:raise ValueError('Missing strong lockfile integrity')
   algorithm,expected=token.split('-',1);dest=self.cache/'archives'/(sha(url.encode())+'.tgz')
   if not dest.exists():
    if not self.a.fetch_deps:raise ValueError('Archive not cached; use --fetch-deps')
    req=urllib.request.Request(url,headers={'User-Agent':'LearnHarness-ReadOnly-Audit'})
    with urllib.request.build_opener(RegistryRedirects()).open(req,timeout=45) as r:
     validate_registry_url(r.url)
     data=r.read(MAX_ARCHIVE+1)
    if len(data)>MAX_ARCHIVE:raise ValueError('Archive exceeds compressed size bound')
   else:
    if dest.stat().st_size>MAX_ARCHIVE:raise ValueError('Cached archive exceeds compressed size bound')
    data=dest.read_bytes()
   if base64.b64encode(hashlib.new(algorithm,data).digest()).decode()!=expected:raise ValueError('LOCKFILE INTEGRITY MISMATCH')
   if not dest.exists():dest.write_bytes(data)
   expanded=0;files=0;scripts={};before=[]
   with tarfile.open(fileobj=io.BytesIO(data),mode='r:gz') as archive:
    for member_number,m in enumerate(archive,1):
     if member_number>MAX_MEMBERS:raise ValueError('Archive member count bound exceeded')
     # No archive paths are extracted or executed, even if hostile.
     if m.isdir():continue
     if not m.isfile():self.error(label+'/'+m.name,'Archive link/special member not followed');continue
     expanded+=m.size
     if expanded>MAX_EXPANDED:raise ValueError('Archive expanded-size bound exceeded')
     if m.size>MAX_FILE:self.error(label+'/'+m.name,'File exceeds scan size bound');continue
     body=archive.extractfile(m).read(MAX_FILE+1)
     if len(body)>MAX_FILE:raise ValueError('Oversized member')
     self.scan('npm/'+label+'/'+m.name,body,label);files+=1
     if m.name in ['package/package.json','package.json']:
      j=json.loads(body);scripts={k:v for k,v in j.get('scripts',{}).items() if k in ['preinstall','install','postinstall','prepare','prepublish']}
     elif m.name.startswith('package/node_modules/') and m.name.endswith('/package.json'):
      j=json.loads(body);suffix=m.name.removeprefix('package').removesuffix('/package.json')
      with self.lock:
       for lock_path,_ in entries:self.bundled[lock_path+suffix]={'name':j.get('name'),'version':j.get('version')}
   with self.lock:self.packages.append({'name':name,'version':version,'lockPaths':[k for k,v in entries],'integrityVerified':True,'files':files,'bytes':expanded,'lifecycleScripts':scripts})
  except Exception as e:self.error(label,e)
 def check_bundled(self,missing):
  verified=[]
  for entry in missing:
   expected={'name':entry['path'].split('node_modules/')[-1],'version':entry['version']}
   if entry['inBundle'] and self.bundled.get(entry['path'])==expected:verified.append(entry['path'])
   else:self.error(entry['path'],'Lockfile entry has no verified matching archive or bundled manifest')
  return verified
 def run(self):
  start=time.time();self.source();print('First-party source scanned:',self.counts['files'],flush=True)
  lock=json.loads((self.root/'package-lock.json').read_text());groups={};missing=[]
  for path,entry in lock['packages'].items():
   if not path:continue
   if entry.get('resolved'):groups.setdefault(entry['resolved'],[]).append((path,entry))
   else:missing.append({'path':path,'version':entry.get('version'),'inBundle':entry.get('inBundle',False)})
  with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
   for i,_ in enumerate(pool.map(self.archive,groups.items()),1):
    if i%50==0:print('Package archives examined:',i,'/',len(groups),'gaps:',len(self.errors),flush=True)
  bundled_verified=self.check_bundled(missing)
  self.manifest.close()
  # Capability and threat co-occurrence is a review candidate, NOT proof of
  # exfiltration. Keep all matches, including low-confidence and fixture matches.
  candidates=[]
  for row in self.rows:
   labels=[x['identifies'] for x in row['matches']]
   if any(x.startswith('review.') for x in labels) or (any(x.startswith('threat.') for x in labels) and any(x.startswith('capability.') for x in labels)):
    candidates.append(row)
  summary={'status':'review-required','engine':'YARA-X 1.22.1 + GuardDog 3.2.0 source rules + local review rules','ruleCount':self.rule_count,'rulesAndScannerHash':self.identity,'seconds':round(time.time()-start,2),**self.counts,'packageArchivesExpected':len(groups),'packageArchivesScanned':len(self.packages),'bundledLockEntries':missing,'reviewCandidates':len(candidates),'gapCount':len(self.errors),'scope':'Current working-tree source and integrity-verified lockfile archives, including dev and optional platforms. Not an attestation of installed Docker bytes.','limits':['Pattern matching is not whole-program data flow or proof of benignness.','Native binaries are signature-scanned, not decompiled.','Rules apply to all regular files; no dist/build/node_modules or extension exclusions.','No package code or lifecycle script executed.','Dynamic app behavior requires the separate disposable Docker tests.']}
  summary['bundledEntriesVerified']=bundled_verified
  for name,obj in [('summary.json',summary),('matches.json',self.rows),('review-candidates.json',candidates),('gaps.json',self.errors),('packages.json',self.packages)]:save(self.out/name,obj)
  print(json.dumps(summary),flush=True)

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--root',type=Path,required=True);p.add_argument('--tooling',type=Path,required=True);p.add_argument('--out',type=Path,required=True);p.add_argument('--fetch-deps',action='store_true');Audit(p.parse_args()).run()
