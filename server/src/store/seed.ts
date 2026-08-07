import type { Database } from 'bun:sqlite';
import type { BatchKind, EventMeta, Rule } from '@chainwatch/shared';
import {
  findLabelByUnique,
  getEventByTxid,
  insertBatch,
  insertEvent,
  insertLabel,
  addBatchTx,
} from './db';
import { upsertIdentity } from './authQueries';
import { applyLabelVote, toggleAiFeedback } from './apiQueries';
import defaultSeedEntries from '../../fixtures/seed-labels.json';
import defaultSeedBatchesJson from '../../fixtures/seed-batches.json';
import defaultDemoFixtureJson from '../../fixtures/seed-demo.json';

export interface SeedEntry {
  address: string;
  tag: string;
  evidenceUrl: string | null;
}

export interface SeedResult {
  imported: number;
  skipped: number;
}

const BASE58_RE = /^[13][1-9A-HJ-NP-Za-km-z]{25,34}$/;
const BECH32_RE = /^bc1[02-9ac-hj-np-z]{11,87}$/i;

export function isBitcoinAddress(address: unknown): address is string {
  if (typeof address !== 'string') return false;
  if (BASE58_RE.test(address)) return true;
  if (BECH32_RE.test(address) && (address === address.toLowerCase() || address === address.toUpperCase())) {
    return true;
  }
  return false;
}

function isValidEntry(entry: unknown): entry is SeedEntry {
  if (typeof entry !== 'object' || entry === null) return false;
  const e = entry as Record<string, unknown>;
  return (
    isBitcoinAddress(e.address) &&
    typeof e.tag === 'string' &&
    e.tag.length > 0 &&
    (e.evidenceUrl === null || typeof e.evidenceUrl === 'string')
  );
}

export function importSeedEntries(
  db: Database,
  entries: unknown[],
  warn: (message: string) => void = console.warn,
): SeedResult {
  let imported = 0;
  let skipped = 0;
  const importAll = db.transaction((items: unknown[]): void => {
    for (const entry of items) {
      if (!isValidEntry(entry)) {
        skipped += 1;
        warn(`seed: skipping malformed entry ${JSON.stringify(entry)}`);
        continue;
      }
      insertLabel(db, {
        address: entry.address,
        tag: entry.tag,
        evidenceUrl: entry.evidenceUrl,
        authorDid: null,
        source: 'seed',
      });
      imported += 1;
    }
  });
  importAll(entries);
  return { imported, skipped };
}

export interface SeedBatchTxEntry {
  txid: string;
  blockHeight?: number | null;
  blockHash?: string | null;
  blockTime?: string | null;
  valueSats: number;
  linkReason: string;
}

export interface SeedBatchEntry {
  id?: string;
  kind: BatchKind;
  title: string;
  description?: string | null;
  source: string;
  txs: SeedBatchTxEntry[];
}

export function importSeedBatches(db: Database, batches: SeedBatchEntry[]): void {
  const importAll = db.transaction((items: SeedBatchEntry[]): void => {
    for (const entry of items) {
      const batch = insertBatch(db, {
        id: entry.id,
        kind: entry.kind,
        title: entry.title,
        description: entry.description ?? null,
        source: entry.source,
      });
      if (batch === null) continue;
      for (const tx of entry.txs) {
        addBatchTx(db, {
          batchId: batch.id,
          txid: tx.txid,
          blockHeight: tx.blockHeight ?? null,
          blockHash: tx.blockHash ?? null,
          blockTime: tx.blockTime ?? null,
          valueSats: tx.valueSats,
          linkReason: tx.linkReason,
        });
      }
    }
  });
  importAll(batches);
}

interface DemoAnalyst {
  did: string;
  handle: string;
}

interface DemoEvent {
  txid: string;
  rules: string[];
  valueSats: number;
  detectedAt: string;
  blockHeight: number;
  blockHash: string;
  blockTime: string;
  inputs: { address: string | null; valueSats: number }[];
  outputs: { address: string | null; valueSats: number }[];
  aiSummary: string;
  aiTag: string;
  meta: EventMeta | null;
}

interface DemoLabel {
  address: string;
  tag: string;
  note: string | null;
  evidenceUrl: string | null;
  author: string;
}

interface DemoVote {
  address: string;
  tag: string;
  voter: string;
  value: 1 | -1;
}

interface DemoAiFeedback {
  txid: string;
  voter: string;
  value: 'confirm' | 'refute';
}

interface DemoCoinjoinBatchTx {
  txid: string;
  linkReason: string;
}

interface DemoFixture {
  analysts: DemoAnalyst[];
  events: DemoEvent[];
  labels: DemoLabel[];
  votes: DemoVote[];
  aiFeedback: DemoAiFeedback[];
  coinjoinBatch: Omit<SeedBatchEntry, 'txs'> & { txs: DemoCoinjoinBatchTx[] };
}

const defaultSeedBatches = defaultSeedBatchesJson as unknown as SeedBatchEntry[];
const defaultDemoFixture = defaultDemoFixtureJson as unknown as DemoFixture;

export function seedDemoData(
  db: Database,
  fixture: DemoFixture = defaultDemoFixture,
  batches: SeedBatchEntry[] = defaultSeedBatches,
): void {
  const seedAll = db.transaction((): void => {
    const dids = new Map<string, string>();
    for (const analyst of fixture.analysts) {
      upsertIdentity(db, analyst.did, analyst.handle);
      dids.set(analyst.handle, analyst.did);
    }

    for (const event of fixture.events) {
      const { row, inserted } = insertEvent(db, {
        txid: event.txid,
        rules: event.rules as Rule[],
        valueSats: event.valueSats,
        inputs: event.inputs,
        outputs: event.outputs,
        source: 'live',
        detectedAt: event.detectedAt,
      });
      if (inserted && row !== null) {
        db.query(
          `UPDATE events
           SET status = 'confirmed', block_height = ?, block_hash = ?, block_time = ?,
               ai_status = 'done', ai_summary = ?, ai_tag = ?, meta = ?
           WHERE id = ?`,
        ).run(
          event.blockHeight,
          event.blockHash,
          event.blockTime,
          event.aiSummary,
          event.aiTag,
          event.meta === null ? null : JSON.stringify(event.meta),
          row.id,
        );
      }
    }

    for (const label of fixture.labels) {
      const authorDid = dids.get(label.author);
      if (authorDid === undefined) continue;
      insertLabel(db, {
        address: label.address,
        tag: label.tag,
        note: label.note,
        evidenceUrl: label.evidenceUrl,
        authorDid,
        source: 'crowd',
      });
    }

    for (const vote of fixture.votes) {
      const voterDid = dids.get(vote.voter);
      if (voterDid === undefined) continue;
      const label = findLabelByUnique(db, vote.address, vote.tag, 'crowd');
      if (label === null) continue;
      const existing = db
        .query('SELECT value FROM votes WHERE label_id = ? AND voter_did = ?')
        .get(label.id, voterDid);
      if (existing !== null) continue;
      applyLabelVote(db, label.id, voterDid, vote.value);
    }

    for (const feedback of fixture.aiFeedback) {
      const voterDid = dids.get(feedback.voter);
      if (voterDid === undefined) continue;
      const event = getEventByTxid(db, feedback.txid);
      if (event === null) continue;
      const existing = db
        .query('SELECT value FROM ai_feedback WHERE event_id = ? AND voter_did = ?')
        .get(event.id, voterDid);
      if (existing !== null) continue;
      toggleAiFeedback(db, event.id, voterDid, feedback.value);
    }

    importSeedBatches(db, batches);

    const roundTxs: SeedBatchTxEntry[] = fixture.coinjoinBatch.txs.map((tx) => {
      const event = getEventByTxid(db, tx.txid);
      return {
        txid: tx.txid,
        linkReason: tx.linkReason,
        blockHeight: event?.block_height ?? null,
        blockHash: event?.block_hash ?? null,
        blockTime: event?.block_time ?? null,
        valueSats: event?.value_sats ?? 0,
      };
    });
    importSeedBatches(db, [{ ...fixture.coinjoinBatch, txs: roundTxs }]);
  });
  seedAll();
}

export function seedDatabase(
  db: Database,
  entries: unknown[] = defaultSeedEntries,
  warn?: (message: string) => void,
): SeedResult {
  const result = importSeedEntries(db, entries, warn);
  seedDemoData(db);
  return result;
}
