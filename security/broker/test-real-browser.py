"""Real Chromium test of the restricted mock-only interface. No personal profile."""
import argparse,json,os,subprocess,time,uuid,tempfile,socket,threading,base64,shutil
from urllib.parse import urlparse,parse_qs,urlencode
from pathlib import Path
from http.server import ThreadingHTTPServer,BaseHTTPRequestHandler
from playwright.sync_api import sync_playwright,expect
p=argparse.ArgumentParser();p.add_argument('--docker',default='docker');p.add_argument('--app-image',required=True);p.add_argument('--node-image',required=True);p.add_argument('--firewall-image',required=True);p.add_argument('--chromium',required=True);p.add_argument('--evidence-dir',required=True);p.add_argument('--subscription-fixture',action='store_true');a=p.parse_args()
assert a.app_image.startswith('sha256:') and '@sha256:' in a.node_image
root=Path(__file__).resolve().parent;evidence=Path(a.evidence_dir).resolve();evidence.mkdir(parents=True,exist_ok=True)
project='lh-browser-fixture-'+uuid.uuid4().hex[:10];tag=project+':broker';nettag=project+':network';netbase=project+':network-base';events=[];checks=[];token='';errors=[];outside=[];canary_hits=[]
env=os.environ.copy();env.update(APP_IMAGE=a.app_image,BROKER_IMAGE=tag,VIEW_NET_IMAGE=nettag)
def run(args,check=True,secret=False):
 r=subprocess.run([a.docker,*args],capture_output=True,text=True,encoding='utf-8',timeout=120,env=env)
 events.append({'args':args,'exit':r.returncode,'stdout':'[private fixture capability]' if secret else r.stdout,'stderr':r.stderr})
 if check and r.returncode:raise RuntimeError(r.stderr)
 return r
class Canary(BaseHTTPRequestHandler):
 def do_GET(self):
  if self.path.startswith('/hit'):canary_hits.append(self.path)
  self.send_response(200);self.send_header('Content-Type','text/html');self.end_headers();self.wfile.write(b'<!doctype html><title>Isolated cross-origin fixture</title>')
 def do_POST(self):canary_hits.append(self.path);self.send_response(204);self.end_headers()
 def log_message(self,*args):pass
canary=ThreadingHTTPServer(('127.0.0.1',0),Canary);threading.Thread(target=canary.serve_forever,daemon=True).start();other=f'http://127.0.0.1:{canary.server_port}'
with socket.socket() as s:s.bind(('127.0.0.1',0));port=s.getsockname()[1]
origin=f'http://127.0.0.1:{port}'
with tempfile.TemporaryDirectory(prefix='fixture-',dir=evidence) as tmp:
 override=Path(tmp)/'browser.yaml';override.write_text(f'services:\n  view-net:\n    ports: !override ["127.0.0.1:{port}:8080"]\n  view:\n    environment:\n      LH_VIEW_HOST: "127.0.0.1:{port}"\n',encoding='utf-8')
 if a.subscription_fixture:
  with override.open('a',encoding='utf-8') as f:f.write('  broker:\n    command: [node, mock-subscription.mjs]\n    volumes: [subscription:/subscription, policy:/policy]\nvolumes:\n  subscription:\n  policy:\n')
 base=['compose','--project-name',project,'--file',str(root/'compose.mock.yaml'),'--file',str(override)]
 try:
  run(['build','--network','none','--pull=false','--build-arg','NODE_IMAGE='+a.node_image,'--tag',tag,str(root)])
  if a.subscription_fixture:
   shutil.copyfile(root/'mock-subscription.mjs',Path(tmp)/'mock-subscription.mjs')
   (Path(tmp)/'Dockerfile').write_text('FROM '+tag+'\nCOPY mock-subscription.mjs ./\n',encoding='utf-8')
   run(['build','--network','none','--pull=false','--tag',tag,tmp])
  assert json.loads(run(['image','inspect',a.firewall_image]).stdout)[0]['Id']==a.firewall_image
  run(['tag',a.firewall_image,netbase])
  run(['build','--network','none','--pull=false','--build-arg','FIREWALL_IMAGE='+netbase,'--file',str(root/'Dockerfile.network'),'--tag',nettag,str(root)])
  env['VIEW_NET_IMAGE']=json.loads(run(['image','inspect',nettag]).stdout)[0]['Id']
  env['BROKER_IMAGE']=json.loads(run(['image','inspect',tag]).stdout)[0]['Id'];run(base+['up','-d'])
  token=run(base+['exec','-T','view','node','-e',"process.stdout.write(require('fs').readFileSync('/view-secret/token','utf8'))"],secret=True).stdout.strip()
  with sync_playwright() as pw:
   browser=pw.chromium.launch(executable_path=a.chromium,headless=True,args=['--disable-background-networking','--disable-component-update','--disable-sync','--no-first-run','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1'])
   context=browser.new_context(viewport={'width':1280,'height':960},service_workers='block',accept_downloads=False)
   def guard(route):
    u=route.request.url
    if u.startswith(origin+'/') or u.startswith(other+'/'):route.continue_()
    else:outside.append(u.split('#')[0]);route.abort()
   context.route('**/*',guard)
   page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
   try:
    last_error=None
    for _ in range(12):
     try:
      page.goto(origin+'/#'+token,wait_until='networkidle',timeout=10000)
      if 'Request failed' in page.locator('#status').inner_text():page.reload()
      expect(page.locator('#status')).to_contain_text('Connected.',timeout=3000);break
     except Exception as e:last_error=str(e).replace(token,"[fixture capability]");time.sleep(.2)
    else:
     page.screenshot(path=str(evidence/'failed-initialization.png'),full_page=True)
     raise AssertionError('Interface failed to initialize: '+str(last_error))
    checks.append('fresh real browser connects with private capability')
    assert '#' not in page.url
    assert page.evaluate('localStorage.length===0 && sessionStorage.length===0')
    assert not context.cookies();checks.append('capability removed from URL; no cookie or persistent browser storage')
    if a.subscription_fixture:
     run(base+['stop','app'])
     setup=context.new_page();setup.on('pageerror',lambda e:errors.append(str(e)));setup.goto(origin+'/account.html#'+token)
     expect(setup.locator('#status')).to_contain_text('Sign-in required')
     setup.locator('#signin').click();expect(setup.locator('#authorize-link')).to_be_visible()
     auth=parse_qs(urlparse(setup.locator('#authorize-link').get_attribute('href')).query)
     assert auth['client_id']==['dynamic_agent_client'] and auth['code_challenge_method']==['S256']
     code=base64.urlsafe_b64encode(auth['nonce'][0].encode()).decode().rstrip('=')
     callback=context.new_page();callback.goto(origin+'/auth/callback?'+urlencode({'code':code,'state':auth['state'][0],'client_id':'oaiapp_browser_fixture'}));callback.close()
     expect(setup.locator('#status')).to_contain_text('Signed in.',timeout=10000)
     cid=run(base+['ps','-a','-q','app']).stdout.strip()
     state=json.loads(run(['inspect',cid]).stdout)[0]
     assert state['State']['Status']=='exited'
     assert not any(m['Destination'] in ['/subscription','/policy','/egress','/control','/view-secret'] for m in state['Mounts'])
     assert setup.evaluate('localStorage.length===0 && sessionStorage.length===0') and not context.cookies()
     setup.screenshot(path=str(evidence/'account-setup.png'),full_page=True);setup.close()
     run(base+['up','-d','--wait','app'])
     expect(page.locator('#account-status')).to_contain_text('Signed in with ChatGPT plan permission',timeout=10000)
     expect(page.locator('#send')).to_be_disabled();expect(page.locator('#spending-status')).to_contain_text('Inference locked')
     assert 'mock-received' not in run(base+['logs','--no-log-prefix','mock']).stdout
     # Trusted operator fixture writes a SYNTHETIC policy; there is no UI/app unlock route.
     unlock="const fs=require('fs');const db=JSON.parse(fs.readFileSync('/subscription/accounts/accounts.json','utf8'));fs.writeFileSync('/policy/plan-only.json',JSON.stringify({version:1,accountKey:db.active,paidCreditsDisabled:true,evidenceSha256:'a'.repeat(64),verifiedAt:Date.now(),expiresAt:Date.now()+3600000}),{mode:384});"
     run(base+['exec','-T','broker','node','-e',unlock])
     expect(page.locator('#send')).to_be_enabled(timeout=10000)
     expect(page.locator('#models option')).to_have_count(1)
     assert page.locator('#models').input_value()=='gpt-4'
     checks.append('account-only page signs in while app is stopped; no credential mounts/storage; spending stays locked until separate fixture policy; account-specific model shown')
    page.locator('#create').click();expect(page.locator('#status')).to_have_text('Lesson ready')
    first=page.locator('#chats').input_value();assert first.startswith('chat_')
    page.locator('#message').fill('SYNTHETIC_BROKER_INTEGRATION Explain random assignment.')
    page.locator('#send').click();expect(page.locator('#pending option')).to_have_count(1,timeout=20000)
    assert 'mock-received' not in run(base+['logs','--no-log-prefix','mock']).stdout
    page.locator('#review').click();expect(page.locator('#destination')).to_contain_text('ChatGPT plan' if a.subscription_fixture else 'isolated mock provider')
    expect(page.locator('#payload')).to_contain_text('SYNTHETIC_BROKER_INTEGRATION');expect(page.locator('#approve')).to_be_disabled()
    page.locator('#checked').check();page.locator('#approve').click()
    expect(page.locator('#lesson')).to_contain_text('Synthetic lesson: random assignment',timeout=20000)
    checks.append('UI creates lesson, holds request, reviews exact mock payload, approves and renders persisted response')
    page.screenshot(path=str(evidence/'approved-lesson.png'),full_page=True)
    page.locator('#create').click();expect(page.locator('#status')).to_have_text('Lesson ready')
    page.wait_for_timeout(2200)
    second=page.locator('#chats').input_value();assert second!=first,'New lesson did not select its own saved-session entry'
    checks.append('new lesson selection remains synchronized after polling')
    attack=f'<img src="{other}/hit-image" onerror="globalThis.compromised=true"><script>globalThis.compromised=true</script><iframe src="{other}/hit-frame"></iframe><button id="approve">Forged approval</button>'
    page.locator('#message').fill('SYNTHETIC_BROKER_INTEGRATION '+attack)
    page.locator('#send').click();expect(page.locator('#pending option')).to_have_count(1,timeout=20000)
    page.locator('#review').click();expect(page.locator('#payload')).to_contain_text('Forged approval')
    def leaf_strings(value):
     if isinstance(value,str):yield value
     elif isinstance(value,list):
      for item in value:yield from leaf_strings(item)
     elif isinstance(value,dict):
      for item in value.values():yield from leaf_strings(item)
    assert any(attack in value for value in leaf_strings(json.loads(page.locator('#payload').inner_text()))), 'Reviewed JSON lost the attack fixture'
    expect(page.locator('#lesson')).to_contain_text(attack)
    expect(page.locator('#approve')).to_have_count(1)
    assert page.locator('img,iframe,object').count()==0 and not page.evaluate('Boolean(globalThis.compromised)') and not canary_hits
    page.locator('#reject').click();expect(page.locator('#pending option')).to_have_count(0,timeout=10000)
    assert run(base+['logs','--no-log-prefix','mock']).stdout.count('mock-received')==1
    checks.append('malicious request/lesson markup stays inert; reject clears request without dispatch')
    # Verify the browser itself enforces CSP, rather than relying on a request interceptor.
    result=page.evaluate('''async other=>{const violations=[];document.addEventListener('securitypolicyviolation',e=>violations.push(e.violatedDirective));const img=document.createElement('img');img.src=other+'/hit-csp-image';document.body.append(img);const frame=document.createElement('iframe');frame.src=other+'/hit-csp-frame';document.body.append(frame);const script=document.createElement('script');script.textContent='globalThis.inlineExecuted=true';document.body.append(script);let blocked=false;try{await fetch(other+'/hit-csp-fetch')}catch{blocked=true}await new Promise(r=>setTimeout(r,300));img.remove();frame.remove();script.remove();return {violations,blocked,inlineExecuted:Boolean(globalThis.inlineExecuted)}}''',other)
    assert result['blocked'] and not result['inlineExecuted'];assert any(x.startswith('img-src') for x in result['violations']);assert any(x.startswith('frame-src') for x in result['violations']);assert not canary_hits
    checks.append('Chromium CSP blocks inline scripts, external fetch, image and frame loads; canary receives zero requests')
    # Even possessing a fixture token does not let another origin call the view.
    attacker=context.new_page();attacker.goto(other)
    cross=attacker.evaluate('''async ({origin,token})=>{try{await fetch(origin+'/control',{method:'POST',headers:{'content-type':'application/json','x-view-token':token},body:JSON.stringify({op:'list'})});return false}catch{return true}}''',{'origin':origin,'token':token})
    assert cross;attacker.close();checks.append('real cross-origin browser request blocked')
    page.reload();expect(page.locator('#status')).to_have_text('Private access required',timeout=10000)
    expect(page.locator('#lesson')).to_have_text('');checks.append('reload without private link loses access and clears lesson')
    page.goto(origin+'/#'+token);expect(page.locator('#status')).to_contain_text('Connected.')
    page.locator('#chats').select_option(first);expect(page.locator('#lesson')).to_contain_text('Synthetic lesson: random assignment',timeout=10000)
    run(base+['restart','app'])
    page.goto('about:blank');page.goto(origin+'/#'+token);expect(page.locator('#status')).to_contain_text('Connected.',timeout=20000)
    page.locator('#chats').select_option(first);expect(page.locator('#lesson')).to_contain_text('Synthetic lesson: random assignment',timeout=20000)
    checks.append('saved lesson reload and app restart persistence')
    seed=r"const fs=require('fs');const [id,text]=process.argv.slice(1);if(!/^chat_[a-z0-9_]+$/.test(id))throw Error('id');const file='/state/data/chats/'+id+'.json';const record=JSON.parse(fs.readFileSync(file,'utf8'));const m=record.messages.find(m=>m.role==='assistant');if(!m)throw Error('no assistant');m.content=[{type:'text',text:'Synthetic lesson: random assignment. '+text}];fs.writeFileSync(file,JSON.stringify(record));"
    run(base+['exec','-T','app','node','-e',seed,first,attack])
    expect(page.locator('#lesson')).to_contain_text('Forged approval',timeout=10000)
    assert page.locator('img,iframe,object').count()==0 and page.locator('script').count()==1
    assert not page.evaluate('Boolean(globalThis.compromised)') and not canary_hits
    checks.append('malicious app-authored assistant output cannot execute markup or create a forged approval button')
    page.screenshot(path=str(evidence/'final-browser.png'),full_page=True)
    assert not errors,errors;assert not outside,outside
    version=browser.version
    probe=r"import net from 'node:net';import fs from 'node:fs';import {Resolver} from 'node:dns/promises';import assert from 'node:assert/strict';for(const host of ['1.1.1.1','192.168.65.254','169.254.169.254','2606:4700:4700::1111']){const denied=await new Promise(r=>{const s=net.connect({host,port:443});s.setTimeout(350);s.on('connect',()=>{s.destroy();r(false)});s.on('error',()=>r(true));s.on('timeout',()=>{s.destroy();r(true)})});assert.equal(denied,true)}const dns=new Resolver({timeout:300,tries:1});dns.setServers(['127.0.0.11']);try{await dns.resolve4('example.com');throw Error('DNS escaped')}catch(e){assert.ok(['ETIMEOUT','ECONNREFUSED','ENETUNREACH'].includes(e.code),'unexpected DNS result '+e.code)}assert.match(fs.readFileSync('/proc/self/status','utf8'),/CapEff:\s+0+\n/);console.log('outbound IPv4/IPv6, host, metadata and DNS denied; capabilities zero')"
    run(base+['exec','-T','view','node','--input-type=module','-e',probe])
    run(base+['exec','-T','view-net','iptables','-L','OUTPUT','-nv'])
    run(base+['restart','view-net'])
    for _ in range(40):
     cid=run(base+['ps','-q','view-net']).stdout.strip()
     if run(['inspect','--format','{{.State.Health.Status}}',cid]).stdout.strip()=='healthy':break
     time.sleep(.1)
    run(base+['up','-d','--wait','--force-recreate','--no-deps','view'])
    page.goto('about:blank');page.goto(origin+'/#'+token);expect(page.locator('#status')).to_contain_text('Connected.',timeout=20000)
    run(base+['exec','-T','view','node','--input-type=module','-e',probe])
    checks.append('view firewall denies outbound TCP/DNS and survives namespace/view restart')
    for label in ['third','fourth']:
     page.locator('#create').click();expect(page.locator('#status')).to_have_text('Lesson ready')
     page.locator('#message').fill('SYNTHETIC_BROKER_INTEGRATION '+label);page.locator('#send').click()
     expect(page.locator('#pending option')).to_have_count(1 if label=='third' else 2,timeout=10000)
     if label=='third':
      page.locator('#review').click();expect(page.locator('#payload')).to_contain_text('third');page.locator('#checked').check();old=page.locator('#pending').input_value()
    ids=page.locator('#pending option').evaluate_all('(options)=>options.map(o=>o.value)')
    page.locator('#pending').select_option(next(i for i in ids if i!=old));expect(page.locator('#approve')).to_be_disabled();expect(page.locator('#checked')).not_to_be_checked();expect(page.locator('#payload')).to_have_text('')
    for remaining in [1,0]:
     page.locator('#review').click();expect(page.locator('#reject')).to_be_enabled();page.locator('#reject').click();expect(page.locator('#pending option')).to_have_count(remaining,timeout=10000)
    assert run(base+['logs','--no-log-prefix','mock']).stdout.count('mock-received')==1
    checks.append('switching pending requests clears prior review/consent; rejected requests never dispatch')
    if a.subscription_fixture:
     page.locator('#signout').click();expect(page.locator('#account-status')).to_contain_text('Sign-in required',timeout=10000)
     expect(page.locator('#send')).to_be_disabled();expect(page.locator('#status')).to_contain_text('revoked')
     assert page.evaluate('localStorage.length===0 && sessionStorage.length===0') and not context.cookies()
     assert 'SYNTHETIC_BROKER_ONLY' not in page.content() and 'synthetic-refresh-only' not in page.content()
     checks.append('browser logout revokes fake session, removes credentials and disables sending; tokens never enter browser storage')
   except Exception:
    events.append({'browserFailureState':page.evaluate("({status:document.querySelector('#status')?.textContent,account:document.querySelector('#account-status')?.textContent,models:document.querySelector('#models')?.textContent})")})
    page.screenshot(path=str(evidence/'failed-scenario.png'),full_page=True)
    raise
   finally:context.close();browser.close()
  fail=Path(tmp)/'fail-init.yaml';fail.write_text('services:\n  view-net:\n    environment:\n      LH_VIEW_FAIL_INIT: "1"\n',encoding='utf-8')
  failed=run(base+['--file',str(fail),'up','-d','--force-recreate','view'],False)
  assert failed.returncode!=0
  cid=run(base+['ps','-a','-q','view']).stdout.strip()
  assert run(['inspect','--format','{{.State.Status}}',cid]).stdout.strip()!='running'
  checks.append('failed firewall initialization prevents the view from starting')
  print('PASS: '+str(len(checks))+' real-browser scenarios')
 except Exception as e:
  run(base+['exec','-T','view','node','--input-type=module','-e',"import fs from 'node:fs';import {socketJson} from './view.mjs';console.log('ipc files',fs.readdirSync('/app-ipc'));try{const r=await socketJson('/app-ipc/app.sock','/rpc','POST',{op:'models'});console.log('ipc result',r.status,Array.isArray(r.value),r.value?.length)}catch(e){console.log('ipc failure',e.code,e.message)}"],False)
  events.append({'failure':str(e).replace(token,'[fixture capability]') if token else str(e)});raise
 finally:
  run(base+['logs','--no-log-prefix','--tail','20'],False)
  run(base+['down','--volumes','--remove-orphans'],False);run(['image','rm',tag,nettag,netbase],False);canary.shutdown();canary.server_close()
  report={'checks':checks,'browser':locals().get('version'),'pageErrors':errors,'outsideRequests':outside,'canaryHits':canary_hits,'events':events}
  text=json.dumps(report,indent=2)
  if token:text=text.replace(token,'[fixture capability]')
  (evidence/'results.json').write_text(text,encoding='utf-8')
