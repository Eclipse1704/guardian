import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { config, required } from "../config.js";
import { recordEvent } from "../events.js";
import { projectDir } from "./files.js";

interface HiggsfieldRequest {
  status: string;
  request_id: string;
  status_url?: string;
  images?: { url: string }[];
  error?: string;
}

const TERMINAL = new Set(["completed", "failed", "nsfw", "canceled"]);

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Key ${required("HF_API_KEY_ID")}:${required("HF_API_KEY_SECRET")}`,
    "Content-Type": "application/json",
  };
}

/** Submits a text-to-image job to Higgsfield, waits for it, and returns the image URLs. */
export async function generateImage(
  prompt: string,
  aspectRatio: string,
  timeoutMs = 5 * 60_000,
): Promise<string[]> {
  const submit = await fetch(`${config.higgsfield.baseUrl}/${config.higgsfield.model}`, {
    method: "POST",
    headers: { ...authHeaders(), "Idempotency-Key": randomUUID() },
    body: JSON.stringify({ prompt, aspect_ratio: aspectRatio }),
  });
  if (!submit.ok) {
    throw new Error(`Higgsfield submit failed: ${submit.status} ${await submit.text()}`);
  }
  let job = (await submit.json()) as HiggsfieldRequest;
  const statusUrl =
    job.status_url ?? `${config.higgsfield.baseUrl}/requests/${job.request_id}/status`;

  const deadline = Date.now() + timeoutMs;
  while (!TERMINAL.has(job.status)) {
    if (Date.now() > deadline) throw new Error(`Higgsfield job ${job.request_id} timed out`);
    await new Promise((r) => setTimeout(r, 3000));
    const res = await fetch(statusUrl, { headers: authHeaders() });
    if (!res.ok) throw new Error(`Higgsfield status failed: ${res.status} ${await res.text()}`);
    job = (await res.json()) as HiggsfieldRequest;
  }
  if (job.status !== "completed" || !job.images?.length) {
    throw new Error(`Higgsfield job ${job.request_id} ended with status "${job.status}"`);
  }
  return job.images.map((i) => i.url);
}

export const generateProductImageTool = betaZodTool({
  name: "generate_product_image",
  description:
    "Generate a product image (product shot, hero banner, mockup, social creative) with " +
    "Higgsfield and save it into the project's images/ folder. Write the prompt in English, " +
    "describing subject, setting, lighting, camera/style and mood; do not ask for rendered text " +
    "inside the image. Returns the relative path to use in HTML (e.g. images/hero.jpg).",
  inputSchema: z.object({
    project: z.string().describe("Same project name used with save_asset"),
    name: z
      .string()
      .regex(/^[\w-]+$/)
      .describe("Short file name without extension, e.g. hero, product-front, og-image"),
    prompt: z.string().describe("Detailed English image prompt"),
    aspect_ratio: z.enum(["1:1", "4:5", "3:4", "16:9", "9:16"]).default("1:1"),
  }),
  run: async ({ project, name, prompt, aspect_ratio }) => {
    try {
      const [url] = await generateImage(prompt, aspect_ratio);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Downloading ${url} failed: ${res.status}`);
      const ext = path.extname(new URL(url).pathname) || ".jpg";
      const dir = path.join(projectDir(project), "images");
      await fs.mkdir(dir, { recursive: true });
      const relative = `images/${name}${ext}`;
      await fs.writeFile(path.join(dir, `${name}${ext}`), Buffer.from(await res.arrayBuffer()));
      await recordEvent({
        type: "image_created",
        title: `נוצרה תמונה "${name}" עבור "${project}"`,
        details: { file: relative },
        source: "content-agent",
      });
      return `Saved image to ${relative}`;
    } catch (err) {
      return `Error generating image: ${(err as Error).message}`;
    }
  },
});
