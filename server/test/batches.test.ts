import { describe, test, expect } from 'bun:test';
import { Hono } from 'hono';
import type { Database } from 'bun:sqlite';
import type { BatchDetail, BatchesResponse, Label } from '@chainwatch/shared';
import {
  addBatchTx,
  getEventByTxid,
  insertBatch,
  insertEvent,
  insertLabel,
  listBatchTxs,
  listBatches,
  openDatabase,
} from '../src/store/db';
import { importSeedBatches, type SeedBatchEntry } from '../src/store/seed';
import { createBatchRoutes } from '../src/api/batches';
import curatedFixture from '../fixtures/seed-batches.json';

const DETECTED_TXID = 'd'.repeat(64);
const UNDETECTED_TXID = 'e'.repeat(64);
const LABELED_ADDR = 'bc1qbatchlabeledaddress00000000000000000';

function makeHarness(): { db: Database; app: Hono; batchId: string } {
  const db = openDatabase(':memory:');
  const batch = insertBatch(db, {
    kind: 'curated',
    title: 'Demo curated batch',
    description: 'assembled at build time',
    source: 'seed',
  })!;
  addBatchTx(db, {
    batchId: batch.id,
    txid: DETECTED_TXID,
    blockHeight: 800000,
    blockHash: 'f'.repeat(64),
    blockTime: '2026-08-01T10:00:00.000Z',
    valueSats: 1_500_000_000,
    linkReason: 'round',
  });
  addBatchTx(db, {
    batchId: batch.id,
    txid: UNDETECTED_TXID,
    blockHeight: 800001,
    blockHash: '0'.repeat(64),
    blockTime: '2026-08-01T11:00:00.000Z',
    valueSats: 500_000_000,
    linkReason: 'round chain: spends output of ' + DETECTED_TXID,
  });
  insertEvent(db, {
    txid: DETECTED_TXID,
    rules: ['coinjoin'],
    valueSats: 1_500_000_000,
    inputs: [{ address: LABELED_ADDR, valueSats: 1_600_000_000 }],
    outputs: [{ address: null, valueSats: 1_500_000_000 }],
  });
  insertLabel(db, {
    address: LABELED_ADDR,
    tag: 'mix-coordinator',
    note: 'seen coordinating rounds',
    authorDid: null,
    source: 'seed',
  });
  const app = new Hono();
  app.route('/', createBatchRoutes(db));
  return { db, app, batchId: batch.id };
}

describe('GET /api/batches', () => {
  test('list conforms to BatchesResponse with assembled summaries', async () => {
    const { app, batchId } = makeHarness();
    const res = await app.request('/api/batches');
    expect(res.status).toBe(200);
    const body = (await res.json()) as BatchesResponse;
    expect(body.batches).toHaveLength(1);
    const summary = body.batches[0];
    expect(summary.id).toBe(batchId);
    expect(summary.kind).toBe('curated');
    expect(summary.title).toBe('Demo curated batch');
    expect(summary.description).toBe('assembled at build time');
    expect(summary.txCount).toBe(2);
    expect(summary.totalValueSats).toBe(2_000_000_000);
    expect(summary.latestBlockTime).toBe('2026-08-01T11:00:00.000Z');
    expect(summary.topLabels).toHaveLength(1);
    const label: Label = summary.topLabels[0];
    expect(label.address).toBe(LABELED_ADDR);
    expect(label.tag).toBe('mix-coordinator');
    expect(label.source).toBe('seed');
    expect(typeof label.score).toBe('number');
    expect(typeof label.createdAt).toBe('string');
  });

  test('batch without labeled addresses renders empty topLabels', async () => {
    const db = openDatabase(':memory:');
    const batch = insertBatch(db, {
      kind: 'coinjoin-round',
      title: 'Coinjoin round (generic)',
      source: 'auto',
    })!;
    addBatchTx(db, { batchId: batch.id, txid: '0'.repeat(64), valueSats: 42, linkReason: 'round' });
    const app = new Hono();
    app.route('/', createBatchRoutes(db));
    const res = await app.request('/api/batches');
    const body = (await res.json()) as BatchesResponse;
    expect(body.batches[0].topLabels).toEqual([]);
    expect(body.batches[0].latestBlockTime).toBeNull();
    expect(body.batches[0].description).toBeNull();
  });
});

describe('GET /api/batches/:id', () => {
  test('detail conforms to BatchDetail with labels and eventId for detected txs', async () => {
    const { db, app, batchId } = makeHarness();
    const res = await app.request(`/api/batches/${batchId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as BatchDetail;
    expect(body.id).toBe(batchId);
    expect(body.txCount).toBe(2);
    expect(body.txs).toHaveLength(2);

    const event = getEventByTxid(db, DETECTED_TXID)!;
    const detected = body.txs.find((tx) => tx.txid === DETECTED_TXID)!;
    expect(detected.blockHeight).toBe(800000);
    expect(detected.blockHash).toBe('f'.repeat(64));
    expect(detected.blockTime).toBe('2026-08-01T10:00:00.000Z');
    expect(detected.valueSats).toBe(1_500_000_000);
    expect(detected.linkReason).toBe('round');
    expect(detected.eventId).toBe(event.id);
    expect(detected.labels.map((l) => l.tag)).toEqual(['mix-coordinator']);

    const undetected = body.txs.find((tx) => tx.txid === UNDETECTED_TXID)!;
    expect(undetected.eventId).toBeNull();
    expect(undetected.labels).toEqual([]);
  });

  test('unknown batch id → 404', async () => {
    const { app } = makeHarness();
    const res = await app.request('/api/batches/no-such-batch');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(typeof body.error).toBe('string');
  });
});

describe('curated batch fixture', () => {
  test('imports idempotently with block info and link reasons', () => {
    const db = openDatabase(':memory:');
    const fixture = curatedFixture as unknown as SeedBatchEntry[];
    importSeedBatches(db, fixture);
    importSeedBatches(db, fixture);

    const batches = listBatches(db);
    expect(batches).toHaveLength(fixture.length);
    expect(batches.every((b) => b.kind === 'curated' && b.source === 'seed')).toBe(true);
    for (const entry of fixture) {
      const txs = listBatchTxs(db, entry.id!);
      expect(txs).toHaveLength(entry.txs.length);
      for (const tx of txs) {
        expect(tx.block_height).toBeGreaterThan(0);
        expect(tx.block_hash).toMatch(/^[0-9a-f]{64}$/);
        expect(tx.block_time).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        expect(tx.value_sats).toBeGreaterThan(0);
        expect(tx.link_reason.length).toBeGreaterThan(0);
      }
    }
  });
});
