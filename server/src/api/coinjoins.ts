import { Hono } from 'hono';
import type { Database } from 'bun:sqlite';
import type { CoinjoinsResponse } from '@chainwatch/shared';
import { findBatchByTxid } from '../store/db';
import { listCoinjoinEvents } from '../store/batchQueries';
import { serializeEventSummary } from './routes';

const MAX_LIMIT = 200;

export function createCoinjoinRoutes(db: Database): Hono {
  const app = new Hono();

  app.get('/api/coinjoins', (c) => {
    const query = c.req.query();
    let limit = 50;
    if (query.limit !== undefined) {
      const parsed = Number(query.limit);
      if (!Number.isInteger(parsed) || parsed < 1) {
        return c.json({ error: 'limit must be a positive integer' }, 400);
      }
      limit = Math.min(parsed, MAX_LIMIT);
    }
    const rows = listCoinjoinEvents(db, limit);
    const body: CoinjoinsResponse = {
      coinjoins: rows.map((row) => ({
        ...serializeEventSummary(db, row),
        batchId: findBatchByTxid(db, row.txid)?.id ?? null,
      })),
    };
    return c.json(body);
  });

  return app;
}
