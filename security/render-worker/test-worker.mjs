import http from 'node:http';import assert from 'node:assert/strict';
// Run in a disposable renderer container, not a real course/account deployment.
const request=(value)=>new Promise((resolve,reject)=>{const b=Buffer.from(JSON.stringify(value));const r=http.request({socketPath:'/render-ipc/render.sock',path:'/render',method:'POST',headers:{'content-type':'application/json','content-length':b.length}},s=>{let x='';s.on('data',b=>x+=b);s.on('end',()=>resolve({status:s.statusCode,body:JSON.parse(x)}))});r.on('error',reject);r.setTimeout(30000,()=>r.destroy(new Error('Timeout')));r.end(b)});
assert.equal((await request({op:'info',path:'/etc/passwd'})).status,502);
assert.equal((await request({op:'demo',html:'<script>window.answer=42</script>',probe:'answer',settleMs:0})).body.probeResult,42);
// Await the actual delayed attempt: a short observation window can miss a
// throttled background timer and falsely claim that delayed behaviour was tested.
const denied=await request({op:'demo',html:'<script>window.attempt=new Promise(resolve=>setTimeout(()=>fetch("http://192.168.1.1/").then(()=>resolve("sent"),()=>resolve("blocked")),500))</script>',probe:'window.attempt',settleMs:0});
assert.equal(denied.status,200);assert.equal(denied.body.probeResult,'blocked');assert.ok(denied.body.failedRequests.length);
const began=Date.now();assert.equal((await request({op:'demo',html:'<p>Timeout</p>',probe:'(()=>{while(true){}})()',settleMs:0})).status,502);assert.ok(Date.now()-began<30000);
assert.equal((await request({op:'demo',html:'<p>Recovered</p>',probe:'document.body.textContent',settleMs:0})).body.probeResult,'Recovered');
// Build one bounded PDF for the sandboxed worker without depending on an app-side parser.
function cropFixture() {
  const content = '0.8 0 0 rg 0 0 100 80 re f';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Count 1 /Kids [3 0 R] >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 80] /Contents 4 0 R >>',
    '<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((body, i) => {
    const offset = pdf.length;
    pdf += (i + 1) + ' 0 obj\n' + body + '\nendobj\n';
    return offset;
  });
  const xref = pdf.length;
  pdf += 'xref\n0 5\n0000000000 65535 f \n';
  for (const offset of offsets) pdf += String(offset).padStart(10, '0') + ' 00000 n \n';
  pdf += 'trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
  return Buffer.from(pdf, 'ascii').toString('base64');
}
const render = { op: 'render', pdf: cropFixture(), pages: [1], dpi: 72 };
const full = await request(render);
const cropped = await request({ ...render, crop: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 } });
assert.equal(full.status, 200);
assert.equal(cropped.status, 200);
const size = ({ body }) => {
  const png = Buffer.from(body[0].png, 'base64');
  return [png.readUInt32BE(16), png.readUInt32BE(20)];
};
assert.deepEqual(size(full), [100, 80]);
assert.deepEqual(size(cropped), [50, 40]);
assert.equal((await request({ ...render, crop: { x: 0.7, y: 0, width: 0.5, height: 1 } })).status, 502);
assert.equal((await request({ ...render, fitLongSide: 4097 })).status, 502);
console.log('PASS path denial, demo mechanics, delayed LAN attempt, deadline and recovery');
