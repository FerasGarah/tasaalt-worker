// Fallback speech-to-text on the cloud worker: the same small Whisper model the desktop studio used.
// The words + timestamps go back to the server, which does the script alignment itself.
const path = require('path');
const media = require('./media');

async function transcribe({ voice, log }) {
  log('قراءة الصوت…');
  const length = await media.duration(voice);
  const audio = await media.decode16k(voice);
  log('تحميل نموذج التعرف على الكلام…');
  const { pipeline, env } = await import('@xenova/transformers');
  env.localModelPath = path.join(__dirname, '..', 'node_modules', 'sts-whisper-tiny', 'models') + path.sep;
  env.allowRemoteModels = false;
  const asr = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny', { quantized: true });
  log('تحويل الصوت إلى كلمات…');
  const res = await asr(audio, { language: 'arabic', task: 'transcribe', chunk_length_s: 30, stride_length_s: 5, return_timestamps: 'word' });
  const words = (res.chunks || []).filter(c => c.text.trim()).map(c => ({ text: c.text.trim(), start: c.timestamp[0], end: c.timestamp[1] }));
  const pauses = await media.silences(voice);
  return { length, words, pauses, heard: res.text };
}

module.exports = { transcribe };
