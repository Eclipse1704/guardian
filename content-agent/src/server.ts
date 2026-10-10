import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { timingSafeEqual } from "node:crypto";
import cron from "node-cron";
import { config, required } from "./config.js";
import { recordEvent } from "./events.js";
import { runAgent } from "./agent.js";
import { sendDailyDigest } from "./digest.js";
import { buildBusinessCard, cardProject, siteUrl, type CardRequest } from "./cards.js";

const secret = required("EVENTS_WEBHOOK_SECRET");

function authorized(req: http.IncomingMessage): boolean {
  const given = Buffer.from(String(req.headers["x-webhook-secret"] ?? ""));
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

/** Serves generated sites publicly under /sites/<project>/<file>. */
async function serveSite(urlPath: string, res: http.ServerResponse) {
  const rel = decodeURIComponent(urlPath.replace(/^\/sites\//, "").split("?")[0]);
  const file = path.resolve(config.outputDir, rel.endsWith("/") ? rel + "index.html" : rel);
  if (!file.startsWith(config.outputDir + path.sep)) return send(res, 404, { error: "not found" });
  try {
    const body = await fs.readFile(file);
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    send(res, 404, { error: "not found" });
  }
}

function send(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") return send(res, 200, { ok: true });
    if (req.method === "GET" && req.url?.startsWith("/sites/")) return serveSite(req.url, res);
    if (!authorized(req)) return send(res, 401, { error: "unauthorized" });

    // Your platform posts every update here; they are included in the daily WhatsApp digest.
    if (req.method === "POST" && req.url === "/events") {
      const body = await readJson(req);
      if (typeof body.type !== "string" || typeof body.title !== "string") {
        return send(res, 400, { error: "body needs string fields 'type' and 'title'" });
      }
      const event = await recordEvent({
        type: body.type,
        title: body.title,
        details: (body.details as Record<string, unknown>) ?? undefined,
        source: typeof body.source === "string" ? body.source : "platform",
      });
      return send(res, 201, event);
    }

    // Run a content job: { "request": "צור דף נחיתה ל..." }
    if (req.method === "POST" && req.url === "/agent") {
      const body = await readJson(req);
      if (typeof body.request !== "string") return send(res, 400, { error: "missing 'request'" });
      return send(res, 200, { summary: await runAgent(body.request) });
    }

    // A Creators Club member built a business card: generate the site in the background.
    if (req.method === "POST" && req.url === "/business-card") {
      const card = (await readJson(req)) as unknown as CardRequest;
      if (typeof card.name !== "string" || !card.name.trim()) {
        return send(res, 400, { error: "missing 'name'" });
      }
      const url = siteUrl(cardProject(card));
      buildBusinessCard(card)
        .then(() =>
          recordEvent({
            type: "business_card_ready",
            title: `כרטיס הביקור של ${card.name} מוכן`,
            details: { url, memberId: card.memberId },
            source: "content-agent",
          }),
        )
        .catch((err) =>
          recordEvent({
            type: "agent_error",
            title: `יצירת כרטיס הביקור של ${card.name} נכשלה`,
            details: { error: (err as Error).message, memberId: card.memberId },
            source: "content-agent",
          }),
        )
        .catch((err) => console.error("Recording business-card result failed:", err));
      return send(res, 202, { status: "building", url });
    }

    if (req.method === "POST" && req.url === "/digest") {
      return send(res, 200, { summary: await sendDailyDigest() });
    }

    send(res, 404, { error: "not found" });
  } catch (err) {
    console.error(err);
    send(res, 500, { error: (err as Error).message });
  }
});

cron.schedule(config.server.digestCron, () => {
  sendDailyDigest().catch((err) => console.error("Daily digest failed:", err));
});

server.listen(config.server.port, () => {
  console.log(`content-agent listening on :${config.server.port}, digest cron "${config.server.digestCron}"`);
});
