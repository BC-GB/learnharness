import RFB from '/novnc/core/rfb.js';
const status=document.querySelector('#status');
const token=location.hash.slice(1);history.replaceState(null,'',location.pathname);
try {
 if(!/^[a-f0-9]{64}$/.test(token))throw Error('Open the private learning link.');
 const result=await fetch('/session',{method:'POST',headers:{'x-view-token':token}});
 if(!result.ok)throw Error('Private access denied.');
 const review=document.querySelector('#review');review.href='http://127.0.0.1:3188/#'+token;
 const rfb=new RFB(document.querySelector('#screen'),`${location.protocol==='https:'?'wss':'ws'}://${location.host}/websockify`);
 rfb.scaleViewport=true;rfb.resizeSession=false;rfb.clipViewport=false;
 rfb.addEventListener('connect',()=>{status.textContent='Browser runs inside Docker';});
 rfb.addEventListener('disconnect',()=>{status.textContent='Disconnected. Reopen the private link.';});
 rfb.addEventListener('securityfailure',()=>{status.textContent='Connection rejected.';});
 // No clipboard forwarding, file transfer, remote URLs, or app HTML are accepted here.
} catch(e){status.textContent=e.message;}
