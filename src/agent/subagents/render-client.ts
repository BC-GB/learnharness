import http from 'node:http';
/** No network destination or filesystem path may be supplied by model input. */
export function isolatedRendererEnabled(): boolean { return process.env.LH_ISOLATED_RENDERER === '1'; }
let tail: Promise<unknown> = Promise.resolve();
let queued = 0;
export async function isolatedRender<T>(payload: Record<string, unknown>): Promise<T> {
 if(!isolatedRendererEnabled())throw new Error('Isolated renderer is not configured.');
 const data=Buffer.from(JSON.stringify(payload));if(data.length>32*1024*1024)throw new Error('Renderer input too large.');
 if(queued>=8)throw new Error('Renderer queue is full. Try again when current imports finish.');
 queued++;
 const result=tail.then(()=>new Promise<T>((resolve,reject)=>{
  const req=http.request({socketPath:'/render-ipc/render.sock',path:'/render',method:'POST',headers:{'content-type':'application/json','content-length':data.length}},res=>{
   const chunks:Buffer[]=[];let size=0;
   res.on('data',(b:Buffer)=>{size+=b.length;if(size>24*1024*1024){res.destroy(new Error('Renderer output too large.'));return;}chunks.push(b)});
   res.on('error',reject);res.on('end',()=>{if(res.statusCode!==200){reject(new Error('Isolated rendering failed.'));return;}try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as T)}catch{reject(new Error('Invalid renderer response.'))}});
  });
  req.on('error',reject);req.setTimeout(25000,()=>req.destroy(new Error('Isolated renderer timed out.')));req.end(data);
 }));
 tail=result.catch(()=>{}).finally(()=>{queued--;});
 return result;
}
