import { describe, test, expect } from 'bun:test';
import type { Database } from 'bun:sqlite';
import { getEventByTxid, listBatches, listBatchTxs, openDatabase } from '../src/store/db';
import { seedDatabase } from '../src/store/seed';
import {
  getAiFeedback,
  listEvents,
  listLeaderboard,
  listTrendingLabels,
} from '../src/store/apiQueries';
import { getIdentity, isoFromNow } from '../src/store/authQueries';
import {
  countAiFeedbackByVoter,
  getVoteTalliesForAuthor,
  listLabelsByAuthor,
} from '../src/store/analystQueries';
import { assembleBatchDetail } from '../src/store/batchApiQueries';
import { serializeEventSummary } from '../src/api/routes';
import demoFixtureJson from '../fixtures/seed-demo.json';

interface DemoFixtureShape {
  analysts: { did: string; handle: string }[];
  events: { txid: string; rules: string[] }[];
  labels: { address: string; tag: string; author: string }[];
  coinjoinBatch: { id: string; txs: { txid: string }[] };
}

const fixture = demoFixtureJson as unknown as DemoFixtureShape;
const [sleuth, forensics, max] = fixture.analysts;

function seededDb(): Database {
  const db = openDatabase(':memory:');
  seedDatabase(db, { demoData: true });
  return db;
}

function tableCounts(db: Database): Record<string, number> {
  const tables = ['events', 'identities', 'labels', 'votes', 'ai_feedback', 'batches', 'batch_txs'];
  const counts: Record<string, number> = {};
  for (const table of tables) {
    counts[table] = (db.query(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  }
  return counts;
}

describe('demo seed: events', () => {
  test('seeded events are confirmed with block info, AI results, and meta', () => {
    const db = seededDb();
    const rows = listEvents(db, { limit: 50 });
    expect(rows).toHaveLength(fixture.events.length);
    expect(new Set(rows.map((r) => r.txid))).toEqual(new Set(fixture.events.map((e) => e.txid)));
    for (const row of rows) {
      expect(row.status).toBe('confirmed');
      expect(row.block_height).toBeGreaterThan(0);
      expect(row.block_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(row.block_time).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(row.ai_status).toBe('done');
      expect(row.ai_summary!.length).toBeGreaterThan(0);
      expect(row.ai_tag!.length).toBeGreaterThan(0);
    }
  });

  test('coinjoin events carry wasabi meta and whale events match seed labels', () => {
    const db = seededDb();
    const rows = listEvents(db, { limit: 50 });
    const summaries = rows.map((row) => serializeEventSummary(db, row));

    const coinjoins = summaries.filter((s) => s.rules.includes('coinjoin'));
    expect(coinjoins).toHaveLength(3);
    for (const cj of coinjoins) {
      expect(cj.meta?.coinjoin?.kind).toBe('wasabi');
      expect(cj.meta?.coinjoin?.equalOutputCount).toBeGreaterThanOrEqual(10);
      expect(cj.meta?.coinjoin?.denominationSats).toBeGreaterThan(0);
      expect(cj.meta?.coinjoin?.participantCount).toBeGreaterThan(0);
    }

    const whale = summaries.find((s) => s.txid === fixture.events[0].txid)!;
    expect(whale.rules).toEqual(['whale']);
    expect(whale.valueSats).toBeGreaterThanOrEqual(10 * 1e8);
    expect(whale.matchedLabels.map((l) => l.tag)).toContain('okx reserves wallets');

    const dormant = summaries.find((s) => s.rules.includes('dormant-wake'))!;
    expect(dormant.rules).toContain('whale');
    expect(dormant.blockTime!.startsWith('2010-')).toBe(true);
  });

  test('ai_feedback tallies are non-zero on seeded events', () => {
    const db = seededDb();
    const whale = getEventByTxid(db, fixture.events[0].txid)!;
    expect(getAiFeedback(db, whale.id, null)).toEqual({ confirms: 2, refutes: 1, mine: null });
    const dormant = getEventByTxid(db, fixture.events[3].txid)!;
    expect(getAiFeedback(db, dormant.id, null)).toEqual({ confirms: 2, refutes: 0, mine: null });
  });
});

describe('demo seed: analysts, votes, trending', () => {
  test('leaderboard is non-empty with reputation matching received votes', () => {
    const db = seededDb();
    const board = listLeaderboard(db);
    expect(board).toHaveLength(3);
    expect(board.map((b) => b.handle)).toEqual([
      'satoshi-sleuth',
      'chain-forensics',
      'mempool-max',
    ]);
    expect(board.map((b) => b.reputation)).toEqual([4, 3, 2]);
    expect(board.map((b) => b.net_votes)).toEqual([4, 3, 2]);
    expect(board.map((b) => b.label_count)).toEqual([2, 2, 2]);
  });

  test('trending labels are non-empty within the last 24h', () => {
    const db = seededDb();
    const trending = listTrendingLabels(db, isoFromNow(-24 * 60 * 60 * 1000), null);
    expect(trending.length).toBe(fixture.labels.length);
    expect(trending.every((l) => l.source === 'crowd')).toBe(true);
    expect(trending[0].score).toBeGreaterThanOrEqual(trending[trending.length - 1].score);
  });

  test('analyst profile aggregates labels, votes, and ai feedback', () => {
    const db = seededDb();
    const identity = getIdentity(db, sleuth.did)!;
    expect(identity.handle).toBe('satoshi-sleuth');
    expect(identity.reputation).toBe(4);

    const authored = listLabelsByAuthor(db, sleuth.did);
    expect(authored.map((l) => l.tag).sort()).toEqual(['pizza-seller', 'wasabi-coordinator']);
    expect(getVoteTalliesForAuthor(db, sleuth.did)).toEqual({ up: 4, down: 0 });
    expect(countAiFeedbackByVoter(db, sleuth.did)).toBe(2);

    expect(getVoteTalliesForAuthor(db, forensics.did)).toEqual({ up: 3, down: 0 });
    expect(getVoteTalliesForAuthor(db, max.did)).toEqual({ up: 3, down: 1 });
  });
});

describe('demo seed: batches', () => {
  test('curated batches and the coinjoin-round batch are present and linked', () => {
    const db = seededDb();
    const batches = listBatches(db);
    expect(batches).toHaveLength(3);
    expect(batches.filter((b) => b.kind === 'curated')).toHaveLength(2);

    const round = batches.find((b) => b.kind === 'coinjoin-round')!;
    expect(round.title).toBe('Coinjoin round (wasabi)');
    const roundTxs = listBatchTxs(db, round.id);
    expect(roundTxs.map((t) => t.txid).sort()).toEqual(
      fixture.coinjoinBatch.txs.map((t) => t.txid).sort(),
    );

    const detail = assembleBatchDetail(db, round);
    expect(detail.txCount).toBe(3);
    expect(detail.latestBlockTime).not.toBeNull();
    expect(detail.totalValueSats).toBeGreaterThan(0);
    for (const tx of detail.txs) {
      expect(tx.eventId).not.toBeNull();
      expect(tx.tx.block_height).toBeGreaterThan(0);
    }
    expect(detail.topLabels.map((l) => l.tag)).toContain('wasabi-coordinator');
  });
});

describe('demo seed: idempotency', () => {
  test('double-seed is a no-op', () => {
    const db = seededDb();
    const before = tableCounts(db);
    const reputationBefore = listLeaderboard(db).map((b) => b.reputation);

    seedDatabase(db, { demoData: true });

    expect(tableCounts(db)).toEqual(before);
    expect(listLeaderboard(db).map((b) => b.reputation)).toEqual(reputationBefore);
    const whale = getEventByTxid(db, fixture.events[0].txid)!;
    expect(getAiFeedback(db, whale.id, null)).toEqual({ confirms: 2, refutes: 1, mine: null });
  });
});
