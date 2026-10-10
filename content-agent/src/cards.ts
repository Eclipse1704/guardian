import { runAgent } from "./agent.js";
import { config } from "./config.js";
import { slugify } from "./slug.js";

/** Member details the platform sends when a Creators Club member builds a business card. */
export interface CardRequest {
  /** The member's id on the platform; keeps two members with the same name apart. */
  memberId?: string;
  name: string;
  role?: string;
  bio?: string;
  services?: string[];
  phone?: string;
  whatsapp?: string;
  email?: string;
  website?: string;
  socials?: Record<string, string>;
  location?: string;
  package?: string;
  photoUrl?: string;
  notes?: string;
}

export function cardProject(card: CardRequest): string {
  return `card-${card.memberId ?? card.name}`;
}

export function siteUrl(project: string, file = "index.html"): string {
  const rel = `/sites/${encodeURIComponent(slugify(project))}/${file}`;
  return config.publicUrl ? config.publicUrl + rel : rel;
}

/** Builds a digital business-card site for a club member and returns its URL. */
export async function buildBusinessCard(card: CardRequest) {
  const project = cardProject(card);
  const request =
    `בני אתר כרטיס ביקור דיגיטלי לחברת/חבר מועדון הבוראים. project: "${project}", ` +
    `שמור את הדף בשם index.html (kind: business_card_site). ` +
    `אם יש photoUrl השתמש בו כתמונת הפרופיל; אחרת אל תייצר תמונה של אדם, השתמש באות ראשונה מעוצבת. ` +
    `אל תמציא פרטי קשר שלא נמסרו.\nפרטי החבר/ה (JSON):\n${JSON.stringify(card, null, 2)}`;
  const summary = await runAgent(request);
  return { project: slugify(project), url: siteUrl(project), summary };
}
