// Test fixture only; intentionally excluded from the production broker Dockerfile.
import crypto from 'node:crypto';
import http from 'node:http';
import {createSubscription,ISSUER,RESOURCE} from './subscription.mjs';
import {startBroker} from './server.mjs';
const {privateKey,publicKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
const jwks={keys:[{...publicKey.export({format:'jwk'}),kid:'synthetic',alg:'RS256'}]};
const token=(nonce)=>{
 const claims={iss:ISSUER,aud:'oaiapp_browser_fixture',sub:'synthetic-browser-user',email:'synthetic@example.invalid',nonce,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600};
 const base=[{alg:'RS256',kid:'synthetic'},claims].map(v=>Buffer.from(JSON.stringify(v)).toString('base64url')).join('.');
 return base+'.'+crypto.sign('RSA-SHA256',Buffer.from(base),privateKey).toString('base64url');
};
const request=async(url,options)=>{
 if(url===ISSUER+'/.well-known/jwks.json')return {status:200,value:jwks};
 if(url===RESOURCE+'/models')return {status:200,value:{models:[{slug:'gpt-4',display_name:'Synthetic subscription model',visibility:'list'}]}};
 if(url===ISSUER+'/api/accounts/oauth/token'){
  const form=new URLSearchParams(options.body);if(form.get('client_id')!=='oaiapp_browser_fixture')throw Error('Fixture client mismatch');
  const nonce=Buffer.from(form.get('code')??'','base64url').toString('utf8');
  return {status:200,value:{access_token:'SYNTHETIC_BROKER_ONLY',refresh_token:'synthetic-refresh-only',id_token:token(nonce),token_type:'Bearer',expires_in:3600,scope:'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct'}};
 }
 if(url===ISSUER+'/.well-known/openid-configuration')return {status:200,value:{revocation_endpoint:ISSUER+'/api/accounts/oauth/revoke'}};
 if(url===ISSUER+'/api/accounts/oauth/revoke')return {status:200,value:null};
 throw Error('Unexpected fixture URL');
};
const subscription=createSubscription({dir:'/subscription/accounts',policyFile:'/policy/plan-only.json',request});
const transport={open:(url,options,callback)=>{
 if(url!==RESOURCE+'/responses')throw Error('Unexpected fixture inference URL');
 return http.request({hostname:'mock',port:8090,path:'/v1/responses',...options},callback);
}};
const broker=await startBroker({requestSocket:'/broker/request.sock',controlSocket:'/control/admin.sock',stateDir:'/state',mode:'subscription',subscription,transport});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await broker.close();process.exit(0)});
