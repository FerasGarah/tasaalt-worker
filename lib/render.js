// Frame rendering with headless Chrome, driven by playwright-core (same logic as the desktop studio).
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const { chromium } = require('playwright-core');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const fontDir = path.join(ROOT, 'node_modules', '@fontsource', 'tajawal');
const gsapFile = path.join(ROOT, 'node_modules', 'gsap', 'dist', 'gsap.min.js');

function fontCss() {
  return ['400', '500', '700', '800'].map(w => fs.readFileSync(path.join(fontDir, w + '.css'), 'utf8')).join('\n')
    .replace(/url\(\.\/files\//g, 'url(https://local.font/files/');
}

function candidates() {
  const list = [];
  if (process.env.STORY_BROWSER) list.push({ executablePath: process.env.STORY_BROWSER });
  for (const p of ['/opt/google/chrome/chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'])
    if (fs.existsSync(p)) list.push({ executablePath: p });
  list.push({ channel: 'chrome' }, {});
  return list;
}

async function launch() {
  let last;
  for (const c of candidates()) {
    try { return await chromium.launch({ ...c, headless: true, args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] }); }
    catch (e) { last = e; }
  }
  // Last resort: download Playwright's own Chromium.
  try {
    execSync('npx playwright-core install chromium', { cwd: ROOT, stdio: 'inherit' });
    return await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] });
  } catch (e) { last = e; }
  throw new Error('لم أجد متصفح Chrome على جهاز GitHub. ' + (last ? last.message.split('\n')[0] : ''));
}

async function openEpisode(browser, html, { exportMode = true, dsf = 1 } = {}) {
  const page = await browser.newPage({ viewport: exportMode ? { width: 360, height: 640 } : { width: 400, height: 900 }, deviceScaleFactor: dsf });
  const css = fontCss(), gsapSrc = fs.readFileSync(gsapFile, 'utf8');
  await page.route('**/*', route => {
    const u = route.request().url();
    if (u.includes('gsap')) return route.fulfill({ status: 200, contentType: 'application/javascript', body: gsapSrc });
    if (u.includes('fonts.googleapis.com')) return route.fulfill({ status: 200, contentType: 'text/css', body: css });
    if (u.startsWith('https://local.font/files/')) return route.fulfill({ status: 200, contentType: 'font/woff2', body: fs.readFileSync(path.join(fontDir, 'files', u.split('/').pop())) });
    if (u.startsWith('file:')) return route.continue();
    return route.abort();
  });
  if (exportMode) await page.addInitScript(() => { window.STORY_EXPORT = true; });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(pathToFileURL(path.resolve(html)).href);
  try { await page.waitForFunction(() => !!window.__story, null, { timeout: 20000, polling: 100 }); }
  catch (_) { throw new Error('ملف الحلقة لم يعمل. ' + (errors[0] ? 'الخطأ: ' + errors[0] : 'تأكد أنه ملف الحلقة الصحيح.')); }
  await page.evaluate(() => document.fonts.ready);
  const length = await page.evaluate(() => window.__storyLength || window.__story.duration());
  return { page, errors, length };
}

async function shoot(page, t, file, jpeg) {
  await page.evaluate(tt => { const m = window.__story; m.pause(); m.time(tt, false); }, t);
  await page.locator('.st-stage').first().screenshot({ path: file, type: jpeg ? 'jpeg' : 'png', quality: jpeg ? 92 : undefined });
}

// Preview: N frames spread across the episode, tiled into one sheet image.
async function preview({ html, outDir, count = 12, log }) {
  fs.mkdirSync(outDir, { recursive: true });
  for (const f of fs.readdirSync(outDir)) fs.unlinkSync(path.join(outDir, f));
  const browser = await launch();
  try {
    const { page, errors, length } = await openEpisode(browser, html, { dsf: 1 });
    const times = []; for (let i = 0; i < count; i++) times.push(+((length * (i + 0.5)) / count).toFixed(2));
    const files = [];
    for (const t of times) { const f = path.join(outDir, `t_${t.toFixed(2)}.png`); await shoot(page, t, f, false); files.push({ t, f }); log && log(`لقطة عند ${t.toFixed(1)} ث`); }
    const cols = 6, rows = Math.ceil(files.length / cols);
    const sheetHtml = path.join(outDir, 'sheet.html');
    fs.writeFileSync(sheetHtml, `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#fff;font:14px sans-serif}
      .g{display:grid;grid-template-columns:repeat(${cols},360px);gap:6px;padding:6px}.c{position:relative}.c img{display:block;width:360px}
      .c b{position:absolute;left:6px;top:6px;background:#000c;color:#fff;padding:2px 6px;border-radius:4px}</style>
      <div class="g">${files.map(x => `<div class="c"><img src="${encodeURI(path.basename(x.f))}"><b>${x.t.toFixed(1)}s</b></div>`).join('')}</div>`);
    const sp = await browser.newPage({ viewport: { width: cols * 366 + 6, height: rows * 646 + 6 } });
    await sp.goto(pathToFileURL(sheetHtml).href);
    await sp.screenshot({ path: path.join(outDir, 'sheet.png'), fullPage: true });
    fs.unlinkSync(sheetHtml);
    return { length, errors, sheet: path.join(outDir, 'sheet.png') };
  } finally { await browser.close(); }
}

// Full render: all frames at fps, split across a few pages working in parallel.
async function renderAll({ html, framesDir, fps = 30, dsf = 3, workers, onProgress, log, shouldStop }) {
  fs.mkdirSync(framesDir, { recursive: true });
  for (const f of fs.readdirSync(framesDir)) fs.unlinkSync(path.join(framesDir, f));
  workers = workers || Math.max(2, Math.min(4, os.cpus().length));
  const browser = await launch();
  try {
    const first = await openEpisode(browser, html, { dsf });
    const total = Math.round(first.length * fps);
    log && log(`عدد الإطارات: ${total} — يعمل ${workers} مسار بالتوازي`);
    const chunk = Math.ceil(total / workers);
    let done = 0;
    const pages = [first.page];
    for (let w = 1; w < workers; w++) pages.push((await openEpisode(browser, html, { dsf })).page);
    await Promise.all(pages.map(async (page, w) => {
      for (let f = w * chunk; f < Math.min(total, (w + 1) * chunk); f++) {
        if (shouldStop && shouldStop()) throw new Error('أُوقف الإنتاج');
        await shoot(page, f / fps, path.join(framesDir, `f_${String(f).padStart(5, '0')}.jpg`), true);
        done++; if (onProgress && done % 10 === 0) onProgress(done / total);
      }
    }));
    onProgress && onProgress(1);
    return { total, length: first.length, errors: first.errors };
  } finally { await browser.close(); }
}

module.exports = { preview, renderAll, launch, openEpisode };
