// Fixed input-only protocol. Browser control never crosses the container boundary.
export const FRAME_WIDTH=1440,FRAME_HEIGHT=1000,MAX_DELTA=1200;
export function validateWheel(q){
 if(!q||Array.isArray(q)||typeof q!=='object'||Object.keys(q).sort().join(',')!=='dx,dy,seq,x,y')throw Error('Invalid input');
 for(const k of ['x','y','dx','dy'])if(!Number.isFinite(q[k]))throw Error('Invalid number');
 if(!Number.isSafeInteger(q.seq)||q.seq<1||q.seq>1e9||q.x<0||q.x>=FRAME_WIDTH||q.y<0||q.y>=FRAME_HEIGHT||Math.abs(q.dx)>MAX_DELTA||Math.abs(q.dy)>MAX_DELTA)throw Error('Input out of range');
 return {seq:q.seq,x:q.x,y:q.y,dx:q.dx,dy:q.dy};
}
function appTarget(t){
 try{return t.type==='page'&&new URL(t.url).origin==='http://127.0.0.1:3000';}catch{return false;}
}
export function createWheelDispatcher(rpc){
 let targetId=null,sessionId=null;
 return async(q,canDispatch=()=>true)=>{
  q=validateWheel(q);
  if(!canDispatch())throw Error('Stale input');
  // The caller cannot choose a target, method, URL, expression or file.
  const {targetInfos}=await rpc('Target.getTargets');
  const target=targetInfos.find(t=>t.targetId===targetId&&appTarget(t))??targetInfos.find(appTarget);
  if(!target)throw Error('App unavailable');
  if(targetId!==target.targetId||!sessionId){
   if(sessionId)await rpc('Target.detachFromTarget',{sessionId}).catch(()=>{});
   targetId=target.targetId;
   ({sessionId}=await rpc('Target.attachToTarget',{targetId,flatten:true}));
  }
  const {cssLayoutViewport:viewport}=await rpc('Page.getLayoutMetrics',{},sessionId);
  const {bounds}=await rpc('Browser.getWindowForTarget',{targetId});
  const offset=bounds.top+bounds.height-viewport.clientHeight;
  // Xvfb without a window manager can report a one-pixel frame margin.
  if(bounds.left!==0||bounds.top!==0||bounds.width<FRAME_WIDTH-2||bounds.width>FRAME_WIDTH||bounds.height<FRAME_HEIGHT-2||bounds.height>FRAME_HEIGHT||viewport.clientWidth<bounds.width-32||viewport.clientWidth>bounds.width||offset<0||offset>150||q.x>=bounds.width||q.y<offset||q.y>=bounds.height)throw Error('Viewport mismatch');
  // Recheck after asynchronous setup; never send into another origin.
  const {targetInfo}=await rpc('Target.getTargetInfo',{targetId});
  if(!appTarget(targetInfo)||!canDispatch())throw Error('App unavailable');
  await rpc('Input.dispatchMouseEvent',{type:'mouseWheel',x:q.x,y:q.y-offset,deltaX:q.dx,deltaY:q.dy,modifiers:0},sessionId);
 };
}
