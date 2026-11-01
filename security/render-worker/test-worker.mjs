import http from 'node:http';import assert from 'node:assert/strict';
// Run in a disposable renderer container, not a real course/account deployment.
const request=(value)=>new Promise((resolve,reject)=>{const b=Buffer.from(JSON.stringify(value));const r=http.request({socketPath:'/render-ipc/render.sock',path:'/render',method:'POST',headers:{'content-type':'application/json','content-length':b.length}},s=>{let x='';s.on('data',b=>x+=b);s.on('end',()=>resolve({status:s.statusCode,body:JSON.parse(x)}))});r.on('error',reject);r.setTimeout(30000,()=>r.destroy(new Error('Timeout')));r.end(b)});
assert.equal((await request({op:'info',path:'/etc/passwd'})).status,502);
assert.equal((await request({op:'demo',html:'<script>window.answer=42</script>',probe:'answer',settleMs:0})).body.probeResult,42);
const denied=await request({op:'demo',html:'<script>setTimeout(()=>fetch("http://192.168.1.1/"),50)</script>',settleMs:300});assert.ok(denied.body.failedRequests.length);
const began=Date.now();assert.equal((await request({op:'demo',html:'<p>Timeout</p>',probe:'(()=>{while(true){}})()',settleMs:0})).status,502);assert.ok(Date.now()-began<30000);
assert.equal((await request({op:'demo',html:'<p>Recovered</p>',probe:'document.body.textContent',settleMs:0})).body.probeResult,'Recovered');
console.log('PASS path denial, demo mechanics, delayed LAN attempt, deadline and recovery');
