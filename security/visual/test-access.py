from pathlib import Path
import os, json, subprocess, urllib.request, urllib.error, time, http.client
D=os.environ.get('DOCKER','docker'); token=subprocess.check_output([D,'exec','lh-visual-fixture-visual-1','cat','/view-secret/token'],text=True).strip()
def request(path='/',method='GET',headers=None):
 r=urllib.request.Request('http://127.0.0.1:3189'+path,method=method,headers=headers or {})
 try:
  with urllib.request.urlopen(r,timeout=5) as s:return s.status,dict(s.headers)
 except urllib.error.HTTPError as e:return e.code,dict(e.headers)
 except http.client.RemoteDisconnected:return 0,{}
for _ in range(50):
 try:
  if request()[0]==200:break
 except (OSError, urllib.error.URLError):pass
 time.sleep(.2)
checks=[]
def check(name,condition):
 checks.append({'name':name,'pass':condition});assert condition,name
check('fixed viewer public but contains no app data',request()[0]==200)
check('forged host denied',request(headers={'Host':'attacker.invalid'})[0]==403)
check('missing session token denied',request('/session','POST',{'Origin':'http://127.0.0.1:3189'})[0]==403)
check('foreign origin denied',request('/session','POST',{'Origin':'https://attacker.invalid','X-View-Token':token})[0]==403)
check('bad session token denied',request('/session','POST',{'Origin':'http://127.0.0.1:3189','X-View-Token':'a'*64})[0]==403)
code,headers=request('/session','POST',{'Origin':'http://127.0.0.1:3189','X-View-Token':token})
check('valid capability produces HttpOnly strict cookie',code==204 and 'HttpOnly' in headers.get('Set-Cookie','') and 'SameSite=Strict' in headers.get('Set-Cookie',''))
for path in ['/app','/control','/subscription','/novnc/../../../../view-secret/token','/novnc/%2e%2e/%2e%2e/%2e%2e/view-secret/token']:
 check('no app/control/file proxy '+path,request(path)[0]==404)
for origin,cookie in [('https://attacker.invalid','lh_visual='+token),('http://127.0.0.1:3189','lh_visual='+'b'*64)]:
 check('websocket unauthorized denied '+origin,request('/websockify',headers={'Origin':origin,'Cookie':cookie,'Upgrade':'websocket','Connection':'Upgrade','Sec-WebSocket-Key':'MDEyMzQ1Njc4OWFiY2RlZg==','Sec-WebSocket-Version':'13'})[0] in (0,403))
Path(__file__).with_name('visual-auth-results.json').write_text(json.dumps(checks,indent=2)+'\n',encoding='utf-8')
print('PASS',len(checks),'visual gateway access checks')
