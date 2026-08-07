import { Hono } from 'hono';
import type { Database } from 'bun:sqlite';
import type { BatchDetail, BatchSummary, BatchesResponse } from '@chainwatch/shared';
import { getBatchById, listBatches, type BatchRow } from '../store/db';
import {
  assembleBatchDetail,
  assembleBatchSummary,
  type BatchSummaryData,
} from '../store/batchApiQueries';
import { toLabel } from './routes';

function toBatchSummary(data: BatchSummaryData): BatchSummary {
  return {
    id: data.batch.id,
    kind: data.batch.kind,
    title: data.batch.title,
    description: data.batch.description,
    txCount: data.txCount,
    totalValueSats: data.totalValueSats,
    latestBlockTime: data.latestBlockTime,
    topLabels: data.topLabels.map(toLabel),
  };
}

export function createBatchRoutes(db: Database): Hono {
  const app = new Hono();

  app.get('/api/batches', (c) => {
    const body: BatchesResponse = {
      batches: listBatches(db).map((row: BatchRow) => toBatchSummary(assembleBatchSummary(db, row))),
    };
    return c.json(body);
  });

  app.get('/api/batches/:id', (c) => {
    const row = getBatchById(db, c.req.param('id'));
    if (!row) return c.json({ error: 'unknown batch' }, 404);
    const data = assembleBatchDetail(db, row);
    const body: BatchDetail = {
      ...toBatchSummary(data),
      txs: data.txs.map(({ tx, eventId, labels }) => ({
        txid: tx.txid,
        blockHeight: tx.block_height,
        blockHash: tx.block_hash,
        blockTime: tx.block_time,
        valueSats: tx.value_sats,
        linkReason: tx.link_reason,
        labels: labels.map(toLabel),
        eventId,
      })),
    };
    return c.json(body);
  });

  return app;
}
