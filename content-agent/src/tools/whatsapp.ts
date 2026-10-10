import { config, required } from "../config.js";

/**
 * Sends a message to WHATSAPP_TO through the Meta WhatsApp Cloud API.
 *
 * In "template" mode the text is passed as the single {{1}} body variable of an approved
 * template, which works at any time. Template variables may not contain newlines, so lines
 * are joined with " | " and the text is capped at 1000 characters.
 * In "text" mode a free-form message is sent; Meta only delivers it within 24 hours of your
 * last message to the business number.
 */
export async function sendWhatsApp(text: string): Promise<string> {
  const { apiVersion, mode, templateName, templateLang } = config.whatsapp;
  const url = `https://graph.facebook.com/${apiVersion}/${required("WHATSAPP_PHONE_NUMBER_ID")}/messages`;

  const body =
    mode === "text"
      ? { type: "text", text: { preview_url: false, body: text.slice(0, 4096) } }
      : {
          type: "template",
          template: {
            name: templateName,
            language: { code: templateLang },
            components: [
              {
                type: "body",
                parameters: [{ type: "text", text: flattenForTemplate(text) }],
              },
            ],
          },
        };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${required("WHATSAPP_TOKEN")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ messaging_product: "whatsapp", to: required("WHATSAPP_TO"), ...body }),
  });
  const json = (await res.json()) as { messages?: { id: string }[]; error?: { message: string } };
  if (!res.ok || !json.messages?.[0]) {
    throw new Error(`WhatsApp send failed (${res.status}): ${json.error?.message ?? JSON.stringify(json)}`);
  }
  return json.messages[0].id;
}

function flattenForTemplate(text: string): string {
  const flat = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join(" | ")
    .replace(/\s{4,}/g, "   ");
  return flat.length > 1000 ? flat.slice(0, 997) + "..." : flat;
}
