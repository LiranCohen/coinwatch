import { Hono } from 'hono';
import type { BlocksResponse, BlockSummary } from '@chainwatch/shared';
import type { EsploraClient } from '../ingest/esplora';
import { errMessage } from '../util';

const MAX_BLOCKS = 12;
const DEFAULT_BLOCKS = 6;
/**
 * The ticker is decoration: a wedged upstream must not hold the request open
 * for the client's whole patience budget. Failing fast lets the UI say the
 * chain head is unavailable instead of showing skeletons indefinitely.
 */
const BLOCKS_TIMEOUT_MS = 12_000;

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
      const blocks = await withTimeout(deps.esplora.recentBlocks(limit), BLOCKS_TIMEOUT_MS);
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

/** Reject once the bound elapses; the upstream promise is left to settle unobserved. */
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
