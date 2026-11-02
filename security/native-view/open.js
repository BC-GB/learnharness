const token=location.hash.slice(1),candidate=new URLSearchParams(location.search).get('lesson');
history.replaceState(null,'','/open');
const target=candidate&&/^[A-Za-z0-9_-]{1,100}$/.test(candidate)?'/chat/'+candidate:'/';
(async()=>{try{
 if(!/^[a-f0-9]{64}$/.test(token))throw Error('Open LearnHarness using Start-Learning.ps1.');
 const response=await fetch('/_session',{method:'POST',headers:{'x-native-key':token}});
 if(!response.ok)throw Error('Private access could not be established.');
 location.replace(target);
}catch(error){document.querySelector('#status').textContent=error.message;}})();
