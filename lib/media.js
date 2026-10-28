// ffmpeg helpers: find the binary, decode audio, detect pauses, encode the final video.
const { spawn } = require('child_process');
const fs = require('fs');

function ffmpegPath() {
  if (process.env.FFMPEG_PATH && fs.existsSync(process.env.FFMPEG_PATH)) return process.env.FFMPEG_PATH;
  try { const p = require('ffmpeg-static'); if (p && fs.existsSync(p)) return p; } catch (_) {}
  return 'ffmpeg';
}

function run(args, { collect = 'stderr', onLine } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath(), args, { windowsHide: true });
    const out = [], err = [];
    p.stdout.on('data', d => out.push(d));
    p.stderr.on('data', d => { err.push(d); if (onLine) String(d).split(/\r|\n/).forEach(l => l && onLine(l)); });
    p.on('error', e => reject(new Error('تعذر تشغيل ffmpeg: ' + e.message)));
    p.on('close', code => {
      if (code !== 0) return reject(new Error('ffmpeg فشل:\n' + Buffer.concat(err).toString().slice(-1500)));
      resolve(collect === 'stdout' ? Buffer.concat(out) : Buffer.concat(err).toString());
    });
  });
}

async function duration(file) {
  const log = await run(['-hide_banner', '-i', file, '-f', 'null', '-']).catch(e => String(e.message));
  const m = /time=(\d+):(\d+):([\d.]+)/g; let last = null, x;
  while ((x = m.exec(log))) last = x;
  if (last) return (+last[1]) * 3600 + (+last[2]) * 60 + parseFloat(last[3]);
  const d = /Duration: (\d+):(\d+):([\d.]+)/.exec(log);
  return d ? (+d[1]) * 3600 + (+d[2]) * 60 + parseFloat(d[3]) : 0;
}

async function decode16k(file) {
  const buf = await run(['-hide_banner', '-loglevel', 'error', '-i', file, '-ac', '1', '-ar', '16000', '-f', 'f32le', '-'], { collect: 'stdout' });
  return new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4));
}

async function silences(file, noise = -35, d = 0.25) {
  const log = await run(['-hide_banner', '-i', file, '-af', `silencedetect=noise=${noise}dB:d=${d}`, '-f', 'null', '-']);
  const out = []; let s = null;
  log.split(/\r?\n/).forEach(l => {
    let m = /silence_start: ([\d.]+)/.exec(l); if (m) s = parseFloat(m[1]);
    m = /silence_end: ([\d.]+)/.exec(l); if (m && s != null) { out.push([s, parseFloat(m[1])]); s = null; }
  });
  return out;
}

function encode({ framesDir, fps, voice, out, onProgress, total }) {
  const path = require('path');
  return run(['-hide_banner', '-y', '-framerate', String(fps), '-i', path.join(framesDir, 'f_%05d.jpg'), '-i', voice,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-profile:v', 'high',
    '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-t', (total / fps).toFixed(3), out], {
    onLine: l => { const m = /frame=\s*(\d+)/.exec(l); if (m && onProgress && total) onProgress(Math.min(1, +m[1] / total)); }
  });
}

function version() { return run(['-version'], { collect: 'stdout' }); }

module.exports = { version, ffmpegPath, duration, decode16k, silences, encode };
