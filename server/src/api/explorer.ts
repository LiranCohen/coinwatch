import { Hono } from 'hono';
import type { Database } from 'bun:sqlite';
import {
  classifySearchInput,
  isTxid,
  type BlockDetail,
  type BlockTxsResponse,
  type Label,
  type Rule,
  type SearchResolution,
  type TxDetail,
  type TxIo,
} from '@chainwatch/shared';
import type { EsploraClient, EsploraTx } from '../ingest/esplora';
import { getEventByTxid } from '../store/db';
import { getLabelsForAddressesScored, getLabelsForTxScored } from '../store/apiQueries';
import { entropyFor } from '../detect/pipeline';
import { toLabel } from './routes';
import { errMessage } from '../util';

/** Upstream reads are the slow part; every one of them is bounded. */
const LOOKUP_TIMEOUT_MS = 10_000;
const BLOCK_PAGE = 25;

export interface ExplorerDeps {
  db: Database;
  esplora: EsploraClient;
  warn?: (message: string) => void;
}

/**
 * Ordinary block-explorer navigation: any transaction, any block, and a search
 * box that works out what it was handed.
 *
 * The detection index only ever holds transactions that tripped a rule, which
 * is a small slice of the chain. Everything here reads through to the chain
 * itself, so a user can walk from a block to a transaction to an address the
 * way they can in any explorer, and label whatever they find.
 */
export function createExplorerRoutes(deps: ExplorerDeps): Hono {
  const warn = deps.warn ?? ((message: string) => console.warn(message));
  const app = new Hono();

  app.get('/api/search', async (c) => {
    const raw = c.req.query('q') ?? '';
    const body = await resolveSearch(deps, raw);
    return c.json(body);
  });

  app.get('/api/tx/:txid', async (c) => {
    const txid = c.req.param('txid');
    if (!isTxid(txid)) return c.json({ error: 'txid must be 64 hex characters' }, 400);
    try {
      const detail = await withTimeout(loadTx(deps, txid.toLowerCase()), LOOKUP_TIMEOUT_MS);
      if (detail === null) return c.json({ error: 'unknown transaction' }, 404);
      return c.json(detail);
    } catch (err) {
      warn(`tx: ${txid} unavailable: ${errMessage(err)}`);
      return c.json({ error: 'chain data unavailable' }, 503);
    }
  });

  app.get('/api/block/:id', async (c) => {
    try {
      const block = await withTimeout(loadBlock(deps, c.req.param('id')), LOOKUP_TIMEOUT_MS);
      if (block === null) return c.json({ error: 'unknown block' }, 404);
      return c.json(block);
    } catch (err) {
      warn(`block: ${c.req.param('id')} unavailable: ${errMessage(err)}`);
      return c.json({ error: 'chain data unavailable' }, 503);
    }
  });

  app.get('/api/block/:id/txs', async (c) => {
    const requested = Number(c.req.query('start') ?? 0);
    // Esplora pages block transactions in fixed blocks of 25 and rejects any
    // other offset, so the cursor is snapped rather than passed through
    const startIndex = Number.isFinite(requested)
      ? Math.max(0, Math.floor(Math.trunc(requested) / BLOCK_PAGE) * BLOCK_PAGE)
      : 0;
    try {
      const block = await withTimeout(loadBlock(deps, c.req.param('id')), LOOKUP_TIMEOUT_MS);
      if (block === null) return c.json({ error: 'unknown block' }, 404);
      const page = await withTimeout(
        deps.esplora.blockTxs(block.hash, startIndex),
        LOOKUP_TIMEOUT_MS,
      );
      const body: BlockTxsResponse = {
        hash: block.hash,
        height: block.height,
        startIndex,
        txCount: block.txCount,
        transactions: page.map((tx) => summarize(deps, tx, null)),
      };
      return c.json(body);
    } catch (err) {
      warn(`block txs: ${c.req.param('id')} unavailable: ${errMessage(err)}`);
      return c.json({ error: 'chain data unavailable' }, 503);
    }
  });

  return app;
}

async function resolveSearch(deps: ExplorerDeps, raw: string): Promise<SearchResolution> {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return { kind: 'unknown', value: null, height: null, reason: 'enter an address, transaction or block' };
  }

  // a bare number is a block height, which nothing else can be
  if (/^\d{1,9}$/.test(trimmed)) {
    try {
      const hash = await deps.esplora.blockHashAt(Number(trimmed));
      return { kind: 'block', value: hash, height: Number(trimmed), reason: null };
    } catch {
      return { kind: 'unknown', value: null, height: null, reason: 'no block at that height' };
    }
  }

  const target = classifySearchInput(trimmed);
  if (target.kind === 'address') {
    return { kind: 'address', value: target.value, height: null, reason: null };
  }

  if (target.kind === 'txid') {
    // 64 hex is ambiguous: it is the shape of both a txid and a block hash, so
    // ask the chain which one it is rather than guessing from the string
    try {
      const tx = await deps.esplora.tx(target.value);
      if (tx !== null) return { kind: 'tx', value: target.value, height: null, reason: null };
    } catch {
      /* fall through to the block check */
    }
    try {
      const block = await deps.esplora.block(target.value);
      return { kind: 'block', value: block.hash, height: block.height, reason: null };
    } catch {
      return {
        kind: 'unknown',
        value: target.value,
        height: null,
        reason: 'no transaction or block with that hash',
      };
    }
  }

  return { kind: 'unknown', value: null, height: null, reason: target.reason };
}

async function loadBlock(deps: ExplorerDeps, id: string): Promise<BlockDetail | null> {
  let hash = id;
  if (/^\d{1,9}$/.test(id)) {
    hash = await deps.esplora.blockHashAt(Number(id));
  } else if (!/^[0-9a-fA-F]{64}$/.test(id)) {
    return null;
  }
  const block = await deps.esplora.block(hash.toLowerCase());
  let confirmations: number | null = null;
  try {
    confirmations = (await deps.esplora.tipHeight()) - block.height + 1;
  } catch {
    confirmations = null;
  }
  return {
    hash: block.hash,
    height: block.height,
    time: block.time,
    txCount: block.txCount,
    sizeBytes: block.sizeBytes,
    weight: block.weight,
    miner: block.miner,
    medianFeeRate: block.medianFeeRate,
    confirmations,
  };
}

async function loadTx(deps: ExplorerDeps, txid: string): Promise<TxDetail | null> {
  const tx = await deps.esplora.tx(txid);
  if (tx === null) return null;

  let spends: (string | null)[] = [];
  try {
    spends = (await deps.esplora.outspends(txid)).map((entry) => (entry.spent ? entry.txid : null));
  } catch {
    spends = [];
  }

  let confirmations: number | null = null;
  if (tx.confirmed && tx.blockHeight !== null) {
    try {
      confirmations = (await deps.esplora.tipHeight()) - tx.blockHeight + 1;
    } catch {
      confirmations = null;
    }
  }

  return summarize(deps, tx, spends, confirmations);
}

/** Assemble the view, attaching whatever the crowd and the detector already know. */
function summarize(
  deps: ExplorerDeps,
  tx: EsploraTx,
  spends: (string | null)[] | null,
  confirmations: number | null = null,
): TxDetail {
  const addresses = [...tx.inputs, ...tx.outputs]
    .map((io) => io.address)
    .filter((address): address is string => address !== null);
  const labelRows = getLabelsForAddressesScored(deps.db, [...new Set(addresses)], null);
  const byAddress = new Map<string, Label[]>();
  for (const row of labelRows) {
    const label = toLabel(row);
    const list = byAddress.get(label.address) ?? [];
    list.push(label);
    byAddress.set(label.address, list);
  }

  const io = (entry: { address: string | null; valueSats: number }, extra: Partial<TxIo>): TxIo => ({
    address: entry.address,
    valueSats: entry.valueSats,
    labels: entry.address ? (byAddress.get(entry.address) ?? []) : [],
    ...extra,
  });

  const event = getEventByTxid(deps.db, tx.txid);
  const vbytes = tx.weight / 4;

  return {
    txid: tx.txid,
    blockHeight: tx.blockHeight,
    blockHash: tx.blockHash,
    time: tx.blockTime,
    confirmed: tx.confirmed,
    confirmations,
    sizeBytes: tx.sizeBytes,
    weight: tx.weight,
    feeSats: tx.feeSats,
    feeRate: vbytes > 0 ? tx.feeSats / vbytes : null,
    totalOutSats: tx.outputs.reduce((total, output) => total + output.valueSats, 0),
    isCoinbase: tx.isCoinbase,
    inputs: tx.inputs.map((input) => io(input, { fromTxid: input.txid })),
    outputs: tx.outputs.map((output, index) =>
      io(output, { spentBy: spends === null ? null : (spends[index] ?? null) }),
    ),
    // coinbase inputs carry no prevout value, so the arithmetic cannot close
    entropy: tx.isCoinbase
      ? null
      : entropyFor({
          txid: tx.txid,
          inputs: tx.inputs.map((i) => ({ address: i.address, valueSats: i.valueSats })),
          outputs: tx.outputs.map((o) => ({ address: o.address, valueSats: o.valueSats })),
          feeSats: tx.feeSats,
          confirmed: tx.confirmed,
          blockHeight: tx.blockHeight,
          blockHash: tx.blockHash,
          blockTime: tx.blockTime,
          isCoinbase: tx.isCoinbase,
        }),
    labels: getLabelsForTxScored(deps.db, tx.txid, null).map(toLabel),
    eventId: event?.id ?? null,
    rules: event === null ? [] : (JSON.parse(event.rules) as Rule[]),
  };
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
