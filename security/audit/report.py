"""Summarize evidence without equating a heuristic match with spyware."""
import argparse,json,collections
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--out',type=Path,required=True);a=p.parse_args()
def read(name,default):
 f=a.out/name;return json.loads(f.read_text()) if f.exists() else default
s=read('summary.json',{});rows=read('matches.json',[]);packages=read('packages.json',[]);advisories=read('advisories.json',{});runtime=read('runtime.json',{'status':'not run'})
gaps=read('gaps.json',[]);file_count=s.get('files');supplement=a.out.parent/(a.out.name+'-supplement')
if (supplement/'summary.json').exists():
 extra=json.loads((supplement/'summary.json').read_text())
 if extra['rulesAndScannerHash']!=s.get('rulesAndScannerHash'):raise RuntimeError('Supplement scanner identity differs')
 rows=[x for x in rows if not x['path'].startswith('source/')]+json.loads((supplement/'matches.json').read_text())
 gaps=json.loads((supplement/'remaining-gaps.json').read_text())
 paths=set()
 for f in [a.out/'files.jsonl',supplement/'files.jsonl']:
  with f.open() as stream:
   for line in stream:paths.add(json.loads(line)['path'])
 file_count=len(paths)
review=[]
disposition_file=a.out.parent/'reviewed-matches.json'
dispositions=json.loads(disposition_file.read_text()) if disposition_file.exists() else []
by_match={(x['path'],x['sha256'],x['rule']):x for x in dispositions}
for row in rows:
 labels=[m['identifies'] for m in row['matches']];capabilities=[x for x in labels if x.startswith('capability.')];threats=[x for x in labels if x.startswith('threat.')]
 outgoing=any('network.outbound' in x for x in labels)
 data_access=any(any(k in x for k in ['filesystem.read','filesystem.browser','environment.read']) for x in labels)
 if (outgoing and data_access) or (threats and capabilities) or any(x.startswith('review.') for x in labels):
  documented=[by_match[(row['path'],row['sha256'],m['rule'])] for m in row['matches'] if (row['path'],row['sha256'],m['rule']) in by_match]
  unresolved=[m['rule'] for m in row['matches'] if m['identifies'].startswith(('threat.','review.')) and (row['path'],row['sha256'],m['rule']) not in by_match]
  review.append({**row,'reason':'Sensitive/file read and outbound capabilities coexist; trace data and destination.' if outgoing and data_access else 'Heuristic combination needs contextual review.','classification':'candidate, not confirmed malware','documentedMatches':documented,'unresolvedHeuristics':unresolved,'needsReview':bool(unresolved) or (outgoing and data_access)})
counts=collections.Counter(x['package'] for x in review)
malware=[{'id':k,**v} for k,v in advisories.get('details',{}).items() if v['malwareRelated'] and not v['withdrawn']]
report={'staticComplete':bool(s) and not gaps,'ruleFileCount':s.get('ruleCount'),'files':file_count,'archiveCoverage':{'scanned':s.get('packageArchivesScanned'),'expected':s.get('packageArchivesExpected')},'gaps':gaps,'reviewCandidateFiles':len(review),'reviewCandidatePackages':counts.most_common(),'lifecycleHooks':[{'name':x['name'],'version':x['version'],'scripts':x['lifecycleScripts']} for x in packages if x['lifecycleScripts']],'knownMalwareAdvisories':malware,'advisoryErrors':advisories.get('errors',['not run']),'runtime':runtime,'verdict':'Review required; automated matches are not a spyware verdict. No silent clean status.','installedArtifactAttestation':'Not established by lockfile archive scanning; requires Docker artifact snapshot and manifest comparison.'}
(a.out/'review-queue.json').write_text(json.dumps(review,indent=2));(a.out/'report.json').write_text(json.dumps(report,indent=2))
print(json.dumps({k:report[k] for k in ['staticComplete','files','archiveCoverage','reviewCandidateFiles','knownMalwareAdvisories','verdict']}))
