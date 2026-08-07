import { describe, test, expect } from 'bun:test';
import { EventEmitter } from 'node:events';
import type { Database } from 'bun:sqlite';
import type {
  AddressInfo,
  AiFeedback,
  EventDetail,
  EventSummary,
  EventsListResponse,
  Identity,
  Label,
  LeaderboardResponse,
  ServerMeta,
  TrendingResponse,
} from '@chainwatch/shared';
import { openDatabase, insertEvent, insertLabel, type EventInput, type EventRow } from '../src/store/db';
import { createSession, upsertIdentity } from '../src/store/authQueries';
import { composeApp, startPipelineLoop } from '../src/index';
import type { Pipeline } from '../src/detect/pipeline';
import type { AiProvider } from '../src/ai/provider';
import type { AddressInfoClient } from '../src/external/addressinfo';
import { loadConfig, type Config } from '../src/config';
import type { Hono } from 'hono';
import type { SseHub } from '../src/api/sse';

// GET /api/addresses/:address rejects anything that fails checksum validation,
// so the fixtures have to be addresses that really encode a witness program
const ADDR_IN = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const ADDR_OUT = 'bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3';
/** valid, but never referenced by any event or label in these tests */
const ADDR_UNTRACKED = 'bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297';

const MOCK_AI: AiProvider = {
  name: 'mock',
  summarizeEvent: () =>
    Promise.resolve({ ok: true, summary: 'Mock analysis of the event.', tag: 'whale-move' }),
};

const STATS_ADDRESS_INFO: AddressInfoClient = {
  getAddressTxs: () => Promise.resolve([]),
  getAddressStats: (address) =>
    Promise.resolve({
      address,
      chain_stats: { tx_count: 7, funded_txo_sum: 100_000, spent_txo_sum: 30_000 },
      mempool_stats: { tx_count: 1, funded_txo_sum: 5_000, spent_txo_sum: 0 },
    }),
  getAddressActivity: () => Promise.resolve([]),
};

const FAILING_ADDRESS_INFO: AddressInfoClient = {
  getAddressTxs: () => Promise.resolve(null),
  getAddressStats: () => Promise.resolve(null),
  getAddressActivity: () => Promise.resolve(null),
};

/** stands in for a wedged explorer: the stats call never settles at all */
const HANGING_ADDRESS_INFO: AddressInfoClient = {
  getAddressTxs: () => Promise.resolve(null),
  getAddressStats: () => new Promise(() => {}),
  getAddressActivity: () => Promise.resolve(null),
};

interface Harness {
  db: Database;
  app: Hono;
  hub: SseHub;
  emitter: EventEmitter;
  config: Config;
}

function makeHarness(
  options: {
    injectorEnabled?: boolean;
    remoteAddress?: string;
    addressInfo?: AddressInfoClient;
    ai?: AiProvider;
    config?: Partial<Config>;
    sourceName?: () => string;
  } = {},
): Harness {
  const db = openDatabase(':memory:');
  const emitter = new EventEmitter();
  const config: Config = {
    ...loadConfig({}),
    injectorEnabled: options.injectorEnabled ?? false,
    ...options.config,
  };
  const { app, hub } = composeApp({
    db,
    config,
    emitter,
    ai: options.ai ?? MOCK_AI,
    addressInfo: options.addressInfo ?? STATS_ADDRESS_INFO,
    sourceName: options.sourceName,
    getRemoteAddress:
      options.remoteAddress === undefined ? undefined : () => options.remoteAddress,
    log: () => {},
  });
  return { db, app, hub, emitter, config };
}

function addEvent(db: Database, overrides: Partial<EventInput> = {}): EventRow {
  const { row } = insertEvent(db, {
    txid: (crypto.randomUUID().replaceAll('-', '') + '0'.repeat(64)).slice(0, 64),
    rules: ['whale'],
    valueSats: 1_500_000_000,
    inputs: [{ address: ADDR_IN, valueSats: 1_600_000_000 }],
    outputs: [{ address: ADDR_OUT, valueSats: 1_500_000_000 }],
    ...overrides,
  });
  return row!;
}

function makeSession(db: Database, did: string, handle?: string): string {
  upsertIdentity(db, did, handle);
  const token = crypto.randomUUID();
  createSession(db, did, token);
  return token;
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

function postJson(app: Hono, path: string, body: unknown, token?: string) {
  return app.request(path, {
    method: 'POST',
    headers: token ? authHeaders(token) : { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function expectEventSummaryShape(event: EventSummary): void {
  expect(typeof event.id).toBe('string');
  expect(typeof event.txid).toBe('string');
  expect(typeof event.detectedAt).toBe('string');
  expect(Array.isArray(event.rules)).toBe(true);
  expect(typeof event.valueSats).toBe('number');
  expect(['active', 'confirmed', 'evicted']).toContain(event.status);
  expect(['live', 'demo']).toContain(event.source);
  expect(['pending', 'done', 'failed']).toContain(event.aiStatus);
  expect(event.aiTag === null || typeof event.aiTag === 'string').toBe(true);
  expect(Array.isArray(event.matchedLabels)).toBe(true);
}

function expectLabelShape(label: Label): void {
  expect(typeof label.id).toBe('string');
  expect(typeof label.address).toBe('string');
  expect(typeof label.tag).toBe('string');
  expect(label.note === null || typeof label.note === 'string').toBe(true);
  expect(label.evidenceUrl === null || typeof label.evidenceUrl === 'string').toBe(true);
  expect(label.source === 'crowd' || label.source === 'seed').toBe(true);
  expect(typeof label.score).toBe('number');
  expect([-1, 0, 1]).toContain(label.myVote);
  expect(typeof label.createdAt).toBe('string');
  if (label.author !== null) {
    expect(typeof label.author.did).toBe('string');
    expect(label.author.handle === null || typeof label.author.handle === 'string').toBe(true);
  }
}

async function waitFor(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('waitFor: timed out');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function readSseUntil(
  body: ReadableStream<Uint8Array>,
  needles: string[],
  timeoutMs = 3000,
): Promise<string> {
  const missing = [...needles];
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let accumulated = '';
  const deadline = Date.now() + timeoutMs;
  try {
    while (missing.length > 0) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      const chunk = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('sse read timeout')), remaining),
        ),
      ]);
      if (chunk.done) break;
      accumulated += decoder.decode(chunk.value, { stream: true });
      for (let i = missing.length - 1; i >= 0; i--) {
        if (accumulated.includes(missing[i])) missing.splice(i, 1);
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  expect(missing).toEqual([]);
  return accumulated;
}

describe('GET /api/events', () => {
  test('returns newest-first contract-shaped summaries with matchedLabels top 3 by score (R13)', async () => {
    const { db, app } = makeHarness();
    const older = addEvent(db, { detectedAt: '2026-08-06T00:00:01.000Z' });
    const newer = addEvent(db, { detectedAt: '2026-08-06T00:00:02.000Z' });
    for (const [tag, score] of [
      ['label-a', 3],
      ['label-b', 2],
      ['label-c', 1],
      ['label-d', 0],
    ] as const) {
      const label = insertLabel(db, { address: ADDR_IN, tag, source: 'seed' })!;
      for (let i = 0; i < score; i++) {
        db.query('INSERT INTO votes (label_id, voter_did, value) VALUES (?, ?, 1)').run(
          label.id,
          `did:jwk:voter-${tag}-${i}`,
        );
      }
    }

    const res = await app.request('/api/events');
    expect(res.status).toBe(200);
    const body = (await res.json()) as EventsListResponse;
    expect(body.events.map((e) => e.id)).toEqual([newer.id, older.id]);
    for (const event of body.events) expectEventSummaryShape(event);
    expect(body.events[0].matchedLabels.map((l) => l.tag)).toEqual([
      'label-a',
      'label-b',
      'label-c',
    ]);
    for (const label of body.events[0].matchedLabels) expectLabelShape(label);
  });

  test('filters by rule, status and source; supports limit and before cursor', async () => {
    const { db, app } = makeHarness();
    const e1 = addEvent(db, { detectedAt: '2026-08-06T00:00:01.000Z', rules: ['whale'] });
    const e2 = addEvent(db, {
      detectedAt: '2026-08-06T00:00:02.000Z',
      rules: ['coinjoin'],
      source: 'demo',
    });
    addEvent(db, { detectedAt: '2026-08-06T00:00:03.000Z', rules: ['hack'], source: 'demo' });
    db.query("UPDATE events SET status = 'evicted' WHERE id = ?").run(e1.id);

    const byRule = (await (await app.request('/api/events?rule=coinjoin')).json()) as EventsListResponse;
    expect(byRule.events.map((e) => e.id)).toEqual([e2.id]);

    const byStatus = (await (await app.request('/api/events?status=evicted')).json()) as EventsListResponse;
    expect(byStatus.events.map((e) => e.id)).toEqual([e1.id]);

    const bySource = (await (await app.request('/api/events?source=demo')).json()) as EventsListResponse;
    expect(bySource.events).toHaveLength(2);

    const limited = (await (await app.request('/api/events?limit=2')).json()) as EventsListResponse;
    expect(limited.events).toHaveLength(2);
    const page2 = (await (
      await app.request(`/api/events?limit=2&before=${limited.events[1].id}`)
    ).json()) as EventsListResponse;
    expect(page2.events.map((e) => e.id)).toEqual([e1.id]);

    expect((await app.request('/api/events?rule=bogus')).status).toBe(400);
    expect((await app.request('/api/events?status=bogus')).status).toBe(400);
    expect((await app.request('/api/events?source=bogus')).status).toBe(400);
    expect((await app.request('/api/events?limit=0')).status).toBe(400);
  });
});

describe('GET /api/events/:id', () => {
  test('returns contract-shaped EventDetail', async () => {
    const { db, app } = makeHarness();
    const event = addEvent(db);
    insertLabel(db, { address: ADDR_IN, tag: 'known-exchange', source: 'seed' });

    const res = await app.request(`/api/events/${event.id}`);
    expect(res.status).toBe(200);
    const detail = (await res.json()) as EventDetail;
    expectEventSummaryShape(detail);
    expect(detail.id).toBe(event.id);
    expect(detail.aiSummary).toBeNull();
    expect(detail.inputs).toEqual([{ address: ADDR_IN, valueSats: 1_600_000_000 }]);
    expect(detail.outputs).toEqual([{ address: ADDR_OUT, valueSats: 1_500_000_000 }]);
    expect(detail.labels.map((l) => l.tag)).toEqual(['known-exchange']);
    expect(detail.aiFeedback).toEqual({ confirms: 0, refutes: 0, mine: null });
  });

  test('unknown event id returns 404', async () => {
    const { app } = makeHarness();
    expect((await app.request('/api/events/does-not-exist')).status).toBe(404);
  });
});

describe('POST /api/events/:id/ai-feedback', () => {
  test('toggle semantics: same value removes, opposite flips, tallies recompute', async () => {
    const { db, app } = makeHarness();
    const event = addEvent(db);
    const alice = makeSession(db, 'did:jwk:alice', 'alice');
    const bob = makeSession(db, 'did:jwk:bob', 'bob');

    let res = await postJson(app, `/api/events/${event.id}/ai-feedback`, { value: 'confirm' }, alice);
    expect(res.status).toBe(200);
    expect((await res.json()) as AiFeedback).toEqual({ confirms: 1, refutes: 0, mine: 'confirm' });

    res = await postJson(app, `/api/events/${event.id}/ai-feedback`, { value: 'confirm' }, alice);
    expect((await res.json()) as AiFeedback).toEqual({ confirms: 0, refutes: 0, mine: null });

    await postJson(app, `/api/events/${event.id}/ai-feedback`, { value: 'refute' }, alice);
    res = await postJson(app, `/api/events/${event.id}/ai-feedback`, { value: 'refute' }, bob);
    expect((await res.json()) as AiFeedback).toEqual({ confirms: 0, refutes: 2, mine: 'refute' });

    res = await postJson(app, `/api/events/${event.id}/ai-feedback`, { value: 'confirm' }, bob);
    expect((await res.json()) as AiFeedback).toEqual({ confirms: 1, refutes: 1, mine: 'confirm' });
  });

  test('rejects unauthenticated, invalid value and unknown event', async () => {
    const { db, app } = makeHarness();
    const event = addEvent(db);
    const alice = makeSession(db, 'did:jwk:alice');

    expect((await postJson(app, `/api/events/${event.id}/ai-feedback`, { value: 'confirm' })).status).toBe(401);
    expect(
      (await postJson(app, `/api/events/${event.id}/ai-feedback`, { value: 'bogus' }, alice)).status,
    ).toBe(400);
    expect(
      (await postJson(app, '/api/events/nope/ai-feedback', { value: 'confirm' }, alice)).status,
    ).toBe(404);
  });
});

describe('GET /api/addresses/:address', () => {
  test('returns contract-shaped AddressInfo with stats, labels, recent events and history', async () => {
    const { db, app } = makeHarness();
    const event = addEvent(db);
    insertLabel(db, { address: ADDR_IN, tag: 'old-miner', source: 'seed' });

    const res = await app.request(`/api/addresses/${ADDR_IN}`);
    expect(res.status).toBe(200);
    const info = (await res.json()) as AddressInfo;
    expect(info.address).toBe(ADDR_IN);
    expect(info.balanceSats).toBe(75_000);
    expect(info.txCount).toBe(8);
    expect(info.labels.map((l) => l.tag)).toEqual(['old-miner']);
    expectLabelShape(info.labels[0]);
    expect(info.eventCount).toBe(1);
    expect(info.recentEvents.map((e) => e.id)).toEqual([event.id]);
    expectEventSummaryShape(info.recentEvents[0]);
    expect(info.history).toEqual([
      {
        txid: event.txid,
        time: event.detected_at,
        deltaSats: -1_600_000_000,
        eventId: event.id,
      },
    ]);
  });

  test('null balance/txCount when lookups fail', async () => {
    const { app } = makeHarness({ addressInfo: FAILING_ADDRESS_INFO });
    const res = await app.request(`/api/addresses/${ADDR_UNTRACKED}`);
    expect(res.status).toBe(200);
    const info = (await res.json()) as AddressInfo;
    expect(info.balanceSats).toBeNull();
    expect(info.txCount).toBeNull();
    expect(info.labels).toEqual([]);
    expect(info.recentEvents).toEqual([]);
    expect(info.eventCount).toBe(0);
  });

  test('eventCount counts every detection, not just the returned page', async () => {
    const { db, app } = makeHarness();
    for (let i = 0; i < 12; i++) {
      addEvent(db, { detectedAt: `2026-08-06T00:00:${String(i).padStart(2, '0')}.000Z` });
    }

    const res = await app.request(`/api/addresses/${ADDR_IN}`);
    const info = (await res.json()) as AddressInfo;
    // the page is capped well below the total, which is the whole point
    expect(info.recentEvents.length).toBeLessThan(12);
    expect(info.eventCount).toBe(12);

    // an address on the other side of the same events counts them too
    const out = (await (await app.request(`/api/addresses/${ADDR_OUT}`)).json()) as AddressInfo;
    expect(out.eventCount).toBe(12);
  });

  test('a wedged explorer yields null stats without withholding labels and events', async () => {
    const { db, app } = makeHarness({ addressInfo: HANGING_ADDRESS_INFO });
    const event = addEvent(db);
    insertLabel(db, { address: ADDR_IN, tag: 'old-miner', source: 'seed' });

    const res = await app.request(`/api/addresses/${ADDR_IN}`);
    expect(res.status).toBe(200);
    const info = (await res.json()) as AddressInfo;
    expect(info.balanceSats).toBeNull();
    expect(info.txCount).toBeNull();
    expect(info.labels.map((l) => l.tag)).toEqual(['old-miner']);
    expect(info.recentEvents.map((e) => e.id)).toEqual([event.id]);
    expect(info.eventCount).toBe(1);
    expect(info.history.length).toBe(1);
  }, 10_000);

  test('a throwing stats lookup is reported as unknown, not a 500', async () => {
    const { db, app } = makeHarness({
      addressInfo: {
        ...FAILING_ADDRESS_INFO,
        getAddressStats: () => Promise.reject(new Error('explorer exploded')),
      },
    });
    addEvent(db);

    const res = await app.request(`/api/addresses/${ADDR_IN}`);
    expect(res.status).toBe(200);
    const info = (await res.json()) as AddressInfo;
    expect(info.balanceSats).toBeNull();
    expect(info.txCount).toBeNull();
    expect(info.eventCount).toBe(1);
  });

  test('malformed addresses are rejected with 400 and a reason', async () => {
    const { app } = makeHarness();
    const bad = [
      'not-an-address',
      // one character off a real address: shape is fine, checksum is not
      'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t5',
      // same, for base58 and for bech32m, so all three decoders are exercised
      '1A1zP1eP5QGefi2DMPTfTL5SLmv7Divfna',
      'bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg32v7',
    ];
    for (const address of bad) {
      const res = await app.request(`/api/addresses/${address}`);
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(typeof body.error).toBe('string');
      expect(body.error.length).toBeGreaterThan(0);
    }
  });

  test('an upper-case bech32 address resolves to the same record as its lower-case form', async () => {
    const { db, app } = makeHarness();
    const event = addEvent(db);
    insertLabel(db, { address: ADDR_IN, tag: 'old-miner', source: 'seed' });

    const upper = await app.request(`/api/addresses/${ADDR_IN.toUpperCase()}`);
    expect(upper.status).toBe(200);
    const info = (await upper.json()) as AddressInfo;
    // the canonical form is echoed back, not whatever casing the caller sent
    expect(info.address).toBe(ADDR_IN);
    expect(info.labels.map((l) => l.tag)).toEqual(['old-miner']);
    expect(info.recentEvents.map((e) => e.id)).toEqual([event.id]);

    const lower = (await (await app.request(`/api/addresses/${ADDR_IN}`)).json()) as AddressInfo;
    expect(info).toEqual(lower);
  });
});

describe('GET /api/events/by-txid/:txid', () => {
  test('returns the same EventDetail as GET /api/events/:id', async () => {
    const { db, app } = makeHarness();
    const event = addEvent(db);
    insertLabel(db, { address: ADDR_IN, tag: 'known-exchange', source: 'seed' });

    const res = await app.request(`/api/events/by-txid/${event.txid}`);
    expect(res.status).toBe(200);
    const detail = (await res.json()) as EventDetail;
    expectEventSummaryShape(detail);
    expect(detail.id).toBe(event.id);
    expect(detail.txid).toBe(event.txid);
    expect(detail.labels.map((l) => l.tag)).toEqual(['known-exchange']);

    const byId = (await (await app.request(`/api/events/${event.id}`)).json()) as EventDetail;
    expect(detail).toEqual(byId);

    const upper = (await (
      await app.request(`/api/events/by-txid/${event.txid.toUpperCase()}`)
    ).json()) as EventDetail;
    expect(upper).toEqual(byId);
  });

  test('malformed txids are rejected with 400', async () => {
    const { app } = makeHarness();
    const bad = ['abc', 'z'.repeat(64), '0'.repeat(63), '0'.repeat(65), ADDR_IN];
    for (const txid of bad) {
      const res = await app.request(`/api/events/by-txid/${txid}`);
      expect(res.status).toBe(400);
      expect(typeof ((await res.json()) as { error: string }).error).toBe('string');
    }
  });

  test('a well-formed but untracked txid returns 404', async () => {
    const { db, app } = makeHarness();
    addEvent(db);
    const res = await app.request(`/api/events/by-txid/${'a'.repeat(64)}`);
    expect(res.status).toBe(404);
    expect((await res.json()) as { error: string }).toEqual({ error: 'unknown transaction' });
  });

  test('the literal by-txid segment is not swallowed by /api/events/:id', async () => {
    const { db, app } = makeHarness();
    const event = addEvent(db);
    // an event whose id happened to be 'by-txid' would be the only other way
    // this path could 200, and the id column is a uuid, so a 400 here proves
    // the txid handler ran
    expect((await app.request('/api/events/by-txid/nope')).status).toBe(400);
    expect((await app.request(`/api/events/${event.id}`)).status).toBe(200);
  });
});

describe('POST /api/addresses/:address/labels', () => {
  test('creates a contract-shaped label and broadcasts label:new on the stream', async () => {
    const { db, app, hub } = makeHarness();
    const alice = makeSession(db, 'did:jwk:alice', 'alice');

    const streamRes = await app.request('/api/stream');
    expect(streamRes.status).toBe(200);
    await waitFor(() => hub.clientCount() === 1);

    const res = await postJson(
      app,
      `/api/addresses/${ADDR_IN}/labels`,
      { tag: 'my-exchange', note: 'seen it', evidenceUrl: 'https://example.com/proof' },
      alice,
    );
    expect(res.status).toBe(201);
    const label = (await res.json()) as Label;
    expectLabelShape(label);
    expect(label).toMatchObject({
      address: ADDR_IN,
      tag: 'my-exchange',
      note: 'seen it',
      evidenceUrl: 'https://example.com/proof',
      source: 'crowd',
      score: 0,
      myVote: 0,
    });
    expect(label.author).toEqual({ did: 'did:jwk:alice', handle: 'alice' });

    await readSseUntil(streamRes.body!, ['event: label:new', '"tag":"my-exchange"']);
  });

  test('validation: tag length, note length, evidenceUrl scheme', async () => {
    const { db, app } = makeHarness();
    const alice = makeSession(db, 'did:jwk:alice');

    const bad = [
      { tag: 'x' },
      { tag: 'a'.repeat(33) },
      { tag: 'ok-tag', note: 'n'.repeat(281) },
      { tag: 'ok-tag', evidenceUrl: 'not-a-url' },
      { tag: 'ok-tag', evidenceUrl: 'ftp://example.com/x' },
      { tag: 'ok-tag', evidenceUrl: '//example.com/schemeless' },
    ];
    for (const body of bad) {
      const res = await postJson(app, `/api/addresses/${ADDR_IN}/labels`, body, alice);
      expect(res.status).toBe(400);
    }
    expect((await postJson(app, `/api/addresses/${ADDR_IN}/labels`, { tag: 'ok-tag' })).status).toBe(401);

    const ok = await postJson(
      app,
      `/api/addresses/${ADDR_IN}/labels`,
      { tag: 'ok-tag', evidenceUrl: 'http://example.com/is-fine' },
      alice,
    );
    expect(ok.status).toBe(201);
  });

  test('malformed addresses are rejected with 400 and a reason, same as the read path', async () => {
    const { db, app } = makeHarness();
    const alice = makeSession(db, 'did:jwk:alice');
    const bad = [
      'hello-world',
      'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t5',
      '1A1zP1eP5QGefi2DMPTfTL5SLmv7Divfna',
    ];
    for (const address of bad) {
      const res = await postJson(app, `/api/addresses/${address}/labels`, { tag: 'bogus' }, alice);
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(typeof body.error).toBe('string');
      expect(body.error.length).toBeGreaterThan(0);
    }
    // nothing invalid reached the label table, so nothing can surface as trending
    const trending = (await (await app.request('/api/labels/trending')).json()) as TrendingResponse;
    expect(trending.labels).toEqual([]);
    expect((db.query('SELECT COUNT(*) AS n FROM labels').get() as { n: number }).n).toBe(0);
  });

  test('an upper-case bech32 address is stored canonically and found by a later GET', async () => {
    const { db, app } = makeHarness();
    const alice = makeSession(db, 'did:jwk:alice', 'alice');

    const res = await postJson(
      app,
      `/api/addresses/${ADDR_IN.toUpperCase()}/labels`,
      { tag: 'shouty-exchange' },
      alice,
    );
    expect(res.status).toBe(201);
    const label = (await res.json()) as Label;
    expect(label.address).toBe(ADDR_IN);

    const info = (await (await app.request(`/api/addresses/${ADDR_IN}`)).json()) as AddressInfo;
    expect(info.labels.map((l) => l.tag)).toEqual(['shouty-exchange']);

    // the same tag posted in the other casing is the same label, not a second one
    const again = await postJson(
      app,
      `/api/addresses/${ADDR_IN}/labels`,
      { tag: 'shouty-exchange' },
      alice,
    );
    expect(again.status).toBe(200);
    expect(((await again.json()) as Label).id).toBe(label.id);
  });
});

describe('GET /api/meta', () => {
  test('reports the loaded detection thresholds, not compiled-in defaults', async () => {
    const overrides: Partial<Config> = {
      whaleThresholdBtc: 42.5,
      dormantBlocks: 1234,
      dormantMinValueBtc: 0.25,
      coinjoinMinEqualOutputs: 9,
      coinjoinMinDenominationBtc: 0.05,
      chainSource: 'bitcoind',
    };
    const { app, config } = makeHarness({ config: overrides });

    const res = await app.request('/api/meta');
    expect(res.status).toBe(200);
    const body = (await res.json()) as ServerMeta;
    expect(body.detection).toEqual({
      whaleThresholdBtc: config.whaleThresholdBtc,
      dormantBlocks: config.dormantBlocks,
      dormantMinValueBtc: config.dormantMinValueBtc,
      coinjoinMinEqualOutputs: config.coinjoinMinEqualOutputs,
      coinjoinMinDenominationBtc: config.coinjoinMinDenominationBtc,
    });
    expect(body.chainSource).toBe(config.chainSource);

    const defaults = makeHarness();
    const fallback = (await (await defaults.app.request('/api/meta')).json()) as ServerMeta;
    expect(fallback.detection).not.toEqual(body.detection);
    expect(fallback.detection.whaleThresholdBtc).toBe(defaults.config.whaleThresholdBtc);
  });

  test("chainSource names the source the pipeline resolved, not the 'auto' setting", async () => {
    const { app } = makeHarness({
      config: { chainSource: 'auto' },
      sourceName: () => 'esplora',
    });
    const body = (await (await app.request('/api/meta')).json()) as ServerMeta;
    expect(body.chainSource).toBe('esplora');
  });
});

describe('POST /api/labels/:id/vote', () => {
  test('toggle/flip with reputation recompute in the same transaction (R12/AE4/KTD-9)', async () => {
    const { db, app } = makeHarness();
    const alice = makeSession(db, 'did:jwk:alice', 'alice');
    const bob = makeSession(db, 'did:jwk:bob', 'bob');
    const created = await (
      await postJson(app, `/api/addresses/${ADDR_IN}/labels`, { tag: 'vote-target' }, alice)
    ).json() as Label;

    const reputationOf = async (token: string): Promise<number> => {
      const me = (await (
        await app.request('/api/auth/me', { headers: authHeaders(token) })
      ).json()) as Identity;
      return me.reputation;
    };

    let res = await postJson(app, `/api/labels/${created.id}/vote`, { value: 1 }, bob);
    expect(res.status).toBe(200);
    let label = (await res.json()) as Label;
    expect(label.score).toBe(1);
    expect(label.myVote).toBe(1);
    expect(await reputationOf(alice)).toBe(1);

    res = await postJson(app, `/api/labels/${created.id}/vote`, { value: 1 }, bob);
    label = (await res.json()) as Label;
    expect(label.score).toBe(0);
    expect(label.myVote).toBe(0);
    expect(await reputationOf(alice)).toBe(0);

    res = await postJson(app, `/api/labels/${created.id}/vote`, { value: -1 }, bob);
    label = (await res.json()) as Label;
    expect(label.score).toBe(-1);
    expect(label.myVote).toBe(-1);
    expect(await reputationOf(alice)).toBe(-1);

    res = await postJson(app, `/api/labels/${created.id}/vote`, { value: 1 }, bob);
    label = (await res.json()) as Label;
    expect(label.score).toBe(1);
    expect(label.myVote).toBe(1);
    expect(await reputationOf(alice)).toBe(1);
  });

  test('self-vote rejected with 422; seed labels earn no reputation', async () => {
    const { db, app } = makeHarness();
    const alice = makeSession(db, 'did:jwk:alice', 'alice');
    const bob = makeSession(db, 'did:jwk:bob', 'bob');
    const own = (await (
      await postJson(app, `/api/addresses/${ADDR_IN}/labels`, { tag: 'own-label' }, alice)
    ).json()) as Label;
    expect((await postJson(app, `/api/labels/${own.id}/vote`, { value: 1 }, alice)).status).toBe(422);

    const seed = insertLabel(db, { address: ADDR_IN, tag: 'seed-label', source: 'seed' })!;
    const res = await postJson(app, `/api/labels/${seed.id}/vote`, { value: 1 }, bob);
    expect(res.status).toBe(200);
    expect(((await res.json()) as Label).score).toBe(1);
    const board = (await (await app.request('/api/leaderboard')).json()) as LeaderboardResponse;
    for (const analyst of board.analysts) expect(analyst.reputation).toBe(0);
  });

  test('rejects unknown label, invalid value and missing auth', async () => {
    const { db, app } = makeHarness();
    const alice = makeSession(db, 'did:jwk:alice');
    const bob = makeSession(db, 'did:jwk:bob');
    const label = (await (
      await postJson(app, `/api/addresses/${ADDR_IN}/labels`, { tag: 'some-label' }, alice)
    ).json()) as Label;

    expect((await postJson(app, '/api/labels/nope/vote', { value: 1 }, bob)).status).toBe(404);
    expect((await postJson(app, `/api/labels/${label.id}/vote`, { value: 2 }, bob)).status).toBe(400);
    expect((await postJson(app, `/api/labels/${label.id}/vote`, { value: 1 })).status).toBe(401);
  });
});

describe('GET /api/leaderboard', () => {
  test('returns top 20 by reputation with contract shape', async () => {
    const { db, app } = makeHarness();
    const alice = makeSession(db, 'did:jwk:alice', 'alice');
    const bob = makeSession(db, 'did:jwk:bob', 'bob');
    const carol = makeSession(db, 'did:jwk:carol', 'carol');
    const label = (await (
      await postJson(app, `/api/addresses/${ADDR_IN}/labels`, { tag: 'ranked-label' }, alice)
    ).json()) as Label;
    await postJson(app, `/api/labels/${label.id}/vote`, { value: 1 }, bob);
    await postJson(app, `/api/labels/${label.id}/vote`, { value: 1 }, carol);

    const res = await app.request('/api/leaderboard');
    expect(res.status).toBe(200);
    const body = (await res.json()) as LeaderboardResponse;
    expect(body.analysts[0]).toEqual({
      did: 'did:jwk:alice',
      handle: 'alice',
      reputation: 2,
      labelCount: 1,
      netVotes: 2,
    });
    expect(body.analysts).toHaveLength(3);
  });
});

describe('GET /api/labels/trending', () => {
  test('returns voted labels from the last 24h, ordered by score', async () => {
    const { db, app } = makeHarness();
    const alice = makeSession(db, 'did:jwk:alice', 'alice');
    const bob = makeSession(db, 'did:jwk:bob');
    const hot = (await (
      await postJson(app, `/api/addresses/${ADDR_IN}/labels`, { tag: 'hot-label' }, alice)
    ).json()) as Label;
    await postJson(app, `/api/addresses/${ADDR_OUT}/labels`, { tag: 'cold-label' }, alice);
    await postJson(app, `/api/labels/${hot.id}/vote`, { value: 1 }, bob);

    const res = await app.request('/api/labels/trending');
    expect(res.status).toBe(200);
    const body = (await res.json()) as TrendingResponse;
    expect(body.labels.map((l) => l.tag)).toEqual(['hot-label']);
    expectLabelShape(body.labels[0]);
    expect(body.labels[0].score).toBe(1);

    const authed = (await (
      await app.request('/api/labels/trending', { headers: authHeaders(bob) })
    ).json()) as TrendingResponse;
    expect(authed.labels[0].myVote).toBe(1);
  });
});

describe('optional auth on reads', () => {
  test('Bearer token populates myVote and mine; anonymous defaults to 0/null', async () => {
    const { db, app } = makeHarness();
    const alice = makeSession(db, 'did:jwk:alice', 'alice');
    const bob = makeSession(db, 'did:jwk:bob', 'bob');
    const event = addEvent(db);
    const label = (await (
      await postJson(app, `/api/addresses/${ADDR_IN}/labels`, { tag: 'opt-label' }, alice)
    ).json()) as Label;
    await postJson(app, `/api/labels/${label.id}/vote`, { value: 1 }, bob);
    await postJson(app, `/api/events/${event.id}/ai-feedback`, { value: 'confirm' }, bob);

    const asBob = (await (
      await app.request(`/api/addresses/${ADDR_IN}`, { headers: authHeaders(bob) })
    ).json()) as AddressInfo;
    expect(asBob.labels[0].myVote).toBe(1);

    const anonymous = (await (await app.request(`/api/addresses/${ADDR_IN}`)).json()) as AddressInfo;
    expect(anonymous.labels[0].myVote).toBe(0);

    const detailBob = (await (
      await app.request(`/api/events/${event.id}`, { headers: authHeaders(bob) })
    ).json()) as EventDetail;
    expect(detailBob.aiFeedback).toEqual({ confirms: 1, refutes: 0, mine: 'confirm' });
    expect(detailBob.labels.find((l) => l.id === label.id)?.myVote).toBe(1);

    const detailAnon = (await (await app.request(`/api/events/${event.id}`)).json()) as EventDetail;
    expect(detailAnon.aiFeedback).toEqual({ confirms: 1, refutes: 0, mine: null });
  });
});

describe('dev injector', () => {
  test('404 for both POST and GET when disabled', async () => {
    const { app } = makeHarness({ injectorEnabled: false });
    expect((await app.request('/api/dev/inject', { method: 'POST' })).status).toBe(404);
    expect((await app.request('/api/dev/inject')).status).toBe(404);
  });

  test('GET probe returns 200 when enabled; POST rejects non-loopback callers', async () => {
    const enabled = makeHarness({ injectorEnabled: true });
    expect((await enabled.app.request('/api/dev/inject')).status).toBe(200);

    const remote = makeHarness({ injectorEnabled: true, remoteAddress: '203.0.113.9' });
    expect(
      (
        await remote.app.request('/api/dev/inject', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        })
      ).status,
    ).toBe(403);
    expect((await remote.app.request('/api/dev/inject')).status).toBe(403);
  });

  test('injected event is persisted with demo markers and returned as EventDetail (AE6)', async () => {
    const { app } = makeHarness({ injectorEnabled: true });
    const res = await app.request('/api/dev/inject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rule: 'coinjoin', valueSats: 42_000_000, address: ADDR_IN }),
    });
    expect(res.status).toBe(201);
    const detail = (await res.json()) as EventDetail;
    expect(detail.source).toBe('demo');
    expect(detail.rules).toEqual(['coinjoin']);
    expect(detail.valueSats).toBe(42_000_000);
    expect(detail.aiStatus).toBe('pending');
    expect(detail.inputs[0].address).toBe(ADDR_IN);
    expect(detail.aiFeedback).toEqual({ confirms: 0, refutes: 0, mine: null });

    const list = (await (await app.request('/api/events?source=demo')).json()) as EventsListResponse;
    expect(list.events.map((e) => e.id)).toEqual([detail.id]);

    const bad = await app.request('/api/dev/inject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rule: 'bogus' }),
    });
    expect(bad.status).toBe(400);
    const badValue = await app.request('/api/dev/inject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ valueSats: -1 }),
    });
    expect(badValue.status).toBe(400);
  });

  test('injected event streams as event:new with demo marker, then event:update after AI pass', async () => {
    const { app, hub } = makeHarness({ injectorEnabled: true });
    const streamRes = await app.request('/api/stream');
    await waitFor(() => hub.clientCount() === 1);

    const post = await app.request('/api/dev/inject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rule: 'whale' }),
    });
    expect(post.status).toBe(201);

    const received = await readSseUntil(streamRes.body!, [
      'event: event:new',
      '"source":"demo"',
      '"rules":["whale"]',
      'event: event:update',
      '"aiStatus":"done"',
      '"aiTag":"whale-move"',
    ]);
    expect(received.indexOf('event: event:new')).toBeLessThan(received.indexOf('event: event:update'));
  });
});

describe('SSE health', () => {
  test('health message with lastPollAt is broadcast after each successful poll', async () => {
    const { app, hub } = makeHarness();
    const streamRes = await app.request('/api/stream');
    await waitFor(() => hub.clientCount() === 1);

    let lastPoll: string | null = null;
    const fakePipeline: Pipeline = {
      emitter: new EventEmitter(),
      sourceName: () => 'test',
      poll: () => {
        lastPoll = new Date().toISOString();
        return Promise.resolve();
      },
      lastPollAt: () => lastPoll,
    };
    const stop = startPipelineLoop(fakePipeline, hub, 60_000);
    try {
      const received = await readSseUntil(streamRes.body!, ['event: health', '"lastPollAt"']);
      expect(received).toContain(lastPoll as unknown as string);
    } finally {
      stop();
    }
  });
});

describe('auth mounting', () => {
  test('auth routes are reachable under /api', async () => {
    const { db, app } = makeHarness();
    const token = makeSession(db, 'did:jwk:alice', 'alice');
    const me = await app.request('/api/auth/me', { headers: authHeaders(token) });
    expect(me.status).toBe(200);
    expect(((await me.json()) as Identity).did).toBe('did:jwk:alice');
    expect((await app.request('/api/auth/me')).status).toBe(401);
  });
});
