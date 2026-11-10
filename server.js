import http from 'node:http';
import { readFile, mkdir, readdir, rm, open } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { AppError, normalizeUrl, createMedia, JobQueue } from './lib.js';

const root=path.dirname(fileURLToPath(import.meta.url));
function number(name,fallback) { const n=Number(process.env[name] ?? fallback); if(!Number.isSafeInteger(n)||n<1) throw new Error(`Invalid ${name}`); return n; }
export const config={ host:process.env.HOST || '127.0.0.1', port:number('PORT',3000), ytdlp:process.env.YT_DLP_PATH || 'yt-dlp', ffmpeg:process.env.FFMPEG_PATH || 'ffmpeg', maxDuration:number('MAX_DURATION_SECONDS',1800), maxBytes:number('MAX_FILE_BYTES',209715200), concurrency:number('CONCURRENCY',2), maxQueue:number('MAX_QUEUE',20), rate:number('REQUESTS_PER_MINUTE',30), timeout:number('JOB_TIMEOUT_MS',600000), ttl:number('FILE_TTL_MS',1800000), dataDir:path.join(root,'.data') };
export function createApp(settings=config, media=createMedia(settings)) {
  const queue=new JobQueue(settings,media); const previews=new Map(); const rates=new Map(); let metadataActive=0;
  const housekeeping=setInterval(()=> { const now=Date.now(); for(const [id,p] of previews) if(p.expires<now) previews.delete(id); for(const [ip,r] of rates) if(r.reset<now) rates.delete(ip); },60000); housekeeping.unref();
  const json=(res,status,data)=> { res.writeHead(status,{'Content-Type':'application/json'}); res.end(JSON.stringify(data)); };
  async function body(req) { let text=''; for await(const chunk of req) { text+=chunk; if(text.length>4096) throw new AppError('Request is too large.',413); } try { const value=JSON.parse(text); if(!value || typeof value!=='object' || Array.isArray(value)) throw 0; return value; } catch { throw new AppError('Invalid JSON request.'); } }
  const server=http.createServer(async(req,res)=> {
    res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('Referrer-Policy','no-referrer'); res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' https://i.ytimg.com; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const url=new URL(req.url,'http://localhost'); const route=url.pathname;
      if(req.method==='POST') {
        if(req.headers.origin && req.headers.origin!==`http://${req.headers.host}` && req.headers.origin!==`https://${req.headers.host}`) throw new AppError('Cross-origin request rejected.',403);
        if(!req.headers['content-type']?.startsWith('application/json')) throw new AppError('Use application/json.',415);
      }
      if(route.startsWith('/api/') && req.method==='POST') {
        const ip=req.socket.remoteAddress; let rate=rates.get(ip); if(!rate || rate.reset<Date.now()) { rate={count:0,reset:Date.now()+60000}; rates.set(ip,rate); }
        if(++rate.count>settings.rate) { res.setHeader('Retry-After','60'); throw new AppError('Too many requests. Please wait a minute.',429); }
      }
      if(route==='/api/health' && req.method==='GET') {
        try { await media.health(); json(res,200,{ready:true, launchToken:process.env.FRAMEFLOW_LAUNCH_TOKEN, maxDuration:settings.maxDuration,maxBytes:settings.maxBytes}); }
        catch(e) { json(res,503,{ready:false,error:e.message}); } return;
      }
      if(route==='/api/preview' && req.method==='POST') {
        const data=await body(req); const normalized=normalizeUrl(data.url);
        if(metadataActive>=settings.concurrency) throw new AppError('Video lookup is busy. Try again shortly.',429);
        metadataActive++; let info;
        try { await media.health(); info=await media.metadata(normalized); } finally { metadataActive--; }
        if(!info.options.length) throw new AppError('No output fits the configured file size limit.');
        if(previews.size>=1000) previews.delete(previews.keys().next().value);
        const id=randomUUID(); previews.set(id,{url:normalized,info,expires:Date.now()+600000}); json(res,200,{id,...info}); return;
      }
      if(route==='/api/jobs' && req.method==='POST') {
        const data=await body(req); const preview=previews.get(data.previewId);
        if(!preview || preview.expires<Date.now()) throw new AppError('Video preview expired. Load the link again.',410);
        if(data.permission!==true) throw new AppError('Confirm that you have permission to download this content.');
        const option=preview.info.options.find(o=>o.format===data.format && o.quality===data.quality);
        if(!option) throw new AppError('Select an available output option.');
        const job=queue.add({url:preview.url,title:preview.info.title,format:option.format,quality:option.quality}); json(res,202,{id:job.id}); return;
      }
      const match=route.match(/^\/api\/jobs\/([a-f0-9-]{36})(\/download)?$/);
      if(match && req.method==='GET') {
        const job=queue.jobs.get(match[1]); if(!job) throw new AppError('Job not found. Load the video to start again.',404);
        if(job.expiresAt && Date.now()>=job.expiresAt) { await queue.cleanup(); }
        if(match[2]) {
          if(job.state==='expired') throw new AppError('This download expired. Convert the video again.',410);
          if(job.state!=='ready') throw new AppError('The download is not ready.',409);
          let handle; try { handle=await open(job.file,'r'); } catch { throw new AppError('The download is no longer available.',410); }
          res.writeHead(200,{'Content-Type':job.format==='mp3'?'audio/mpeg':'video/mp4','Content-Length':job.bytes,'Content-Disposition':`attachment; filename="frameflow.${job.format}"`});
          const stream=handle.createReadStream(); stream.on('error',()=>res.destroy()); res.on('close',()=>stream.destroy()); stream.pipe(res); return;
        }
        const {id,state,progress,stage,error,expiresAt,bytes}=job; json(res,200,{id,state,progress,stage,error,expiresAt,bytes}); return;
      }
      const assets={'/':['index.html','text/html; charset=utf-8'],'/app.js':['app.js','text/javascript; charset=utf-8'],'/styles.css':['styles.css','text/css; charset=utf-8']};
      if(req.method==='GET' && assets[route]) { const [name,type]=assets[route]; res.writeHead(200,{'Content-Type':type}); res.end(await readFile(path.join(root,'public',name))); return; }
      throw new AppError('Not found.',404);
    } catch(error) { if(!res.headersSent) json(res,error.status || 500,{error:error instanceof AppError ? error.message : 'Unexpected server error. Please retry.'}); else res.destroy(); }
  });
  server.on('close',()=>{queue.close(); clearInterval(housekeeping);}); return {server,queue};
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  await mkdir(config.dataDir,{recursive:true});
  // This single-process app owns only UUID directories beneath its fixed data folder.
  for(const entry of await readdir(config.dataDir,{withFileTypes:true})) if(entry.isDirectory() && /^[a-f0-9-]{36}$/.test(entry.name)) await rm(path.join(config.dataDir,entry.name),{recursive:true,force:true});
  const {server}=createApp(); server.listen(config.port,config.host,()=>console.log(`Frameflow is running at http://${config.host}:${config.port}`));
}
