// Speech-to-text for Hebrew meeting recordings.
// Any OpenAI-compatible /audio/transcriptions endpoint works:
//   OpenAI  -> TRANSCRIBE_BASE_URL=https://api.openai.com/v1      TRANSCRIBE_MODEL=gpt-4o-transcribe
//   Groq    -> TRANSCRIBE_BASE_URL=https://api.groq.com/openai/v1 TRANSCRIBE_MODEL=whisper-large-v3
// If no key is configured, the browser's live transcript (Web Speech API) is used instead.

const BASE_URL = (process.env.TRANSCRIBE_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
const MODEL = process.env.TRANSCRIBE_MODEL || 'gpt-4o-transcribe';
const API_KEY = () => process.env.TRANSCRIBE_API_KEY || process.env.OPENAI_API_KEY;

export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

export function isConfigured() {
  return Boolean(API_KEY());
}

export async function transcribe(buffer, filename, mimetype) {
  if (buffer.length > MAX_AUDIO_BYTES) {
    throw new Error('קובץ האודיו גדול מ-25MB. נסו הקלטה קצרה יותר.');
  }
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mimetype || 'audio/webm' }), filename || 'meeting.webm');
  form.append('model', MODEL);
  form.append('language', 'he');
  form.append('response_format', 'json');
  form.append('prompt', 'פגישת מכירה בעברית בין איש מכירות ללקוח.');

  const res = await fetch(`${BASE_URL}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY()}` },
    body: form,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`התמלול נכשל (${res.status}): ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  return (data.text || '').trim();
}
