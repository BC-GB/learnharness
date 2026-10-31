import http from 'node:http';
const [action, id, sha256] = process.argv.slice(2);
if (!['list','show','approve','reject'].includes(action) || (action !== 'list' && !/^[a-f0-9-]{36}$/.test(id ?? '')) || (['approve','reject'].includes(action) && !/^[a-f0-9]{64}$/.test(sha256 ?? ''))) throw Error('Usage: admin.mjs list | show ID | approve ID SHA256 | reject ID SHA256');
const data = ['approve','reject'].includes(action) ? JSON.stringify({action,sha256}) : null;
const req = http.request({socketPath:'/control/admin.sock',path:action==='list'?'/pending':`/requests/${id}`,method:data?'POST':'GET',headers:data?{'content-type':'application/json','content-length':Buffer.byteLength(data)}:{}},res=>{
 let output='';res.setEncoding('utf8');res.on('data',b=>{output+=b;if(output.length>4*1024*1024)res.destroy()});res.on('end',()=>{console.log(JSON.stringify(JSON.parse(output)));if(res.statusCode!==200)process.exitCode=1});
});
req.on('error',()=>{console.error('Broker control unavailable');process.exitCode=1});req.setTimeout(10000,()=>req.destroy());req.end(data);
