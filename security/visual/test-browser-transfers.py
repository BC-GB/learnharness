from pathlib import Path
import subprocess,json,urllib.request,urllib.error,http.client,os,tempfile
from playwright.sync_api import sync_playwright,expect
D=os.environ.get('DOCKER','docker');base=Path(__file__).resolve().parents[2];out=Path(tempfile.mkdtemp(prefix='lh-transfer-test-'))
prefix='lh-renderer-app-fixture-';origin='http://127.0.0.1:3192'
token=subprocess.check_output([D,'exec',prefix+'visual-1','cat','/view-secret/token'],text=True).strip()
script="const h=require('http'),b=JSON.stringify({title:'<img src=x onerror=alert(1)> Transfer fixture'});const r=h.request({socketPath:'/app-ipc/web.sock',path:'/api/chats',method:'POST',headers:{host:'127.0.0.1:3000','content-type':'application/json','content-length':Buffer.byteLength(b)}},s=>{let x='';s.on('data',b=>x+=b);s.on('end',()=>console.log(x))});r.end(b)"
x=json.loads(subprocess.check_output([D,'exec',prefix+'app-1','node','-e',script],text=True));print('Created synthetic session')
def request(path,method='GET',headers=None,data=None):
 req=urllib.request.Request(origin+path,data=data,method=method,headers=headers or {})
 try:
  with urllib.request.urlopen(req,timeout=10) as r:return r.status,r.read()
 except urllib.error.HTTPError as e:return e.code,e.read()
checks=[]
def check(name,ok):checks.append({'name':name,'pass':ok});assert ok,name
for path in ['/sessions','/export/fixture','/session','/account']:
 check('unauthenticated '+path,request(path)[0]==403)
headers={'Cookie':'lh_visual='+token,'X-Visual-Request':'1'}
check('refresh authenticated',request('/session',headers=headers)[0]==204)
check('duplicate cookie denied',request('/session',headers={**headers,'Cookie':'lh_visual='+token+'; lh_visual='+token})[0]==403)
check('foreign host denied',request('/sessions',headers={**headers,'Host':'attacker.invalid'})[0]==403)
check('cross site denied',request('/sessions',headers={**headers,'Sec-Fetch-Site':'cross-site'})[0]==403)
check('missing custom header denied',request('/sessions',headers={'Cookie':'lh_visual='+token})[0]==403)
check('import foreign origin denied',request('/import','POST',{**headers,'Origin':'https://attacker.invalid'},b'abc')[0]==403)
check('import oversized denied',request('/import','POST',{**headers,'Origin':origin,'Content-Type':'multipart/form-data; boundary=abc','Content-Length':str(22*1024*1024)},b'abc')[0]==413)
for p in ['/export/../../view-secret/token','/control','/app','/api/chats','/sessions?url=http://192.168.1.1']:
 check('arbitrary proxy denied '+p,request(p,headers=headers)[0]==404)
with sync_playwright() as pw:
 b=pw.chromium.launch(headless=True,**({'executable_path':os.environ['CHROMIUM_PATH']} if os.environ.get('CHROMIUM_PATH') else {}))
 c=b.new_context(viewport={'width':1900,'height':900},service_workers='block',accept_downloads=True);page=c.new_page();outside=[];errors=[]
 page.on('pageerror',lambda e:errors.append(str(e)))
 def guard(r):
  if r.request.url.startswith(origin+'/'):r.continue_()
  else:outside.append(r.request.url);r.abort()
 c.route('**/*',guard);page.goto(origin+'/#'+token)
 expect(page.locator('#status')).to_have_text('Browser runs inside Docker',timeout=30000)
 page.reload();expect(page.locator('#status')).to_have_text('Browser runs inside Docker',timeout=30000)
 page.locator('#size').click();expect(page.locator('#size')).to_have_text('Fit to window');page.locator('#size').click()
 page.locator('#files').click();expect(page.locator('#sessions option').first).to_be_attached()
 check('untrusted session title stays text',page.locator('#sessions img').count()==0)
 with page.expect_download() as dl:page.locator('#export').click()
 download=dl.value;p=out/'transfer-export.md';download.save_as(p);check('markdown download',download.suggested_filename.endswith('.md') and p.stat().st_size>0)
 with page.expect_download() as dl:page.locator('#snapshot').click()
 download=dl.value;p=out/'transfer-screen.png';download.save_as(p);check('PNG download',p.read_bytes().startswith(b'\x89PNG'))
 page.locator('#upload').set_input_files(str(base/'tests/fixtures/sample-3page.pdf'))
 expect(page.locator('#file-status')).to_contain_text('models',timeout=30000)
 check('PDF reached original model gate','model' in page.locator('#file-status').inner_text().lower())
 check('no host app scripts',page.locator('iframe').count()==0 and not outside and not errors)
 check('no capability in local storage',page.evaluate('localStorage.length===0&&sessionStorage.length===0&&!location.hash'))
 page.screenshot(path=str(out/'transfer-dialog.png'));b.close()
(out/'results.json').write_text(json.dumps(checks,indent=2));print('PASS',len(checks),'transfer and refresh checks')
