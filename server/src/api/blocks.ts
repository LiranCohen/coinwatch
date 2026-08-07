import { Hono } from 'hono';
import type { BlocksResponse, BlockSummary } from '@chainwatch/shared';
import type { EsploraClient } from '../ingest/esplora';
import { errMessage } from '../util';

const MAX_BLOCKS = 12;
const DEFAULT_BLOCKS = 6;

export interface BlockRoutesDeps {
  esplora: EsploraClient;
  /** name of the active ingestion source, surfaced so clients can show provenance */
  sourceName: () => string;
  warn?: (message: string) => void;
}

/**
 * Recent blocks for the chain ticker. Served from the explorer client rather
 * than our own store because we care about the chain's actual head here, not
 * about the subset of it we happen to have indexed.
 */
export function createBlockRoutes(deps: BlockRoutesDeps): Hono {
  const warn = deps.warn ?? ((message: string) => console.warn(message));
  const app = new Hono();

  app.get('/api/blocks', async (c) => {
    const requested = Number(c.req.query('limit') ?? DEFAULT_BLOCKS);
    const limit = Number.isFinite(requested)
      ? Math.min(MAX_BLOCKS, Math.max(1, Math.trunc(requested)))
      : DEFAULT_BLOCKS;
    try {
      const blocks = await deps.esplora.recentBlocks(limit);
      const body: BlocksResponse = {
        tipHeight: blocks[0]?.height ?? 0,
        source: deps.sourceName(),
        blocks: blocks.map(
          (block): BlockSummary => ({
            height: block.height,
            hash: block.hash,
            time: block.time,
            txCount: block.txCount,
            sizeBytes: block.sizeBytes,
            weight: block.weight,
            miner: block.miner,
            medianFeeRate: block.medianFeeRate,
          }),
        ),
      };
      return c.json(body);
    } catch (err) {
      warn(`blocks: lookup failed: ${errMessage(err)}`);
      return c.json({ error: 'chain data unavailable' }, 503);
    }
  });

  return app;
}
