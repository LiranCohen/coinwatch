import { Hono, type Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { getConnInfo } from 'hono/bun';
import type { EventEmitter } from 'node:events';
import type { Database } from 'bun:sqlite';
import type { InjectRequest, Rule } from '@chainwatch/shared';
import type { Config } from '../config';
import { insertEvent } from '../store/db';
import { serializeEventDetail } from './routes';

const RULES: readonly string[] = ['whale', 'dormant-wake', 'coinjoin', 'demo'];
const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const SATS_PER_BTC = 100_000_000;

const DEFAULT_DEMO_INPUT = 'bc1qchainwatchdemoinput000000000000000000000';
const DEFAULT_DEMO_OUTPUT = 'bc1qchainwatchdemooutput00000000000000000000';

export interface InjectDeps {
  db: Database;
  emitter: EventEmitter;
  config: Config;
  getRemoteAddress?: (c: Context) => string | undefined;
}

function defaultRemoteAddress(c: Context): string | undefined {
  try {
    return getConnInfo(c).remote.address;
  } catch {
    return undefined;
  }
}

function fakeTxid(): string {
  return (crypto.randomUUID().replaceAll('-', '') + '0'.repeat(64)).slice(0, 64);
}

export function createInjectApp(deps: InjectDeps): Hono {
  const { db, emitter, config } = deps;
  const getRemoteAddress = deps.getRemoteAddress ?? defaultRemoteAddress;
  const app = new Hono();

  const guard = createMiddleware(async (c, next) => {
    if (!config.injectorEnabled) {
      return c.json({ error: 'not found' }, 404);
    }
    const remote = getRemoteAddress(c);
    if (remote !== undefined && !LOOPBACK_ADDRESSES.has(remote)) {
      return c.json({ error: 'injector is loopback-only' }, 403);
    }
    await next();
  });

  app.get('/api/dev/inject', guard, (c) => c.json({ enabled: true }));

  app.post('/api/dev/inject', guard, async (c) => {
    let body: InjectRequest = {};
    const text = await c.req.text();
    if (text.trim().length > 0) {
      try {
        body = JSON.parse(text) as InjectRequest;
      } catch {
        return c.json({ error: 'invalid JSON body' }, 400);
      }
    }
    if (body.rule !== undefined && !RULES.includes(body.rule)) {
      return c.json({ error: `rule must be one of ${RULES.join(', ')}` }, 400);
    }
    if (
      body.valueSats !== undefined &&
      (!Number.isInteger(body.valueSats) || body.valueSats <= 0)
    ) {
      return c.json({ error: 'valueSats must be a positive integer' }, 400);
    }
    if (body.address !== undefined && (typeof body.address !== 'string' || body.address.length === 0)) {
      return c.json({ error: 'address must be a non-empty string' }, 400);
    }

    const rule: Rule = body.rule ?? 'whale';
    const rules: Rule[] = rule === 'demo' ? ['demo'] : [rule, 'demo'];
    const valueSats = body.valueSats ?? 2 * Math.round(config.whaleThresholdBtc * SATS_PER_BTC);
    const inputAddress = body.address ?? DEFAULT_DEMO_INPUT;

    const row = insertEvent(db, {
      txid: fakeTxid(),
      rules,
      valueSats,
      inputs: [{ address: inputAddress, valueSats: valueSats + 1000 }],
      outputs: [{ address: DEFAULT_DEMO_OUTPUT, valueSats }],
      source: 'demo',
    });
    if (!row) return c.json({ error: 'injection failed' }, 500);

    emitter.emit('event:new', row);
    return c.json(serializeEventDetail(db, row, null), 201);
  });

  return app;
}
