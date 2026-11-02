// Synthetic provider for visual restoration tests only. Never used with a real account.
import http from 'node:http';
let calls=0;
const usage={input_tokens:10,output_tokens:20,total_tokens:30};
http.createServer((req,res)=>{
 let raw='';req.on('data',b=>{raw+=b;if(raw.length>1048576)req.destroy()});req.on('end',()=>{
  if(req.method!=='POST'||req.url!=='/v1/responses'||req.headers.authorization!=='Bearer SYNTHETIC_BROKER_ONLY'){res.writeHead(403);return res.end();}
  const body=JSON.parse(raw);if(!raw.includes('VISUAL_FIXTURE')){res.writeHead(403);return res.end();}
  calls++;const tool=body.tools?.find(t=>['quiz','probe'].includes(t.name));
  const quiz=tool&&calls===1;
  const args=JSON.stringify({question:'Which design removes systematic treatment selection?',options:[{label:'Random assignment'},{label:'Selecting the highest earners'}],correctAnswer:'Random assignment',explanation:'Random assignment breaks systematic selection into treatment.',type:'check',nodeId:'random-assignment'});
  const item=quiz?{type:'function_call',id:'fc_visual_fixture',call_id:'call_visual_fixture',name:tool.name,arguments:args,status:'completed'}:{type:'message',id:'msg_visual_fixture_'+calls,role:'assistant',status:'completed',content:[{type:'output_text',text:'## 1. Random assignment\n\nRandom assignment removes systematic selection into treatment.\n\n$$ATE = E[Y(1)-Y(0)]$$\n\nThis is a synthetic interface test, not a sourced course lesson.',annotations:[]}]};
  const events=[{type:'response.created',response:{id:'resp_visual_fixture_'+calls,status:'in_progress',output:[]}}];
  if(quiz){events.push({type:'response.output_item.added',output_index:0,item:{...item,arguments:''}},{type:'response.function_call_arguments.delta',item_id:item.id,output_index:0,delta:args},{type:'response.function_call_arguments.done',item_id:item.id,output_index:0,arguments:args});}
  else {events.push({type:'response.output_item.added',output_index:0,item:{...item,content:[]}},{type:'response.content_part.added',output_index:0,content_index:0,part:{type:'output_text',text:'',annotations:[]}},{type:'response.output_text.delta',output_index:0,content_index:0,delta:item.content[0].text});}
  events.push({type:'response.output_item.done',output_index:0,item},{type:'response.completed',response:{id:'resp_visual_fixture_'+calls,status:'completed',output:[item],usage}});
  res.writeHead(200,{'content-type':'text/event-stream'});for(const event of events)res.write(`data: ${JSON.stringify(event)}\n\n`);res.end();console.log(JSON.stringify({syntheticCall:calls,quiz:Boolean(quiz)}));
 });
}).listen(8090,'0.0.0.0');
