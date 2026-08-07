import { describe, test, expect } from 'bun:test';
import { openDatabase, insertEvent, getEventByTxid, getLabelsForAddress, insertLabel } from '../src/store/db';
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
