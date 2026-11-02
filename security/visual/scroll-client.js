// Trusted viewer input only. No app DOM, HTML or scripts are imported here.
export function installPreciseScroll(screen,displayConnected){
 let socket,ready=false,seq=0,inflight=0,pending=null,frame=0,timeout=0,retry=0;
 const reset=()=>{ready=false;inflight=0;pending=null;clearTimeout(timeout);screen.dataset.scrollMode='standard';};
 function schedule(){if(!frame)frame=requestAnimationFrame(flush);}
 function flush(){
  frame=0;if(!ready||!displayConnected()||inflight||!pending)return;
  const q=pending;pending=null;if(performance.now()-q.time>250)return;
  inflight=++seq;
  socket.send(new TextEncoder().encode(JSON.stringify({seq,x:q.x,y:q.y,dx:q.dx,dy:q.dy})+'\n'));
  timeout=setTimeout(()=>socket.close(1000),1000);
 }
 function connect(){
  clearTimeout(retry);reset();
  if(document.hidden)return;
  socket=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/scroll`);socket.binaryType='arraybuffer';
  let input='';
  socket.onmessage=event=>{
   input+=typeof event.data==='string'?event.data:new TextDecoder().decode(event.data);
   if(input.length>4096){socket.close(1000);return;}
   let index;while((index=input.indexOf('\n'))>=0){
    let q;try{q=JSON.parse(input.slice(0,index));}catch{socket.close(1000);return;}input=input.slice(index+1);
    if(q.ready===true){ready=true;screen.dataset.scrollMode='precise';}
    else if(q.seq===inflight){clearTimeout(timeout);inflight=0;if(q.ok!==true){pending=null;socket.close(1000);return;}schedule();}
   }
  };
  socket.onerror=()=>socket.close(1000);
  socket.onclose=()=>{reset();if(!document.hidden)retry=setTimeout(connect,1000);};
 }
 screen.addEventListener('wheel',event=>{
  const canvas=screen.querySelector('canvas');
  if(!ready||!displayConnected()||document.hidden||event.ctrlKey||event.metaKey||event.altKey||!canvas||event.target!==canvas)return;
  const r=canvas.getBoundingClientRect();if(!r.width||!r.height)return;
  const x=(event.clientX-r.left)*canvas.width/r.width,y=(event.clientY-r.top)*canvas.height/r.height;
  if(x<0||x>=canvas.width||y<0||y>=canvas.height)return;
  const unit=event.deltaMode===1?16:event.deltaMode===2?r.height:1;
  let dx=event.deltaX*unit*canvas.width/r.width,dy=event.deltaY*unit*canvas.height/r.height;
  if(event.shiftKey&&!dx){dx=dy;dy=0;}
  if(!Number.isFinite(dx)||!Number.isFinite(dy))return;
  event.preventDefault();event.stopImmediatePropagation();
  const time=performance.now();
  if(pending&&(time-pending.time>250||Math.abs(x-pending.x)>32||Math.abs(y-pending.y)>32))pending=null;
  // Preserve fractional pixels; coalesce at display cadence, never queue a
  // long trail of stale scrolling behind a slow/disconnected viewer.
  pending={x,y,dx:Math.max(-1200,Math.min(1200,(pending?.dx??0)+dx)),dy:Math.max(-1200,Math.min(1200,(pending?.dy??0)+dy)),time};schedule();
 },{capture:true,passive:false});
 screen.addEventListener('pointerdown',()=>{pending=null;},{capture:true});
 document.addEventListener('visibilitychange',()=>{pending=null;if(document.hidden){clearTimeout(retry);socket?.close(1000);}else if(!socket||socket.readyState===WebSocket.CLOSED)connect();});
 connect();
}
