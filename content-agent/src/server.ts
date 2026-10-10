import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import cron from "node-cron";
import { config, required } from "./config.js";
import { recordEvent } from "./events.js";
import { runAgent } from "./agent.js";
import { sendDailyDigest } from "./digest.js";

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

function send(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") return send(res, 200, { ok: true });
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
