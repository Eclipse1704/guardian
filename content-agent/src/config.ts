import "dotenv/config";
import path from "node:path";

function optional(name: string, fallback = ""): string {
  return process.env[name]?.trim() || fallback;
}

export function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing environment variable ${name} (see .env.example)`);
  return value;
}

export const config = {
  model: optional("CLAUDE_MODEL", "claude-opus-5-5"),
  outputDir: path.resolve(optional("OUTPUT_DIR", "output")),
  dataDir: path.resolve(optional("DATA_DIR", "data")),
  higgsfield: {
    baseUrl: optional("HF_BASE_URL", "https://api.higgsfield.ai"),
    model: optional("HF_IMAGE_MODEL", "higgsfield-ai/soul/v2/standard"),
  },
  whatsapp: {
    apiVersion: optional("WHATSAPP_API_VERSION", "v23.0"),
    mode: optional("WHATSAPP_MODE", "template") as "template" | "text",
    templateName: optional("WHATSAPP_TEMPLATE_NAME", "daily_digest"),
    templateLang: optional("WHATSAPP_TEMPLATE_LANG", "he"),
  },
  server: {
    port: Number(optional("PORT", "8080")),
    digestCron: optional("DIGEST_CRON", "0 20 * * *"),
  },
};
