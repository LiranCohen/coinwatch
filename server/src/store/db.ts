import { Database } from 'bun:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadConfig } from '../config';
import type { Rule, EventStatus, AiStatus, BatchKind, EventMeta } from '@chainwatch/shared';

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
  block_height: number | null;
  block_hash: string | null;
  block_time: string | null;
  meta: string | null;
}

export function parseEventMeta(row: EventRow): EventMeta | null {
  if (row.meta === null) return null;
  try {
    return JSON.parse(row.meta) as EventMeta;
  } catch {
    return null;
  }
}

export interface LabelInput {
  /** the thing being labelled: an address, or a txid when targetKind is 'tx' */
  address: string;
  tag: string;
  note?: string | null;
  evidenceUrl?: string | null;
  authorDid?: string | null;
  source: 'crowd' | 'seed';
  targetKind?: 'address' | 'tx';
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
  migrate(db);
  return db;
}

/**
 * Additive column migrations.
 *
 * The schema file is applied with CREATE TABLE IF NOT EXISTS, which does
 * nothing to a table that already exists, so new columns have to be added
 * explicitly for databases created by an earlier version.
 */
function migrate(db: Database): void {
  const columns = db.query('PRAGMA table_info(labels)').all() as { name: string }[];
  if (!columns.some((column) => column.name === 'target_kind')) {
    // existing rows all describe addresses, which is what the default records
    db.exec("ALTER TABLE labels ADD COLUMN target_kind TEXT NOT NULL DEFAULT 'address'");
  }
  // indexed here rather than in the schema file, which runs before the column exists
  db.exec('CREATE INDEX IF NOT EXISTS labels_target_kind ON labels (target_kind, address)');
}

export function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}

export interface InsertEventResult {
  row: EventRow | null;
  inserted: boolean;
}

export function insertEvent(db: Database, event: EventInput): InsertEventResult {
  const id = crypto.randomUUID();
  const detectedAt = event.detectedAt ?? new Date().toISOString();
  const result = db.query(
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
  return { row: getEventByTxid(db, event.txid), inserted: result.changes > 0 };
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
       (id, address, tag, note, evidence_url, author_did, source, target_kind)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    label.address,
    label.tag,
    label.note ?? null,
    label.evidenceUrl ?? null,
    label.authorDid ?? null,
    label.source,
    label.targetKind ?? 'address',
  );
  return findLabelByUnique(db, label.address, label.tag, label.source);
}

/** Labels attached to a transaction rather than an address. */
export function getLabelsForTx(db: Database, txid: string): LabelRow[] {
  return db
    .query("SELECT * FROM labels WHERE target_kind = 'tx' AND address = ? ORDER BY created_at DESC")
    .all(txid) as LabelRow[];
}

export function findLabelByUnique(
  db: Database,
  address: string,
  tag: string,
  source: 'crowd' | 'seed',
): LabelRow | null {
  return db
    .query('SELECT * FROM labels WHERE address = ? AND tag = ? AND source = ?')
    .get(address, tag, source) as LabelRow | null;
}

export function getLabelsForAddress(db: Database, address: string): LabelRow[] {
  return db
    .query('SELECT * FROM labels WHERE address = ? ORDER BY tag')
    .all(address) as LabelRow[];
}

export function getLabelById(db: Database, id: string): LabelRow | null {
  return db.query('SELECT * FROM labels WHERE id = ?').get(id) as LabelRow | null;
}

export interface BatchInput {
  id?: string;
  kind: BatchKind;
  title: string;
  description?: string | null;
  source: string;
}

export interface BatchRow {
  id: string;
  kind: BatchKind;
  title: string;
  description: string | null;
  source: string;
  created_at: string;
}

export interface BatchTxInput {
  batchId: string;
  txid: string;
  blockHeight?: number | null;
  blockHash?: string | null;
  blockTime?: string | null;
  valueSats: number;
  linkReason: string;
}

export interface BatchTxRow {
  batch_id: string;
  txid: string;
  block_height: number | null;
  block_hash: string | null;
  block_time: string | null;
  value_sats: number;
  link_reason: string;
}

export function insertBatch(db: Database, batch: BatchInput): BatchRow | null {
  const id = batch.id ?? crypto.randomUUID();
  db.query(
    `INSERT OR IGNORE INTO batches (id, kind, title, description, source)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, batch.kind, batch.title, batch.description ?? null, batch.source);
  return getBatchById(db, id);
}

export function addBatchTx(db: Database, tx: BatchTxInput): BatchTxRow | null {
  db.query(
    `INSERT OR IGNORE INTO batch_txs
       (batch_id, txid, block_height, block_hash, block_time, value_sats, link_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    tx.batchId,
    tx.txid,
    tx.blockHeight ?? null,
    tx.blockHash ?? null,
    tx.blockTime ?? null,
    tx.valueSats,
    tx.linkReason,
  );
  return db
    .query('SELECT * FROM batch_txs WHERE batch_id = ? AND txid = ?')
    .get(tx.batchId, tx.txid) as BatchTxRow | null;
}

export function getBatchById(db: Database, id: string): BatchRow | null {
  return db.query('SELECT * FROM batches WHERE id = ?').get(id) as BatchRow | null;
}

export function listBatchTxs(db: Database, batchId: string): BatchTxRow[] {
  return db
    .query('SELECT * FROM batch_txs WHERE batch_id = ? ORDER BY block_time DESC, txid')
    .all(batchId) as BatchTxRow[];
}

export function findBatchByTxid(db: Database, txid: string): BatchRow | null {
  return db
    .query(
      `SELECT batches.* FROM batches
       JOIN batch_txs ON batch_txs.batch_id = batches.id
       WHERE batch_txs.txid = ?
       ORDER BY batches.created_at DESC
       LIMIT 1`,
    )
    .get(txid) as BatchRow | null;
}

export function listBatches(db: Database): BatchRow[] {
  return db.query('SELECT * FROM batches ORDER BY created_at DESC, id').all() as BatchRow[];
}
