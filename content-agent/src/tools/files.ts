import fs from "node:fs/promises";
import path from "node:path";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { config } from "../config.js";
import { recordEvent } from "../events.js";
import { slugify } from "../slug.js";

export const ASSET_KINDS = [
  "guide", // מדריך מעוצב / ebook
  "layout", // עימוד ועריכה של תוכן קיים
  "landing_page", // דף נחיתה / דף מכירה
  "business_card_site", // אתר כרטיס ביקור דיגיטלי
  "marketing_copy", // קופי לפרסומות, פוסטים, מיילים
  "creative_brief", // קריאייטיב: קונספט, מסרים, הנחיות ויזואליות
] as const;

export function projectDir(project: string): string {
  return path.join(config.outputDir, slugify(project));
}

export const saveAssetTool = betaZodTool({
  name: "save_asset",
  description:
    "Save a finished deliverable to the project folder. Use format 'html' for designed pages " +
    "(guides, landing pages, business-card sites) as a complete standalone HTML document with " +
    "inline CSS, and 'md' for copy and briefs. Images created with generate_product_image live " +
    "in the same folder, so reference them by their returned relative path (e.g. images/hero.jpg). " +
    "Call once per file; calling again with the same filename overwrites it.",
  inputSchema: z.object({
    project: z.string().describe("Product or project name; all files for it share one folder"),
    kind: z.enum(ASSET_KINDS),
    filename: z
      .string()
      .regex(/^[\w.-]+$/, "Latin letters, digits, dot, dash or underscore only")
      .describe("File name including extension, e.g. index.html or guide.html or ads.md"),
    format: z.enum(["html", "md"]),
    content: z.string().describe("The full file content"),
  }),
  run: async ({ project, kind, filename, format, content }) => {
    const ext = path.extname(filename).slice(1);
    if (ext !== format) {
      return `Error: filename extension ".${ext}" does not match format "${format}".`;
    }
    const dir = projectDir(project);
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, filename);
    await fs.writeFile(file, content, "utf8");
    await recordEvent({
      type: "asset_created",
      title: `נוצר ${kind} עבור "${project}"`,
      details: { file: path.relative(process.cwd(), file) },
      source: "content-agent",
    });
    return `Saved ${path.relative(process.cwd(), file)} (${content.length} chars).`;
  },
});
