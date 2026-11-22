// Runs only in the renderer container; input is bytes, never a caller-supplied path.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
let input='';for await(const b of process.stdin){input+=b;if(input.length>32*1024*1024)throw Error('Input limit')}
const q=JSON.parse(input);let result;
if(q.op==='demo'){
 if(typeof q.html!=='string'||Buffer.byteLength(q.html)>1024*1024)throw Error('HTML limit');
 const {default:puppeteer}=await import('puppeteer-core');
 const browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--disable-background-networking'],timeout:10000});
 try{const page=await browser.newPage();const consoleErrors=[],pageErrors=[],failedRequests=[];
 await page.setRequestInterception(true);page.on('request',r=>{if(/^(data:|about:|blob:)/.test(r.url()))r.continue();else {failedRequests.push('External resource blocked');r.abort()}});
 page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text().slice(0,1000))});page.on('pageerror',e=>pageErrors.push(e.message.slice(0,1000)));
 await page.setContent(q.html,{waitUntil:'domcontentloaded',timeout:5000});await new Promise(r=>setTimeout(r,Math.min(Math.max(q.settleMs??2000,0),3000)));
 let probeResult;if(q.probe){if(typeof q.probe!=='string'||q.probe.length>16000)throw Error('Probe limit');probeResult=await page.evaluate(q.probe)}
 result={consoleErrors,pageErrors,failedRequests,probeResult,ok:!consoleErrors.length&&!pageErrors.length&&!failedRequests.length};
 }finally{await browser.close()}
}else{
 const bytes=Buffer.from(q.pdf??'','base64');if(bytes.length>20*1024*1024||bytes.subarray(0,5).toString()!=='%PDF-')throw Error('PDF input');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pdf-job-')),file=path.join(dir,'input.pdf');await fs.writeFile(file,bytes,{mode:0o600});
 try{const pdf=await import('./vendor/pdf-ops.ts');
 const info=await pdf.pdfInfo(file);if(info.page_count>200)throw Error('Page limit');
 switch(q.op){
 case 'render':{
 const pages=q.pages;if(!Array.isArray(pages)||!pages.length||pages.length>8||pages.some(n=>!Number.isInteger(n)||n<1||n>info.page_count))throw Error('Page selection');
 const dpi=q.dpi??120;if(!Number.isFinite(dpi)||dpi<36||dpi>200)throw Error('DPI limit');
 const {createCanvas}=await import('@napi-rs/canvas');const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
 const crop = q.crop ?? { x: 0, y: 0, width: 1, height: 1 };
 const { x, y, width, height } = crop;
 if (![x, y, width, height].every(Number.isFinite) || x < 0 || y < 0 ||
     width <= 0 || height <= 0 || x + width > 1 + 1e-9 || y + height > 1 + 1e-9) throw Error('PDF crop limit');
 const fit = q.fitLongSide;
 if (fit !== undefined && (!Number.isFinite(fit) || fit < 1 || fit > 4096)) throw Error('PDF fit limit');
 const task=getDocument({data:new Uint8Array(bytes),standardFontDataUrl:'/app/node_modules/pdfjs-dist/standard_fonts/',verbosity:0});
 try {
  const doc = await task.promise;
  result = [];
  for (const n of pages) {
   const page = await doc.getPage(n);
   const base = page.getViewport({ scale: 1 });
   const regionWidth = base.width * width;
   const regionHeight = base.height * height;
   const scale = fit === undefined ? dpi / 72 : Math.min(dpi / 72, fit / Math.max(regionWidth, regionHeight));
   const w = Math.ceil(regionWidth * scale);
   const h = Math.ceil(regionHeight * scale);
   if (![w, h].every(side => Number.isFinite(side) && side > 0 && side <= 4096) || w*h > 16000000) throw Error('Canvas limit');
   const viewport = page.getViewport({ scale, offsetX: -x * base.width * scale, offsetY: -y * base.height * scale });
   const canvas = createCanvas(w, h);
   await page.render({ canvasContext: canvas.getContext('2d'), viewport, canvas }).promise;
   result.push({ page: n, png: canvas.toBuffer('image/png').toString('base64') });
   page.cleanup();
  }
 } finally { await task.destroy(); }
 break;
 }
 case 'info':result={...info,path:undefined};break;
 case 'extract':result=await pdf.pdfExtract(file,String(q.pages??'all'));break;
 case 'search':if(typeof q.query!=='string'||q.query.length>1000)throw Error('Query limit');{const x=await pdf.pdfSearch(file,q.query,{literal:q.literal===true,contextLines:Math.min(Math.max(Number(q.contextLines)||0,0),8)});result={hits:x.hits,pageTexts:[...x.pageTexts]}}break;
 case 'convert':result=await pdf.convertPdf(new Uint8Array(bytes),Math.min(q.maxPages??200,200));break;
 default:throw Error('Operation denied');
 }
 }finally{await fs.rm(dir,{recursive:true,force:true})}
}
process.stdout.write(JSON.stringify(result));

