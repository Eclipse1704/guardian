# Content Agent — סוכן תוכן, שיווק ותמונות

סוכן מבוסס Claude שמייצר תוכן מוכן לפי סוג המוצר, ושולח סיכום יומי לווטסאפ.

| יכולת | מה נוצר | איך |
|---|---|---|
| 1. יצירת תוכן | מדריך מעוצב (HTML להדפסה), עימוד ועריכה של טקסט קיים | Claude + הכלי `save_asset` |
| 2. קריאייטיב ושיווק | בריף קריאייטיב, קופי לפרסומות/פוסטים/מיילים, דף נחיתה/מכירה, אתר כרטיס ביקור דיגיטלי | Claude + `save_asset` |
| 3. תמונות מוצר | צילומי מוצר, באנרים, קריאייטיב לרשתות | Higgsfield API, הכלי `generate_product_image` |
| 4. דוח יומי לווטסאפ | סיכום של כל העדכונים מהפלטפורמה ב-24 השעות האחרונות | WhatsApp Cloud API + cron |

כל הקבצים נשמרים ב-`output/<שם-הפרויקט>/` (קובצי HTML ו-MD, ותמונות בתיקייה `images/`).

## התקנה

```bash
cd content-agent
npm install
cp .env.example .env   # ולמלא את המפתחות
```

### מפתחות נדרשים
1. **Claude**: מפתח `ANTHROPIC_API_KEY` מ-console.anthropic.com.
2. **Higgsfield**: מזהה מפתח וסוד (`HF_API_KEY_ID`, `HF_API_KEY_SECRET`) מ-cloud.higgsfield.ai. הסוד מוצג רק פעם אחת.
3. **WhatsApp (Meta Cloud API)**:
   - יוצרים אפליקציה ב-developers.facebook.com, מוסיפים את המוצר WhatsApp, ומעתיקים את `Phone number ID` ואת ה-access token (לשימוש קבוע עדיף טוקן של System User).
   - ב-WhatsApp Manager יוצרים תבנית הודעה בשם `daily_digest` בשפה עברית (`he`), בקטגוריית Utility, עם גוף כמו: `הסיכום היומי שלך: {{1}}`, ומחכים לאישור שלה.
   - `WHATSAPP_TO` הוא המספר שלך בפורמט בינלאומי בלי `+`, לדוגמה `9725XXXXXXXX`.

## שימוש

### הרצת משימת תוכן
```bash
npm run agent -- "מוצר: מדריך דיגיטלי 'אפייה ביתית למתחילים', מחיר 89 ש\"ח. צור מדריך מעוצב, דף מכירה ו-3 תמונות מוצר"
npm run agent -- "בנה אתר כרטיס ביקור דיגיטלי לדנה כהן, מאמנת כושר בתל אביב, טלפון 050-0000000"
npm run agent -- "צור קריאייטיב וקופי לקמפיין פייסבוק לבקבוק מים חכם"
```

### שרת: קבלת עדכונים ושליחת הדוח היומי
```bash
npm run server
```
השרת מקבל עדכונים מהפלטפורמה ושולח סיכום לווטסאפ כל יום לפי `DIGEST_CRON` (ברירת המחדל: 20:00, `TZ=Asia/Jerusalem`).

| נתיב | תיאור |
|---|---|
| `POST /events` | הפלטפורמה שולחת כל עדכון: `{"type":"sale","title":"מכירה חדשה","details":{...}}` |
| `POST /agent` | מריץ משימת תוכן: `{"request":"..."}` |
| `POST /digest` | שולח את הדוח היומי עכשיו (לבדיקה) |
| `GET /health` | בדיקת חיים, בלי אימות |

כל קריאה, חוץ מ-`/health`, חייבת לכלול את הכותרת `x-webhook-secret: <EVENTS_WEBHOOK_SECRET>`.

דוגמה לחיבור מהפלטפורמה (או מ-Zapier/Make/webhook של חנות):
```bash
curl -X POST https://your-server/events \
  -H "x-webhook-secret: $EVENTS_WEBHOOK_SECRET" -H "Content-Type: application/json" \
  -d '{"type":"signup","title":"נרשם משתמש חדש","details":{"email":"..."}}'
```
גם הסוכן עצמו רושם אירוע לכל קובץ ותמונה שהוא יוצר, כך שהם מופיעים בדוח היומי.

אפשר לשלוח את הדוח גם בלי השרת, מ-cron של המערכת: `npm run digest`.

## הערות
- מצב `WHATSAPP_MODE=template` עובד בכל שעה. מצב `text` מגיע ליעד רק אם שלחת הודעה למספר העסקי ב-24 השעות האחרונות.
- בתבנית אסור שהמשתנה יכיל שורות חדשות, ולכן הסיכום מאוחד לשורה אחת עם `|`.
- האירועים נשמרים בקובץ `data/events.jsonl`. בפריסה עם כמה שרתים כדאי להחליף אותו במסד נתונים.
