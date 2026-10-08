// מאמן השטח — client app (no build step).
const $ = (sel, root = document) => root.querySelector(sel);
const view = $('#view');

const state = {
  status: { claude: false, transcription: false, whatsapp: false },
  reps: [],
  settings: null,
  me: localStorage.getItem('me') || '',
};

// ---------- utils ----------

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

async function api(path, opts = {}) {
  const init = { ...opts };
  if (opts.json !== undefined) {
    init.body = JSON.stringify(opts.json);
    init.headers = { 'Content-Type': 'application/json' };
  }
  const res = await fetch(path, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `שגיאה ${res.status}`);
  return data;
}

function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.hidden = true), ms);
}

const tone = (score, max = 100) => (score == null ? 'neutral' : score >= max * 0.7 ? 'good' : score >= max * 0.5 ? 'warn' : 'bad');
const toneColor = (t) => `var(--${t === 'neutral' ? 'muted' : t})`;
const fmtTime = (sec) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
const repName = (id) => state.reps.find((r) => r.id === id)?.name || '—';

function relDate(iso) {
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d) / 86400000);
  const time = d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
  if (days === 0) return `היום, ${time}`;
  if (days === 1) return `אתמול, ${time}`;
  if (days < 7) return `לפני ${days} ימים`;
  return d.toLocaleDateString('he-IL');
}

function ring(score, size = 112) {
  const r = 46, c = 2 * Math.PI * r, t = tone(score);
  const off = c * (1 - (score ?? 0) / 100);
  return `<svg class="ring" viewBox="0 0 112 112" width="${size}" height="${size}" role="img" aria-label="ציון ${score} מתוך 100">
    <circle cx="56" cy="56" r="${r}" fill="none" stroke="var(--surface-2)" stroke-width="10"/>
    <circle cx="56" cy="56" r="${r}" fill="none" stroke="${toneColor(t)}" stroke-width="10" stroke-linecap="round"
      stroke-dasharray="${c}" stroke-dashoffset="${off}" transform="rotate(-90 56 56)"/>
    <text x="56" y="62" text-anchor="middle" font-size="30" fill="var(--text)">${score ?? '—'}</text>
    <text x="56" y="80" text-anchor="middle" font-size="11" fill="var(--muted)">מתוך 100</text>
  </svg>`;
}

function sparkline(values, w = 110, h = 34) {
  if (values.length < 2) return `<svg class="spark" viewBox="0 0 ${w} ${h}"></svg>`;
  const x = (i) => 4 + (i * (w - 8)) / (values.length - 1);
  const y = (v) => h - 4 - (v / 100) * (h - 8);
  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const last = values.at(-1);
  const t = tone(last);
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-label="מגמה: ${values.join(', ')}">
    <polyline points="${pts}" fill="none" stroke="var(--border)" stroke-width="2" stroke-linejoin="round"/>
    <polyline points="${pts}" fill="none" stroke="${toneColor(t)}" stroke-width="2.5" stroke-linejoin="round"/>
    <circle cx="${x(values.length - 1)}" cy="${y(last)}" r="3.5" fill="${toneColor(t)}"/>
  </svg>`;
}

const WA_ICON = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6a2.7 2.7 0 0 0 1.8-1.2 2.2 2.2 0 0 0 .1-1.3c0-.1-.2-.2-.4-.3z"/></svg>`;

// ---------- router ----------

const routes = [
  [/^\/$/, homeView, 'home'],
  [/^\/record$/, recordView, 'record'],
  [/^\/upload$/, uploadView, 'record'],
  [/^\/m\/(\w+)$/, meetingView, 'home'],
  [/^\/dashboard$/, dashboardView, 'dashboard'],
  [/^\/settings$/, settingsView, 'settings'],
];

let cleanup = null;
async function route() {
  if (cleanup) { const c = cleanup; cleanup = null; if ((await c()) === false) return; }
  const path = location.hash.replace(/^#/, '') || '/';
  for (const [re, fn, tab] of routes) {
    const m = path.match(re);
    if (m) {
      document.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
      view.innerHTML = '';
      try { await fn(...m.slice(1)); } catch (err) { view.innerHTML = `<div class="card empty">${esc(err.message)}</div>`; }
      view.focus({ preventScroll: true });
      window.scrollTo(0, 0);
      return;
    }
  }
  location.hash = '#/';
}

// ---------- home: my meetings ----------

function meetingRow(m) {
  const pending = m.status !== 'done';
  const t = pending ? 'neutral' : tone(m.score);
  const scoreTxt = m.status === 'error' ? '!' : pending ? '<div class="spinner"></div>' : m.score;
  const sub = m.status === 'error' ? `<span class="danger">${esc(m.error || 'שגיאה')}</span>`
    : pending ? 'מנתח…'
    : `${esc(repName(m.repId))} · ${relDate(m.createdAt)}${m.openObjections ? ` · <span class="pill bad">${m.openObjections} התנגדויות פתוחות</span>` : ''}`;
  return `<a class="meeting" href="#/m/${m.id}">
    <div class="score ${t}">${scoreTxt}</div>
    <div class="info"><div class="title">${esc(m.title || m.customerName || 'פגישה חדשה')}</div><div class="small muted">${sub}</div></div>
    ${m.dealProbability != null ? `<div class="small muted" title="סיכוי סגירה">${m.dealProbability}%</div>` : ''}
  </a>`;
}

async function homeView() {
  const filter = state.me ? `?repId=${state.me}` : '';
  const meetings = await api(`/api/meetings${filter}`);
  const done = meetings.filter((m) => m.status === 'done');
  const avg = done.length ? Math.round(done.reduce((a, m) => a + m.score, 0) / done.length) : null;
  const who = state.me ? repName(state.me) : 'כל הצוות';
  view.innerHTML = `
    <a class="hero-rec" href="#/record">
      <div class="big-dot"><span></span></div>
      <b>מתחילים פגישה? לחצו להקלטה</b>
      <small>שימו את הטלפון בכיס. אחרי הפגישה תקבלו ציון וטיפים לוואטסאפ.</small>
    </a>
    <div class="row between"><h2>${state.me ? 'הפגישות שלי' : 'כל הפגישות'}</h2><a class="btn ghost" href="#/upload">העלאת קובץ / תמלול</a></div>
    ${done.length ? `<div class="kpis" style="margin:0 0 14px">
      <div class="kpi"><b>${done.length}</b><span>פגישות</span></div>
      <div class="kpi"><b style="color:${toneColor(tone(avg))}">${avg}</b><span>ציון ממוצע</span></div>
      <div class="kpi"><b>${done.reduce((a, m) => a + (m.openObjections || 0), 0)}</b><span>התנגדויות פתוחות</span></div>
    </div>` : ''}
    <div id="list">${meetings.length ? meetings.map(meetingRow).join('') : `<div class="card empty">עוד אין פגישות ל${esc(who)}. הקליטו את הפגישה הראשונה!</div>`}</div>`;

  if (meetings.some((m) => ['queued', 'transcribing', 'analyzing'].includes(m.status))) {
    const t = setTimeout(() => location.hash === '#/' || location.hash === '' ? route() : null, 3000);
    cleanup = () => clearTimeout(t);
  }
}

// ---------- recorder ----------

function pickMime() {
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  return types.find((t) => window.MediaRecorder?.isTypeSupported?.(t)) || '';
}

async function recordView() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  // Live browser transcription is the fallback when the server has no speech-to-text key.
  const useLive = Boolean(SR) && !state.status.transcription;
  const canRecord = Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);

  view.innerHTML = `
    <h1>פגישה חדשה</h1>
    <p class="sub">ממלאים פרטים, לוחצים על הכפתור האדום, ושמים את הטלפון בכיס.</p>
    <div class="card">
      <div class="grid2">
        <div class="field"><label for="cust">שם הלקוח</label><input id="cust" type="text" placeholder="למשל: משפחת כהן"></div>
        <div class="field"><label for="custPhone">טלפון הלקוח (לא חובה)</label><input id="custPhone" type="tel" inputmode="tel" placeholder="050-0000000"></div>
      </div>
      <div class="field" style="margin:0"><label for="notes">הערה קצרה (לא חובה)</label><input id="notes" type="text" placeholder="למשל: מתעניינים בדירת גן, באו עם ההורים"></div>
    </div>
    <div class="card recorder">
      ${canRecord ? '' : '<p class="danger">הדפדפן הזה לא תומך בהקלטה. נסו Chrome או Safari עדכני, או העלו קובץ.</p>'}
      <div id="recState" class="muted">מוכן להקלטה</div>
      <div class="timer" id="timer">00:00</div>
      <canvas class="wave" id="wave" width="600" height="80"></canvas>
      <button class="rec-btn" id="recBtn" aria-label="התחל הקלטה" ${canRecord ? '' : 'disabled'}><span class="ci"></span></button>
      <div class="row" style="justify-content:center;gap:8px">
        <button class="btn secondary" id="pocketBtn" hidden>מצב כיס 🌙</button>
        <button class="btn secondary" id="cancelBtn" hidden>ביטול</button>
      </div>
      ${useLive ? `<details style="margin-top:14px;text-align:start"><summary>תמלול חי</summary><div class="live" id="live" style="margin-top:8px">התמלול יופיע כאן תוך כדי ההקלטה…</div></details>` : ''}
    </div>
    <p class="small muted" style="text-align:center">
      🔒 ההקלטה נשמרת רק בשרת של הצוות. מומלץ ליידע את הלקוח שהשיחה מוקלטת לשיפור השירות.
    </p>`;

  let rec, stream, chunks = [], started = 0, tick, raf, audioCtx, recognition, wakeLock;
  let finalText = '', interim = '', recording = false, stopping = false;
  const btn = $('#recBtn');

  const draw = (analyser) => {
    const c = $('#wave');
    if (!c) return;
    const ctx = c.getContext('2d');
    const data = new Uint8Array(analyser.frequencyBinCount);
    const color = getComputedStyle(document.documentElement).getPropertyValue('--rec').trim() || '#e11d48';
    const loop = () => {
      analyser.getByteTimeDomainData(data);
      ctx.clearRect(0, 0, c.width, c.height);
      const bars = 60, w = c.width / bars;
      for (let i = 0; i < bars; i++) {
        let peak = 0;
        const step = Math.floor(data.length / bars);
        for (let j = 0; j < step; j++) peak = Math.max(peak, Math.abs(data[i * step + j] - 128));
        const h = Math.max(3, (peak / 128) * c.height * 1.6);
        ctx.fillStyle = color;
        ctx.fillRect(i * w + 2, (c.height - h) / 2, w - 4, Math.min(h, c.height));
      }
      raf = requestAnimationFrame(loop);
    };
    loop();
  };

  const startLive = () => {
    if (!useLive) return;
    recognition = new SR();
    recognition.lang = 'he-IL';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (e) => {
      interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript.trim() + '\n';
        else interim += r[0].transcript;
      }
      const live = $('#live');
      if (live) { live.textContent = (finalText + interim) || '…'; live.scrollTop = live.scrollHeight; }
    };
    // Chrome stops recognition after silences; keep it going for the whole meeting.
    recognition.onend = () => { if (recording) try { recognition.start(); } catch {} };
    recognition.onerror = (e) => { if (e.error === 'not-allowed') recognition = null; };
    try { recognition.start(); } catch {}
  };

  const start = async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch {
      toast('צריך לאשר גישה למיקרופון');
      return;
    }
    const mimeType = pickMime();
    rec = new MediaRecorder(stream, { ...(mimeType && { mimeType }), audioBitsPerSecond: 32000 });
    chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.start(5000);
    recording = true;
    started = Date.now();
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    audioCtx.createMediaStreamSource(stream).connect(analyser);
    draw(analyser);
    startLive();
    try { wakeLock = await navigator.wakeLock?.request('screen'); } catch {}
    tick = setInterval(() => {
      const t = fmtTime((Date.now() - started) / 1000);
      $('#timer') && ($('#timer').textContent = t);
      $('#pocket-time').textContent = t;
    }, 500);
    $('#recState').innerHTML = '<span class="recording-badge">מקליט</span>';
    btn.innerHTML = '<span class="sq"></span>';
    btn.setAttribute('aria-label', 'סיים פגישה');
    $('#pocketBtn').hidden = false;
    $('#cancelBtn').hidden = false;
  };

  const teardown = () => {
    recording = false;
    clearInterval(tick);
    cancelAnimationFrame(raf);
    try { recognition?.stop(); } catch {}
    stream?.getTracks().forEach((t) => t.stop());
    audioCtx?.close().catch(() => {});
    wakeLock?.release?.().catch(() => {});
    $('#pocket').hidden = true;
  };

  const stop = async () => {
    if (stopping) return;
    stopping = true;
    const durationSec = Math.round((Date.now() - started) / 1000);
    const done = new Promise((r) => (rec.onstop = r));
    rec.stop();
    await done;
    teardown();
    const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
    const ext = (rec.mimeType || '').includes('mp4') ? 'm4a' : (rec.mimeType || '').includes('ogg') ? 'ogg' : 'webm';
    const fd = new FormData();
    fd.append('audio', blob, `meeting.${ext}`);
    fd.append('repId', state.me || '');
    fd.append('customerName', $('#cust').value);
    fd.append('customerPhone', $('#custPhone').value);
    fd.append('notes', $('#notes').value);
    fd.append('durationSec', durationSec);
    fd.append('liveTranscript', (finalText + interim).trim());
    view.innerHTML = `<div class="card empty"><div class="spinner" style="margin:0 auto 10px"></div>מעלה את ההקלטה…</div>`;
    try {
      const m = await api('/api/meetings', { method: 'POST', body: fd });
      location.hash = `#/m/${m.id}`;
    } catch (err) {
      // Keep the recording so the meeting is not lost.
      const url = URL.createObjectURL(blob);
      view.innerHTML = `<div class="card"><h2 class="danger">ההעלאה נכשלה</h2><p>${esc(err.message)}</p>
        <a class="btn block" download="meeting.${ext}" href="${url}">שמירת ההקלטה במכשיר</a></div>`;
    }
  };

  btn.onclick = () => (recording ? stop() : start());
  $('#cancelBtn').onclick = () => {
    if (!confirm('לבטל את ההקלטה? היא לא תישמר.')) return;
    teardown();
    location.hash = '#/';
  };
  $('#pocketBtn').onclick = () => { $('#pocket').hidden = false; };
  let lastTap = 0;
  $('#pocket').onclick = () => {
    if (Date.now() - lastTap < 400) $('#pocket').hidden = true;
    lastTap = Date.now();
  };

  const guard = () => {
    if (recording && !confirm('ההקלטה עדיין רצה. לעזוב ולאבד אותה?')) {
      history.replaceState(null, '', '#/record');
      cleanup = guard;
      return false;
    }
    teardown();
  };
  cleanup = guard;
}

// ---------- upload file / paste transcript ----------

async function uploadView() {
  view.innerHTML = `
    <h1>ניתוח פגישה קיימת</h1>
    <p class="sub">הקלטתם עם אפליקציה אחרת? העלו את הקובץ — או הדביקו תמלול.</p>
    <div class="seg" role="tablist"><button class="on" data-m="file">קובץ אודיו</button><button data-m="text">הדבקת תמלול</button></div>
    <form class="card" id="f" style="margin-top:12px">
      <div class="grid2">
        <div class="field"><label for="cust">שם הלקוח</label><input id="cust" name="customerName" type="text"></div>
        <div class="field"><label for="rep">איש מכירות</label><select id="rep" name="repId">${state.reps.map((r) => `<option value="${r.id}" ${r.id === state.me ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select></div>
      </div>
      <div id="m-file" class="field">
        <label for="audio">קובץ אודיו (mp3, m4a, wav, webm — עד 25MB)</label>
        <input id="audio" name="audio" type="file" accept="audio/*,video/mp4,.m4a,.mp3,.wav,.webm,.ogg">
        ${state.status.transcription ? '' : '<p class="small danger">שימו לב: תמלול קבצים בשרת לא מוגדר (TRANSCRIBE_API_KEY). אפשר להדביק תמלול במקום.</p>'}
      </div>
      <div id="m-text" class="field" hidden>
        <label for="transcript">תמלול השיחה</label>
        <textarea id="transcript" name="transcript" placeholder="הדביקו כאן את התמלול. לא צריך לסמן מי מדבר — ה-AI יזהה לבד."></textarea>
        <button type="button" class="btn ghost" id="sample">טעינת שיחה לדוגמה</button>
      </div>
      <button class="btn block" type="submit">נתח את הפגישה</button>
    </form>`;

  let mode = 'file';
  view.querySelectorAll('.seg button').forEach((b) =>
    (b.onclick = () => {
      mode = b.dataset.m;
      view.querySelectorAll('.seg button').forEach((x) => x.classList.toggle('on', x === b));
      $('#m-file').hidden = mode !== 'file';
      $('#m-text').hidden = mode !== 'text';
    }),
  );
  $('#sample').onclick = () => {
    $('#cust').value = 'תמר וגיל';
    $('#transcript').value = SAMPLE;
  };
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData();
    fd.append('customerName', $('#cust').value);
    fd.append('repId', $('#rep').value);
    if (mode === 'file') {
      const file = $('#audio').files[0];
      if (!file) return toast('בחרו קובץ');
      fd.append('audio', file, file.name);
    } else {
      if ($('#transcript').value.trim().length < 40) return toast('התמלול קצר מדי');
      fd.append('transcript', $('#transcript').value);
    }
    e.submitter.disabled = true;
    try {
      const m = await api('/api/meetings', { method: 'POST', body: fd });
      location.hash = `#/m/${m.id}`;
    } catch (err) {
      toast(err.message);
      e.submitter.disabled = false;
    }
  };
}

const SAMPLE = `שלום, ברוכים הבאים, אני אלון. תשבו, רוצים משהו לשתות?
תודה, מים זה מצוין.
אז ספרו לי, מה הביא אתכם אלינו?
אנחנו גרים בשכירות כבר שש שנים, יש לנו ילד אחד ועוד אחד בדרך, אז אנחנו מחפשים ארבעה חדרים.
מזל טוב! מתי הלידה?
בעוד ארבעה חודשים.
אז בואו אני אראה לכם את הדירות. יש לנו ארבעה חדרים בקומה שלוש, מאה ושש מטר, מרפסת שמש של עשרה מטר, מטבח גדול, ממ"ד, שני חדרי רחצה. המחיר הוא שני מיליון מאתיים.
וואו, זה יותר ממה שתכננו. חשבנו על משהו סביב מיליון ותשע מאות.
כן, אבל המחירים רק עולים, בעוד שנה זה יהיה יותר.
ומתי האכלוס?
בעוד שנתיים וחצי בערך.
זה די רחוק, אנחנו צריכים משהו יותר מהר בגלל התינוק.
אני מבין. בכל מקרה, הנה התוכנית של הדירה. תסתכלו כמה היא מרווחת.
יפה. אנחנו נצטרך לחשוב על זה, אולי גם לראות את הפרויקט של אפריקה ישראל ליד.
בטח, קחו את הזמן. הנה הכרטיס שלי, תתקשרו מתי שתרצו.`;

// ---------- meeting report ----------

const HANDLED = { full: ['good', 'טופלה'], partial: ['warn', 'טופלה חלקית'], no: ['bad', 'לא טופלה'] };
const SENTIMENT = { positive: ['good', 'חיובי'], neutral: ['neutral', 'ניטרלי'], negative: ['bad', 'שלילי'] };
const SPEAKER = { rep: 'איש מכירות', customer: 'לקוח', other: 'אחר' };
const STEPS = [['queued', 'בתור'], ['transcribing', 'מתמלל את השיחה'], ['analyzing', 'מנתח את הפגישה'], ['done', 'מוכן']];

async function meetingView(id) {
  const m = await api(`/api/meetings/${id}`);

  if (m.status !== 'done') {
    const idx = STEPS.findIndex(([s]) => s === m.status);
    view.innerHTML = `
      <h1>${esc(m.customerName || 'פגישה חדשה')}</h1>
      <p class="sub">${esc(repName(m.repId))} · ${relDate(m.createdAt)}</p>
      <div class="card">
        ${m.status === 'error' ? `
          <h2 class="danger">הניתוח לא הושלם</h2><p>${esc(m.error)}</p>
          <div class="row wrap"><button class="btn" id="retry">נסו שוב</button>
          ${m.audioFile ? `<a class="btn secondary" href="/api/meetings/${m.id}/audio" download>הורדת ההקלטה</a>` : ''}
          <button class="btn ghost danger" id="del">מחיקה</button></div>`
        : `<h2>מעבד את הפגישה…</h2><p class="muted">זה לוקח בדרך כלל פחות מדקה. אפשר לסגור את המסך — נשלח לכם טיפים לוואטסאפ.</p>
          <ul class="steps">${STEPS.slice(1).map(([s, label], i) => {
            const cls = i + 1 < idx ? 'ok' : i + 1 === idx ? 'on' : '';
            const icon = cls === 'ok' ? '✓' : cls === 'on' ? '<div class="spinner"></div>' : '•';
            return `<li class="${cls}"><span class="d">${icon}</span>${label}</li>`;
          }).join('')}</ul>`}
      </div>`;
    if (m.status === 'error') {
      $('#retry').onclick = async () => { await api(`/api/meetings/${id}/retry`, { method: 'POST' }); route(); };
      $('#del').onclick = () => deleteMeeting(id);
    } else {
      const t = setTimeout(() => location.hash === `#/m/${id}` && route(), 2000);
      cleanup = () => clearTimeout(t);
    }
    return;
  }

  const a = m.analysis;
  const open = a.objections.filter((o) => o.handled !== 'full').length;
  const transcript = a.transcript?.length ? a.transcript : [{ speaker: 'other', text: m.transcriptText }];
  const [st, sl] = SENTIMENT[a.customer.sentiment] || SENTIMENT.neutral;

  view.innerHTML = `
    <div class="card">
      <div class="report-head">
        ${ring(a.overall_score)}
        <div>
          <h1>${esc(a.title)}</h1>
          <div class="muted small">${esc(m.rep?.name || '—')} · ${relDate(m.createdAt)}${m.durationSec ? ` · ${Math.round(m.durationSec / 60)} דק׳` : ''}</div>
          ${m.demo ? '<span class="pill neutral" style="margin-top:6px">דוגמה</span>' : ''}
        </div>
      </div>
      <div class="kpis">
        <div class="kpi"><b style="color:${toneColor(tone(a.deal_probability))}">${a.deal_probability}%</b><span>סיכוי סגירה</span></div>
        <div class="kpi"><b style="color:${toneColor(open ? 'bad' : 'good')}">${open}</b><span>התנגדויות פתוחות</span></div>
        <div class="kpi"><b style="color:${toneColor(a.rep_talk_ratio > 60 ? 'bad' : a.rep_talk_ratio > 50 ? 'warn' : 'good')}">${a.rep_talk_ratio}%</b><span>זמן דיבור שלך</span></div>
      </div>
      <p style="margin:14px 0 0">${esc(a.summary)}</p>
    </div>

    <div class="card">
      <h2>🎯 3 דברים לפגישה הבאה</h2>
      <ol class="tips">${a.top_tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ol>
      <div class="row wrap" style="margin-top:12px">
        <a class="btn wa" target="_blank" rel="noopener" href="${esc(m.whatsapp.coachLink)}">${WA_ICON} שלח לי לוואטסאפ</a>
        ${m.whatsapp.canAutoSend ? `<button class="btn secondary" id="autoWa">שליחה אוטומטית</button>` : ''}
        ${m.whatsappSentAt ? `<span class="pill good">נשלח ✓</span>` : ''}
      </div>
    </div>

    <div class="card">
      <h2>התנגדויות (${a.objections.length})</h2>
      ${a.objections.length ? a.objections.map((o) => {
        const [t, l] = HANDLED[o.handled];
        return `<div class="obj">
          <div class="row between"><h3>${esc(o.objection)}</h3><span class="pill ${t}">${l}</span></div>
          <div class="quote">הלקוח: "${esc(o.quote)}"</div>
          <div class="small muted">מה ענית: ${esc(o.how_handled)}</div>
          ${o.handled !== 'full' ? `<div class="better"><b>אפשר היה לענות:</b>"${esc(o.better_response)}"</div>` : ''}
        </div>`;
      }).join('') : '<p class="muted">לא עלו התנגדויות.</p>'}
    </div>

    <div class="card">
      <h2>ציון לפי קריטריונים</h2>
      ${a.criteria.map((c) => {
        const t = tone(c.score, 10);
        return `<div class="crit">
          <div class="row between"><b>${esc(c.name)}</b><b style="color:${toneColor(t)}">${c.score}/10</b></div>
          <div class="bar"><i style="width:${c.score * 10}%;background:${toneColor(t)}"></i></div>
          <div class="small">${esc(c.feedback)}</div>
          ${c.evidence ? `<div class="quote">${esc(c.evidence)}</div>` : ''}
        </div>`;
      }).join('')}
    </div>

    ${a.missed_opportunities.length ? `<div class="card"><h2>💡 הזדמנויות שפוספסו</h2>
      ${a.missed_opportunities.map((x) => `<div class="crit"><div class="quote">${esc(x.moment)}</div><div>${esc(x.what_to_do)}</div></div>`).join('')}
    </div>` : ''}

    <div class="card">
      <h2>מי דיבר</h2>
      <div class="talk"><div class="r" style="width:${a.rep_talk_ratio}%"></div><div class="c" style="width:${100 - a.rep_talk_ratio}%"></div></div>
      <div class="legend"><span><i style="background:var(--brand)"></i>איש מכירות ${a.rep_talk_ratio}%</span><span><i style="background:#22c55e"></i>לקוח ${100 - a.rep_talk_ratio}%</span><span>${a.rep_questions} שאלות נשאלו</span></div>
      <p class="small muted" style="margin:8px 0 0">היעד: הלקוח מדבר יותר ממך. מתחת ל-50% זה מצוין.</p>
    </div>

    <div class="card">
      <h2>הלקוח</h2>
      <div class="row wrap" style="margin-bottom:10px"><span class="pill ${st}">${sl}</span>${a.buying_signals.map((s) => `<span class="chip">✅ ${esc(s)}</span>`).join('')}</div>
      <div class="grid2 small">
        <div><b>צרכים</b><div class="muted">${a.customer.needs.map(esc).join(' · ') || 'לא ידוע'}</div></div>
        <div><b>תקציב</b><div class="muted">${esc(a.customer.budget)}</div></div>
        <div><b>מקבלי החלטה</b><div class="muted">${esc(a.customer.decision_makers)}</div></div>
        <div><b>לוח זמנים</b><div class="muted">${esc(a.customer.timeline)}</div></div>
      </div>
    </div>

    <div class="card">
      <h2>צעדים הבאים</h2>
      ${a.next_steps.map((s) => `<label class="row" style="font-weight:400"><input type="checkbox"> ${esc(s)}</label>`).join('')}
      <h3 style="margin-top:14px">הודעת המשך ללקוח</h3>
      <div class="wa-preview">${esc(a.followup_message)}</div>
      <div class="row wrap" style="margin-top:10px">
        <a class="btn wa" target="_blank" rel="noopener" href="${esc(m.whatsapp.customerLink)}">${WA_ICON} שלח ללקוח</a>
        <button class="btn secondary" id="copyFollow">העתקה</button>
      </div>
    </div>

    <div class="card">
      <details><summary>תמלול השיחה</summary>
        ${m.audioFile ? `<audio controls preload="none" src="/api/meetings/${m.id}/audio" style="width:100%;margin-top:10px"></audio>` : ''}
        <div class="bubbles" style="margin-top:10px">${transcript.map((t) => `<div class="bubble ${t.speaker}"><small>${SPEAKER[t.speaker] || ''}</small>${esc(t.text)}</div>`).join('')}</div>
      </details>
    </div>

    <div class="card">
      <details><summary>הודעת הוואטסאפ שתישלח</summary><div class="wa-preview" style="margin-top:10px">${esc(m.whatsapp.coachText)}</div></details>
    </div>
    <div class="row between"><a class="btn ghost" href="#/">→ חזרה</a><button class="btn ghost danger" id="del">מחיקת פגישה</button></div>`;

  $('#copyFollow').onclick = async () => {
    try { await navigator.clipboard.writeText(a.followup_message); toast('הועתק'); } catch { toast('לא הצלחתי להעתיק'); }
  };
  $('#del').onclick = () => deleteMeeting(id);
  $('#autoWa') && ($('#autoWa').onclick = async (e) => {
    e.target.disabled = true;
    try { await api(`/api/meetings/${id}/whatsapp`, { method: 'POST' }); toast('נשלח לוואטסאפ ✓'); route(); }
    catch (err) { toast(err.message); e.target.disabled = false; }
  });
}

async function deleteMeeting(id) {
  if (!confirm('למחוק את הפגישה וההקלטה?')) return;
  await api(`/api/meetings/${id}`, { method: 'DELETE' });
  toast('נמחק');
  location.hash = '#/';
}

// ---------- manager dashboard ----------

async function dashboardView() {
  const d = await api('/api/dashboard');
  const t = d.totals;
  const maxObj = Math.max(1, ...d.objectionTypes.map((o) => o.total));
  view.innerHTML = `
    <h1>תמונת מצב מהשטח</h1>
    <p class="sub">${esc(d.company)} · מה באמת קורה בפגישות</p>
    <div class="grid4" style="margin-bottom:14px">
      <div class="kpi lg"><b style="color:${toneColor(tone(t.avgScore))}">${t.avgScore ?? '—'}</b><span>ציון ממוצע</span></div>
      <div class="kpi lg"><b>${t.meetings}</b><span>פגישות (${t.thisWeek} השבוע)</span></div>
      <div class="kpi lg"><b style="color:${toneColor(tone(t.objectionHandledRate))}">${t.objectionHandledRate ?? '—'}%</b><span>התנגדויות שטופלו</span></div>
      <div class="kpi lg"><b>${t.pipelineHot}</b><span>עסקאות חמות (60%+)</span></div>
    </div>

    <div class="card">
      <h2>הצוות</h2>
      ${d.reps.length ? d.reps.map((r) => `
        <div class="rep-row">
          <div>
            <b>${esc(r.name)}</b> <span class="small muted">· ${r.meetings} פגישות</span>
            <div class="small" style="margin-top:2px">
              ${r.weakest ? `<span class="pill bad">לשפר: ${esc(r.weakest)}</span> ` : ''}
              ${r.strongest ? `<span class="pill good">חזק: ${esc(r.strongest)}</span>` : ''}
            </div>
            <div class="small muted" style="margin-top:4px">${r.avgTalkRatio != null ? `מדבר ${r.avgTalkRatio}% מהזמן · ` : ''}${r.objectionHandledRate != null ? `מטפל ב-${r.objectionHandledRate}% מההתנגדויות` : ''}</div>
          </div>
          <div style="text-align:left">
            <div style="font-size:24px;font-weight:800;color:${toneColor(tone(r.avgScore))}">${r.avgScore ?? '—'}</div>
            ${sparkline(r.trend)}
          </div>
        </div>`).join('') : '<p class="muted">הוסיפו אנשי מכירות בהגדרות.</p>'}
    </div>

    <div class="card">
      <h2>איפה הצוות חלש</h2>
      <p class="small muted" style="margin-top:-6px">ממוצע הצוות בכל קריטריון, מהחלש לחזק</p>
      ${d.criteria.map((c) => {
        const tt = tone(c.avg, 10);
        return `<div class="hbar"><span>${esc(c.name)}</span><div class="track"><i style="width:${c.avg * 10}%;background:${toneColor(tt)}"></i></div><b style="color:${toneColor(tt)}">${c.avg}</b></div>`;
      }).join('') || '<p class="muted">אין עדיין נתונים.</p>'}
    </div>

    <div class="card">
      <h2>התנגדויות נפוצות</h2>
      <div class="legend" style="margin-bottom:8px"><span><i style="background:var(--bad)"></i>נשארו פתוחות</span><span><i style="background:var(--good)"></i>טופלו</span></div>
      ${d.objectionTypes.map((o) => `
        <div class="hbar"><span>${esc(o.label)}</span>
          <div class="stack" style="width:${(o.total / maxObj) * 100}%">
            <i style="width:${(o.open / o.total) * 100}%;background:var(--bad)"></i><i style="width:${((o.total - o.open) / o.total) * 100}%;background:var(--good)"></i>
          </div><b>${o.total}</b></div>`).join('') || '<p class="muted">אין עדיין נתונים.</p>'}
    </div>

    ${d.recentOpen.length ? `<div class="card">
      <h2>התנגדויות שלא קיבלו מענה</h2>
      <p class="small muted" style="margin-top:-6px">שווה לדבר עליהן בישיבת הצוות</p>
      ${d.recentOpen.map((o) => `<a class="meeting" href="#/m/${o.meetingId}"><div class="info"><div class="title">${esc(o.objection)}</div><div class="small muted">"${esc(o.quote)}" · ${esc(repName(o.repId))}</div></div></a>`).join('')}
    </div>` : ''}`;
}

// ---------- settings ----------

async function settingsView() {
  const [settings, presets] = await Promise.all([api('/api/settings'), api('/api/presets')]);
  state.settings = settings;
  const s = state.status;
  const flag = (on, okTxt, offTxt) => `<span class="pill ${on ? 'good' : 'warn'}">${on ? okTxt : offTxt}</span>`;

  view.innerHTML = `
    <h1>הגדרות</h1>
    <p class="sub">מנהל המכירות קובע לפי מה מדרגים את הפגישות.</p>

    <div class="card">
      <h2>חיבורים</h2>
      <div class="row between"><span>ניתוח AI (Claude)</span>${flag(s.claude, 'מחובר', 'חסר ANTHROPIC_API_KEY')}</div>
      <div class="row between" style="margin-top:8px"><span>תמלול בשרת</span>${flag(s.transcription, 'מחובר', 'תמלול חי בדפדפן')}</div>
      <div class="row between" style="margin-top:8px"><span>וואטסאפ אוטומטי</span>${flag(s.whatsapp, 'מחובר', 'קישורי wa.me')}</div>
    </div>

    <div class="card">
      <h2>העסק</h2>
      <div class="field"><label for="company">שם העסק / הצוות</label><input id="company" type="text" value="${esc(settings.company)}"></div>
      <div class="field"><label for="preset">תחום</label>
        <select id="preset">${presets.map((p) => `<option value="${p.id}" ${p.id === settings.preset ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
        <p class="small muted">החלפת תחום טוענת את הקריטריונים המומלצים לתחום.</p>
      </div>
      <label class="row" style="font-weight:400"><input type="checkbox" id="autoWa" ${settings.autoWhatsapp ? 'checked' : ''} ${s.whatsapp ? '' : 'disabled'}> לשלוח טיפים לוואטסאפ של איש המכירות אוטומטית אחרי כל פגישה</label>
    </div>

    <div class="card">
      <h2>אנשי מכירות</h2>
      <div id="reps">${state.reps.map((r) => `
        <div class="row" style="margin-bottom:8px" data-id="${r.id}">
          <input type="text" value="${esc(r.name)}" data-k="name" aria-label="שם">
          <input type="tel" value="${esc(r.phone)}" data-k="phone" placeholder="טלפון לוואטסאפ" aria-label="טלפון">
          <button class="btn ghost danger" data-del="${r.id}" aria-label="מחיקה">✕</button>
        </div>`).join('')}</div>
      <form class="row" id="addRep"><input type="text" id="newRep" placeholder="שם איש מכירות חדש"><input type="tel" id="newRepPhone" placeholder="050-0000000"><button class="btn secondary">הוספה</button></form>
    </div>

    <div class="card">
      <div class="row between"><h2>קריטריונים לציון</h2><button class="btn ghost" id="addCrit">+ קריטריון</button></div>
      <p class="small muted" style="margin-top:-6px">ה-AI מדרג כל קריטריון 0–10. המשקל קובע כמה הוא משפיע על הציון הכולל.</p>
      <div id="crits"></div>
      <button class="btn block" id="saveCrit">שמירת קריטריונים</button>
    </div>

    <div class="card">
      <h2>נתוני דוגמה</h2>
      <p class="small muted">איפוס מחזיר את הצוות והפגישות לדוגמה, ומוחק את כל השאר.</p>
      <button class="btn secondary" id="reset">איפוס לנתוני דוגמה</button>
    </div>`;

  const renderCrits = () => {
    $('#crits').innerHTML = state.settings.criteria.map((c, i) => `
      <div class="crit-edit" data-i="${i}">
        <div class="row"><input type="text" data-k="name" value="${esc(c.name)}" aria-label="שם הקריטריון">
          <input type="number" data-k="weight" min="0.5" max="3" step="0.5" value="${c.weight}" aria-label="משקל" title="משקל">
          <button class="btn ghost danger" data-rm="${i}" aria-label="הסרה">✕</button></div>
        <textarea data-k="description" style="min-height:64px;margin-top:8px" aria-label="מה נחשב טוב">${esc(c.description)}</textarea>
      </div>`).join('');
  };
  const readCrits = () =>
    [...view.querySelectorAll('.crit-edit')].map((el) => ({
      ...state.settings.criteria[el.dataset.i],
      name: $('[data-k=name]', el).value,
      weight: Number($('[data-k=weight]', el).value),
      description: $('[data-k=description]', el).value,
    }));
  renderCrits();

  const save = async (patch, msg = 'נשמר') => {
    state.settings = await api('/api/settings', { method: 'PUT', json: patch });
    toast(msg);
  };
  $('#company').onchange = (e) => save({ company: e.target.value });
  $('#autoWa').onchange = (e) => save({ autoWhatsapp: e.target.checked });
  $('#preset').onchange = async (e) => {
    if (!confirm('לטעון את הקריטריונים המומלצים לתחום? הקריטריונים הנוכחיים יוחלפו.')) { e.target.value = state.settings.preset; return; }
    await save({ preset: e.target.value }, 'הקריטריונים עודכנו');
    renderCrits();
  };
  $('#crits').onclick = (e) => {
    if (e.target.dataset.rm === undefined) return;
    state.settings.criteria = readCrits().filter((_, i) => i !== Number(e.target.dataset.rm));
    renderCrits();
  };
  $('#addCrit').onclick = () => {
    state.settings.criteria = [...readCrits(), { id: '', name: 'קריטריון חדש', weight: 1, description: '' }];
    renderCrits();
  };
  $('#saveCrit').onclick = async () => { await save({ criteria: readCrits() }); renderCrits(); };

  $('#reps').onchange = async (e) => {
    const row = e.target.closest('[data-id]');
    await api(`/api/reps/${row.dataset.id}`, { method: 'PUT', json: { [e.target.dataset.k]: e.target.value } });
    await loadReps();
    toast('נשמר');
  };
  $('#reps').onclick = async (e) => {
    if (!e.target.dataset.del || !confirm('למחוק את איש המכירות?')) return;
    await api(`/api/reps/${e.target.dataset.del}`, { method: 'DELETE' });
    await loadReps();
    route();
  };
  $('#addRep').onsubmit = async (e) => {
    e.preventDefault();
    if (!$('#newRep').value.trim()) return;
    await api('/api/reps', { method: 'POST', json: { name: $('#newRep').value, phone: $('#newRepPhone').value } });
    await loadReps();
    route();
  };
  $('#reset').onclick = async () => {
    if (!confirm('לאפס הכול לנתוני הדוגמה?')) return;
    await api('/api/reset-demo', { method: 'POST' });
    await loadReps();
    toast('אופס');
    route();
  };
}

// ---------- boot ----------

async function loadReps() {
  state.reps = await api('/api/reps');
  const sel = $('#who');
  if (state.me && !state.reps.some((r) => r.id === state.me)) state.me = '';
  sel.innerHTML = `<option value="">👥 כל הצוות</option>` + state.reps.map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join('');
  sel.value = state.me;
}

$('#who').onchange = (e) => {
  state.me = e.target.value;
  localStorage.setItem('me', state.me);
  route();
};

async function boot() {
  try {
    [state.status] = await Promise.all([api('/api/status'), loadReps()]);
  } catch {}
  if (!state.status.claude) {
    const b = $('#banner');
    b.hidden = false;
    b.innerHTML = 'מצב הדגמה — הפגישות כאן הן דוגמה. לניתוח פגישות אמיתיות מגדירים <code>ANTHROPIC_API_KEY</code>. <a href="#" id="hideBanner">הסתר</a>';
    $('#hideBanner').onclick = (e) => { e.preventDefault(); b.hidden = true; };
  }
  window.addEventListener('hashchange', route);
  route();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
}
boot();
