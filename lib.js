import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, stat, rm } from 'node:fs/promises';
import path from 'node:path';

export class AppError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
export function normalizeUrl(input) {
  let u; try { u = new URL(input); } catch { throw new AppError('Enter a valid YouTube video URL.'); }
  if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password || u.port) throw new AppError('Use a standard YouTube video URL.');
  const hosts = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'];
  let id;
  if (u.hostname === 'youtu.be' && /^\/[\w-]{11}$/.test(u.pathname)) id = u.pathname.slice(1);
  else if (hosts.includes(u.hostname)) {
    if (u.pathname === '/watch') id = u.searchParams.get('v');
    else id = u.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{11})\/?$/)?.[1];
  }
  if (!id || !/^[\w-]{11}$/.test(id)) throw new AppError('Use a single YouTube video link, not a playlist or channel.');
  return `https://www.youtube.com/watch?v=${id}`;
}
export function run(command, args, { timeout = 30000, onLine, signal } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, windowsHide: true, detached: process.platform !== 'win32' });
    let output = '', stderr = '', pending = '', failure;
    const stop = (message) => {
      if (failure) return; failure = new AppError(message, 503);
      if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }).on('error', () => child.kill());
      else { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill(); } }
    };
    const abort = () => stop('Conversion stopped: temporary storage limit exceeded.');
    const timer = setTimeout(() => stop('The operation timed out. Please try a shorter video.'), timeout);
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', chunk => {
      output += chunk; pending += chunk;
      if (output.length > 16 * 1024 * 1024) { stop('Media response exceeded the size limit.'); return; }
      const lines = pending.split(/\r?\n/); pending = lines.pop(); lines.forEach(line => onLine?.(line));
    });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
    child.on('error', error => { cleanup(); reject(new AppError(error.code === 'ENOENT' ? `Required tool is missing: ${path.basename(command)}. See README setup instructions.` : 'Could not start the media tool.', 503)); });
    child.on('close', code => {
      cleanup(); if (pending) onLine?.(pending);
      if (failure) reject(failure);
      else if (code !== 0) reject(new AppError(/private|unavailable|sign in|not available|restricted/i.test(stderr) ? 'This video is unavailable or access-restricted. Try another public video.' : 'Media processing failed. Check the link and installed tools, then retry.', 422));
      else resolve(output);
    });
  });
}
export function mediaInfo(raw, config) {
  if (raw.is_live || raw.live_status === 'is_upcoming' || !Number.isFinite(raw.duration) || raw.duration <= 0) throw new AppError('Choose a finished video with a known duration.');
  if (raw.duration > config.maxDuration) throw new AppError(`Video exceeds the ${Math.floor(config.maxDuration / 60)} minute limit.`);
  const formats = (raw.formats || []).filter(f => !f.has_drm);
  const audio = formats.filter(f => f.acodec && f.acodec !== 'none');
  if (!audio.length) throw new AppError('No supported audio stream is available.');
  const options = [128, 192, 320].map(quality => ({ format: 'mp3', quality, label: `${quality} kbps`, estimatedBytes: Math.ceil(raw.duration * quality * 1000 / 8) }));
  const m4a = formats.filter(f => f.ext === 'm4a' && f.acodec !== 'none');
  const videos = formats.filter(f => f.ext === 'mp4' && f.vcodec?.startsWith('avc1') && f.height && (f.acodec !== 'none' || m4a.length));
  for (const quality of [...new Set(videos.map(f => f.height))].sort((a,b) => b-a)) {
    const video = videos.filter(f => f.height === quality).sort((a,b) => (b.tbr || 0)-(a.tbr || 0))[0];
    const a = video.acodec === 'none' ? m4a.sort((a,b) => (b.abr || 0)-(a.abr || 0))[0] : null;
    const size = f => f && (f.filesize || f.filesize_approx || (f.tbr ? f.tbr * 1000 / 8 * raw.duration : null));
    options.push({ format: 'mp4', quality, label: `${quality}p`, estimatedBytes: size(video) && (!a || size(a)) ? Math.ceil(size(video) + (size(a) || 0)) : null });
  }
  return { title: String(raw.title || 'YouTube video'), duration: raw.duration, thumbnail: `https://i.ytimg.com/vi/${raw.id}/hqdefault.jpg`, options: options.filter(o => !o.estimatedBytes || o.estimatedBytes <= config.maxBytes) };
}
export function createMedia(config) {
  const base = ['--ignore-config', '--no-playlist', '--no-warnings', '--socket-timeout', '20', '--retries', '2', '--js-runtimes', 'node'];
  return {
    async health() { await Promise.all([run(config.ytdlp, ['--version']), run(config.ffmpeg, ['-version'])]); },
    async metadata(url) { return mediaInfo(JSON.parse(await run(config.ytdlp, [...base, '--dump-single-json', '--skip-download', '--', url], { timeout: 60000 })), config); },
    async convert(job, dir, progress, signal) {
      const args = [...base, '--ffmpeg-location', path.dirname(config.ffmpeg) === '.' ? config.ffmpeg : path.dirname(config.ffmpeg), '--max-filesize', String(config.maxBytes), '--match-filters', `duration <= ${config.maxDuration} & !is_live`, '--newline', '--progress', '--progress-template', 'download:PROGRESS %(progress._percent_str)s', '--output', path.join(dir, 'result.%(ext)s')];
      if (config.ffmpeg === 'ffmpeg') args.splice(args.indexOf('--ffmpeg-location'), 2);
      if (job.format === 'mp3') args.push('-f', 'bestaudio/best', '--extract-audio', '--audio-format', 'mp3', '--audio-quality', `${job.quality}K`);
      else args.push('-f', `bestvideo[ext=mp4][vcodec^=avc1][height=${job.quality}]+bestaudio[ext=m4a]/best[ext=mp4][vcodec^=avc1][height=${job.quality}]`, '--merge-output-format', 'mp4');
      await run(config.ytdlp, [...args, '--', job.url], { timeout: config.timeout, signal, onLine(line) { const match = line.match(/^PROGRESS\s+([\d.]+)%/); if (match) progress({ stage: 'Downloading source stream', progress: Math.min(100, Number(match[1])) }); else if (/\[ExtractAudio\]|\[Merger\]/.test(line)) progress({ stage: 'Processing media', progress: null }); } });
      return path.join(dir, `result.${job.format}`);
    }
  };
}
export class JobQueue {
  constructor(config, media) { this.config=config; this.media=media; this.jobs=new Map(); this.active=0; this.pending=[]; this.timer=setInterval(() => this.cleanup().catch(console.error), 10000); this.timer.unref(); }
  add(data) {
    if (this.pending.length + this.active >= this.config.maxQueue) throw new AppError('The queue is full. Try again shortly.', 429);
    const job={ ...data, id:randomUUID(), state:'queued', progress:null, stage:'Waiting for a worker', createdAt:Date.now() };
    this.jobs.set(job.id,job); this.pending.push(job); this.pump(); return job;
  }
  pump() { while(this.active < this.config.concurrency && this.pending.length) { this.active++; this.execute(this.pending.shift()).finally(() => { this.active--; this.pump(); }); } }
  async execute(job) {
    const dir=path.join(this.config.dataDir,job.id); const controller=new AbortController(); let monitor;
    try {
      job.state='converting'; job.stage='Preparing conversion'; await mkdir(dir,{recursive:true});
      monitor=setInterval(async () => { try { const entries=await readdir(dir); const sizes=await Promise.all(entries.map(async f => (await stat(path.join(dir,f))).size)); if(sizes.reduce((a,b)=>a+b,0)>this.config.maxBytes*3) controller.abort(); } catch {} },1000);
      job.file=await this.media.convert(job,dir, update => Object.assign(job,update),controller.signal);
      const file=await stat(job.file); if(!file.isFile() || !file.size || file.size>this.config.maxBytes) throw new AppError('The result is empty or exceeds the file size limit.');
      job.bytes=file.size; job.state='ready'; job.stage='Ready to download'; job.progress=null;
    } catch(error) { job.state='failed'; job.error=error instanceof AppError ? error.message : 'Conversion failed. Please try again.'; await rm(dir,{recursive:true,force:true}).catch(()=>{}); }
    finally { clearInterval(monitor); job.finishedAt=Date.now(); job.expiresAt=job.finishedAt+this.config.ttl; }
  }
  async cleanup(now=Date.now()) {
    for(const [id,job] of this.jobs) {
      if(job.expiresAt && now>=job.expiresAt && job.state!=='expired') { await rm(path.join(this.config.dataDir,id),{recursive:true,force:true}); job.state='expired'; job.file=null; job.progress=null; }
      if(job.expiresAt && now>job.expiresAt+this.config.ttl) this.jobs.delete(id);
    }
  }
  close() { clearInterval(this.timer); }
}
