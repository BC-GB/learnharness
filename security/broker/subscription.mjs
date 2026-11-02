// Trusted broker only. Never mount this module's state or policy in LearnHarness.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const ISSUER = 'https://auth.openai.com';
export const RESOURCE = 'https://api.openai.com/v1';
const AUTHORIZE = ISSUER + '/api/accounts/authorize';
const TOKEN = ISSUER + '/api/accounts/oauth/token';
const SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const random = () => crypto.randomBytes(32).toString('base64url');
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const validClient = value => typeof value === 'string' && /^oaiapp_[A-Za-z0-9_-]{1,200}$/.test(value);
const secret = value => typeof value === 'string' && value.length > 0 && value.length <= 32768 && !/[\s\x00-\x1f\x7f]/.test(value);
const requiredScopes = scopes => ['resource.invoke','chatgpt.tokens.use.direct'].every(s => scopes.includes(s));

function readPrivate(file) {
  if (!fs.existsSync(file)) return null;
  const s = fs.lstatSync(file);
  if (!s.isFile() || (s.mode & 0o077) || s.size > 1024 * 1024) throw Error('Unsafe credential storage');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function writePrivate(file, value) {
  const temp = file + '.' + random() + '.tmp';
  const fd = fs.openSync(temp, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  try { fs.renameSync(temp, file); } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
  const dir = fs.openSync(path.dirname(file), 'r'); try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
}

export function verifyIdentity(jwt, jwks, client, nonce, now = Date.now()) {
  if (!secret(jwt)) throw Error('Invalid identity token');
  const parts = jwt.split('.');
  if (parts.length !== 3 || parts.some(p => !/^[A-Za-z0-9_-]+$/.test(p))) throw Error('Invalid identity token');
  const head = JSON.parse(Buffer.from(parts[0], 'base64url'));
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url'));
  if (head.alg !== 'RS256' || typeof head.kid !== 'string' || head.crit || head.jku || head.x5u) throw Error('Identity algorithm rejected');
  const keys = jwks.keys?.filter(k => k.kid === head.kid && k.kty === 'RSA' && (!k.use || k.use === 'sig') && (!k.alg || k.alg === 'RS256')) ?? [];
  if (keys.length !== 1) throw Error('Identity signing key rejected');
  const key = crypto.createPublicKey({key: keys[0], format: 'jwk'});
  if ((key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048 || !crypto.verify('RSA-SHA256', Buffer.from(parts[0]+'.'+parts[1]), key, Buffer.from(parts[2], 'base64url'))) throw Error('Identity signature rejected');
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.iss !== ISSUER || !aud.includes(client) || (aud.length > 1 && claims.azp !== client) || (claims.azp && claims.azp !== client) || typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 512 || !Number.isFinite(claims.exp) || claims.exp * 1000 <= now || !Number.isFinite(claims.iat) || claims.iat * 1000 > now + 30000 || (claims.nbf !== undefined && (!Number.isFinite(claims.nbf) || claims.nbf * 1000 > now + 30000)) || (nonce !== undefined && claims.nonce !== nonce)) throw Error('Identity claims rejected');
  return claims;
}

export function normalizeSubscriptionRequest(value) {
  const allowed = new Set(['model','input','instructions','tools','tool_choice','parallel_tool_calls','reasoning','text','store','stream','include']);
  const out = Object.fromEntries(Object.entries(value).filter(([key]) => allowed.has(key)));
  if (!Array.isArray(out.input) || out.store !== false || out.stream !== true) throw Error('Subscription request contract');
  out.input = out.input.map(item => item?.role === 'system' ? {...item, role:'developer'} : item);
  if (out.tools?.length) {
    if (!out.tools.every(t => t?.type === 'function')) throw Error('Only local function tools allowed');
    out.tools = [{type:'namespace',name:'learnharness',description:'Local learning tools',tools:out.tools}];
  }
  return out;
}

/** request(url,{method,headers,body}) must enforce HTTPS endpoint allowlisting,
 * redirects denied, response size/deadline limits, and never log credentials. */
export function createSubscription({dir,policyFile,request,now=()=>Date.now()}) {
  fs.mkdirSync(dir,{recursive:true,mode:0o700});
  if (!fs.lstatSync(dir).isDirectory() || (fs.statSync(dir).mode & 0o077)) throw Error('Unsafe subscription directory');
  const file = path.join(dir,'accounts.json');
  let db = readPrivate(file) ?? {version:1,host:'urn:uuid:'+crypto.randomUUID(),active:null,accounts:{}};
  if (db.version !== 1 || !/^urn:uuid:[a-f0-9-]{36}$/.test(db.host) || !db.accounts || typeof db.accounts !== 'object') throw Error('Invalid subscription state');
  writePrivate(file,db);
  let pending = null, busy = false, refresh = null, modelCache = null;
  const save = () => writePrivate(file,db);
  const active = () => db.active && db.accounts[db.active];
  const accountKey = a => digest(JSON.stringify([ISSUER,a.subject,a.client_id]));
  function policyOK(a) {
    if (!a?.access_token || !policyFile) return false;
    try {
      const p = readPrivate(policyFile);
      if (!p || p.accountKey !== accountKey(a) || p.paidCreditsDisabled !== true || !/^[a-f0-9]{64}$/.test(p.evidenceSha256) || !Number.isFinite(p.verifiedAt) || p.verifiedAt > now()) return false;
      // Explicit durable consent is tied to this account/client, not a timer.
      // OAuth expiry, refresh, scopes, logout and dispatch checks remain separate.
      if (p.version === 2) return p.authorization === 'persistent-subscription-only' && p.expiresAt === undefined;
      return p.version === 1 && Number.isFinite(p.expiresAt) && p.verifiedAt >= a.signedInAt && p.expiresAt > now() && p.expiresAt - p.verifiedAt <= 86400000;
    } catch { return false; }
  }
  function status() {
    const a = active();
    return {mode:'subscription',active:db.active,accounts:Object.entries(db.accounts).map(([id,a])=>({id,email:a.email??'',clientId:a.client_id,signedIn:Boolean(a.access_token),planPermission:requiredScopes(a.scopes??[])})),signedIn:Boolean(a?.access_token),planPermission:requiredScopes(a?.scopes??[]),spendingLocked:!policyOK(a),accountKey:a?accountKey(a):null};
  }
  function start(redirectUri, account = null) {
    const url = new URL(redirectUri);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.pathname !== '/auth/callback' || url.search || url.hash || url.username || url.password) throw Error('Callback rejected');
    if (busy || refresh) throw Error('Authentication busy');
    const selected = account === null ? null : db.accounts[account];
    if (account !== null && !selected) throw Error('Unknown account');
    const verifier = random(), state = random(), nonce = random();
    pending = {account,client:selected?.client_id,state,nonce,verifier,redirectUri,expires:now()+600000};
    const params = new URLSearchParams({client_id:selected?.client_id??'dynamic_agent_client',ext_agent_host_id:db.host,response_type:'code',redirect_uri:redirectUri,scope:SCOPES,resource:RESOURCE,state,nonce,code_challenge_method:'S256',code_challenge:digestBase64(verifier)});
    if (!selected) params.set('agent_name_hint','LearnHarness restricted broker');
    // Optional identity-token hints are deliberately omitted: no token enters browser URLs.
    return {url:AUTHORIZE+'?'+params,expires:pending.expires};
  }
  async function tokenRequest(form) {
    const r = await request(TOKEN,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(form).toString()});
    if (r.status !== 200) throw Error(r.status===400||r.status===401?'Sign in again':'Authentication temporarily unavailable');
    const t = r.value;
    if (!secret(t?.access_token) || t.token_type?.toLowerCase() !== 'bearer' || !Number.isFinite(t.expires_in) || t.expires_in <= 0 || t.expires_in > 86400 || typeof t.scope !== 'string' || (t.refresh_token!==undefined&&!secret(t.refresh_token))) throw Error('Invalid token response');
    return t;
  }
  async function identity(jwt,client,nonce) {
    const r = await request(ISSUER+'/.well-known/jwks.json',{method:'GET'});
    if (r.status !== 200) throw Error('Identity keys unavailable');
    return verifyIdentity(jwt,r.value,client,nonce,now());
  }
  async function callback(query) {
    if (busy) throw Error('Authentication busy');
    const p = pending; pending = null;
    if (!p || now() >= p.expires || query.state !== p.state) throw Error('Sign-in state rejected');
    if (query.error) throw Error('Sign-in was declined');
    const client = query.client_id ?? p.client;
    if (!validClient(client) || (p.client && client !== p.client) || !secret(query.code)) throw Error('Sign-in callback rejected');
    busy = true;
    try {
      const t = await tokenRequest({grant_type:'authorization_code',client_id:client,code:query.code,code_verifier:p.verifier,redirect_uri:p.redirectUri,resource:RESOURCE});
      const claims = await identity(t.id_token,client,p.nonce);
      const old = p.account && db.accounts[p.account];
      if (old && old.subject !== claims.sub) throw Error('Account identity changed');
      const a = {client_id:client,subject:claims.sub,email:typeof claims.email==='string'?claims.email.slice(0,320):'',access_token:t.access_token,refresh_token:t.refresh_token,id_token:t.id_token,expiresAt:now()+t.expires_in*1000,signedInAt:now(),scopes:t.scope.split(' ')};
      const id = accountKey(a), next={...db,accounts:{...db.accounts,[id]:a},active:id};
      writePrivate(file,next); db=next; modelCache = null;
      return status();
    } finally { busy = false; }
  }
  async function access() {
    const a=active(),id=db.active;
    if (!a?.access_token || !requiredScopes(a.scopes)) throw Error('ChatGPT plan sign-in required');
    if (a.expiresAt > now()+60000) return a.access_token;
    if (refresh) return refresh;
    refresh=(async()=>{
      if (!a.refresh_token) throw Error('Sign in again');
      try {
        const t=await tokenRequest({grant_type:'refresh_token',client_id:a.client_id,refresh_token:a.refresh_token,resource:RESOURCE});
        if (t.id_token) { const claims=await identity(t.id_token,a.client_id); if(claims.sub!==a.subject)throw Error('Account identity changed'); }
        if (!requiredScopes(t.scope.split(' '))) throw Error('ChatGPT plan permission missing');
        if (db.active!==id || active()!==a) throw Error('Account changed');
        Object.assign(a,{access_token:t.access_token,refresh_token:t.refresh_token??a.refresh_token,id_token:t.id_token??a.id_token,expiresAt:now()+t.expires_in*1000,scopes:t.scope.split(' ')});save();return a.access_token;
      } catch {
        delete a.access_token;delete a.refresh_token;delete a.id_token;modelCache=null;save();throw Error('Sign in again');
      }
    })();
    try{return await refresh}finally{refresh=null}
  }
  async function models() {
    const token=await access();
    if(modelCache?.account===db.active&&modelCache.expires>now())return modelCache.items;
    const r=await request(RESOURCE+'/models',{method:'GET',headers:{authorization:'Bearer '+token}});
    if(r.status!==200||!Array.isArray(r.value?.models))throw Error('Subscription model catalog unavailable');
    const items=r.value.models.filter(m=>m.visibility==='list'&&typeof m.slug==='string'&&/^[A-Za-z0-9._-]{1,120}$/.test(m.slug)).map(m=>({id:m.slug,name:typeof m.display_name==='string'?m.display_name.slice(0,200):m.slug}));
    modelCache={account:db.active,expires:now()+60000,items};return items;
  }
  async function authorize(model) {
    if(pending||busy||!policyOK(active()))throw Error('Local subscription permission is not enabled for this account');
    if(!(await models()).some(m=>m.id===model))throw Error('Model unavailable for this ChatGPT account');
    if(!policyOK(active()))throw Error('Local subscription permission changed');
    return access();
  }
  async function logout() {
    if(busy||refresh)throw Error('Authentication busy');
    pending=null;const a=active();let revoked=!a?.refresh_token;
    busy=true;
    try {
      if(a?.refresh_token){
        try{
          const discovery=await request(ISSUER+'/.well-known/openid-configuration',{method:'GET'});
          const target=new URL(discovery.value?.revocation_endpoint);
          if(discovery.status!==200||target.origin!==ISSUER||target.username||target.password||target.search||target.hash)throw Error('Revocation endpoint denied');
          const r=await request(target.href,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:a.refresh_token,token_type_hint:'refresh_token',client_id:a.client_id}).toString()});revoked=r.status===200;
        }catch{revoked=false}
      }
    }finally{
      if(a){delete a.access_token;delete a.refresh_token;delete a.id_token;}modelCache=null;save();busy=false;
    }
    return {revoked,...status()};
  }
  return {status,start,callback,models,authorize,logout};
}
function digestBase64(value){return crypto.createHash('sha256').update(value).digest('base64url')}
