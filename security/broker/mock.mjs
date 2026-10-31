import http from 'node:http';
import crypto from 'node:crypto';
http.createServer((req,res)=>{
 if(req.url!=='/v1/responses'||req.method!=='POST'){res.writeHead(404);return res.end()}
 let body='';req.on('data',b=>{body+=b;if(body.length>1048576)req.destroy()});req.on('end',()=>{
  if(req.headers.authorization!=='Bearer SYNTHETIC_BROKER_ONLY'){res.writeHead(403);return res.end()}
  const value=JSON.parse(body);if(!JSON.stringify(value).includes('SYNTHETIC_BROKER_INTEGRATION')){res.writeHead(403);return res.end()}
  console.log(JSON.stringify({event:'mock-received',sha256:crypto.createHash('sha256').update(body).digest('hex'),bytes:Buffer.byteLength(body)}));
  const item={type:'message',id:'msg_mock',role:'assistant',status:'completed',content:[{type:'output_text',text:'Synthetic lesson: random assignment addresses selection bias.',annotations:[]}]};
  res.writeHead(200,{'content-type':'text/event-stream'});
  for(const event of [{type:'response.created',response:{id:'resp_mock'}},{type:'response.output_item.added',output_index:0,item:{...item,content:[]}},{type:'response.content_part.added',output_index:0,content_index:0,part:{type:'output_text',text:'',annotations:[]}},{type:'response.output_text.delta',output_index:0,content_index:0,delta:item.content[0].text},{type:'response.output_item.done',output_index:0,item},{type:'response.completed',response:{id:'resp_mock',status:'completed',output:[item],usage:{input_tokens:4,output_tokens:8,total_tokens:12}}}])res.write(`data: ${JSON.stringify(event)}\n\n`);
  res.end();
 });
}).listen(8090,'0.0.0.0');
