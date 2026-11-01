"""Trusted pixel gateway. No app HTML/JS, clipboard or credential proxy routes."""
import os, pathlib, hmac, re
from http.cookies import SimpleCookie
from urllib.parse import urlsplit, unquote
from websockify.websocketproxy import WebSocketProxy, ProxyRequestHandler
TOKEN=pathlib.Path('/view-secret/token').read_text().strip()
HOST=os.environ.get('LH_VISUAL_HOST','127.0.0.1:3189')
assert re.fullmatch(r'[a-f0-9]{64}',TOKEN)
assert re.fullmatch(r'127\.0\.0\.1:[0-9]{1,5}',HOST)
ORIGIN='http://'+HOST
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
   c=SimpleCookie();c.load(self.headers.get('Cookie',''));v=c.get('lh_visual');return bool(v) and hmac.compare_digest(v.value,TOKEN)
  except Exception:return False
 def do_POST(self):
  if self.path!='/session' or not self.allowed_host() or self.headers.get('Origin')!=ORIGIN or self.headers.get('Sec-Fetch-Site')=='cross-site':return self.reject()
  if self.headers.get('Transfer-Encoding') or self.headers.get('Content-Length','0')!='0':return self.reject(400)
  if not hmac.compare_digest(self.headers.get('X-View-Token',''),TOKEN):return self.reject()
  self.send_response(204);self.send_header('Set-Cookie','lh_visual='+TOKEN+'; HttpOnly; SameSite=Strict; Path=/');self.send_header('Content-Length','0');self.end_headers()
 def do_GET(self):
  if not self.allowed_host():return self.reject()
  if self.headers.get('Upgrade','').lower()=='websocket':
   if self.path!='/websockify' or self.headers.get('Origin')!=ORIGIN or not self.authorized():return self.reject()
   return super().do_GET()
  route=urlsplit(self.path).path
  fixed={'/':('/visual/viewer.html','text/html'),'/viewer.js':('/visual/viewer.js','text/javascript'),'/viewer.css':('/visual/viewer.css','text/css')}
  if route in fixed:file,kind=fixed[route];target=pathlib.Path(file)
  elif route.startswith('/novnc/'):
   suffix=unquote(route[len('/novnc/'):]);target=(pathlib.Path('/usr/share/novnc')/suffix).resolve()
   if not str(target).startswith(('/usr/share/novnc/','/usr/share/javascript/')) or not target.is_file() or target.suffix not in ['.js','.css','.png','.svg']:return self.reject(404)
   kind={'.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'}[target.suffix]
  else:return self.reject(404)
  if target.stat().st_size>2*1024*1024:return self.reject(413)
  data=target.read_bytes();self.send_response(200);self.send_header('Content-Type',kind);self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
 def validate_connection(self):
  if not self.allowed_host() or self.path!='/websockify' or self.headers.get('Origin')!=ORIGIN or not self.authorized():raise RuntimeError('Private access required')
if __name__=='__main__':
 WebSocketProxy(RequestHandlerClass=Handler,listen_host='0.0.0.0',listen_port=8080,unix_target='/browser-ipc/vnc.sock',web=None,daemon=False,verbose=False).start_server()
