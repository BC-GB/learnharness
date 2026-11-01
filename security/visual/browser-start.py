import os, subprocess, time, signal, pathlib, urllib.request, stat, re
os.environ['DISPLAY']=':99'
start_path=os.environ.get('LH_VISUAL_START_PATH','/')
if not re.fullmatch(r'/(?:chat/[A-Za-z0-9_-]{1,100})?',start_path):raise RuntimeError('Invalid start path')
children=[]
def start(args):
 p=subprocess.Popen(args); children.append(p); return p
try:
 sock=pathlib.Path('/browser-ipc/vnc.sock')
 if sock.exists():
  if not stat.S_ISSOCK(sock.lstat().st_mode):raise RuntimeError('Unexpected framebuffer path')
  sock.unlink()
 start(['Xvfb',':99','-screen','0','1440x1000x24','-nolisten','tcp','-ac'])
 for _ in range(100):
  if pathlib.Path('/tmp/.X11-unix/X99').exists():break
  time.sleep(.1)
 else:raise RuntimeError('Display failed')
 start(['node','/visual/browser-http.mjs'])
 for _ in range(120):
  try:
   with urllib.request.urlopen('http://127.0.0.1:3000/',timeout=2) as r:
    if r.status==200:break
  except Exception:time.sleep(.5)
 else:raise RuntimeError('App unavailable')
 args=['chromium','--no-sandbox','--disable-dev-shm-usage','--disable-background-networking','--disable-component-update','--disable-sync','--no-first-run','--disable-default-apps','--disable-features=MediaRouter','--user-data-dir=/tmp/chromium-profile','--noerrdialogs','--window-size=1440,1000','--window-position=0,0','--app=http://127.0.0.1:3000'+start_path]
 if os.environ.get('LH_VISUAL_TEST_DEBUG')=='1':args+=['--remote-debugging-address=127.0.0.1','--remote-debugging-port=9222']
 start(args)
 start(['x11vnc','-display',':99','-unixsock','/browser-ipc/vnc.sock','-rfbport','0','-forever','-shared','-nopw','-nosel','-noxdamage','-quiet'])
 def stop(*_):raise SystemExit()
 signal.signal(signal.SIGTERM,stop);signal.signal(signal.SIGINT,stop)
 while all(p.poll() is None for p in children):time.sleep(.5)
 raise RuntimeError('Browser component exited')
finally:
 for p in children:p.terminate()
 for p in children:
  try:p.wait(timeout=5)
  except subprocess.TimeoutExpired:p.kill()
