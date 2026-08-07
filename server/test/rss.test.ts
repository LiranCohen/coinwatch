import { describe, test, expect } from 'bun:test';
import { EventEmitter } from 'node:events';
import { openDatabase, insertEvent, type EventInput, type EventRow } from '../src/store/db';
import { setEventAiResult } from '../src/store/apiQueries';
import { composeApp } from '../src/index';
import type { AiProvider } from '../src/ai/provider';
import { loadConfig, type Config } from '../src/config';
import { buildRssFeed } from '../src/api/rss';

const MOCK_AI: AiProvider = {
  name: 'mock',
  summarizeEvent: () =>
    Promise.resolve({ ok: true, summary: 'A whale moved ₿ 15 toward an exchange.', tag: 'whale-move' }),
};

function makeApp(publicSiteUrl = 'https://coinwatch.example') {
  const db = openDatabase(':memory:');
  const emitter = new EventEmitter();
  const config: Config = {
    ...loadConfig({}),
    publicSiteUrl,
    injectorEnabled: false,
  };
  const { app } = composeApp({
    db,
    config,
    emitter,
    ai: MOCK_AI,
    addressInfo: null,
    log: () => {},
  });
  return { db, app };
}

function addEvent(db: ReturnType<typeof openDatabase>, overrides: Partial<EventInput> = {}): EventRow {
  const { row } = insertEvent(db, {
    txid: (crypto.randomUUID().replaceAll('-', '') + '0'.repeat(64)).slice(0, 64),
    rules: ['whale'],
    valueSats: 1_500_000_000,
    inputs: [{ address: 'bc1qin', valueSats: 1_600_000_000 }],
    outputs: [{ address: 'bc1qout', valueSats: 1_500_000_000 }],
    ...overrides,
  });
  return row!;
}

describe('buildRssFeed', () => {
  test('escapes XML and uses Coin Standard amounts', () => {
    const db = openDatabase(':memory:');
    const inserted = addEvent(db, {
      rules: ['whale', 'hack'],
      valueSats: 4_215_000_000,
    });
    const row = setEventAiResult(
      db,
      inserted.id,
      'done',
      'Drain toward Wasabi <coordinator> & mix.',
      'exchange-flow',
    )!;
    const xml = buildRssFeed({
      rows: [row],
      publicSiteUrl: 'https://coinwatch.example/',
      feedSelfUrl: 'https://api.example/api/feed.xml',
    });
    expect(xml).toContain('<rss version="2.0"');
    expect(xml).toContain('[WHALE+HACK] ₿ 42.15 · exchange-flow');
    expect(xml).toContain('https://coinwatch.example/app?event=');
    expect(xml).toContain('&lt;coordinator&gt;');
    expect(xml).toContain('&amp; mix.');
    expect(xml).toContain('<category>whale</category>');
    expect(xml).toContain('<category>hack</category>');
    expect(xml).toContain('application/rss+xml');
  });
});

describe('GET /api/feed.xml', () => {
  test('returns RSS for recent events and supports rule filter', async () => {
    const { db, app } = makeApp();
    addEvent(db, { rules: ['whale'], valueSats: 2_000_000_000 });
    addEvent(db, { rules: ['coinjoin'], valueSats: 50_000_000 });

    const all = await app.request('/api/feed.xml');
    expect(all.status).toBe(200);
    expect(all.headers.get('Content-Type')).toContain('application/rss+xml');
    const body = await all.text();
    expect(body).toContain('<channel>');
    expect(body).toContain('[WHALE]');
    expect(body).toContain('[COINJOIN]');
    expect(body).toContain('https://coinwatch.example/app?event=');

    const filtered = await app.request('/api/feed.xml?rule=coinjoin');
    const filteredBody = await filtered.text();
    expect(filtered.status).toBe(200);
    expect(filteredBody).toContain('[COINJOIN]');
    expect(filteredBody).not.toContain('[WHALE]');
    expect(filteredBody).toContain('<title>CoinWatch coinjoin events</title>');
  });

  test('aliases /feed.xml and rejects bad query params', async () => {
    const { db, app } = makeApp();
    addEvent(db);

    const alias = await app.request('/feed.xml');
    expect(alias.status).toBe(200);
    expect(await alias.text()).toContain('<rss version="2.0"');

    expect((await app.request('/api/feed.xml?rule=bogus')).status).toBe(400);
    expect((await app.request('/api/feed.xml?limit=0')).status).toBe(400);
  });
});
