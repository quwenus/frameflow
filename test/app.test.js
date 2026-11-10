import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { normalizeUrl, mediaInfo, run, AppError } from '../lib.js';
import { createApp, config } from '../server.js';

test('normalizes only single video links and rejects URL attacks',()=>{
  for(const url of ['https://youtu.be/abcdefghijk?t=2','https://www.youtube.com/watch?v=abcdefghijk&list=x','https://m.youtube.com/shorts/abcdefghijk']) assert.equal(normalizeUrl(url),'https://www.youtube.com/watch?v=abcdefghijk');
  for(const url of ['file:///etc/passwd','https://youtube.com.evil.test/watch?v=abcdefghijk','https://youtube.com@localhost/watch?v=abcdefghijk','https://localhost/watch?v=abcdefghijk','https://youtube.com:444/watch?v=abcdefghijk','https://youtube.com/playlist?list=x','https://youtu.be/abcdefghijk/extra']) assert.throws(()=>normalizeUrl(url));
});
test('metadata filters unavailable formats and enforces duration and size',()=>{
  const raw={id:'abcdefghijk',title:'Sample',duration:60,formats:[{ext:'m4a',acodec:'mp4a',vcodec:'none',abr:128,tbr:128},{ext:'mp4',vcodec:'avc1.64001f',acodec:'none',height:720,tbr:1000},{ext:'webm',vcodec:'vp9',acodec:'none',height:1080}]};
  const info=mediaInfo(raw,config);assert.equal(info.options.filter(o=>o.format==='mp4').length,1);assert.equal(info.options.find(o=>o.format==='mp4').quality,720);
  assert.throws(()=>mediaInfo({...raw,is_live:true},config)); assert.throws(()=>mediaInfo({...raw,duration:config.maxDuration+1},config));
  assert.equal(mediaInfo(raw,{...config,maxBytes:1}).options.length,0);
});
test('missing tools and subprocess timeouts produce actionable failures',async()=>{
  await assert.rejects(run('frameflow-tool-that-does-not-exist',[]),/Required tool is missing/);
  await assert.rejects(run(process.execPath,['-e','setTimeout(()=>{}, 10000)'],{timeout:100}),/timed out/);
});
test('HTTP lifecycle: preview, queue, download, expiry, errors and limits',async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'frameflow-test-'));
  let release; let fail=false;
  const media={health:async()=>{},metadata:async()=>({title:'Test',duration:60,thumbnail:'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg',options:[{format:'mp3',quality:128,estimatedBytes:100}]}),convert:async(job,folder,progress)=>{await new Promise(r=>{release=r;});if(fail)throw new AppError('Test conversion failure');progress({stage:'Processing media',progress:null});const file=path.join(folder,'result.mp3');await writeFile(file,'test media bytes');return file;}};
  const {server,queue}=createApp({...config,dataDir:dir,concurrency:1,maxQueue:2,ttl:10000},media);
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${server.address().port}`;
  const post=(route,data)=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  const until=async(fn)=>{for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('State timeout');};
  assert.equal((await post('/api/preview',{url:'https://localhost/'})).status,400);
  const p=await (await post('/api/preview',{url:'https://youtu.be/abcdefghijk'})).json();
  assert.equal((await post('/api/jobs',{previewId:p.id,format:'mp4',quality:999,permission:true})).status,400);
  assert.equal((await post('/api/jobs',{previewId:p.id,format:'mp3',quality:128})).status,400);
  const data={previewId:p.id,format:'mp3',quality:128,permission:true};
  const first=await (await post('/api/jobs',data)).json();await until(()=>release);
  const second=await (await post('/api/jobs',data)).json();assert.equal(queue.jobs.get(second.id).state,'queued');
  assert.equal((await post('/api/jobs',data)).status,429);
  assert.equal((await fetch(`${base}/api/jobs/${first.id}/download`)).status,409);
  release();await until(()=>queue.jobs.get(first.id).state==='ready'&&queue.jobs.get(second.id).state==='converting');
  await until(()=>queue.active===1);await new Promise(r=>setTimeout(r,20));
  const download=await fetch(`${base}/api/jobs/${first.id}/download`);assert.equal(download.status,200);assert.equal(download.headers.get('content-type'),'audio/mpeg');assert.equal(await download.text(),'test media bytes');
  const status=await (await fetch(`${base}/api/jobs/${first.id}`)).json();assert.equal(status.state,'ready');assert.equal(status.file,undefined);
  fail=true;release();await until(()=>queue.jobs.get(second.id).state==='failed');assert.match(queue.jobs.get(second.id).error,/Test conversion/);
  await queue.cleanup(Date.now()+11000);assert.equal((await fetch(`${base}/api/jobs/${first.id}/download`)).status,410);
  assert.equal((await fetch(base+'/%2e%2e/server.js')).status,404);
  assert.equal((await fetch(base+'/api/jobs',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://evil.test'},body:JSON.stringify(data)})).status,403);
});
