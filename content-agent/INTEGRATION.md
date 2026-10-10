# חיבור gan-eden-hai.com לסוכן

האתר הוא אפליקציית Next.js. החיבור לסוכן נעשה בשתי קריאות HTTP פשוטות מצד השרת של האתר,
בלי לשנות את מבנה האתר.

## 1. משתני סביבה באתר
```
CONTENT_AGENT_URL=https://agent.gan-eden-hai.com   # הכתובת שבה רץ השרת של הסוכן
CONTENT_AGENT_SECRET=...                           # אותו ערך כמו EVENTS_WEBHOOK_SECRET בסוכן
```

## 2. קובץ עזר: `lib/content-agent.ts`
```ts
const base = process.env.CONTENT_AGENT_URL;
const secret = process.env.CONTENT_AGENT_SECRET ?? "";

async function post(path: string, body: unknown) {
  if (!base) return null;
  try {
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-webhook-secret": secret },
      body: JSON.stringify(body),
    });
    return res.ok ? res.json() : null;
  } catch (err) {
    console.error("content-agent unreachable", err); // never break the user flow
    return null;
  }
}

/** Report anything that happened on the platform; it shows up in the daily WhatsApp digest. */
export function notifyAgent(type: string, title: string, details?: Record<string, unknown>) {
  return post("/events", { type, title, details, source: "gan-eden-hai" });
}

/** Ask the agent to build a member's digital business card. Returns { url } right away. */
export function requestBusinessCard(card: {
  memberId: string; name: string; role?: string; bio?: string; services?: string[];
  phone?: string; whatsapp?: string; email?: string; website?: string;
  socials?: Record<string, string>; location?: string; package?: string; photoUrl?: string;
}) {
  return post("/business-card", card) as Promise<{ status: string; url: string } | null>;
}
```
כל הקריאות נעשות מצד השרת בלבד (Route Handler / Server Action), כדי שהסוד לא יגיע לדפדפן.

## 3. איפה לקרוא ל-`notifyAgent`
| אירוע באתר | `type` | דוגמה ל-`title` |
|---|---|---|
| הרשמה לקהילה החינמית | `signup` | `נרשמה חברה חדשה: מיכל` |
| הצטרפות למועדון הבוראים | `club_join` | `מיכל הצטרפה למועדון הבוראים (חבילת יוצרת)` |
| תשלום / רכישה | `payment` | `תשלום 290 ₪ – חבילת יוצרת` |
| יצירה חדשה פורסמה | `work_published` | `יצירה חדשה: "סדנת נשימה בטבע"` |
| הרשמה לריטריט | `retreat_booking` | `2 נרשמו לריטריט בגליל` |
| שיתוף רגע בפיד / בקהילה | `moment_shared` | `5 רגעים חדשים שותפו בפיד` |
| שאלה לסוניה | `question` | `שאלה חדשה מיעל: ...` |
| שגיאה / תשלום שנכשל | `error` | `תשלום נכשל עבור ...` |

אפשר לשלוח גם סוגים נוספים. הסוכן מקבץ ומסכם כל `type`, ומקדים בדוח את מה שקשור לכסף,
לחברות חדשות ולדברים שדורשים טיפול.

## 4. כרטיס ביקור דיגיטלי למועדון הבוראים
בסיום מסך "בחירת חבילה ובניית כרטיס ביקור", קוראים ל-`requestBusinessCard(...)`.
התשובה חוזרת מיד עם `url`, ואת הכתובת אפשר לשמור בפרופיל של החברה. בניית הדף לוקחת כמה דקות,
וכשהוא מוכן נרשם אירוע `business_card_ready`, שמופיע גם בדוח היומי. אם הבנייה נכשלת נרשם
אירוע `agent_error`.

הדפים זמינים לציבור בכתובת `<PUBLIC_URL>/sites/<project>/`.
