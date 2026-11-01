"""OSV queries contain only public npm package names/versions, never code."""
import argparse,json,time,urllib.request,re
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--root',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args();a.out.mkdir(parents=True,exist_ok=True)
lock=json.loads((a.root/'package-lock.json').read_text());packages=sorted({(v.get('name') or k.split('node_modules/')[-1],v['version']) for k,v in lock['packages'].items() if k and v.get('version')})
records=[];errors=[];start=time.time()
def request(url,data=None):
 req=urllib.request.Request(url,data=json.dumps(data).encode() if data else None,headers={'Content-Type':'application/json'})
 with urllib.request.urlopen(req,timeout=40) as r:return json.load(r)
for offset in range(0,len(packages),100):
 pending=[({'package':{'name':name,'ecosystem':'npm'},'version':version},name,version) for name,version in packages[offset:offset+100]]
 try:
  pages=0
  while pending:
   pages+=1
   if pages>20:raise RuntimeError('Advisory pagination limit reached')
   result=request('https://api.osv.dev/v1/querybatch',{'queries':[x[0] for x in pending]})['results'];assert len(result)==len(pending)
   nxt=[]
   for (query,name,version),r in zip(pending,result):
    for v in r.get('vulns',[]):records.append({'package':name,'version':version,'id':v['id']})
    if r.get('next_page_token'):nxt.append(({**query,'page_token':r['next_page_token']},name,version))
   pending=nxt
 except Exception as e:errors.append({'batch':offset,'error':str(e)})
details={}
for id in sorted({x['id'] for x in records}):
 try:
  j=request('https://api.osv.dev/v1/vulns/'+id);details[id]={'summary':j.get('summary',''),'withdrawn':j.get('withdrawn'),'aliases':j.get('aliases',[]),'malwareRelated':id.startswith('MAL-') or bool(re.search(r'malicious|malware|credential.steal|backdoor',j.get('summary','')+' '+j.get('details',''),re.I))}
 except Exception as e:errors.append({'id':id,'error':str(e)})
out={'queriedAt':time.time(),'packages':len(packages),'seconds':round(time.time()-start,2),'records':records,'details':details,'errors':errors,'note':'An empty result means no matching published advisory was returned; it is not a malware-free assessment.'}
(a.out/'advisories.json').write_text(json.dumps(out,indent=2),encoding='utf-8')
print(json.dumps({'packages':len(packages),'advisoryIds':len(details),'malwareRelated':[k for k,v in details.items() if v['malwareRelated']],'errors':len(errors)}))
