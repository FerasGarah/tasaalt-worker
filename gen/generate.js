// Episode generator: narration + word timings → episode.html in the series style, written by DeepSeek,
// checked in the real player and repaired automatically.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { chat, parseJson, extractCode } = require('./llm');
const { assemble, fallbackChapter } = require('./assemble');
const { validate, score } = require('./validate');

const P = n => fs.readFileSync(path.join(__dirname, 'prompts', n + '.md'), 'utf8');
const EX = n => fs.readFileSync(path.join(__dirname, 'examples', n), 'utf8');
const fill = (tpl, vars) => tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] == null ? '' : String(vars[k])));
const r2 = v => Math.round(v * 100) / 100;

function systemPrompt(engineSrc) {
  return [
    P('bible'),
    '\n---------------------------------------------------------------------------------------------------------\n',
    '## Reference episode A — «كيف اختفت الديناصورات؟» (89.56 s)\n',
    'This is the input the studio gave for it (timings file):\n\n```text\n' + EX('dinosaurs-timings.txt').trim() + '\n```\n',
    'And this is the finished episode file (the quality and style you must match):\n\n```html\n' + EX('dinosaurs.html').trim() + '\n```\n',
    '## Reference episode B — «كيف اكتشفنا المغناطيس؟» (71.04 s)\n',
    'Note: this older episode defines its own local `scene()` / `cut(from,to,at)` helpers inside one chapter; in your code use the shared `sub(S,g,bg)` and `cut(tl,from,to,at)` instead.\n\n```html\n' + EX('magnet.html').trim() + '\n```\n',
    '## story-engine.js (complete source of the player and the K kit)\n\n```js\n' + engineSrc.trim() + '\n```\n'
  ].join('\n');
}

function wordsTable(words, from, to, withIndex) {
  const out = [];
  for (let i = from; i < to; i++) out.push(withIndex ? `${i} · ${words[i].t.toFixed(2)} · ${words[i].w}` : `${words[i].t.toFixed(2)} ${words[i].w}`);
  return out.join('\n');
}

function checkSyntax(code, wrap) {
  try { new vm.Script(wrap ? '(' + code + ')' : code); return null; } catch (e) { return e.message; }
}
function looksLikeChapter(code) { return /^function\s*\(\s*g\s*,\s*tl\s*,\s*K\s*\)\s*\{/.test(code.trim()) && code.trim().endsWith('}'); }

// ---------- plan normalisation ----------
function normalizePlan(raw, a) {
  const W = a.words, n = W.length;
  const idx = v => Math.max(0, Math.min(n - 1, Math.round(+v || 0)));
  let chs = (raw.chapters || []).filter(c => c && c.start_word != null).map(c => ({ ...c, start_word: idx(c.start_word) }));
  chs.sort((x, y) => x.start_word - y.start_word);
  chs = chs.filter((c, i) => i === 0 || c.start_word > chs[i - 1].start_word);
  if (!chs.length) throw new Error('plan has no chapters');
  chs[0].start_word = 0;
  const used = new Set();
  chs.forEach((c, i) => {
    let k = String(c.key || '').toLowerCase().replace(/[^a-z0-9_]/g, '').replace(/^[0-9_]+/, '').slice(0, 16) || 'part';
    if (['at', 'k', 'g', 'tl', 'end'].includes(k) && k !== 'end') k = 'c' + k;
    while (used.has(k)) k = k + (i + 1);
    used.add(k); c.key = k;
    c.at = i === 0 ? 0 : r2(Math.max(0, W[c.start_word].t - 0.3));
  });
  // merge chapters shorter than 3 s into the previous one
  for (let i = chs.length - 1; i > 0; i--) {
    const end = i + 1 < chs.length ? chs[i + 1].at : a.length;
    if (end - chs[i].at < 3 || chs[i].at <= chs[i - 1].at + 2) {
      chs[i - 1].scenes = (chs[i - 1].scenes || []).concat(chs[i].scenes || []);
      chs[i - 1].cues = (chs[i - 1].cues || []).concat(chs[i].cues || []);
      chs.splice(i, 1);
    }
  }
  chs.forEach((c, i) => {
    c.end = r2(i + 1 < chs.length ? chs[i + 1].at : a.length);
    c.firstWord = c.start_word;
    c.lastWord = i + 1 < chs.length ? chs[i + 1].start_word : n;
    c.scenes = (c.scenes || []).map(s => ({ ...s, t: r2(W[idx(s.start_word != null ? s.start_word : c.start_word)].t) }));
    c.cues = (c.cues || []).filter(q => q && q.word != null).map(q => {
      const w = idx(q.word);
      return { text: String(q.text || W[w].w).trim(), role: q.role || 'secondary', color: q.color || null, fx: q.fx || '', word: w, t: r2(W[w].t) };
    }).filter(q => q.t >= c.at - 0.05 && q.t < c.end);
  });
  const poster = +raw.poster > 0 && +raw.poster < chs[0].end ? +raw.poster : Math.min(chs[0].end - 0.2, 3);
  return {
    title: String(raw.title || '').trim() || 'هل تساءلت يومًا؟',
    poster: r2(poster), look: String(raw.look || ''), fact_notes: Array.isArray(raw.fact_notes) ? raw.fact_notes.filter(Boolean).map(String) : [],
    helpers: Array.isArray(raw.helpers) ? raw.helpers.filter(h => h && /^[A-Za-z_]\w*$/.test(h.name || '')).slice(0, 8) : [],
    chapters: chs.map(c => ({ key: c.key, at: c.at, end: c.end, idea: String(c.idea || ''), scenes: c.scenes, cues: c.cues, firstWord: c.firstWord, lastWord: c.lastWord }))
  };
}

// Plan without AI (used only if the plan step fails twice): chapters at the longest pauses.
function fallbackPlan(a) {
  const W = a.words, n = W.length;
  const target = Math.max(4, Math.min(9, Math.round(a.length / 11)));
  const gaps = [];
  for (let i = 1; i < n; i++) gaps.push({ i, g: W[i].t - W[i - 1].t });
  const cuts = gaps.sort((x, y) => y.g - x.g).slice(0, target - 1).map(x => x.i).sort((x, y) => x - y);
  const starts = [0, ...cuts];
  const raw = { title: '', chapters: starts.map((s, k) => {
    const e = k + 1 < starts.length ? starts[k + 1] : n;
    const ws = [];
    for (let i = s; i < e; i++) if (W[i].w.replace(/[^ء-ي0-9]/g, '').length >= 5 || /\d/.test(W[i].w)) ws.push(i);
    return { key: 'part' + (k + 1), start_word: s, idea: '', scenes: [], cues: ws.filter((_, j) => j % 3 === 0).slice(0, 5).map(i => ({ word: i, text: W[i].w, role: /\d/.test(W[i].w) ? 'number' : 'hero' })) };
  }) };
  return normalizePlan(raw, a);
}

function chapterPlanText(c) {
  const lines = [`Idea: ${c.idea}`];
  (c.scenes || []).forEach((s, i) => lines.push(`Scene ${i + 1} (from ${s.t.toFixed(2)} s): background: ${s.background || ''}; drawing: ${s.drawing || ''}; motion: ${s.motion || ''}`));
  lines.push('Cues (spoken time · role · text · effect):');
  (c.cues || []).forEach(q => lines.push(`- ${q.t.toFixed(2)} · ${q.role} · «${q.text}»${q.color ? ' · ' + q.color : ''}${q.fx ? ' · ' + q.fx : ''}`));
  return lines.join('\n');
}
function captionsIn(a, c) { return a.captions.filter(x => x[0] >= c.at - 0.05 && x[0] < c.end).map(x => `${(+x[0]).toFixed(2)} ${x[1]}`).join('\n'); }

// ---------- main ----------
async function generate({ aligned, engineSrc, workDir, key, model, log, progress, shouldStop, previous, note }) {
  const a = { length: +aligned.length, words: aligned.words.map(w => ({ w: String(w.w), t: +w.t })), pauses: aligned.pauses || [], captions: aligned.captions || [] };
  if (!a.words.length) throw new Error('ملف التوقيت لا يحتوي كلمات. أعد المطابقة.');
  const system = { role: 'system', content: systemPrompt(engineSrc) };
  const usage = { prompt: 0, completion: 0, cached: 0, calls: 0 };
  const ask = async (content, opts = {}) => {
    const r = await chat({ key, model, messages: [system, { role: 'user', content }], shouldStop, log, ...opts });
    usage.calls++; usage.prompt += r.usage.prompt_tokens || 0; usage.completion += r.usage.completion_tokens || 0; usage.cached += r.usage.prompt_cache_hit_tokens || 0;
    return r;
  };
  const report = { model, started: new Date().toISOString(), steps: [], repaired: [], fallback: [], warnings: {} };

  let plan, helpers = '', codes = {};
  let reply = '';

  if (previous && note) {
    // ---------- edit an existing generated episode ----------
    plan = previous.plan; helpers = previous.helpers || ''; previous.chapters.forEach(c => { codes[c.key] = c.code; });
    log('قراءة ملاحظتك وتحديد المشاهد التي ستتغير…'); progress(0.08);
    const list = plan.chapters.map(c => `${c.key} · ${c.at.toFixed(2)}–${c.end.toFixed(2)} s · ${c.idea}`).join('\n');
    const r = await ask(fill(P('edit'), { NOTE: note, CHAPTERS: list }), { json: true, maxTokens: 3000, temperature: 0.3, label: 'edit' });
    const j = parseJson(r.content);
    reply = String(j.reply || '');
    const todo = (j.chapters || []).filter(x => x && plan.chapters.some(c => c.key === x.key));
    if (!todo.length) throw new Error('لم يحدد DeepSeek أي مشهد للتعديل. اكتب الملاحظة بشكل أوضح (مثلًا: المشهد عند الثانية 30…).');
    if (reply) log('DeepSeek: ' + reply);
    let done = 0;
    await pool(todo, 3, async x => {
      const c = plan.chapters.find(cc => cc.key === x.key);
      log(`إعادة كتابة المشهد «${c.key}»…`);
      const extra = fill(P('rewrite'), { INSTRUCTIONS: x.instructions, CODE: codes[c.key] });
      const code = await writeChapter(c, extra);
      if (code) codes[c.key] = code;
      progress(0.1 + 0.55 * (++done / todo.length));
    });
    report.edited = todo.map(x => x.key);
  } else {
    // ---------- 1. plan ----------
    log('DeepSeek يقرأ النص ويخطط المشاهد…'); progress(0.03);
    const extra = '';
    for (let attempt = 0; attempt < 2 && !plan; attempt++) {
      try {
        const r = await ask(fill(P('plan'), {
          LENGTH: a.length.toFixed(2), WORDS: wordsTable(a.words, 0, a.words.length, true),
          PAUSES: a.pauses.map(p => (+p[0]).toFixed(2) + '-' + (+p[1]).toFixed(2)).join(', '),
          CAPTIONS: a.captions.map(c => (+c[0]).toFixed(2) + ' ' + c[1]).join('\n'), EXTRA: extra
        }), { json: true, maxTokens: 8000, temperature: 0.6, label: 'plan' });
        plan = normalizePlan(parseJson(r.content), a);
      } catch (e) { if (/أُوقفت|مفتاح|رصيد|النموذج/.test(e.message)) throw e; log('إعادة التخطيط: ' + e.message); }
    }
    if (!plan) { log('تعذر التخطيط بالذكاء الاصطناعي، استخدام تقسيم تلقائي.'); plan = fallbackPlan(a); report.fallbackPlan = true; }
    log(`الخطة: ${plan.chapters.length} فصول — ${plan.chapters.map(c => c.key).join('، ')}`);
    plan.fact_notes.forEach(f => log('ملاحظة علمية: ' + f));
    progress(0.15);

    // ---------- 2. shared helpers ----------
    if (plan.helpers.length) {
      log('رسم الشخصيات والأدوات المشتركة: ' + plan.helpers.map(h => h.name).join('، '));
      const spec = plan.helpers.map(h => `- ${h.signature || h.name + '(S,p,x,y,s)'} → returns ${h.returns || 'group'}: ${h.draw || h.description || ''}`).join('\n');
      for (let attempt = 0; attempt < 2; attempt++) {
        const r = await ask(fill(P('helpers'), { LOOK: plan.look, HELPERS: spec }), { maxTokens: 8000, temperature: 0.5, label: 'helpers' });
        const code = extractCode(r.content);
        const err = checkSyntax(code, false);
        const missing = plan.helpers.filter(h => !new RegExp('function\\s+' + h.name + '\\s*\\(').test(code)).map(h => h.name);
        if (!err && !/Story\.episode|Math\.random/.test(code)) { helpers = code; if (missing.length) plan.helpers = plan.helpers.filter(h => !missing.includes(h.name)); break; }
        log('إعادة كتابة الرسوم المشتركة' + (err ? ': ' + err : ''));
      }
      if (!helpers) plan.helpers = [];
    }
    progress(0.2);

    // ---------- 3. chapters ----------
    let done = 0;
    await pool(plan.chapters, 3, async c => {
      log(`كتابة المشهد ${plan.chapters.indexOf(c) + 1}/${plan.chapters.length} «${c.key}» (${c.at.toFixed(1)}–${c.end.toFixed(1)} ث)…`);
      codes[c.key] = await writeChapter(c, '');
      progress(0.2 + 0.5 * (++done / plan.chapters.length));
    });
  }

  // writes one chapter (with one syntax retry); returns code or null
  async function writeChapter(c, extra) {
    const i = plan.chapters.indexOf(c);
    const prev = plan.chapters[i - 1], next = plan.chapters[i + 1];
    const helperText = helpers ? plan.helpers.map(h => `${h.signature || h.name} → ${h.returns || ''}: ${h.draw || ''}`).join('\n') + '\n\n```js\n' + helpers + '\n```' : '(none — draw everything inside the chapter)';
    let content = fill(P('chapter'), {
      KEY: c.key, INDEX: i + 1, COUNT: plan.chapters.length, TITLE: plan.title, LOOK: plan.look,
      AT: c.at.toFixed(2), END: c.end.toFixed(2), DUR: (c.end - c.at).toFixed(2),
      PREV: prev ? `${prev.key} (${prev.at.toFixed(1)}–${prev.end.toFixed(1)} s): ${prev.idea}` : '(this is the opening hook)',
      NEXT: next ? `${next.key} (${next.at.toFixed(1)}–${next.end.toFixed(1)} s): ${next.idea}` : '(this is the final chapter: return to the opening object and close strongly)',
      WORDS: wordsTable(a.words, c.firstWord, c.lastWord, false), CAPTIONS: captionsIn(a, c), PLAN: chapterPlanText(c), HELPERS: helperText, EXTRA: extra
    });
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await ask(content, { maxTokens: 8000, temperature: 0.55, label: c.key });
      const code = extractCode(r.content);
      const err = !looksLikeChapter(code) ? 'The answer must be exactly one function expression `function(g,tl,K){ … }` inside a ```js block.' : checkSyntax(code, true);
      if (!err && !/Math\.random|setTimeout|setInterval|document\.|textPath/.test(code)) return code;
      log(`تصحيح صياغة المشهد «${c.key}»…`);
      content = fill(P('repair'), { KEY: c.key, AT: c.at.toFixed(2), END: c.end.toFixed(2), CODE: code.slice(0, 20000),
        ISSUES: '- ' + (err || 'Forbidden API used (Math.random / setTimeout / document / textPath). Use K.rr / timeline tweens only.'), WORDS: wordsTable(a.words, c.firstWord, c.lastWord, false) });
    }
    return null;
  }

  // ---------- 4. assemble + check + repair ----------
  plan.chapters.forEach((c, i) => { if (!codes[c.key]) { codes[c.key] = fallbackChapter(c, i); report.fallback.push(c.key); } });
  const build = () => assemble({ title: plan.title, length: a.length, poster: plan.poster, captions: a.captions, helpers, model,
    chapters: plan.chapters.map(c => ({ ...c, code: codes[c.key] })) });
  const engineFile = path.join(workDir, 'story-engine.js');
  let best = {}; // key -> {code, score, issues}
  for (let round = 0; round < 3; round++) {
    if (shouldStop()) throw new Error('أُوقفت العملية');
    log(round === 0 ? 'تشغيل الحلقة في المتصفح وفحص كل مشهد…' : `إعادة الفحص (جولة ${round + 1})…`);
    let v = await validate({ html: build(), engineFile, workDir, chapters: plan.chapters, length: a.length });
    if (v.fatal && helpers) {
      log('خطأ في الرسوم المشتركة: ' + v.fatal + ' — إعادة البناء بدونها');
      report.steps.push('helpers dropped: ' + v.fatal);
      helpers = ''; plan.helpers = [];
      v = await validate({ html: build(), engineFile, workDir, chapters: plan.chapters, length: a.length });
    }
    if (v.fatal) throw new Error('الحلقة لا تعمل: ' + v.fatal);
    plan.chapters.forEach(c => {
      const s = score(v.issues[c.key]);
      if (!best[c.key] || s < best[c.key].score) best[c.key] = { code: codes[c.key], score: s, issues: v.issues[c.key] };
      else codes[c.key] = best[c.key].code;
    });
    const bad = plan.chapters.filter(c => best[c.key].score > 0 && !report.fallback.includes(c.key));
    const total = plan.chapters.reduce((s, c) => s + best[c.key].score, 0);
    log(total ? `الفحص وجد ${total} ملاحظة في ${bad.length} مشهد.` : 'الفحص: كل المشاهد سليمة ✓');
    progress(0.72 + round * 0.06);
    if (!bad.length || round === 2) break;
    let done = 0;
    await pool(bad, 3, async c => {
      const iss = best[c.key].issues;
      log(`إصلاح المشهد «${c.key}» (${iss.hard.length + iss.soft.length} ملاحظة)…`);
      const content = fill(P('repair'), { KEY: c.key, AT: c.at.toFixed(2), END: c.end.toFixed(2), CODE: best[c.key].code,
        ISSUES: iss.hard.concat(iss.soft).map(x => '- ' + x).join('\n'), WORDS: wordsTable(a.words, c.firstWord, c.lastWord, false) });
      try {
        const r = await ask(content, { maxTokens: 8000, temperature: 0.3, label: 'fix ' + c.key });
        const code = extractCode(r.content);
        if (looksLikeChapter(code) && !checkSyntax(code, true)) { codes[c.key] = code; if (!report.repaired.includes(c.key)) report.repaired.push(c.key); }
      } catch (e) { if (/أُوقفت|رصيد|مفتاح/.test(e.message)) throw e; log('تعذر الإصلاح: ' + e.message); }
      done++;
    });
  }
  // chapters that still crash → safe template
  plan.chapters.forEach((c, i) => {
    codes[c.key] = best[c.key].code;
    if (best[c.key].issues.hard.length) { codes[c.key] = fallbackChapter(c, i); if (!report.fallback.includes(c.key)) report.fallback.push(c.key); }
    if (best[c.key].issues.soft.length) report.warnings[c.key] = best[c.key].issues.soft;
  });
  const html = build();
  report.usage = usage; report.finished = new Date().toISOString(); report.fact_notes = plan.fact_notes; report.reply = reply;
  const gen = { version: 1, model, plan, helpers, chapters: plan.chapters.map(c => ({ key: c.key, code: codes[c.key] })), report };
  return { html, gen };
}

async function pool(items, n, fn) {
  const queue = items.slice(); const errs = [];
  await Promise.all(Array.from({ length: Math.min(n, queue.length) }, async () => {
    while (queue.length) { const it = queue.shift(); try { await fn(it); } catch (e) { errs.push(e); queue.length = 0; } }
  }));
  if (errs.length) throw errs[0];
}

module.exports = { generate, normalizePlan, fallbackPlan, systemPrompt };
