// WhatsApp delivery of coaching tips.
// Always available: a wa.me deep link the rep (or manager) taps to open WhatsApp with the message ready.
// Optional automatic sending through Twilio's WhatsApp API when TWILIO_* env vars are set.

const SID = () => process.env.TWILIO_ACCOUNT_SID;
const TOKEN = () => process.env.TWILIO_AUTH_TOKEN;
const FROM = () => process.env.TWILIO_WHATSAPP_FROM; // e.g. whatsapp:+14155238886

export function isConfigured() {
  return Boolean(SID() && TOKEN() && FROM());
}

/** Israeli local numbers (050-1234567) -> international digits (972501234567). */
export function normalizePhone(phone) {
  let digits = String(phone || '').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('0')) digits = '972' + digits.slice(1);
  return digits;
}

export function waLink(phone, text) {
  const n = normalizePhone(phone);
  return `https://wa.me/${n}?text=${encodeURIComponent(text)}`;
}

export function coachMessage(meeting) {
  const a = meeting.analysis;
  const unhandled = a.objections.filter((o) => o.handled !== 'full');
  const lines = [
    `🎯 *סיכום פגישה: ${a.title}*`,
    `ציון: *${a.overall_score}/100* · סיכוי סגירה: ${a.deal_probability}%`,
    '',
    '*3 דברים לפגישה הבאה:*',
    ...a.top_tips.map((t, i) => `${i + 1}. ${t}`),
  ];
  if (unhandled.length) {
    lines.push('', '*התנגדויות שנשארו פתוחות:*');
    for (const o of unhandled.slice(0, 3)) {
      lines.push(`• ${o.objection}`, `  ↳ אפשר לענות: "${o.better_response}"`);
    }
  }
  if (a.next_steps.length) {
    lines.push('', '*צעדים הבאים:*', ...a.next_steps.slice(0, 3).map((s) => `☐ ${s}`));
  }
  return lines.join('\n');
}

export async function send(phone, text) {
  const auth = Buffer.from(`${SID()}:${TOKEN()}`).toString('base64');
  const body = new URLSearchParams({ From: FROM(), To: `whatsapp:+${normalizePhone(phone)}`, Body: text });
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID()}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`שליחת וואטסאפ נכשלה (${res.status}): ${(await res.text()).slice(0, 200)}`);
  return res.json();
}
