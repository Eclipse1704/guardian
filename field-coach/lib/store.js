// Tiny JSON-file store. Good enough for an MVP with a handful of teams;
// swap for Postgres/SQLite when there are real customers.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PRESETS } from './presets.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(here, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const SEED_FILE = path.join(here, '..', 'seed', 'seed.json');

let db;

function defaults() {
  const seed = fs.existsSync(SEED_FILE) ? JSON.parse(fs.readFileSync(SEED_FILE, 'utf8')) : {};
  return {
    settings: {
      company: seed.settings?.company || 'הצוות שלי',
      preset: seed.settings?.preset || 'real_estate',
      criteria: seed.settings?.criteria || structuredClone(PRESETS.real_estate.criteria),
      autoWhatsapp: false,
      managerPhone: '',
    },
    reps: seed.reps || [],
    // Seed meetings are stored as "N days ago" so the demo always looks recent.
    meetings: (seed.meetings || []).map(({ daysAgo, ...m }) => {
      const t = new Date();
      t.setDate(t.getDate() - daysAgo);
      t.setHours(10 + (daysAgo % 6), 15, 0, 0);
      return { ...m, createdAt: t.toISOString() };
    }),
  };
}

export function load() {
  if (db) return db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = fs.existsSync(DB_FILE) ? JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) : defaults();
  save();
  return db;
}

export function save() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

export function reset() {
  db = defaults();
  save();
  return db;
}

export const id = () => crypto.randomBytes(6).toString('hex');
