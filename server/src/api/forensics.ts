import { Hono } from 'hono';
import type { Database } from 'bun:sqlite';
import {
  validateBitcoinAddress,
  type AddressCluster,
  type AddressFlow,
} from '@chainwatch/shared';
import type { EsploraClient } from '../ingest/esplora';
import { getLabelsForAddressScored } from '../store/apiQueries';
import { clusterAddress, traceAddressFlow } from '../analytics/forensics';
import { analyzeCoinjoin } from '../analytics/coinjoin';
import { isTxid } from '@chainwatch/shared';
import { errMessage } from '../util';

/**
 * Tracing walks a bounded neighbourhood of the chain, so it is slow by nature
 * and gets a budget an order of magnitude larger than an ordinary read. The UI
 * loads it on demand rather than with the page.
 */
const TRACE_TIMEOUT_MS = 45_000;
const CLUSTER_TIMEOUT_MS = 15_000;

export interface ForensicsDeps {
  db: Database;
  esplora: EsploraClient;
  warn?: (message: string) => void;
}

export function createForensicsRoutes(deps: ForensicsDeps): Hono {
  const warn = deps.warn ?? ((message: string) => console.warn(message));
  const app = new Hono();

  /** labels we already hold, so the graph carries what the crowd knows */
  const labelsFor = (address: string): string[] =>
    getLabelsForAddressScored(deps.db, address, null).map((label) => label.tag);

  app.get('/api/addresses/:address/flow', async (c) => {
    const validation = validateBitcoinAddress(c.req.param('address'));
    if (!validation.valid || validation.normalized === null) {
      return c.json({ error: validation.reason ?? 'not a bitcoin address' }, 400);
    }
    const address = validation.normalized;
    const upstreamHops = clampHops(c.req.query('up'), 2);
    const downstreamHops = clampHops(c.req.query('down'), 2);

    try {
      const flow = await withTimeout(
        traceAddressFlow(deps.esplora, address, { upstreamHops, downstreamHops }),
        TRACE_TIMEOUT_MS,
      );
      for (const node of flow.nodes) node.labels = labelsFor(node.address);
      return c.json(flow);
    } catch (err) {
      warn(`flow: ${address} unavailable: ${errMessage(err)}`);
      const body: AddressFlow = {
        focus: address,
        nodes: [],
        edges: [],
        truncated: false,
        note: null,
        available: false,
      };
      return c.json(body);
    }
  });

  app.get('/api/addresses/:address/cluster', async (c) => {
    const validation = validateBitcoinAddress(c.req.param('address'));
    if (!validation.valid || validation.normalized === null) {
      return c.json({ error: validation.reason ?? 'not a bitcoin address' }, 400);
    }
    const address = validation.normalized;

    try {
      const cluster = await withTimeout(clusterAddress(deps.esplora, address), CLUSTER_TIMEOUT_MS);
      for (const member of cluster.members) member.labels = labelsFor(member.address);
      return c.json(cluster);
    } catch (err) {
      warn(`cluster: ${address} unavailable: ${errMessage(err)}`);
      const body: AddressCluster = {
        focus: address,
        members: [],
        bindingTxids: [],
        patterns: [],
        truncated: false,
        note: null,
        available: false,
      };
      return c.json(body);
    }
  });

  app.get('/api/coinjoins/:txid/analysis', async (c) => {
    const txid = c.req.param('txid');
    if (!isTxid(txid)) return c.json({ error: 'txid must be 64 hex characters' }, 400);
    try {
      const analysis = await withTimeout(
        analyzeCoinjoin(deps.esplora, txid.toLowerCase()),
        CLUSTER_TIMEOUT_MS,
      );
      if (analysis === null) return c.json({ error: 'unknown transaction' }, 404);
      return c.json(analysis);
    } catch (err) {
      warn(`coinjoin analysis: ${txid} unavailable: ${errMessage(err)}`);
      return c.json({ error: 'chain data unavailable' }, 503);
    }
  });

  return app;
}

function clampHops(raw: string | undefined, fallback: number): number {
  const value = Number(raw ?? fallback);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(3, Math.max(0, Math.trunc(value)));
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
