"""Rebase only app-owned code on a pinned stable runtime; never mount live data."""
import subprocess,json,hashlib,argparse,re
from pathlib import Path
cli=argparse.ArgumentParser(description=__doc__)
cli.add_argument('--images',type=Path,required=True,help='Private JSON mapping component keys to exact local source image IDs')
cli.add_argument('--out',type=Path,required=True)
cli.add_argument('--docker',default='docker')
a=cli.parse_args();out=a.out.resolve();out.mkdir(parents=True,exist_ok=True);d=a.docker
pins=json.loads(a.images.read_text(encoding='utf-8'))
keys=['APP_IMAGE','BROKER_IMAGE','REVIEW_IMAGE','NATIVE_IMAGE','VIEW_NET_IMAGE','EGRESS_NET_IMAGE','RENDER_IMAGE']
if not isinstance(pins,dict) or set(keys)-pins.keys():raise ValueError('All seven component image IDs required')
for key in keys:
 if not isinstance(pins[key],str) or not re.fullmatch(r'sha256:[0-9a-f]{64}',pins[key]):raise ValueError('Exact local image IDs required')
if (out/'images.json').exists():raise ValueError('Use a fresh output directory')
base='node@sha256:54f84b4cf8432b21aaffd5d3ce8d41e12cea0d10d33c09d2f3c9879d49d6b446'
result={}
for key in keys:
 old=pins[key];cfg=json.loads(subprocess.check_output([d,'image','inspect',old],text=True))[0]['Config']
 path={'APP_IMAGE':'/app','BROKER_IMAGE':'/broker-code','REVIEW_IMAGE':'/broker-code','NATIVE_IMAGE':'/native','RENDER_IMAGE':'/app'}.get(key)
 source_tag='learnharness-audit-source:'+key.lower()
 subprocess.run([d,'tag',old,source_tag],check=True)
 assert subprocess.check_output([d,'image','inspect',source_tag,'--format','{{.Id}}'],text=True).strip()==old
 lines=['FROM '+source_tag+' AS previous','FROM '+base,'USER root']
 packages=[]
 if key=='RENDER_IMAGE':packages=['chromium','tini','fonts-liberation']
 if key in ['VIEW_NET_IMAGE','EGRESS_NET_IMAGE']:packages=['iptables','util-linux']
 if packages:lines+=['RUN apt-get update && apt-get install -y --no-install-recommends '+' '.join(packages)+' && rm -rf /var/lib/apt/lists/*']
 lines+=['RUN rm -rf /usr/local/lib/node_modules /opt/yarn-* && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/yarn /usr/local/bin/yarnpkg']
 if path:lines+=['COPY --from=previous '+path+' '+path]
 else:
  name='view-network' if key=='VIEW_NET_IMAGE' else 'egress-network';lines+=['COPY --from=previous /usr/local/bin/'+name+' /usr/local/bin/'+name]
 if path=='/app':lines+=['RUN test ! -e /app/.git && test ! -e /app/data']
 dirs={'APP_IMAGE':['/state','/app-ipc','/broker','/course','/render-ipc'],'BROKER_IMAGE':['/broker','/control','/state','/app-ipc','/view-secret','/subscription','/policy','/egress'],'REVIEW_IMAGE':['/broker','/control','/state','/app-ipc','/view-secret','/subscription','/policy','/egress'],'NATIVE_IMAGE':['/app-ipc','/view-secret'],'RENDER_IMAGE':['/render-ipc']}.get(key,[])
 if dirs:lines+=['RUN mkdir -p '+' '.join(dirs)+' && chown node:node '+' '.join(dirs)]
 for env in cfg.get('Env',[]):
  name,val=env.split('=',1)
  if name not in ['NODE_VERSION','YARN_VERSION']:lines+=['ENV '+name+'='+json.dumps(val)]
 if cfg.get('WorkingDir'):lines+=['WORKDIR '+cfg['WorkingDir']]
 if cfg.get('User'):lines+=['USER '+cfg['User']]
 if cfg.get('Entrypoint'):lines+=['ENTRYPOINT '+json.dumps(cfg['Entrypoint'])]
 if cfg.get('Cmd'):lines+=['CMD '+json.dumps(cfg['Cmd'])]
 if cfg.get('Healthcheck'):
  h=cfg['Healthcheck'];test=h['Test'];flags=' '.join('--'+k+'='+str(h[K])+'ns' for K,k in [('Interval','interval'),('Timeout','timeout'),('StartPeriod','start-period')] if h.get(K))
  if h.get('Retries'):flags+=' --retries='+str(h['Retries'])
  lines+=['HEALTHCHECK '+flags+' CMD '+(test[1] if test[0]=='CMD-SHELL' else json.dumps(test[1:]))]
 recipe='\n'.join(lines)+'\n';(out/(key+'.Dockerfile')).write_text(recipe)
 tag='learnharness-audit-minimal:'+key.lower();print('Building '+key,flush=True)
 r=subprocess.run([d,'build','--network','default' if packages else 'none','--pull=false','-t',tag,'-'],input=recipe,text=True,capture_output=True,timeout=900)
 (out/(key+'-build.log')).write_text(r.stdout+r.stderr,encoding='utf-8')
 if r.returncode:raise RuntimeError('Build failed: '+key+'; inspect private build log')
 new=subprocess.check_output([d,'image','inspect',tag,'--format','{{.Id}}'],text=True).strip()
 result[key]={'previous':old,'image':new,'recipeSha256':hashlib.sha256(recipe.encode()).hexdigest(),'codeCopiedUnchanged':path,'base':base}
 (out/'images.json').write_text(json.dumps(result,indent=2));print(key+' '+new,flush=True)
