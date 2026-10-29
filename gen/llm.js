// DeepSeek chat client (OpenAI-compatible), streaming so long answers never hit idle timeouts.
const BASE = (process.env.DEEPSEEK_BASE || 'https://api.deepseek.com').replace(/\/+$/, '');

const sleep = ms => new Promise(r => setTimeout(r, ms));

class LlmError extends Error {}

async function chat({ key, model, messages, maxTokens = 8000, json = false, temperature = 0.5, shouldStop, label = '', log }) {
  let useJson = json, maxT = maxTokens, last;
  for (let attempt = 0; attempt < 5; attempt++) {
    if (shouldStop && shouldStop()) throw new LlmError('أُوقفت العملية');
    const body = { model, messages, max_tokens: maxT, temperature, stream: true, stream_options: { include_usage: true } };
    if (useJson) body.response_format = { type: 'json_object' };
    const ctrl = new AbortController();
    const stopTimer = setInterval(() => { if (shouldStop && shouldStop()) ctrl.abort(); }, 1000);
    const hardTimer = setTimeout(() => ctrl.abort(), 15 * 60 * 1000);
    try {
      const r = await fetch(BASE + '/chat/completions', {
        method: 'POST', signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key, Accept: 'text/event-stream' },
        body: JSON.stringify(body)
      });
      if (!r.ok) {
        const txt = await r.text().catch(() => '');
        let msg = txt; try { msg = JSON.parse(txt).error.message; } catch (_) {}
        if (r.status === 401) throw new LlmError('مفتاح DeepSeek غير صحيح أو أُلغي. حدّثه من الإعدادات.');
        if (r.status === 402) throw new LlmError('رصيد DeepSeek انتهى (Insufficient Balance). اشحن الرصيد من platform.deepseek.com ثم أعد المحاولة.');
        if (r.status === 400 && useJson && /response_format|json/i.test(msg)) { useJson = false; continue; }
        if (r.status === 400 && /max_tokens|maximum/i.test(msg) && maxT > 4096) { maxT = Math.max(4096, Math.floor(maxT / 2)); continue; }
        if (r.status === 400 && /model/i.test(msg)) throw new LlmError(`النموذج "${model}" غير متاح في حسابك. اختر نموذجًا آخر من الإعدادات. (${msg})`);
        last = new LlmError(`DeepSeek ${r.status}: ${msg.slice(0, 300)}`);
        if (r.status === 429 || r.status >= 500) { await sleep(5000 * (attempt + 1)); continue; }
        throw last;
      }
      let content = '', usage = null, finish = null, buf = '';
      const dec = new TextDecoder();
      for await (const chunk of r.body) {
        buf += dec.decode(chunk, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') continue;
          let j; try { j = JSON.parse(data); } catch (_) { continue; }
          if (j.usage) usage = j.usage;
          const c = j.choices && j.choices[0];
          if (c) {
            if (c.delta && typeof c.delta.content === 'string') content += c.delta.content;
            if (c.finish_reason) finish = c.finish_reason;
          }
        }
      }
      if (!content.trim()) { last = new LlmError('DeepSeek أعاد ردًا فارغًا'); await sleep(3000); continue; }
      return { content, usage: usage || {}, finish, json: useJson };
    } catch (e) {
      if (e instanceof LlmError) throw e;
      if (shouldStop && shouldStop()) throw new LlmError('أُوقفت العملية');
      last = new LlmError('انقطع الاتصال بـ DeepSeek: ' + (e.message || e));
      log && log(`إعادة المحاولة (${label})…`);
      await sleep(4000 * (attempt + 1));
    } finally { clearInterval(stopTimer); clearTimeout(hardTimer); }
  }
  throw last || new LlmError('تعذر الحصول على رد من DeepSeek');
}

// Tolerant JSON: strips code fences, // comments outside strings and trailing commas.
function parseJson(text) {
  let s = String(text).trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  if (fence) s = fence[1];
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('no JSON object');
  s = s.slice(a, b + 1);
  try { return JSON.parse(s); } catch (_) {}
  let out = '', inStr = false, esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) { out += ch; if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') { inStr = true; out += ch; continue; }
    if (ch === '/' && s[i + 1] === '/') { while (i < s.length && s[i] !== '\n') i++; out += '\n'; continue; }
    out += ch;
  }
  out = out.replace(/,\s*([}\]])/g, '$1');
  return JSON.parse(out);
}

// First ```js block (or the whole text) → code string.
function extractCode(text) {
  const m = /```(?:js|javascript)?\s*\n([\s\S]*?)```/i.exec(text);
  return (m ? m[1] : text).trim();
}

module.exports = { chat, parseJson, extractCode, LlmError };
