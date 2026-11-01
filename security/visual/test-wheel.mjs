// Run against the patched distro file inside the candidate browser image.
import fs from 'node:fs';
import assert from 'node:assert/strict';
const source=fs.readFileSync('/usr/share/novnc/core/rfb.js','utf8');
const start=source.indexOf('    _handleWheel('),end=source.indexOf('    _fakeMouseMove(',start);
assert(start>0&&end>start);
const handler=new Function('clientToElement','WHEEL_STEP','WHEEL_LINE_HEIGHT','return ({'+source.slice(start,end)+'})._handleWheel')(()=>({x:10,y:10}),50,19);
function fixture(){const events=[];return {events,_rfbConnectionState:'connected',_viewOnly:false,_canvas:{},_accumulatedWheelDeltaX:0,_accumulatedWheelDeltaY:0,_handleMouseButton:(...x)=>events.push(x)}}
function wheel(f,x,y,mode=0){handler.call(f,{deltaX:x,deltaY:y,deltaMode:mode,clientX:10,clientY:10,preventDefault(){},stopPropagation(){}})}
let f=fixture();wheel(f,0,250);assert.equal(f.events.length,10);assert.equal(f._accumulatedWheelDeltaY,0);
f=fixture();wheel(f,0,30);assert.equal(f.events.length,0);wheel(f,0,30);assert.equal(f.events.length,2);assert.equal(f._accumulatedWheelDeltaY,10);
wheel(f,0,-70);assert.equal(f.events.length,4);assert.equal(f.events[2][3],1<<3);assert.equal(f._accumulatedWheelDeltaY,-10);
f=fixture();wheel(f,-120,0);assert.equal(f.events.length,4);assert.equal(f._accumulatedWheelDeltaX,-20);assert.equal(f.events[0][3],1<<5);
f=fixture();wheel(f,0,3,1);assert.equal(f.events.length,2);assert.equal(f._accumulatedWheelDeltaY,7);
f=fixture();wheel(f,0,1e9);assert.equal(f.events.length,40);assert.equal(f._accumulatedWheelDeltaY,0);
f=fixture();f._viewOnly=true;wheel(f,250,250);assert.equal(f.events.length,0);
console.log('PASS wheel magnitude, remainder, reversal, horizontal/line input, event cap and view-only');
