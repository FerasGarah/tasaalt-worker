// Tasaalt Studio — cloud worker. Runs on GitHub Actions, talks to the studio server over HTTPS.
// Env: TASK (ping|preview|render|align), JOB, SERVER (…/worker.php), STUDIO_KEY
const fs = require('fs');
const path = require('path');
const os = require('os');

const crypto = require('crypto');
const { TASK, JOB, SERVER, STUDIO_KEY } = process.env;
if (!JOB || !SERVER || !STUDIO_KEY) { console.error('Missing JOB / STUDIO_SERVER / STUDIO_KEY secrets. Open the studio settings and press "update worker files".'); process.exit(1); }
// Per-job secret, derived from the shared key — the same value the server computes.
const TOKEN = process.env.TOKEN || crypto.createHmac('sha256', STUDIO_KEY).update(JOB).digest('hex');
const WORK = path.join(os.tmpdir(), 'studio-' + JOB);
fs.mkdirSync(WORK, { recursive: true });

const url = (a, extra = '') => `${SERVER}?a=${a}&job=${encodeURIComponent(JOB)}&t=${encodeURIComponent(TOKEN)}${extra}`;
const UA = { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) TasaaltStudioWorker/2.0' };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function call(a, body, { extra = '', raw = false, tries = 5 } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url(a, extra), {
        method: body === undefined ? 'GET' : 'POST',
        headers: { ...UA, ...(body !== undefined && !raw ? { 'Content-Type': 'application/json' } : { 'Content-Type': 'application/octet-stream' }) },
        body: body === undefined ? undefined : raw ? body : JSON.stringify(body)
      });
      const txt = await r.text();
      let j; try { j = JSON.parse(txt); } catch (_) { j = null; }
      if (!r.ok) {
        const msg = (j && j.error) || txt.slice(0, 300);
        if (r.status === 403 || r.status === 400 || r.status === 404) throw Object.assign(new Error(`server ${r.status}: ${msg}`), { fatal: true });
        throw new Error(`server ${r.status}: ${msg}`);
      }
      if (!j) throw Object.assign(new Error('السيرفر أعاد ردًا غير متوقع (قد تكون حماية الاستضافة تحجب جهاز GitHub): ' + txt.slice(0, 200)), { fatal: true });
      return j;
    } catch (e) { last = e; if (e.fatal) throw e; await sleep(2000 * (i + 1)); }
  }
  throw last;
}

async function download(name, dest) {
  for (let i = 0; i < 5; i++) {
    try {
      const r = await fetch(url('file', '&name=' + encodeURIComponent(name)), { headers: UA });
      if (!r.ok) throw new Error(`تعذر تنزيل ${name} (${r.status})`);
      fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
      return dest;
    } catch (e) { if (i === 4) throw e; await sleep(2000 * (i + 1)); }
  }
}

let stopFlag = false, chunkSize = 4 << 20;
let pending = [], lastSend = 0, lastProgress = 0;
function log(m) { console.log(m); pending.push(String(m)); }
async function flush(force) {
  if (!force && Date.now() - lastSend < 3000) return;
  lastSend = Date.now();
  const logs = pending; pending = [];
  try {
    const r = await call('progress', { progress: lastProgress, log: logs }, { tries: 2 });
    if (r.stop) stopFlag = true;
  } catch (e) { pending = logs.concat(pending); console.error('progress:', e.message); }
}
function progress(p) { lastProgress = p; flush(false); }

async function upload(name, file) {
  const buf = fs.readFileSync(file);
  const n = Math.max(1, Math.ceil(buf.length / chunkSize));
  for (let i = 0; i < n; i++) {
    if (stopFlag) throw new Error('أُوقفت العملية');
    const r = await call('upload', buf.subarray(i * chunkSize, (i + 1) * chunkSize), { raw: true, extra: `&name=${encodeURIComponent(name)}&i=${i}&n=${n}&size=${buf.length}` });
    if (r.stop) { stopFlag = true; throw new Error('أُوقفت العملية'); }
  }
}

async function main() {
  const start = await call('start', { run_id: process.env.GITHUB_RUN_ID || null,
    run_url: process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null });
  if (start.stop) { console.log('Job was stopped before start.'); return; }
  chunkSize = start.chunk || chunkSize;
  const type = start.type;
  console.log(`Task: ${type} — project: ${start.project}`);

  if (type === 'ping') {
    const media = require('./lib/media');
    const render = require('./lib/render');
    log('فحص Chrome…');
    const b = await render.launch(); const bv = b.version(); await b.close();
    log('Chrome: ' + bv);
    const fv = String(await media.version()).split('\n')[0];
    log(fv);
    await flush(true);
    await call('finish', { ok: true, info: `Chrome ${bv} · ${fv.replace('ffmpeg version ', 'ffmpeg ').split(' Copyright')[0]} · ${os.cpus().length} CPU` });
    return;
  }

  if (type === 'preview' || type === 'render') {
    log('تنزيل ملفات الحلقة…');
    const html = path.join(WORK, 'episode.html');
    await download('episode.html', html);
    await download('story-engine.js', path.join(WORK, 'story-engine.js'));
    const render = require('./lib/render');
    if (type === 'preview') {
      progress(0.1);
      const outDir = path.join(WORK, 'preview');
      let k = 0;
      const r = await render.preview({ html, outDir, count: 12, log: m => { log(m); progress(Math.min(0.8, 0.1 + 0.055 * ++k)); } });
      if (r.errors.length) log('تحذير من الحلقة: ' + r.errors[0]);
      log('رفع الصور إلى السيرفر…');
      const files = fs.readdirSync(outDir).filter(f => f.endsWith('.png')).sort((a, b) => (a === 'sheet.png') - (b === 'sheet.png'));
      for (const f of files) await upload('preview/' + f, path.join(outDir, f));
      progress(0.98);
    } else {
      const media = require('./lib/media');
      const voice = path.join(WORK, start.voice || 'voice.mp3');
      await download('voice', voice);
      const fps = (start.opts && start.opts.fps) || 30;
      const framesDir = path.join(WORK, 'frames');
      log('رسم الإطارات…');
      const r = await render.renderAll({ html, framesDir, fps, dsf: 3, log, shouldStop: () => stopFlag, onProgress: p => progress(0.02 + p * 0.68) });
      if (r.errors.length) log('تحذير من الحلقة: ' + r.errors[0]);
      log('تجميع الفيديو مع الصوت…');
      const out = path.join(WORK, 'video.mp4');
      await media.encode({ framesDir, fps, voice, out, total: r.total, onProgress: p => progress(0.7 + p * 0.2) });
      const mb = (fs.statSync(out).size / 1048576).toFixed(1);
      log(`رفع الفيديو إلى السيرفر (${mb} ميغابايت)…`);
      await flush(true);
      await upload('video.mp4', out);
      progress(0.99);
    }
  } else if (type === 'generate') {
    const key = process.env.DEEPSEEK_KEY;
    if (!key) throw new Error('مفتاح DeepSeek غير محفوظ في GitHub. احفظه من إعدادات الاستوديو.');
    const opts = start.opts || {};
    const aligned = path.join(WORK, 'aligned.json');
    await download('aligned.json', aligned);
    await download('story-engine.js', path.join(WORK, 'story-engine.js'));
    let previous = null;
    if (opts.note) { const gf = path.join(WORK, 'gen-prev.json'); await download('gen.json', gf); previous = JSON.parse(fs.readFileSync(gf, 'utf8')); }
    const { generate } = require('./gen/generate');
    const r = await generate({
      aligned: JSON.parse(fs.readFileSync(aligned, 'utf8')), engineSrc: fs.readFileSync(path.join(WORK, 'story-engine.js'), 'utf8'),
      workDir: WORK, key, model: opts.model || 'deepseek-chat', note: opts.note || '', previous,
      log, progress, shouldStop: () => stopFlag
    });
    const html = path.join(WORK, 'episode.html');
    fs.writeFileSync(html, r.html);
    fs.writeFileSync(path.join(WORK, 'gen.json'), JSON.stringify(r.gen));
    const u = r.gen.report.usage;
    log(`استهلاك DeepSeek: ${u.calls} طلبًا — ${u.prompt} توكن مُدخل (${u.cached} من الذاكرة المؤقتة) و${u.completion} توكن مُخرج.`);
    log('صنع صورة المعاينة…');
    progress(0.9);
    const render = require('./lib/render');
    const outDir = path.join(WORK, 'preview');
    await render.preview({ html, outDir, count: 12 });
    await upload('episode.html', html);
    await upload('gen.json', path.join(WORK, 'gen.json'));
    for (const f of fs.readdirSync(outDir).filter(f => f.endsWith('.png'))) await upload('preview/' + f, path.join(outDir, f));
    progress(0.99);
  } else if (type === 'align') {
    const { transcribe } = require('./lib/transcribe');
    const voice = path.join(WORK, start.voice || 'voice.mp3');
    await download('voice', voice);
    progress(0.2);
    const r = await transcribe({ voice, log });
    log(`وصلت ${r.words.length} كلمة مسموعة.`);
    const f = path.join(WORK, 'rec.json');
    fs.writeFileSync(f, JSON.stringify(r));
    await upload('rec.json', f);
    progress(0.95);
  } else throw new Error('Unknown task ' + type);

  await flush(true);
  await call('finish', { ok: true });
  console.log('Done.');
}

const timer = setInterval(() => flush(false), 5000);
main().then(() => { clearInterval(timer); process.exit(0); }).catch(async e => {
  clearInterval(timer);
  console.error(e);
  try { await flush(true); await call('finish', { ok: false, error: stopFlag ? 'أُوقفت العملية' : (e.message || String(e)) }, { tries: 3 }); } catch (_) {}
  process.exit(stopFlag ? 0 : 1);
});
