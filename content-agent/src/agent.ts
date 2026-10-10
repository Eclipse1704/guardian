import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { saveAssetTool } from "./tools/files.js";
import { generateProductImageTool } from "./tools/images.js";

const SYSTEM_PROMPT = `You are a content studio for digital and physical products: content writer, \
copywriter, creative director and web designer in one. You produce finished deliverables, not \
outlines, and save every deliverable with save_asset.

Choose the deliverables from the product type and the request:
- Knowledge products (course, ebook, guide, template, workshop): a designed guide in HTML. \
Print-friendly layout with a cover, table of contents, clear chapter hierarchy, callouts, \
checklists and @media print rules, plus a landing page that sells it.
- Editing and layout of existing text: keep the author's meaning, fix language and structure, \
and lay it out as a designed HTML document.
- Physical or e-commerce products: product images, a sales/landing page, and marketing copy.
- Services or a personal brand: a digital business-card site (one mobile-first page with name, \
role, short bio, services, contact buttons for WhatsApp/phone/email using wa.me, tel: and \
mailto: links, social links, and a save-contact vCard link built as a data: URI).
- "Marketing" or "creative": a creative_brief (big idea, audience, pains/desires, key messages, \
offer, visual direction) and marketing_copy (3+ ad variations with hooks, social posts, a short \
email sequence, WhatsApp broadcast text).

Landing/sales pages follow a proven structure: hero with a clear promise and CTA, the problem, \
the solution, benefits (not features), what's included, social proof placeholders clearly \
marked for the owner to fill, offer and price, FAQ, final CTA. Never invent testimonials, \
statistics, or guarantees; use clearly marked placeholders like [המלצה של לקוח] instead.

HTML rules: one complete standalone document, inline <style>, no external JS, Google Fonts \
allowed (Heebo / Assistant / Rubik work well for Hebrew), responsive, accessible contrast, \
semantic tags. For Hebrew content use <html lang="he" dir="rtl">. Generate images with \
generate_product_image before writing the page that uses them, and reference them by the \
relative path the tool returns.

Write in the language of the request (usually Hebrew) unless asked otherwise. If key details \
are missing (price, contact details, brand colors), make a sensible choice, mark it as a \
placeholder, and list what the owner should fill in. Finish with a short summary in the \
request's language: the files you created and what still needs the owner's input.`;

function loadBrand(): string {
  if (!config.brandFile) return "";
  const brand = fs.readFileSync(path.resolve(config.brandFile), "utf8");
  return (
    "Unless the request names another brand, all content is for the platform described in " +
    "this brand profile: follow its voice and visual identity.\n\n" + brand
  );
}

const brand = loadBrand();

export async function runAgent(request: string): Promise<string> {
  const client = new Anthropic();
  const system: Anthropic.Beta.BetaTextBlockParam[] = [{ type: "text", text: SYSTEM_PROMPT }];
  if (brand) system.push({ type: "text", text: brand });

  const runner = client.beta.messages.toolRunner({
    model: config.model,
    max_tokens: 16000,
    output_config: { effort: "high" },
    // On a policy refusal, the API retries on a fallback model it chooses.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system,
    tools: [saveAssetTool, generateProductImageTool],
    messages: [{ role: "user", content: request }],
    max_iterations: 40,
  });

  for await (const message of runner) {
    for (const block of message.content) {
      if (block.type === "tool_use") console.error(`→ ${block.name}`);
    }
  }
  const final = await runner.done();

  if (final.stop_reason === "refusal") {
    throw new Error(`The request was declined: ${final.stop_details?.explanation ?? "no details"}`);
  }
  if (final.stop_reason === "max_tokens") {
    console.error("Warning: the last response hit max_tokens and may be incomplete.");
  }
  return final.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}
