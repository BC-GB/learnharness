import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createSubscription, normalizeSubscriptionRequest } from './subscription.mjs';
import { subscriptionTransport } from './subscription-transport.mjs';

const MAX = 1024 * 1024;
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const json = (res, status, value) => {
  if (res.destroyed || res.writableEnded) return;
  if (res.headersSent) { res.destroy(); return; }
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
};
async function body(req, max = MAX) {
  if (req.headers['content-type'] !== 'application/json') throw Error('content type');
  if (req.headers['transfer-encoding'] || !/^\d+$/.test(req.headers['content-length'] ?? '') || Number(req.headers['content-length']) > max) throw Error('length');
  let size = 0; const chunks = [];
  for await (const b of req) { size += b.length; if (size > max) throw Error('size'); chunks.push(b); }
  if (size !== Number(req.headers['content-length'])) throw Error('length mismatch');
  return Buffer.concat(chunks);
}
function persist(dir, id, record) {
  const tmp = path.join(dir, id + '.tmp'), dest = path.join(dir, id + '.json');
  const fd = fs.openSync(tmp, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(record)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, dest);
  const d = fs.openSync(dir, 'r'); try { fs.fsyncSync(d); } finally { fs.closeSync(d); }
}

/** The caller supplies trusted deployment settings, never HTTP input. */
export async function startBroker({ requestSocket, controlSocket, stateDir, mode = 'mock', mockPort = 8090, mockHost = 'mock', keyFile, approvalMs = 600000, responseMs = 120000, subscription, transport, requireReview = true }) {
  if(typeof requireReview!=='boolean'||(!requireReview&&mode==='live'))throw Error('Invalid review policy');
  if (!['mock', 'live', 'subscription'].includes(mode)) throw Error('Unknown broker mode');
  if (mode === 'subscription' && (!subscription || !transport)) throw Error('Subscription broker not configured');
  // Fail closed: live mode requires a separate explicit deployment acknowledgement.
  if (mode === 'live' && process.env.LH_BROKER_ALLOW_LIVE !== 'I_AUTHORIZE_BILLABLE_OPENAI_REQUESTS') throw Error('Live use is not authorized');
  const key = mode === 'live' ? fs.readFileSync(keyFile, 'utf8').trim() : 'SYNTHETIC_BROKER_ONLY';
  if (!key || /[\r\n]/.test(key)) throw Error('Invalid broker credential');
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  // Never resume or replay a request across broker restart, even if it was approved.
  for (const name of fs.readdirSync(stateDir)) {
    if (/^[a-f0-9-]+\.tmp$/.test(name)) fs.unlinkSync(path.join(stateDir, name));
    if (/^[a-f0-9-]+\.json$/.test(name)) {
      const old = JSON.parse(fs.readFileSync(path.join(stateDir, name), 'utf8'));
      persist(stateDir, name.slice(0, -5), { id: old.id, sha256: old.sha256, status: 'closed-on-restart' });
    }
  }
  const pending = new Map();
  const inflight = new Set();
  let authEpoch=0, authorizing=0;
  let records = fs.readdirSync(stateDir).filter(n => n.endsWith('.json')).length;
  function closeRecord(job, status) {
    clearTimeout(job.timer); pending.delete(job.id);
    persist(stateDir, job.id, { id: job.id, sha256: job.sha256, status });
  }
  async function dispatch(job) {
    // Persist consumption BEFORE any upstream activity. Never retry automatically.
    closeRecord(job, 'consumed');
    let credential=key;
    if(mode==='subscription'){
      if(job.accountKey!==subscription.status().accountKey)throw Error('Account changed');
      credential=await subscription.authorize(job.model);
      const ready = subscription.status();
      if(job.res.destroyed||job.epoch!==authEpoch||job.accountKey!==ready.accountKey||!ready.signedIn||!ready.planPermission||ready.spendingLocked)throw Error('Request cancelled');
    }
    const options = mode === 'live'
      ? { hostname: 'api.openai.com', port: 443, path: '/v1/responses', servername: 'api.openai.com', rejectUnauthorized: true }
      : { hostname: mockHost, port: mockPort, path: '/v1/responses' };
    const requestOptions={ ...options, method: 'POST', headers: {
      'accept': 'text/event-stream', 'content-type': 'application/json', 'content-length': job.bytes.length, authorization: `Bearer ${credential}`
    } };
    const receive=reply => {
      const declaredType=reply.headers['content-type'];
      const streamType=/^text\/event-stream(?:;|$)/i.test(declaredType??'');
      // Some subscription responses omit Content-Type. Consumers still require terminal SSE completion.
      if (reply.statusCode !== 200 || (!streamType && !(mode==='subscription' && declaredType===undefined))) {
        const upstreamStatus=reply.statusCode;
        let diagnostic='';
        reply.on('data',chunk=>{diagnostic+=chunk.toString('utf8');if(diagnostic.length>8192)reply.destroy()});
        const fail=()=>json(job.res,502,{error:'Provider response rejected',upstreamStatus});
        reply.on('error',fail);
        reply.on('end',()=>{
          let providerCode,providerParam,responseShape; const contentType=String(reply.headers['content-type']??'').slice(0,120);
          try { const parsed=JSON.parse(diagnostic); const e=parsed?.error; responseShape={object:parsed?.object,status:parsed?.status,keys:Object.keys(parsed??{}).slice(0,12)};
            if(typeof e?.code==='string'&&/^[a-zA-Z0-9_.-]{1,100}$/.test(e.code))providerCode=e.code;
            if(typeof e?.param==='string'&&/^[a-zA-Z0-9_.\[\]-]{1,100}$/.test(e.param))providerParam=e.param;
          } catch {}
          json(job.res,502,{error:'Provider response rejected',upstreamStatus,providerCode,providerParam,contentType,responseShape});
        });return;
      }
      job.res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
      let size = 0;
      reply.on('data', chunk => { size += chunk.length; if (size > 16 * MAX) { reply.destroy(); job.res.destroy(); } });
      reply.on('error', () => job.res.destroy());
      reply.pipe(job.res);
    };
    const upstream=mode==='subscription'?transport.open('https://api.openai.com/v1/responses',{method:'POST',headers:requestOptions.headers},receive):(mode==='live'?https:http).request(requestOptions,receive);
    inflight.add(upstream);
    const deadline = setTimeout(() => upstream.destroy(Error('deadline')), responseMs);
    upstream.on('close', () => {clearTimeout(deadline);inflight.delete(upstream)});
    upstream.on('error', () => json(job.res, 502, { error: 'Provider transport failed' }));
    job.res.on('close', () => upstream.destroy());
    upstream.end(job.bytes);
  }
  const app = http.createServer({ maxHeaderSize: 8192, requestTimeout: 15000 }, async (req, res) => {
    try {
      if (req.method !== 'POST' || req.url !== '/v1/responses') return json(res, 404, { error: 'Not found' });
      const allowed = new Set(['host', 'connection', 'content-type', 'content-length']);
      if (Object.keys(req.headers).some(k => !allowed.has(k))) return json(res, 400, { error: 'Unexpected header' });
      if (pending.size + inflight.size + authorizing >= 16 || records >= 1024) return json(res, 429, { error: 'Broker review capacity reached' });
      let bytes = await body(req);
      const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (!value || typeof value.model !== 'string' || value.stream !== true || value.store !== false) return json(res, 400, { error: 'Streaming and store:false required' });
      // Remote tools could cause provider-side network actions not contained locally.
      if (value.tools && (!Array.isArray(value.tools) || value.tools.some(t => t?.type !== 'function'))) return json(res, 400, { error: 'Only function tools are allowed' });
      let accountKey;
      if(mode==='subscription'){
        const s=subscription.status();
        if(!s.signedIn||!s.planPermission||s.spendingLocked)return json(res,423,{error:'Subscription sign-in and spending verification required'});
        accountKey=s.accountKey;
        // Normalize BEFORE hashing/review: approval always covers the transmitted bytes.
        bytes=Buffer.from(JSON.stringify(normalizeSubscriptionRequest(value)));
      }
      if (pending.size + inflight.size + authorizing >= 16 || records >= 1024) return json(res, 429, { error: 'Broker review capacity reached' });
      const id = crypto.randomUUID(), sha256 = hash(bytes), expires = Date.now() + approvalMs;
      const job = { id, sha256, expires, bytes, res, accountKey, model:value.model, epoch:authEpoch };
      if(!requireReview){
        // Deployment opt-in only; never accept an HTTP flag or replay old queued requests.
        records++;authorizing++;
        try { await dispatch(job); } catch { json(res,423,{error:'Provider authorization failed closed'}); }
        finally { authorizing--; }
        return;
      }
      persist(stateDir, id, { id, sha256, expires, status: 'pending', bodyBase64: bytes.toString('base64') }); records++;
      job.timer = setTimeout(() => { closeRecord(job, 'expired'); json(res, 408, { error: 'Approval expired' }); }, approvalMs);
      pending.set(id, job);
      res.on('close', () => { if (pending.has(id)) closeRecord(job, 'cancelled'); });
    } catch { json(res, 400, { error: 'Request rejected' }); }
  });
  const admin = http.createServer({ maxHeaderSize: 4096, requestTimeout: 10000 }, async (req, res) => {
    try {
      if(req.method==='POST'&&req.url==='/subscription'){
        if(mode!=='subscription')return json(res,200,{mode,accounts:[]});
        const action=JSON.parse((await body(req,8192)).toString());
        if(action.op==='status')return json(res,200,subscription.status());
        if(action.op==='models')return json(res,200,await subscription.models());
        if(!['start','callback','logout'].includes(action.op))return json(res,400,{error:'Subscription operation denied'});
        authEpoch++;
        for(const job of pending.values()){closeRecord(job,'account-change');json(job.res,409,{error:'Account changed'})}
        for(const upstream of inflight)upstream.destroy();
        if(action.op==='start')return json(res,200,subscription.start(action.redirectUri,action.account??null));
        if(action.op==='callback')return json(res,200,await subscription.callback(action.query??{}));
        return json(res,200,await subscription.logout());
      }
      if (req.method === 'GET' && req.url === '/pending') return json(res, 200, [...pending.values()].map(j => ({ id: j.id, sha256: j.sha256, expires: j.expires, bytes: j.bytes.length })));
      const match = /^\/requests\/([a-f0-9-]{36})$/.exec(req.url ?? '');
      if (!match) return json(res, 404, { error: 'Not found' });
      const job = pending.get(match[1]);
      if (!job || Date.now() >= job.expires) return json(res, 409, { error: 'No pending request' });
      if (req.method === 'GET') return json(res, 200, { id: job.id, sha256: job.sha256, destination: mode !== 'mock' ? 'https://api.openai.com/v1/responses'+(mode==='subscription'?' (ChatGPT plan)':'') : 'isolated mock provider', exactUtf8Body: job.bytes.toString('utf8'), bodyBase64: job.bytes.toString('base64') });
      if (req.method !== 'POST') return json(res, 405, { error: 'Method' });
      const decision = JSON.parse((await body(req, 1024)).toString());
      // Awaiting the decision body can race another decision or cancellation.
      if (pending.get(job.id) !== job || Date.now() >= job.expires || decision.sha256 !== job.sha256) return json(res, 409, { error: 'Stale or mismatched approval' });
      if (decision.action === 'reject') { closeRecord(job, 'rejected'); json(job.res, 403, { error: 'Request rejected by reviewer' }); return json(res, 200, { status: 'rejected' }); }
      if (decision.action !== 'approve') return json(res, 400, { error: 'Decision' });
      try{await dispatch(job);json(res,200,{status:'consumed'})}catch{json(job.res,423,{error:'Provider authorization failed closed'});json(res,423,{error:'Provider authorization failed closed'})}
    } catch { json(res, 503, { error: 'Approval failed closed' }); }
  });
  app.maxConnections = 32; admin.maxConnections = 8;
  for (const [server, socket, modeBits] of [[app, requestSocket, 0o666], [admin, controlSocket, 0o600]]) {
    fs.mkdirSync(path.dirname(socket), { recursive: true, mode: 0o755 });
    if (fs.existsSync(socket)) { if (!fs.lstatSync(socket).isSocket()) throw Error('Socket path occupied'); fs.unlinkSync(socket); }
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socket, resolve); }); fs.chmodSync(socket, modeBits);
  }
  return { app, admin, close: async () => {
    authEpoch++;
    for (const job of pending.values()) { closeRecord(job, 'shutdown'); json(job.res, 503, { error: 'Broker shutting down' }); }
    for(const upstream of inflight)upstream.destroy();
    app.closeAllConnections(); admin.closeAllConnections();
    await Promise.all([app, admin].map(s => new Promise(resolve => s.close(resolve))));
  } };
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const mode=process.env.LH_BROKER_UPSTREAM??'mock';
  const transport=mode==='subscription'?subscriptionTransport():undefined;
  const subscription=transport?createSubscription({dir:'/subscription/accounts',policyFile:'/policy/plan-only.json',request:transport.request}):undefined;
  const broker = await startBroker({ requestSocket: '/broker/request.sock', controlSocket: '/control/admin.sock', stateDir: '/state', mode, requireReview:process.env.LH_BROKER_REQUEST_POLICY!=='subscription-direct', keyFile: '/run/secrets/openai-key', subscription, transport });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await broker.close(); process.exit(0); });
}
