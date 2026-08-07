import { Database } from 'bun:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadConfig } from '../config';
import type { Rule, EventStatus, AiStatus } from '@chainwatch/shared';

export interface EventInput {
  txid: string;
  rules: Rule[];
  valueSats: number;
  inputs: { address: string | null; valueSats: number }[];
  outputs: { address: string | null; valueSats: number }[];
  source?: 'live' | 'demo';
  detectedAt?: string;
}

export interface EventRow {
  id: string;
  txid: string;
  detected_at: string;
  rules: string;
  value_sats: number;
  inputs: string;
  outputs: string;
  ai_status: AiStatus;
  ai_summary: string | null;
  ai_tag: string | null;
  source: 'live' | 'demo';
  status: EventStatus;
}

export interface LabelInput {
  address: string;
  tag: string;
  note?: string | null;
  evidenceUrl?: string | null;
  authorDid?: string | null;
  source: 'crowd' | 'seed';
}

export interface LabelRow {
  id: string;
  address: string;
  tag: string;
  note: string | null;
  evidence_url: string | null;
  author_did: string | null;
  source: 'crowd' | 'seed';
  created_at: string;
}

const SCHEMA_PATH = new URL('./schema.sql', import.meta.url);

export function openDatabase(path?: string): Database {
  const dbPath = path ?? loadConfig().dbFile;
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const db = new Database(dbPath, { create: true });
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(readFileSync(SCHEMA_PATH, 'utf8'));
  return db;
}

export function insertEvent(db: Database, event: EventInput): EventRow | null {
  const id = crypto.randomUUID();
  const detectedAt = event.detectedAt ?? new Date().toISOString();
  db.query(
    `INSERT OR IGNORE INTO events
       (id, txid, detected_at, rules, value_sats, inputs, outputs, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    event.txid,
    detectedAt,
    JSON.stringify(event.rules),
    event.valueSats,
    JSON.stringify(event.inputs),
    JSON.stringify(event.outputs),
    event.source ?? 'live',
  );
  return getEventByTxid(db, event.txid);
}

export function getEventByTxid(db: Database, txid: string): EventRow | null {
  return db.query('SELECT * FROM events WHERE txid = ?').get(txid) as EventRow | null;
}

export function getEventById(db: Database, id: string): EventRow | null {
  return db.query('SELECT * FROM events WHERE id = ?').get(id) as EventRow | null;
}

export function insertLabel(db: Database, label: LabelInput): LabelRow | null {
  const id = crypto.randomUUID();
  db.query(
    `INSERT OR IGNORE INTO labels
       (id, address, tag, note, evidence_url, author_did, source)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    label.address,
    label.tag,
    label.note ?? null,
    label.evidenceUrl ?? null,
    label.authorDid ?? null,
    label.source,
  );
  return db
    .query('SELECT * FROM labels WHERE address = ? AND tag = ? AND source = ?')
    .get(label.address, label.tag, label.source) as LabelRow | null;
}

export function getLabelsForAddress(db: Database, address: string): LabelRow[] {
  return db
    .query('SELECT * FROM labels WHERE address = ? ORDER BY tag')
    .all(address) as LabelRow[];
}

export function getLabelsForAddresses(db: Database, addresses: string[]): LabelRow[] {
  if (addresses.length === 0) return [];
  const placeholders = addresses.map(() => '?').join(', ');
  return db
    .query(`SELECT * FROM labels WHERE address IN (${placeholders}) ORDER BY address, tag`)
    .all(...addresses) as LabelRow[];
}

export function getLabelById(db: Database, id: string): LabelRow | null {
  return db.query('SELECT * FROM labels WHERE id = ?').get(id) as LabelRow | null;
}

export function upsertVote(
  db: Database,
  labelId: string,
  voterDid: string,
  value: 1 | -1,
): -1 | 0 | 1 {
  const existing = db
    .query('SELECT value FROM votes WHERE label_id = ? AND voter_did = ?')
    .get(labelId, voterDid) as { value: 1 | -1 } | null;
  if (existing && existing.value === value) {
    db.query('DELETE FROM votes WHERE label_id = ? AND voter_did = ?').run(labelId, voterDid);
    return 0;
  }
  db.query(
    `INSERT INTO votes (label_id, voter_did, value) VALUES (?, ?, ?)
     ON CONFLICT (label_id, voter_did) DO UPDATE SET value = excluded.value`,
  ).run(labelId, voterDid, value);
  return value;
}

export function getLabelScore(db: Database, labelId: string): number {
  const row = db
    .query('SELECT COALESCE(SUM(value), 0) AS score FROM votes WHERE label_id = ?')
    .get(labelId) as { score: number };
  return row.score;
}
