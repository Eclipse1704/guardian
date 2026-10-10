import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";

/** One thing that happened on the platform (sale, signup, new content, error...). */
export interface PlatformEvent {
  type: string;
  title: string;
  details?: Record<string, unknown>;
  source: string;
  timestamp: string;
}

const eventsFile = () => path.join(config.dataDir, "events.jsonl");

export async function recordEvent(
  event: Omit<PlatformEvent, "timestamp"> & { timestamp?: string },
): Promise<PlatformEvent> {
  const full: PlatformEvent = { ...event, timestamp: event.timestamp ?? new Date().toISOString() };
  await fs.mkdir(config.dataDir, { recursive: true });
  await fs.appendFile(eventsFile(), JSON.stringify(full) + "\n", "utf8");
  return full;
}

export async function eventsSince(since: Date): Promise<PlatformEvent[]> {
  let raw: string;
  try {
    raw = await fs.readFile(eventsFile(), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as PlatformEvent)
    .filter((e) => new Date(e.timestamp) >= since);
}
