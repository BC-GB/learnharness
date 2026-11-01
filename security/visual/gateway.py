"""Trusted pixel gateway. No app HTML/JS, clipboard or credential proxy routes."""
import os, pathlib, hmac, re, json, socket, http.client
from http.cookies import SimpleCookie
from urllib.parse import urlsplit, unquote
from websockify.websocketproxy import WebSocketProxy, ProxyRequestHandler
TOKEN=pathlib.Path('/view-secret/token').read_text().strip()
HOST=os.environ.get('LH_VISUAL_HOST','127.0.0.1:3189')
assert re.fullmatch(r'[a-f0-9]{64}',TOKEN)
assert re.fullmatch(r'127\.0\.0\.1:[0-9]{1,5}',HOST)
ORIGIN='http://'+HOST
class Transfer(http.client.HTTPConnection):
 def connect(self):
  self.sock=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);self.sock.settimeout(185);self.sock.connect('/browser-ipc/transfer.sock')
class Handler(ProxyRequestHandler):
 def log_message(self,*args):pass
 def end_headers(self):
  self.send_header('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
  self.send_header('Permissions-Policy','camera=(), microphone=(), geolocation=(), clipboard-read=(), clipboard-write=(), usb=(), serial=(), hid=(), display-capture=()')
  self.send_header('X-Content-Type-Options','nosniff');self.send_header('X-Frame-Options','DENY');self.send_header('Referrer-Policy','no-referrer');self.send_header('Cache-Control','no-store')
  super().end_headers()
 def reject(self,status=403):
  self.send_response(status);self.send_header('Content-Length','0');self.end_headers()
 def allowed_host(self):return self.headers.get('Host')==HOST
 def authorized(self):
  try:
   raw=self.headers.get('Cookie','')
   if len(re.findall(r'(?:^|;)\s*lh_visual=',raw))!=1:return False
   c=SimpleCookie();c.load(raw);v=c.get('lh_visual');return bool(v) and hmac.compare_digest(v.value,TOKEN)
  except Exception:return False
 def transfer(self,path,body=None,kind=None):
  c=Transfer('unused')
  try:
   c.request('POST' if body is not None else 'GET',path,body,{'Content-Type':kind} if kind else {})
   r=c.getresponse();data=r.read(8*1024*1024+1)
   if len(data)>8*1024*1024:return self.reject(413)
   if path.startswith('/export/'):
    if r.status!=200:return self.reject(r.status)
    # Only text attachments. Never copy app headers or active-document MIME types.
    data=data.decode('utf-8',errors='replace').encode('utf-8');mime='text/plain; charset=utf-8'
   else:
    value=json.loads(data)
    if path=='/sessions':
     value={'chats':[{'id':x['id'],'title':str(x.get('title','Session'))[:300]} for x in value.get('chats',[])[:1000] if isinstance(x,dict) and re.fullmatch(r'[A-Za-z0-9_-]{1,100}',str(x.get('id','')))]}
    else:
     value={'results':[{'ok':x.get('ok') is True,'filePath':str(x.get('filePath',''))[:500],'error':str(x.get('error',''))[:1000]} for x in value.get('results',[])[:20] if isinstance(x,dict)],'error':str(value.get('error',''))[:1000]}
    data=json.dumps(value).encode();mime='application/json'
   self.send_response(r.status);self.send_header('Content-Type',mime)
   if path.startswith('/export/'):self.send_header('Content-Disposition','attachment; filename="'+path[8:]+'.md"')
   self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
  except Exception:return self.reject(502)
  finally:c.close()
 def do_POST(self):
  if not self.allowed_host() or self.headers.get('Origin')!=ORIGIN or self.headers.get('Sec-Fetch-Site')=='cross-site':return self.reject()
  if self.path=='/import':
   if not self.authorized() or self.headers.get('X-Visual-Request')!='1':return self.reject()
   kind=self.headers.get('Content-Type','');length=self.headers.get('Content-Length','')
   if not re.fullmatch(r'multipart/form-data; boundary=[A-Za-z0-9\x27()+_,./:=?-]{1,100}',kind):return self.reject(400)
   if self.headers.get('Transfer-Encoding') or not length.isdigit() or not 0<int(length)<=21*1024*1024:return self.reject(413)
   self.connection.settimeout(20);body=self.rfile.read(int(length))
   if len(body)!=int(length):return self.reject(400)
   return self.transfer('/import',body,kind)
  if self.path!='/session':return self.reject(404)
  if self.headers.get('Transfer-Encoding') or self.headers.get('Content-Length','0')!='0':return self.reject(400)
  if not hmac.compare_digest(self.headers.get('X-View-Token',''),TOKEN):return self.reject()
  self.send_response(204);self.send_header('Set-Cookie','lh_visual='+TOKEN+'; HttpOnly; SameSite=Strict; Path=/');self.send_header('Content-Length','0');self.end_headers()
 def do_GET(self):
  if not self.allowed_host():return self.reject()
  if self.path=='/account':
   if not self.authorized() or self.headers.get('Sec-Fetch-Site')=='cross-site':return self.reject()
   self.send_response(303);self.send_header('Location','http://127.0.0.1:3188/account.html#'+TOKEN);self.send_header('Content-Length','0');self.end_headers();return
  if self.path in ['/session','/sessions'] or re.fullmatch(r'/export/[A-Za-z0-9_-]{1,100}',self.path):
   if not self.authorized() or self.headers.get('X-Visual-Request')!='1' or self.headers.get('Sec-Fetch-Site')=='cross-site':return self.reject()
   if self.path=='/session':return self.reject(204)
   return self.transfer(self.path)
  if self.headers.get('Upgrade','').lower()=='websocket':
   if self.path not in ['/websockify','/scroll'] or self.headers.get('Origin')!=ORIGIN or not self.authorized():return self.reject()
   return super().do_GET()
  route=urlsplit(self.path).path
  fixed={'/':('/visual/viewer.html','text/html'),'/viewer.js':('/visual/viewer.js','text/javascript'),'/viewer.css':('/visual/viewer.css','text/css'),'/scroll-client.js':('/visual/scroll-client.js','text/javascript')}
  if route in fixed:file,kind=fixed[route];target=pathlib.Path(file)
  elif route.startswith('/novnc/'):
   suffix=unquote(route[len('/novnc/'):]);target=(pathlib.Path('/usr/share/novnc')/suffix).resolve()
   if not str(target).startswith(('/usr/share/novnc/','/usr/share/javascript/')) or not target.is_file() or target.suffix not in ['.js','.css','.png','.svg']:return self.reject(404)
   kind={'.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'}[target.suffix]
  else:return self.reject(404)
  if target.stat().st_size>2*1024*1024:return self.reject(413)
  data=target.read_bytes();self.send_response(200);self.send_header('Content-Type',kind);self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
 def validate_connection(self):
  if not self.allowed_host() or self.path not in ['/websockify','/scroll'] or self.headers.get('Origin')!=ORIGIN or not self.authorized():raise RuntimeError('Private access required')
 def new_websocket_client(self):
  if self.path!='/scroll':return super().new_websocket_client()
  # Only this fixed, input-only socket. Never expose the browser control pipe.
  target=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM)
  try:
   target.connect('/browser-ipc/scroll.sock');self.request.setsockopt(socket.IPPROTO_TCP,socket.TCP_NODELAY,1);self.do_proxy(target)
  finally:target.close()
if __name__=='__main__':
 WebSocketProxy(RequestHandlerClass=Handler,listen_host='0.0.0.0',listen_port=8080,unix_target='/browser-ipc/vnc.sock',web=None,daemon=False,verbose=False).start_server()
