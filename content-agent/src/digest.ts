import Anthropic from "@anthropic-ai/sdk";
import { pathToFileURL } from "node:url";
import { config } from "./config.js";
import { eventsSince } from "./events.js";
import { sendWhatsApp } from "./tools/whatsapp.js";

/** Summarizes the last 24 hours of platform events and sends the summary to WhatsApp. */
export async function sendDailyDigest(now = new Date()): Promise<string> {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const events = await eventsSince(since);

  let summary: string;
  if (events.length === 0) {
    summary = "אין עדכונים חדשים בפלטפורמה ב-24 השעות האחרונות.";
  } else {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: config.model,
      max_tokens: 2000,
      output_config: { effort: "low" },
      system:
        "You write a daily WhatsApp digest in Hebrew for a business owner about activity on their " +
        "platform. Group related events, lead with what matters most (money, new customers, " +
        "problems that need action), use short lines with a leading emoji, and keep it under 900 " +
        "characters. Plain text only: no Markdown headings, tables or links. Mention only what is " +
        "in the events.",
      messages: [
        {
          role: "user",
          content: `Events from ${since.toISOString()} to ${now.toISOString()} (JSON lines):\n` +
            events.map((e) => JSON.stringify(e)).join("\n"),
        },
      ],
    });
    if (response.stop_reason === "refusal") throw new Error("Digest generation was declined");
    summary = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
  }

  const id = await sendWhatsApp(summary);
  console.log(`Daily digest sent (${events.length} events, message ${id})`);
  return summary;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  sendDailyDigest().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
