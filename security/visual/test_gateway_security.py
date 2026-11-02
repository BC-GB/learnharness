"""Regression cases use synthetic files and stub only the optional websocket dependency."""
import importlib.util,sys,types,unittest,pathlib,tempfile,io
from unittest.mock import patch
from http.server import BaseHTTPRequestHandler
proxy=types.ModuleType('websockify.websocketproxy');proxy.ProxyRequestHandler=BaseHTTPRequestHandler;proxy.WebSocketProxy=object
spec=importlib.util.spec_from_file_location('visual_gateway_under_test',pathlib.Path(__file__).with_name('gateway.py'))
gateway=importlib.util.module_from_spec(spec)
with patch.dict(sys.modules,{'websockify':types.ModuleType('websockify'),'websockify.websocketproxy':proxy}),patch.object(pathlib.Path,'read_text',return_value='a'*64):spec.loader.exec_module(gateway)
class SecurityTests(unittest.TestCase):
 def test_inventory_preserves_nested_assets_but_excludes_active_documents(self):
  with tempfile.TemporaryDirectory() as d:
   root=pathlib.Path(d);(root/'core').mkdir();(root/'core'/'rfb.js').write_text('export{}');(root/'index.html').write_text('active')
   inventory=gateway.static_assets(root,(root,))
   self.assertIn('/novnc/core/rfb.js',inventory);self.assertNotIn('/novnc/index.html',inventory)
 def test_symlink_outside_inventory_roots_is_not_served(self):
  with tempfile.TemporaryDirectory() as d:
   root=pathlib.Path(d)/'assets';root.mkdir();secret=pathlib.Path(d)/'secret.js';secret.write_text('private')
   try:(root/'leak.js').symlink_to(secret)
   except OSError:self.skipTest('Symlink creation unavailable on this host')
   self.assertEqual(gateway.static_assets(root,(root,)),{})
 def test_request_traversal_does_not_open_a_path(self):
  handler=object.__new__(gateway.Handler);handler.allowed_host=lambda:True;handler.headers={};rejections=[];handler.reject=lambda status=403:rejections.append(status)
  for path in ['/novnc/../secret.js','/novnc/%2e%2e/secret.js','/novnc/%252e%252e/secret.js','/novnc/%2fetc/passwd','/novnc/core/rfb.js/../../secret.js']:
   handler.path=path
   with patch.object(pathlib.Path,'read_bytes',side_effect=AssertionError('Unexpected disk read')):handler.do_GET()
  self.assertEqual(rejections,[404]*5)
 def test_export_rejects_header_injection_before_backend_dispatch(self):
  handler=object.__new__(gateway.Handler);rejections=[];handler.reject=lambda status=403:rejections.append(status)
  with patch.object(gateway,'Transfer',side_effect=AssertionError('Unexpected backend dispatch')):
   for value in ['/export/a\r\nInjected: yes','/export/../../private','/export/a";x=1']:handler.transfer(value)
  self.assertEqual(rejections,[400]*3)
 def test_export_uses_a_fixed_attachment_header(self):
  handler=object.__new__(gateway.Handler);headers={};handler.send_response=lambda _:None;handler.send_header=lambda k,v:headers.update({k:v});handler.end_headers=lambda:None;handler.wfile=io.BytesIO()
  class Response:
   status=200
   def read(self,_):return b'# Lesson'
  class Transfer:
   def __init__(self,_):pass
   def request(self,*_):pass
   def getresponse(self):return Response()
   def close(self):pass
  with patch.object(gateway,'Transfer',Transfer):handler.transfer('/export/valid_session-1')
  self.assertEqual(headers['Content-Disposition'],'attachment; filename="session.md"');self.assertEqual(handler.wfile.getvalue(),b'# Lesson')
if __name__=='__main__':unittest.main()
