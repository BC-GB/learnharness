import RFB from '/novnc/core/rfb.js';
const status=document.querySelector('#status');
const token=location.hash.slice(1);history.replaceState(null,'',location.pathname);
const headers={'x-visual-request':'1'};
const message=document.querySelector('#file-status');
function save(blob,name){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
try {
 const result=/^[a-f0-9]{64}$/.test(token)
  ?await fetch('/session',{method:'POST',headers:{'x-view-token':token}})
  :await fetch('/session',{headers});
 if(!result.ok)throw Error('Open the private learning link to connect.');
 document.querySelector('#review').href='/account';
 const rfb=new RFB(document.querySelector('#screen'),`${location.protocol==='https:'?'wss':'ws'}://${location.host}/websockify`);
 rfb.scaleViewport=true;rfb.resizeSession=false;rfb.clipViewport=false;
 rfb.addEventListener('connect',()=>{status.textContent='Browser runs inside Docker';});
 rfb.addEventListener('disconnect',()=>{status.textContent='Disconnected. Refresh to reconnect.';});
 rfb.addEventListener('securityfailure',()=>{status.textContent='Connection rejected.';});
 document.querySelector('#size').onclick=e=>{rfb.scaleViewport=!rfb.scaleViewport;e.target.textContent=rfb.scaleViewport?'Actual size':'Fit to window';};
 document.querySelector('#files').onclick=async()=>{
  document.querySelector('#transfers').showModal();
  try{const r=await fetch('/sessions',{headers});if(!r.ok)throw Error('Could not load sessions.');const data=await r.json();
   const select=document.querySelector('#sessions');select.replaceChildren();
   for(const chat of data.chats){const option=document.createElement('option');option.value=chat.id;option.textContent=chat.title;select.append(option);}
  }catch(e){message.textContent=e.message;}
 };
 document.querySelector('#close').onclick=()=>document.querySelector('#transfers').close();
 document.querySelector('#import').onclick=()=>document.querySelector('#upload').click();
 document.querySelector('#upload').onchange=async e=>{
  const files=[...e.target.files];e.target.value='';const button=document.querySelector('#import');button.disabled=true;
  const results=[];
  try{for(const file of files){
   if(file.size>20*1024*1024||!/[.](pdf|md|markdown|txt)$/i.test(file.name)){results.push(file.name+': choose a PDF or text file under 20 MB.');continue;}
   message.textContent='Importing '+file.name+'…';
   const form=new FormData();form.append('files',file);form.append('paths',file.name);
   const r=await fetch('/import',{method:'POST',headers,body:form});if(!r.ok)throw Error('Import failed (HTTP '+r.status+').');
   const data=await r.json();if(!data.results.length)throw Error(data.error||'No import result.');
   for(const result of data.results)results.push(file.name+': '+(result.ok?'Imported.':result.error||'Import incomplete.'));
  }message.textContent=results.join('\n');}catch(e){message.textContent=[...results,e.message].join('\n');}finally{button.disabled=false;}
 };
 document.querySelector('#export').onclick=async()=>{
  const id=document.querySelector('#sessions').value;if(!id)return;
  try{const r=await fetch('/export/'+encodeURIComponent(id),{headers});if(!r.ok)throw Error('Export failed.');save(new Blob([await r.text()],{type:'text/plain;charset=utf-8'}),id+'.md');message.textContent='Session downloaded as Markdown text.';}catch(e){message.textContent=e.message;}
 };
 document.querySelector('#snapshot').onclick=()=>{const canvas=document.querySelector('#screen canvas');if(canvas)canvas.toBlob(blob=>{if(blob)save(blob,'learnharness-screen.png')},'image/png');};
 // No clipboard, device access, arbitrary URLs or app HTML cross this boundary.
} catch(e){status.textContent=e.message;}
