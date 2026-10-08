import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as store from './lib/store.js';
import * as stt from './lib/transcribe.js';
import * as wa from './lib/whatsapp.js';
import { analyzeMeeting, isConfigured as claudeConfigured } from './lib/analyze.js';
import { PRESETS, presetList } from './lib/presets.js';
import { dashboard } from './lib/stats.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const AUDIO_DIR = path.join(process.env.DATA_DIR || path.join(here, 'data'), 'audio');
fs.mkdirSync(AUDIO_DIR, { recursive: true });

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: stt.MAX_AUDIO_BYTES } });
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(here, 'public')));

const db = store.load();
const wrap = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((err) => res.status(err.status || 500).json({ error: err.message }));
const notFound = () => Object.assign(new Error('לא נמצא'), { status: 404 });
const findMeeting = (id) => db.meetings.find((m) => m.id === id) || (() => { throw notFound(); })();

// ---------- status & settings ----------

app.get('/api/status', (req, res) => {
  res.json({ claude: claudeConfigured(), transcription: stt.isConfigured(), whatsapp: wa.isConfigured() });
});

app.get('/api/presets', (req, res) => res.json(presetList()));

app.get('/api/settings', (req, res) => res.json(db.settings));

app.put('/api/settings', wrap((req, res) => {
  const { company, criteria, autoWhatsapp, managerPhone, preset } = req.body;
  if (company !== undefined) db.settings.company = String(company).slice(0, 80);
  if (managerPhone !== undefined) db.settings.managerPhone = String(managerPhone).slice(0, 20);
  if (autoWhatsapp !== undefined) db.settings.autoWhatsapp = Boolean(autoWhatsapp);
  if (preset && PRESETS[preset]) {
    db.settings.preset = preset;
    if (!criteria) db.settings.criteria = structuredClone(PRESETS[preset].criteria);
  }
  if (Array.isArray(criteria)) {
    db.settings.criteria = criteria
      .filter((c) => c && c.name)
      .map((c) => ({
        id: String(c.id || store.id()).replace(/[^\w-]/g, '').slice(0, 40) || store.id(),
        name: String(c.name).slice(0, 60),
        weight: Math.max(0.5, Math.min(3, Number(c.weight) || 1)),
        description: String(c.description || '').slice(0, 400),
      }));
  }
  store.save();
  res.json(db.settings);
}));

// ---------- reps ----------

app.get('/api/reps', (req, res) => res.json(db.reps));

app.post('/api/reps', wrap((req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) throw Object.assign(new Error('חסר שם'), { status: 400 });
  const rep = { id: store.id(), name: name.slice(0, 40), phone: String(req.body.phone || '').slice(0, 20) };
  db.reps.push(rep);
  store.save();
  res.json(rep);
}));

app.put('/api/reps/:id', wrap((req, res) => {
  const rep = db.reps.find((r) => r.id === req.params.id);
  if (!rep) throw notFound();
  if (req.body.name) rep.name = String(req.body.name).slice(0, 40);
  if (req.body.phone !== undefined) rep.phone = String(req.body.phone).slice(0, 20);
  store.save();
  res.json(rep);
}));

app.delete('/api/reps/:id', wrap((req, res) => {
  db.reps = db.reps.filter((r) => r.id !== req.params.id);
  store.save();
  res.json({ ok: true });
}));

// ---------- meetings ----------

const summary = (m) => ({
  id: m.id,
  createdAt: m.createdAt,
  repId: m.repId,
  customerName: m.customerName,
  status: m.status,
  error: m.error,
  durationSec: m.durationSec,
  title: m.analysis?.title,
  score: m.analysis?.overall_score,
  dealProbability: m.analysis?.deal_probability,
  openObjections: m.analysis?.objections.filter((o) => o.handled !== 'full').length,
});

app.get('/api/meetings', (req, res) => {
  const list = [...db.meetings].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json(list.filter((m) => !req.query.repId || m.repId === req.query.repId).map(summary));
});

app.get('/api/meetings/:id', wrap((req, res) => {
  const m = findMeeting(req.params.id);
  const rep = db.reps.find((r) => r.id === m.repId);
  const out = { ...m, rep };
  if (m.analysis) {
    const coach = wa.coachMessage(m);
    out.whatsapp = {
      coachText: coach,
      coachLink: rep?.phone ? wa.waLink(rep.phone, coach) : `https://wa.me/?text=${encodeURIComponent(coach)}`,
      customerLink: m.customerPhone
        ? wa.waLink(m.customerPhone, m.analysis.followup_message)
        : `https://wa.me/?text=${encodeURIComponent(m.analysis.followup_message)}`,
      canAutoSend: wa.isConfigured() && Boolean(rep?.phone),
    };
  }
  res.json(out);
}));

app.get('/api/meetings/:id/audio', wrap((req, res) => {
  const m = findMeeting(req.params.id);
  if (!m.audioFile) throw notFound();
  res.sendFile(path.join(AUDIO_DIR, m.audioFile));
}));

app.post('/api/meetings', upload.single('audio'), wrap((req, res) => {
  const b = req.body;
  const meeting = {
    id: store.id(),
    createdAt: new Date().toISOString(),
    repId: b.repId || db.reps[0]?.id || null,
    customerName: String(b.customerName || '').slice(0, 60),
    customerPhone: String(b.customerPhone || '').slice(0, 20),
    notes: String(b.notes || '').slice(0, 500),
    durationSec: Number(b.durationSec) || null,
    liveTranscript: String(b.liveTranscript || '').trim(),
    transcriptText: String(b.transcript || '').trim(),
    status: 'queued',
  };
  if (req.file) {
    const ext = (req.file.originalname.match(/\.(\w{2,5})$/) || [, 'webm'])[1];
    meeting.audioFile = `${meeting.id}.${ext}`;
    meeting.audioMime = req.file.mimetype;
    fs.writeFileSync(path.join(AUDIO_DIR, meeting.audioFile), req.file.buffer);
  }
  if (!meeting.audioFile && !meeting.transcriptText && !meeting.liveTranscript) {
    throw Object.assign(new Error('צריך הקלטה או תמלול'), { status: 400 });
  }
  db.meetings.push(meeting);
  store.save();
  runPipeline(meeting);
  res.json(summary(meeting));
}));

app.post('/api/meetings/:id/retry', wrap((req, res) => {
  const m = findMeeting(req.params.id);
  m.status = 'queued';
  delete m.error;
  runPipeline(m);
  res.json(summary(m));
}));

app.delete('/api/meetings/:id', wrap((req, res) => {
  const m = findMeeting(req.params.id);
  if (m.audioFile) fs.rmSync(path.join(AUDIO_DIR, m.audioFile), { force: true });
  db.meetings = db.meetings.filter((x) => x !== m);
  store.save();
  res.json({ ok: true });
}));

app.post('/api/meetings/:id/whatsapp', wrap(async (req, res) => {
  const m = findMeeting(req.params.id);
  const rep = db.reps.find((r) => r.id === m.repId);
  if (!m.analysis) throw Object.assign(new Error('הניתוח עוד לא מוכן'), { status: 409 });
  if (!wa.isConfigured() || !rep?.phone) throw Object.assign(new Error('שליחה אוטומטית לא מוגדרת'), { status: 409 });
  await wa.send(rep.phone, wa.coachMessage(m));
  m.whatsappSentAt = new Date().toISOString();
  store.save();
  res.json({ ok: true, sentAt: m.whatsappSentAt });
}));

// ---------- dashboard ----------

app.get('/api/dashboard', (req, res) => res.json(dashboard(db)));

app.post('/api/reset-demo', wrap((req, res) => {
  const fresh = store.reset();
  Object.assign(db, fresh);
  res.json({ ok: true });
}));

// ---------- pipeline ----------

async function runPipeline(meeting) {
  try {
    let transcript = meeting.transcriptText;
    if (!transcript && meeting.audioFile && stt.isConfigured()) {
      meeting.status = 'transcribing';
      store.save();
      const buf = fs.readFileSync(path.join(AUDIO_DIR, meeting.audioFile));
      transcript = await stt.transcribe(buf, meeting.audioFile, meeting.audioMime);
    }
    if (!transcript) transcript = meeting.liveTranscript;
    if (!transcript || transcript.length < 40) {
      throw new Error(
        stt.isConfigured()
          ? 'התמלול יצא ריק או קצר מדי — ייתכן שההקלטה שקטה מדי.'
          : 'אין תמלול. הגדירו TRANSCRIBE_API_KEY בשרת, או הקליטו בדפדפן Chrome עם תמלול חי.',
      );
    }
    meeting.transcriptText = transcript;

    if (!claudeConfigured()) throw new Error('הניתוח דורש ANTHROPIC_API_KEY בשרת.');
    meeting.status = 'analyzing';
    store.save();

    const rep = db.reps.find((r) => r.id === meeting.repId);
    meeting.analysis = await analyzeMeeting({
      transcript,
      preset: PRESETS[db.settings.preset] || PRESETS.general,
      criteria: db.settings.criteria,
      repName: rep?.name,
      customerName: meeting.customerName,
      notes: meeting.notes,
    });
    meeting.criteriaSnapshot = db.settings.criteria.map(({ id, name, weight }) => ({ id, name, weight }));
    meeting.status = 'done';
    store.save();

    if (db.settings.autoWhatsapp && wa.isConfigured() && rep?.phone) {
      await wa.send(rep.phone, wa.coachMessage(meeting)).then(
        () => { meeting.whatsappSentAt = new Date().toISOString(); store.save(); },
        (err) => console.error('auto whatsapp failed:', err.message),
      );
    }
  } catch (err) {
    console.error(`meeting ${meeting.id} failed:`, err);
    meeting.status = 'error';
    meeting.error = err.message;
    store.save();
  }
}

// Resume anything that was mid-flight when the server stopped.
for (const m of db.meetings) if (['queued', 'transcribing', 'analyzing'].includes(m.status)) runPipeline(m);

app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(here, 'public', 'index.html')));

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`Field Coach running on http://localhost:${port}`);
  console.log(`  Claude analysis: ${claudeConfigured() ? 'on' : 'OFF (set ANTHROPIC_API_KEY)'}`);
  console.log(`  Server transcription: ${stt.isConfigured() ? 'on' : 'off (browser live transcript only)'}`);
  console.log(`  WhatsApp auto-send: ${wa.isConfigured() ? 'on' : 'off (wa.me links)'}`);
});
