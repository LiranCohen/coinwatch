import { describe, test, expect } from 'bun:test';
import {
  openDatabase,
  insertEvent,
  getEventByTxid,
  getLabelsForAddress,
  insertLabel,
  insertBatch,
  addBatchTx,
  getBatchById,
  listBatchTxs,
  findBatchByTxid,
  listBatches,
  parseEventMeta,
} from '../src/store/db';
import { applyLabelVote, getLabelsForAddressScored } from '../src/store/apiQueries';
import { importSeedEntries, seedDatabase, isBitcoinAddress } from '../src/store/seed';
import fixture from '../fixtures/seed-labels.json';

const SAMPLE_EVENT = {
  txid: 'a'.repeat(64),
  rules: ['whale' as const],
  valueSats: 1_500_000_000,
  inputs: [{ address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', valueSats: 1_600_000_000 }],
  outputs: [{ address: '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2', valueSats: 1_500_000_000 }],
};

describe('schema', () => {
  test('fresh DB creates all tables', () => {
    const db = openDatabase(':memory:');
    const tables = (
      db.query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as {
        name: string;
      }[]
    ).map((r) => r.name);
    expect(tables).toEqual([
      'ai_feedback',
      'batch_txs',
      'batches',
      'challenges',
      'did_documents',
      'events',
      'identities',
      'labels',
      'sessions',
      'votes',
    ]);
  });
});

describe('events', () => {
  test('insertEvent persists and dedupes on txid', () => {
    const db = openDatabase(':memory:');
    const first = insertEvent(db, SAMPLE_EVENT);
    expect(first.inserted).toBe(true);
    expect(first.row).not.toBeNull();
    expect(first.row!.txid).toBe(SAMPLE_EVENT.txid);
    expect(JSON.parse(first.row!.rules)).toEqual(['whale']);
    expect(JSON.parse(first.row!.inputs)[0].address).toBe('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa');

    const countBefore = (db.query('SELECT COUNT(*) AS n FROM events').get() as { n: number }).n;
    const second = insertEvent(db, { ...SAMPLE_EVENT, valueSats: 1 });
    const countAfter = (db.query('SELECT COUNT(*) AS n FROM events').get() as { n: number }).n;
    expect(countAfter).toBe(countBefore);
    expect(second.inserted).toBe(false);
    expect(second.row!.id).toBe(first.row!.id);
    expect(getEventByTxid(db, SAMPLE_EVENT.txid)!.value_sats).toBe(1_500_000_000);
  });

  test('new events have null block info and null meta', () => {
    const db = openDatabase(':memory:');
    const { row } = insertEvent(db, SAMPLE_EVENT);
    expect(row!.block_height).toBeNull();
    expect(row!.block_hash).toBeNull();
    expect(row!.block_time).toBeNull();
    expect(row!.meta).toBeNull();
    expect(parseEventMeta(row!)).toBeNull();
  });

  test('parseEventMeta parses stored JSON and tolerates invalid JSON', () => {
    const db = openDatabase(':memory:');
    const { row } = insertEvent(db, SAMPLE_EVENT);
    db.query('UPDATE events SET meta = ? WHERE id = ?').run(
      JSON.stringify({
        coinjoin: {
          kind: 'whirlpool',
          denominationSats: 10_000_000,
          equalOutputCount: 5,
          participantCount: 5,
        },
      }),
      row!.id,
    );
    const meta = parseEventMeta(getEventByTxid(db, SAMPLE_EVENT.txid)!);
    expect(meta?.coinjoin?.kind).toBe('whirlpool');
    expect(meta?.coinjoin?.equalOutputCount).toBe(5);

    db.query('UPDATE events SET meta = ? WHERE id = ?').run('not json', row!.id);
    expect(parseEventMeta(getEventByTxid(db, SAMPLE_EVENT.txid)!)).toBeNull();
  });
});

describe('batches', () => {
  const TX_A = 'b'.repeat(64);
  const TX_B = 'c'.repeat(64);

  test('insertBatch + addBatchTx round-trip with block info', () => {
    const db = openDatabase(':memory:');
    const batch = insertBatch(db, {
      kind: 'coinjoin-round',
      title: 'Round chain',
      description: 'linked rounds',
      source: 'auto',
    })!;
    expect(batch.id).toBeTruthy();
    expect(getBatchById(db, batch.id)!.title).toBe('Round chain');

    addBatchTx(db, {
      batchId: batch.id,
      txid: TX_A,
      blockHeight: 800_001,
      blockHash: 'd'.repeat(64),
      blockTime: '2026-08-01T00:00:00.000Z',
      valueSats: 500_000_000,
      linkReason: 'first round',
    });
    addBatchTx(db, { batchId: batch.id, txid: TX_B, valueSats: 500_000_000, linkReason: 'spends output of round 1' });

    const txs = listBatchTxs(db, batch.id);
    expect(txs).toHaveLength(2);
    const byTxid = new Map(txs.map((t) => [t.txid, t]));
    expect(byTxid.get(TX_A)!.block_height).toBe(800_001);
    expect(byTxid.get(TX_A)!.link_reason).toBe('first round');
    expect(byTxid.get(TX_B)!.block_height).toBeNull();
    expect(byTxid.get(TX_B)!.value_sats).toBe(500_000_000);
  });

  test('addBatchTx dedupes on UNIQUE(batch_id, txid)', () => {
    const db = openDatabase(':memory:');
    const batch = insertBatch(db, { kind: 'curated', title: 'Curated', source: 'seed' })!;
    addBatchTx(db, { batchId: batch.id, txid: TX_A, valueSats: 1, linkReason: 'first' });
    const dupe = addBatchTx(db, { batchId: batch.id, txid: TX_A, valueSats: 2, linkReason: 'second' });
    expect(listBatchTxs(db, batch.id)).toHaveLength(1);
    expect(dupe!.value_sats).toBe(1);
    expect(dupe!.link_reason).toBe('first');
  });

  test('insertBatch with explicit id is idempotent; findBatchByTxid and listBatches work', () => {
    const db = openDatabase(':memory:');
    const first = insertBatch(db, { id: 'batch-1', kind: 'curated', title: 'One', source: 'seed' })!;
    const second = insertBatch(db, { id: 'batch-1', kind: 'curated', title: 'Dupe', source: 'seed' })!;
    expect(second.id).toBe(first.id);
    expect(second.title).toBe('One');
    expect(listBatches(db)).toHaveLength(1);

    insertBatch(db, { id: 'batch-2', kind: 'coinjoin-round', title: 'Two', source: 'auto' });
    addBatchTx(db, { batchId: 'batch-2', txid: TX_A, valueSats: 10, linkReason: 'round' });
    expect(findBatchByTxid(db, TX_A)!.id).toBe('batch-2');
    expect(findBatchByTxid(db, TX_B)).toBeNull();
    expect(listBatches(db)).toHaveLength(2);
  });
});

describe('labels and votes', () => {
  test('insertLabel + getLabelsForAddress; applyLabelVote toggle/flip semantics', () => {
    const db = openDatabase(':memory:');
    db.query('INSERT INTO identities (did) VALUES (?)').run('did:jwk:alice');
    const label = insertLabel(db, {
      address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
      tag: 'Genesis',
      source: 'crowd',
      authorDid: 'did:jwk:alice',
    })!;
    expect(getLabelsForAddress(db, '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa')).toHaveLength(1);

    // duplicate (address, tag, source) ignored
    insertLabel(db, { address: label.address, tag: 'Genesis', source: 'crowd' });
    expect(getLabelsForAddress(db, label.address)).toHaveLength(1);

    const score = () =>
      getLabelsForAddressScored(db, label.address, null).find((l) => l.id === label.id)!.score;

    expect(applyLabelVote(db, label.id, 'did:jwk:bob', 1)).toBe(1);
    expect(score()).toBe(1);
    // same value again removes the vote
    expect(applyLabelVote(db, label.id, 'did:jwk:bob', 1)).toBe(0);
    expect(score()).toBe(0);
    // opposite value flips
    expect(applyLabelVote(db, label.id, 'did:jwk:bob', 1)).toBe(1);
    expect(applyLabelVote(db, label.id, 'did:jwk:bob', -1)).toBe(-1);
    expect(score()).toBe(-1);
  });
});

describe('seed import', () => {
  test('fresh DB imports fixture seed rows with evidence URLs preserved', () => {
    const db = openDatabase(':memory:');
    const result = seedDatabase(db);
    expect(result.imported).toBe(fixture.length);
    expect(result.skipped).toBe(0);

    const binance = getLabelsForAddress(db, '16ftSEQ4ctQFDtVZiUBusQUjRrGhM3JYwe');
    expect(binance.length).toBeGreaterThan(0);
    expect(binance[0].tag).toBe('Binance.com');
    expect(binance[0].source).toBe('seed');
    expect(binance[0].author_did).toBeNull();
    expect(binance[0].evidence_url).toMatch(/^https?:\/\//);

    const row = db
      .query("SELECT evidence_url FROM labels WHERE source = 'seed' AND evidence_url IS NULL")
      .all();
    expect(row).toHaveLength(0);
  });

  test('double import produces no duplicates', () => {
    const db = openDatabase(':memory:');
    seedDatabase(db);
    const second = seedDatabase(db);
    const count = (db.query("SELECT COUNT(*) AS n FROM labels WHERE source = 'seed'").get() as { n: number }).n;
    expect(count).toBe(fixture.length);
    expect(second.imported).toBe(fixture.length);
  });

  test('malformed entries are skipped with a warning and import continues', () => {
    const db = openDatabase(':memory:');
    const warnings: string[] = [];
    const result = importSeedEntries(
      db,
      [
        { address: 'not-an-address', tag: 'Bad', evidenceUrl: 'https://x.example' },
        { address: 'bc1qMixedCaseBad', tag: 'BadCase', evidenceUrl: null },
        { address: '1JvXhnHCi6XqcanvrZJ5s2Qiv4tsmm2UMy', tag: 'Binance Pool', evidenceUrl: 'https://example.com/evidence' },
      ],
      (m) => warnings.push(m),
    );
    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(2);
    expect(warnings).toHaveLength(2);
    const rows = getLabelsForAddress(db, '1JvXhnHCi6XqcanvrZJ5s2Qiv4tsmm2UMy');
    expect(rows).toHaveLength(1);
    expect(rows[0].evidence_url).toBe('https://example.com/evidence');
  });

  test('fixture contains only plausible bitcoin addresses', () => {
    for (const entry of fixture) {
      expect(isBitcoinAddress(entry.address)).toBe(true);
    }
  });
});
