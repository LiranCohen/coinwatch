import { describe, test, expect } from 'bun:test';
import { Hono } from 'hono';
import type { Database } from 'bun:sqlite';
import type { EntityDetail, EntitySummary } from '@chainwatch/shared';
import { openDatabase, insertEvent, insertLabel } from '../src/store/db';
import { importSeedEntries } from '../src/store/seed';
import { createEntityRoutes } from '../src/api/entities';

const ENTITY_ADDR_A = '16RtSf2McLsAewZGy3DWDSLGqZMJS9BVeK';
const ENTITY_ADDR_B = '1FWk3pn6r3dhzU7Xer1ALQQPGaZwG1LLcm';
const OTHER_ADDR = '1LZcEKMCFfg9ARpgw3jG3yZxAV5kPt8mM9';
const TAG = 'DemoExchange';
const OTHER_TAG = 'Solo&Tag';

function makeHarness(): { db: Database; app: Hono } {
  const db = openDatabase(':memory:');
  importSeedEntries(db, [
    { address: ENTITY_ADDR_A, tag: TAG, evidenceUrl: 'https://example.com/a' },
    { address: ENTITY_ADDR_B, tag: TAG, evidenceUrl: null },
    { address: OTHER_ADDR, tag: OTHER_TAG, evidenceUrl: null },
  ]);
  const app = new Hono();
  app.route('/', createEntityRoutes(db));
  return { db, app };
}

describe('GET /api/entities', () => {
  test('groups seed labels by tag with correct counts, sorted by addressCount desc', async () => {
    const { db, app } = makeHarness();
    insertEvent(db, {
      txid: 'b'.repeat(64),
      rules: ['whale'],
      valueSats: 5_000_000_000,
      inputs: [{ address: ENTITY_ADDR_A, valueSats: 5_100_000_000 }],
      outputs: [{ address: ENTITY_ADDR_B, valueSats: 5_000_000_000 }],
    });

    const res = await app.request('/api/entities');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entities: EntitySummary[] };
    expect(body.entities).toHaveLength(2);
    const [first, second] = body.entities;
    expect(first).toEqual({ tag: TAG, addressCount: 2, eventCount: 1 });
    expect(second).toEqual({ tag: OTHER_TAG, addressCount: 1, eventCount: 0 });
  });

  test('crowd labels join their seed-tag entity', async () => {
    const { db, app } = makeHarness();
    insertLabel(db, {
      address: 'bc1qcrowdaddress00000000000000000000000',
      tag: TAG,
      authorDid: null,
      source: 'crowd',
    });
    const res = await app.request('/api/entities');
    const body = (await res.json()) as { entities: EntitySummary[] };
    expect(body.entities[0]).toEqual({ tag: TAG, addressCount: 3, eventCount: 0 });
  });
});

describe('GET /api/entities/:tag', () => {
  test('returns addresses with labels and recent events', async () => {
    const { db, app } = makeHarness();
    insertLabel(db, {
      address: ENTITY_ADDR_A,
      tag: 'hot-wallet',
      note: 'crowd note',
      authorDid: null,
      source: 'crowd',
    });
    insertEvent(db, {
      txid: 'c'.repeat(64),
      rules: ['dormant-wake'],
      valueSats: 900_000_000,
      inputs: [{ address: OTHER_ADDR, valueSats: 950_000_000 }],
      outputs: [{ address: ENTITY_ADDR_B, valueSats: 900_000_000 }],
    });

    const res = await app.request(`/api/entities/${TAG}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as EntityDetail;
    expect(body.tag).toBe(TAG);
    expect(body.addresses.map((a) => a.address)).toEqual([ENTITY_ADDR_A, ENTITY_ADDR_B].sort());
    const addrA = body.addresses.find((a) => a.address === ENTITY_ADDR_A)!;
    expect(addrA.labels.map((l) => l.tag).sort()).toEqual([TAG, 'hot-wallet'].sort());
    expect(addrA.labels[0].source).toBeDefined();
    expect(body.recentEvents).toHaveLength(1);
    expect(body.recentEvents[0].txid).toBe('c'.repeat(64));
    expect(body.recentEvents[0].rules).toEqual(['dormant-wake']);
  });

  test('URL-encoded tag is decoded', async () => {
    const { app } = makeHarness();
    const res = await app.request(`/api/entities/${encodeURIComponent(OTHER_TAG)}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as EntityDetail;
    expect(body.tag).toBe(OTHER_TAG);
    expect(body.addresses.map((a) => a.address)).toEqual([OTHER_ADDR]);
  });

  test('unknown tag → 404', async () => {
    const { app } = makeHarness();
    const res = await app.request('/api/entities/NoSuchEntity');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(typeof body.error).toBe('string');
  });
});
