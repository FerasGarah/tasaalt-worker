// Automatic quality checker: plays the generated episode in the real player (headless Chrome, export mode)
// and reports, per chapter, crashes and visual problems the series never allows.
const fs = require('fs');
const path = require('path');
const render = require('../lib/render');

const normAr = s => String(s || '').replace(/[ً-ْـ]/g, '').replace(/[إأآا]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
  .replace(/[^ء-يa-zA-Z]/g, '');

// Runs inside the page: what is visible in chapter `ci` right now.
function inspect(ci) {
  const svg = document.querySelector('.st-stage svg');
  const groups = Array.prototype.filter.call(svg.children, n => n.tagName === 'g');
  const root = groups[ci];
  if (!root) return { texts: [], shapes: 0 };
  const sr = svg.getBoundingClientRect(), k = 360 / sr.width;
  const vis = el => {
    let o = 1;
    for (let n = el; n && n !== svg; n = n.parentNode) {
      const cs = getComputedStyle(n);
      if (cs.visibility === 'hidden' || cs.display === 'none') return 0;
      o *= parseFloat(cs.opacity);
      if (o < 0.02) return 0;
    }
    return o;
  };
  const box = el => { const r = el.getBoundingClientRect(); return { x: (r.left - sr.left) * k, y: (r.top - sr.top) * k, w: r.width * k, h: r.height * k }; };
  // Is the text really on top somewhere, or covered by a later layer (sub-scene background, shape)?
  const onTop = t => {
    const r = t.getBoundingClientRect();
    const pts = [[0.5, 0.5], [0.2, 0.5], [0.8, 0.5], [0.5, 0.3]];
    for (const [fx, fy] of pts) {
      const x = r.left + r.width * fx, y = r.top + r.height * fy;
      const stack = document.elementsFromPoint(x, y);
      for (const el of stack) {
        if (!(el instanceof SVGElement) || el === svg || el.tagName === 'g') continue;
        if (vis(el) < 0.05) continue;
        if (el === t || t.contains(el)) return true;
        break; // first visible SVG shape above the text covers it at this point
      }
    }
    return false;
  };
  const texts = [];
  root.querySelectorAll('text').forEach(t => {
    const o = vis(t); if (o < 0.6 || !t.textContent.trim()) return;
    const b = box(t); if (b.w < 2) return;
    if (!onTop(t)) return;
    texts.push({ text: t.textContent.trim(), size: +t.getAttribute('font-size') || 0, ...b });
  });
  let shapes = 0;
  root.querySelectorAll('path,rect,circle,ellipse,polygon,polyline,line').forEach(s => {
    if (shapes > 40) return;
    if (vis(s) < 0.05) return;
    const b = box(s); if (b.w * b.h > 6 || (s.tagName === 'line' && b.w + b.h > 6)) shapes++;
  });
  return { texts, shapes };
}

async function validate({ html, engineFile, workDir, chapters, length }) {
  const dir = path.join(workDir, 'check'); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'episode.html');
  fs.writeFileSync(file, html);
  fs.copyFileSync(engineFile, path.join(dir, 'story-engine.js'));
  const issues = {}; chapters.forEach(c => { issues[c.key] = { hard: [], soft: [] }; });
  const add = (key, kind, msg) => { const l = issues[key][kind]; if (!l.includes(msg) && l.length < 8) l.push(msg); };
  const browser = await render.launch();
  let fatal = null;
  try {
    let opened;
    try { opened = await render.openEpisode(browser, file, { dsf: 1 }); }
    catch (e) { fatal = e.message; return { fatal, issues }; }
    const { page, errors } = opened;
    const genErr = await page.evaluate(() => window.__genErr || {});
    for (const k in genErr) if (issues[k]) add(k, 'hard', 'The build function throws: ' + genErr[k]);
    const pageLen = await page.evaluate(() => window.__storyLength);
    if (Math.abs(pageLen - length) > 0.5) fatal = `episode length ${pageLen} differs from audio ${length}`;

    for (let ci = 0; ci < chapters.length; ci++) {
      const ch = chapters[ci];
      if (genErr[ch.key]) continue;
      const times = new Set([ch.at + 0.35, (ch.at + ch.end) / 2, ch.end - 0.15]);
      (ch.cues || []).forEach(c => { if (c.t >= ch.at && c.t < ch.end) times.add(Math.min(ch.end - 0.1, c.t + 0.5)); });
      (ch.scenes || []).forEach(s => { if (s.t > ch.at) times.add(Math.min(ch.end - 0.1, s.t + 0.8)); });
      for (let t = ch.at + 1; t < ch.end - 0.3; t += 1) times.add(t);
      const list = [...times].filter(t => t > 0 && t < length).sort((a, b) => a - b).slice(0, 40);
      let anyText = false;
      for (const t of list) {
        const before = errors.length;
        let r;
        try {
          r = await page.evaluate(([tt, ci2, fn]) => { const m = window.__story; m.pause(); m.time(tt, false); return (new Function('return ' + fn)())(ci2); }, [t, ci, inspect.toString()]);
        } catch (e) { add(ch.key, 'hard', `Error while playing at ${t.toFixed(2)} s: ${String(e.message).split('\n')[0]}`); continue; }
        if (errors.length > before) add(ch.key, 'hard', `Runtime error at ${t.toFixed(2)} s: ${errors[errors.length - 1]}`);
        const tt = t.toFixed(2);
        if (r.texts.length) anyText = true;
        r.texts.forEach(b => {
          if (b.x < 6 || b.x + b.w > 354) add(ch.key, 'soft', `At ${tt} s the text «${b.text}» goes outside the frame (x ${b.x.toFixed(0)}–${(b.x + b.w).toFixed(0)}, allowed 20–340): shrink it or split it into two lines.`);
          if (b.y + b.h > 528) add(ch.key, 'soft', `At ${tt} s the text «${b.text}» is in the caption band (bottom at y ${(b.y + b.h).toFixed(0)}, must stay above 500).`);
        });
        for (let i = 0; i < r.texts.length; i++) for (let j = i + 1; j < r.texts.length; j++) {
          const a = r.texts[i], b = r.texts[j];
          const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)), iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
          if (ix * iy > 0.3 * Math.min(a.w * a.h, b.w * b.h)) add(ch.key, 'soft', `At ${tt} s the texts «${a.text}» and «${b.text}» overlap: hide the first before showing the second, or move one.`);
        }
        if (r.shapes < 3) add(ch.key, 'soft', `At ${tt} s the scene is almost empty (only ${r.shapes} visible shapes): something must be drawn on screen.`);
        (ch.cues || []).forEach(c => {
          if (Math.abs(t - (c.t + 0.5)) > 0.01) return;
          const want = normAr(c.text);
          if (want.length < 2) return;
          const ok = r.texts.some(b => { const got = normAr(b.text); return got && (got.includes(want) || want.includes(got) || got.includes(want.slice(0, Math.max(2, Math.floor(want.length * 0.6))))); });
          if (!ok) add(ch.key, 'soft', `The word «${c.text}» is spoken at ${c.t.toFixed(2)} s but is not visible on screen at ${tt} s.`);
        });
      }
      if (!anyText) add(ch.key, 'soft', 'No kinetic text appears in this chapter at all: the cue words must appear on their beats.');
    }
    if (errors.length && !Object.values(issues).some(v => v.hard.length)) fatal = fatal || ('Page error: ' + errors[0]);
  } finally { await browser.close(); }
  return { fatal, issues };
}

const score = r => r ? r.hard.length * 10 + r.soft.length : 0;

module.exports = { validate, score, normAr };
