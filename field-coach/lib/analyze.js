import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';

const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-5-5';

const Speaker = z.enum(['rep', 'customer', 'other']);

export const AnalysisSchema = z.object({
  title: z.string().describe('כותרת קצרה לפגישה, למשל "דירת 5 חדרים — משפחת כהן"'),
  summary: z.string().describe('סיכום הפגישה ב-3–4 משפטים'),
  transcript: z
    .array(z.object({ speaker: Speaker, text: z.string() }))
    .describe('התמלול המקורי מחולק לדוברים. אל תשנה מילים, רק חלק לפי דובר.'),
  criteria: z.array(
    z.object({
      id: z.string(),
      score: z.number().int().describe('0–10'),
      evidence: z.string().describe('ציטוט קצר מהשיחה שמבסס את הציון'),
      feedback: z.string().describe('משפט אחד: מה היה טוב / מה לשפר'),
    }),
  ),
  objections: z.array(
    z.object({
      objection: z.string().describe('ההתנגדות בניסוח קצר'),
      category: z.enum(['price', 'timing', 'competitor', 'trust', 'need', 'decision_maker', 'other']),
      quote: z.string().describe('מה הלקוח אמר בפועל'),
      handled: z.enum(['full', 'partial', 'no']),
      how_handled: z.string().describe('מה איש המכירות ענה, או "לא התייחס"'),
      better_response: z.string().describe('תשובה מומלצת, מנוסחת כמו שאומרים אותה לקוח'),
    }),
  ),
  missed_opportunities: z.array(
    z.object({
      moment: z.string().describe('הרגע בשיחה (ציטוט או תיאור)'),
      what_to_do: z.string().describe('מה היה צריך לעשות'),
    }),
  ),
  buying_signals: z.array(z.string()),
  customer: z.object({
    needs: z.array(z.string()),
    budget: z.string().describe('או "לא ידוע"'),
    decision_makers: z.string().describe('או "לא ידוע"'),
    timeline: z.string().describe('או "לא ידוע"'),
    sentiment: z.enum(['positive', 'neutral', 'negative']),
  }),
  rep_talk_ratio: z.number().int().describe('אחוז המילים שאמר איש המכירות, 0–100'),
  rep_questions: z.number().int().describe('מספר השאלות שאיש המכירות שאל'),
  deal_probability: z.number().int().describe('הסבירות לסגירה, 0–100'),
  next_steps: z.array(z.string()),
  top_tips: z.array(z.string()).describe('בדיוק 3 טיפים קונקרטיים לפגישה הבאה, מהחשוב ביותר'),
  followup_message: z.string().describe('הודעת וואטסאפ קצרה וחמה שאיש המכירות ישלח ללקוח אחרי הפגישה'),
});

const SYSTEM = `אתה מאמן מכירות בכיר עם 20 שנות ניסיון במכירות פנים מול פנים בישראל — נדל"ן, רכב, מטבחים, ביטוח ואולמות אירועים.
אתה מקבל תמלול של פגישת מכירה שהוקלטה בשטח (לרוב מטלפון בכיס, כך שהתמלול עשוי להכיל שגיאות, רעשים ומילים חסרות — תתעלם מרעש ותבין מהקשר).
התמלול לא מחולק לדוברים. אתה צריך להסיק מי איש המכירות (rep) ומי הלקוח (customer) מתוך התוכן.

המטרה: לתת לאיש המכירות ולמנהל שלו תמונה אמיתית של מה קרה בפגישה ומה לעשות אחרת בפעם הבאה.

כללים:
- כתוב הכול בעברית, בשפה ישירה ומקצועית של מאמן מכירות ישראלי, לא של יועץ אמריקאי.
- היה ספציפי: כל ביקורת מבוססת על ציטוט או רגע מהשיחה. בלי עצות כלליות כמו "תקשיב יותר".
- ציונים הוגנים: 5 זה בינוני, 8+ רק כשבאמת היה מצוין. אל תנפח ציונים.
- התנגדות היא כל חשש, היסוס או "אבל" של הלקוח — גם אם נאמר בעדינות ("נראה לי קצת יקר", "צריך לדבר עם אשתי", "ראינו משהו אחר").
- "better_response" צריך להיות משפט שאפשר להגיד ללקוח מילה במילה.
- בסעיף criteria החזר פריט אחד לכל קריטריון שקיבלת, עם אותו id בדיוק.
- אם משהו לא עלה בשיחה, אל תמציא. כתוב "לא ידוע" או השאר מערך ריק.`;

let client;
function getClient() {
  if (!client) client = new Anthropic();
  return client;
}

export function isConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

function buildPrompt({ transcript, preset, criteria, repName, customerName, notes }) {
  const criteriaText = criteria
    .map((c) => `- id: ${c.id} | ${c.name} (משקל ${c.weight}): ${c.description}`)
    .join('\n');
  return `סוג העסק: ${preset.name}
הקשר: ${preset.context}
איש המכירות: ${repName || 'לא צוין'}
הלקוח: ${customerName || 'לא צוין'}
${notes ? `הערות איש המכירות: ${notes}\n` : ''}
קריטריונים לדירוג (0–10 לכל אחד):
${criteriaText}

<transcript>
${transcript}
</transcript>

נתח את הפגישה.`;
}

/** Weighted 0–100 score from per-criterion 0–10 scores. Computed here, not by the model, so it is consistent. */
export function overallScore(criteriaDefs, scored) {
  let total = 0;
  let weights = 0;
  for (const def of criteriaDefs) {
    const s = scored.find((x) => x.id === def.id);
    if (!s) continue;
    const clamped = Math.max(0, Math.min(10, s.score));
    total += clamped * def.weight;
    weights += def.weight;
  }
  return weights ? Math.round((total / weights) * 10) : 0;
}

export async function analyzeMeeting(input) {
  const message = await getClient().beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: betaZodOutputFormat(AnalysisSchema) },
    system: SYSTEM,
    messages: [{ role: 'user', content: buildPrompt(input) }],
  });

  if (message.stop_reason === 'refusal') {
    throw new Error('המודל סירב לנתח את השיחה הזו.');
  }
  if (message.stop_reason === 'max_tokens') {
    throw new Error('השיחה ארוכה מדי לניתוח בבת אחת.');
  }
  const analysis = message.parsed_output;
  if (!analysis) throw new Error('לא התקבל ניתוח תקין מהמודל.');

  // Attach names/weights so the report renders without looking up settings again.
  analysis.criteria = input.criteria.map((def) => {
    const s = analysis.criteria.find((x) => x.id === def.id) || { score: 0, evidence: '', feedback: 'לא נבדק' };
    return { ...s, id: def.id, name: def.name, weight: def.weight, score: Math.max(0, Math.min(10, s.score)) };
  });
  analysis.overall_score = overallScore(input.criteria, analysis.criteria);
  analysis.top_tips = analysis.top_tips.slice(0, 3);
  analysis.model = message.model;
  return analysis;
}
