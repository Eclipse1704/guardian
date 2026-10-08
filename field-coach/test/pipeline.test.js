// End-to-end: real server + a mock Anthropic API. Verifies the request we send and the
// transcript -> analysis -> report -> dashboard flow, without spending tokens.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const fakeAnalysis = {
  title: 'בדיקה', summary: 'סיכום',
  transcript: [{ speaker: 'rep', text: 'שלום' }, { speaker: 'customer', text: 'יקר לי' }],
  criteria: [{ id: 'rapport', score: 8, evidence: 'שלום', feedback: 'טוב' }, { id: 'closing', score: 2, evidence: '', feedback: 'אין צעד הבא' }],
  objections: [{ objection: 'מחיר', category: 'price', quote: 'יקר לי', handled: 'no', how_handled: 'לא התייחס', better_response: 'כמה חשבתם?' }],
  missed_opportunities: [], buying_signals: [],
  customer: { needs: [], budget: 'לא ידוע', decision_makers: 'לא ידוע', timeline: 'לא ידוע', sentiment: 'neutral' },
  rep_talk_ratio: 70, rep_questions: 1, deal_probability: 20,
  next_steps: ['להתקשר'], top_tips: ['א', 'ב', 'ג', 'ד'], followup_message: 'תודה!',
};

test('transcript is analysed and shows up on the dashboard', async (t) => {
  let captured;
  const mock = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      captured = { url: req.url, headers: req.headers, body: JSON.parse(body) };
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        id: 'msg_1', type: 'message', role: 'assistant', model: captured.body.model,
        content: [{ type: 'text', text: JSON.stringify(fakeAnalysis) }],
        stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 },
      }));
    });
  });
  await new Promise((r) => mock.listen(0, r));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-'));
  const port = 3300 + Math.floor(Math.random() * 500);
  const env = { ...process.env, PORT: port, DATA_DIR: dataDir, ANTHROPIC_API_KEY: 'test', ANTHROPIC_BASE_URL: `http://127.0.0.1:${mock.address().port}` };
  delete env.ANTHROPIC_AUTH_TOKEN;
  const srv = spawn(process.execPath, ['server.js'], { env, stdio: 'pipe' });
  t.after(() => { srv.kill(); mock.close(); });
  await new Promise((r) => srv.stdout.on('data', (d) => String(d).includes('running') && r()));
  const base = `http://127.0.0.1:${port}`;

  const fd = new FormData();
  fd.append('transcript', 'שלום, אני דני. מה מביא אתכם? אנחנו מחפשים דירה. המחיר יקר לי מדי, נחשוב על זה.');
  fd.append('repId', 'rep_dani');
  fd.append('customerName', 'לקוח בדיקה');
  const created = await (await fetch(`${base}/api/meetings`, { method: 'POST', body: fd })).json();

  let m;
  for (let i = 0; i < 50; i++) {
    m = await (await fetch(`${base}/api/meetings/${created.id}`)).json();
    if (m.status === 'done' || m.status === 'error') break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(m.status, 'done', m.error);

  // Request shape
  assert.equal(captured.body.model, 'claude-opus-5-5');
  assert.equal(captured.body.fallbacks, 'default');
  assert.match(captured.headers['anthropic-beta'], /server-side-fallback-2026-07-01/);
  assert.equal(captured.body.output_config.format.type, 'json_schema');
  assert.match(captured.body.messages[0].content, /המחיר יקר לי/);

  // Post-processing: every configured criterion present, weighted score computed server-side
  const ids = m.analysis.criteria.map((c) => c.id);
  assert.ok(ids.includes('discovery'), 'missing criteria are filled in');
  assert.equal(m.analysis.top_tips.length, 3);
  assert.ok(m.analysis.overall_score >= 0 && m.analysis.overall_score <= 100);
  assert.match(m.whatsapp.coachLink, /^https:\/\/wa\.me\/972501234567\?text=/);
  assert.match(m.whatsapp.coachText, /כמה חשבתם/);

  const dash = await (await fetch(`${base}/api/dashboard`)).json();
  assert.equal(dash.totals.meetings, 8);
});
