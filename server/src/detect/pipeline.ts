import { EventEmitter } from 'node:events';
import type { Database } from 'bun:sqlite';
import type { Config } from '../config';
import type { CoinjoinMeta, EventMeta, Rule, TxEntropy } from '@chainwatch/shared';
import type { BitcoinRpc, VerboseTx } from '../rpc/client';
import type { AddressInfoClient } from '../external/addressinfo';
import { classifyCoinjoin, dormantWake, whale, type NormalizedTx } from './rules';
import { addBatchTx, findBatchByTxid, insertBatch, insertEvent } from '../store/db';
import { findCoinjoinEventByOutputAddress, setEventMeta } from '../store/batchQueries';
import { listSweepableEvents, setEventConfirmed, setEventStatus } from '../store/pipelineQueries';
import { BLOCK_PAGE_SIZE, createRpcSource, type ChainSource, type SourceTx } from '../ingest/source';
import { analyzeBoltzmann } from '../analytics/boltzmann';
import { errMessage } from '../util';

const SATS_PER_BTC = 100_000_000;
const FETCH_CONCURRENCY = 8;
/**
 * Address history lookups are the expensive part of dormant detection and the
 * first thing public explorers rate-limit, so they get a per-cycle allowance.
 */
const DORMANT_LOOKUP_BUDGET = 6;
/**
 * Block pages walked per poll. A block is ~120 pages, so this keeps pace with
 * ~10 minute blocks while leaving request headroom for everything else.
 */
const BLOCK_PAGES_PER_POLL = 4;
/** bound on remembered txids so a long-running process does not grow without limit */
const SEEN_TXID_CAP = 20_000;

export function btcToSats(btc: number): number {
  return Math.round(btc * SATS_PER_BTC);
}

export function normalizeTx(raw: VerboseTx): NormalizedTx {
  const inputs = raw.vin.map((input) => ({
    address: scriptAddress(input.prevout?.scriptPubKey),
    valueSats: btcToSats(input.prevout?.value ?? 0),
  }));
  const outputs = raw.vout.map((output) => ({
    address: scriptAddress(output.scriptPubKey),
    valueSats: btcToSats(output.value),
  }));
  return {
    txid: raw.txid,
    inputs,
    outputs,
    totalOutputSats: outputs.reduce((sum, output) => sum + output.valueSats, 0),
  };
}

function scriptAddress(
  scriptPubKey: { address?: string; addresses?: string[] } | undefined | null,
): string | null {
  if (!scriptPubKey) return null;
  if (typeof scriptPubKey.address === 'string') return scriptPubKey.address;
  if (Array.isArray(scriptPubKey.addresses) && typeof scriptPubKey.addresses[0] === 'string') {
    return scriptPubKey.addresses[0];
  }
  return null;
}

function toNormalized(tx: SourceTx): NormalizedTx {
  return {
    txid: tx.txid,
    inputs: tx.inputs,
    outputs: tx.outputs,
    totalOutputSats: tx.outputs.reduce((sum, output) => sum + output.valueSats, 0),
  };
}

/** Run the entropy engine and reduce it to the shape stored on the event. */
export function entropyFor(tx: SourceTx): TxEntropy {
  const result = analyzeBoltzmann(
    tx.inputs.map((io) => io.valueSats),
    tx.outputs.map((io) => io.valueSats),
  );
  return {
    status: result.status,
    reason: result.reason,
    combinations: result.combinations,
    entropy: result.entropy,
    maxEntropy: result.maxEntropy,
    efficiency: result.efficiency,
    density: result.density,
    linkProbability: result.linkProbability,
    deterministicLinks: result.deterministicLinks,
    outputLinkMax: result.outputLinkMax,
    states: result.states,
  };
}

export interface PipelineDeps {
  db: Database;
  /** preferred: an explicit chain source */
  source?: ChainSource;
  /** legacy/simple path: a bitcoind client, wrapped into a source */
  rpc?: BitcoinRpc;
  config: Config;
  addressInfo?: AddressInfoClient | null;
  emitter?: EventEmitter;
  log?: (message: string) => void;
  warn?: (message: string) => void;
}

export interface Pipeline {
  emitter: EventEmitter;
  poll(): Promise<void>;
  lastPollAt(): string | null;
  sourceName(): string;
}

export function createPipeline(deps: PipelineDeps): Pipeline {
  const { db, config } = deps;
  const emitter = deps.emitter ?? new EventEmitter();
  const log = deps.log ?? ((message: string) => console.log(message));
  const warn = deps.warn ?? ((message: string) => console.warn(message));
  const source = deps.source ?? createRpcSource(requireRpc(deps), warn);
  const whaleThresholdSats = btcToSats(config.whaleThresholdBtc);
  const dormantMinValueSats = btcToSats(config.dormantMinValueBtc);

  /**
   * A node hands us the entire mempool, so diffing snapshots sees every arrival.
   * Public explorers only expose a recent sample, so we additionally walk
   * confirmed blocks to get complete coverage of notable transactions.
   */
  const scansBlocks = !source.mempoolIsComplete;

  let prevMempool: Set<string> | null = null;
  let seen = new Set<string>();
  let scanCursor: { height: number; hash: string; index: number; txCount: number } | null = null;
  let lastPoll: string | null = null;
  let polling = false;
  let dormantBudget = DORMANT_LOOKUP_BUDGET;

  function remember(txid: string): boolean {
    if (seen.has(txid)) return false;
    if (seen.size >= SEEN_TXID_CAP) seen = new Set<string>();
    seen.add(txid);
    return true;
  }

  interface RuleEvaluation {
    rules: Rule[];
    coinjoinMeta: CoinjoinMeta | null;
  }

  async function evaluateRules(tx: NormalizedTx, tipHeight: number): Promise<RuleEvaluation> {
    const rules: Rule[] = [];
    if (whale(tx, whaleThresholdSats)) rules.push('whale');
    const coinjoinMeta = classifyCoinjoin(tx, {
      minEqualOutputs: config.coinjoinMinEqualOutputs,
      minDenominationSats: btcToSats(config.coinjoinMinDenominationBtc),
    });
    if (coinjoinMeta !== null) rules.push('coinjoin');
    if (deps.addressInfo && tx.totalOutputSats >= dormantMinValueSats && dormantBudget > 0) {
      dormantBudget--;
      const hit = await dormantWake(tx, {
        minValueSats: dormantMinValueSats,
        dormantBlocks: config.dormantBlocks,
        tipHeight,
        getAddressActivity: (address) => deps.addressInfo!.getAddressActivity(address),
      });
      if (hit) rules.push('dormant-wake');
    }
    return { rules, coinjoinMeta };
  }

  function linkCoinjoinRound(tx: NormalizedTx, kind: CoinjoinMeta['kind']): void {
    const inputAddresses = tx.inputs
      .map((input) => input.address)
      .filter((address): address is string => address !== null);
    const prior = findCoinjoinEventByOutputAddress(db, inputAddresses, tx.txid);
    const priorBatch = prior === null ? null : findBatchByTxid(db, prior.txid);
    let batchId: string;
    let linkReason: string;
    if (prior !== null && priorBatch !== null) {
      batchId = priorBatch.id;
      linkReason = `round chain: spends output of ${prior.txid}`;
    } else {
      const batch = insertBatch(db, {
        kind: 'coinjoin-round',
        title: `Coinjoin round (${kind})`,
        source: 'auto',
      });
      if (batch === null) return;
      batchId = batch.id;
      linkReason = 'round';
    }
    addBatchTx(db, { batchId, txid: tx.txid, valueSats: tx.totalOutputSats, linkReason });
  }

  /** Evaluate one transaction and, if it trips a rule, store and announce it. */
  async function ingest(tx: SourceTx, tipHeight: number): Promise<void> {
    if (tx.isCoinbase) return;
    const normalized = toNormalized(tx);
    const { rules, coinjoinMeta } = await evaluateRules(normalized, tipHeight);
    if (rules.length === 0) return;

    const { row, inserted } = insertEvent(db, {
      txid: tx.txid,
      rules,
      valueSats: normalized.totalOutputSats,
      inputs: normalized.inputs,
      outputs: normalized.outputs,
    });
    if (!inserted || !row) return;

    const meta: EventMeta = { entropy: entropyFor(tx) };
    if (coinjoinMeta !== null) meta.coinjoin = coinjoinMeta;
    if (tx.feeSats > 0) meta.feeSats = tx.feeSats;
    let finalRow = setEventMeta(db, row.id, meta) ?? row;

    if (coinjoinMeta !== null) linkCoinjoinRound(normalized, coinjoinMeta.kind);

    // block-scanned transactions are already mined; record that up front so the
    // UI never shows a confirmed transaction as pending
    if (tx.confirmed && tx.blockHash) {
      finalRow =
        setEventConfirmed(db, row.id, {
          blockHeight: tx.blockHeight,
          blockHash: tx.blockHash,
          blockTime: tx.blockTime,
        }) ?? finalRow;
    }

    log(`pipeline: event detected txid=${tx.txid} rules=${rules.join(',')}`);
    emitter.emit('event:new', finalRow);
  }

  async function ingestMany(txs: SourceTx[], tipHeight: number): Promise<void> {
    for (let i = 0; i < txs.length; i += FETCH_CONCURRENCY) {
      await Promise.all(txs.slice(i, i + FETCH_CONCURRENCY).map((tx) => ingest(tx, tipHeight)));
    }
  }

  async function fetchAndIngest(txids: string[], tipHeight: number): Promise<void> {
    for (let i = 0; i < txids.length; i += FETCH_CONCURRENCY) {
      const batch = txids.slice(i, i + FETCH_CONCURRENCY);
      const txs = await Promise.all(
        batch.map(async (txid) => {
          try {
            return await source.getTx(txid);
          } catch (err) {
            warn(`pipeline: fetch ${txid} failed: ${errMessage(err)}`);
            return null;
          }
        }),
      );
      await ingestMany(txs.filter((tx): tx is SourceTx => tx !== null), tipHeight);
    }
  }

  /**
   * Walk a bounded number of pages of confirmed blocks, resuming where the last
   * poll left off so a full block gets covered across several cycles without
   * bursting requests at the explorer.
   */
  async function scanBlocks(tipHeight: number): Promise<void> {
    /** point the cursor at a block, or clear it when there is nothing to scan */
    const openBlock = async (height: number): Promise<boolean> => {
      if (height > tipHeight) {
        scanCursor = null;
        return false;
      }
      const block = await source.blockAt(height);
      if (block === null) {
        scanCursor = null;
        return false;
      }
      scanCursor = { height: block.height, hash: block.hash, index: 0, txCount: block.txCount };
      log(`pipeline: scanning block ${block.height} (${block.txCount} txs)`);
      return true;
    };

    for (let page = 0; page < BLOCK_PAGES_PER_POLL; page++) {
      if (scanCursor === null && !(await openBlock(tipHeight))) return;
      const cursor = scanCursor!;

      if (cursor.index >= cursor.txCount) {
        // block finished; if the chain has run ahead of us, jump to the tip
        // rather than crawling — recent activity matters more than backfill
        const next = cursor.height + 1;
        if (tipHeight - next > 2) {
          warn(`pipeline: scanner ${tipHeight - next} blocks behind, skipping ahead to ${tipHeight}`);
          if (!(await openBlock(tipHeight))) return;
        } else if (!(await openBlock(next))) {
          return;
        }
        continue;
      }

      const txs = await source.blockTxPage(cursor.hash, cursor.index);
      // Esplora pages are fixed-width; always advance by a whole page so the
      // next start index stays on the page boundary the API requires
      cursor.index += BLOCK_PAGE_SIZE;
      if (txs.length === 0) {
        cursor.index = cursor.txCount;
        continue;
      }
      await ingestMany(
        txs.filter((tx) => remember(tx.txid)),
        tipHeight,
      );
    }
  }

  /** Confirm or evict events we previously saw unconfirmed. */
  async function confirmationSweep(mempool: Set<string> | null): Promise<void> {
    const rows = listSweepableEvents(db);
    for (let i = 0; i < rows.length; i += FETCH_CONCURRENCY) {
      await Promise.all(
        rows.slice(i, i + FETCH_CONCURRENCY).map(async (row) => {
          // with a complete mempool, still-pending transactions need no lookup
          if (mempool !== null && mempool.has(row.txid)) return;
          let tx: SourceTx | null;
          try {
            tx = await source.getTx(row.txid);
          } catch (err) {
            warn(`pipeline: sweep ${row.txid} failed: ${errMessage(err)}`);
            return;
          }
          const confirmed = tx !== null && tx.confirmed && tx.blockHash !== null;
          // Gone from the source entirely, or absent from a mempool we can see
          // in full and not mined: either way it will never confirm.
          if (!confirmed && (tx === null || mempool !== null)) {
            const evicted = setEventStatus(db, row.id, 'evicted');
            if (evicted) {
              log(`pipeline: event ${row.txid} -> evicted`);
              emitter.emit('event:update', evicted);
            }
            return;
          }
          if (!confirmed || tx === null || tx.blockHash === null) return; // still pending
          const updated = setEventConfirmed(db, row.id, {
            blockHeight: tx.blockHeight,
            blockHash: tx.blockHash,
            blockTime: tx.blockTime,
          });
          if (updated) {
            log(`pipeline: event ${row.txid} -> confirmed in block ${tx.blockHeight ?? '?'}`);
            emitter.emit('event:update', updated);
          }
        }),
      );
    }
  }

  async function poll(): Promise<void> {
    if (polling) return;
    polling = true;
    dormantBudget = DORMANT_LOOKUP_BUDGET;
    try {
      const tipHeight = await source.tipHeight();
      const txids = await source.recentMempoolTxids();
      const mempool = new Set(txids);

      if (source.mempoolIsComplete) {
        // first cycle establishes a baseline so we do not replay the whole mempool
        if (prevMempool === null) {
          prevMempool = mempool;
          lastPoll = new Date().toISOString();
          log(`pipeline: baseline snapshot (${mempool.size} txs)`);
          return;
        }
        const newcomers = [...mempool].filter((txid) => !prevMempool!.has(txid));
        await fetchAndIngest(newcomers, tipHeight);
        prevMempool = mempool;
      } else {
        await fetchAndIngest([...mempool].filter((txid) => remember(txid)), tipHeight);
      }

      if (scansBlocks) await scanBlocks(tipHeight);
      await confirmationSweep(source.mempoolIsComplete ? mempool : null);
      lastPoll = new Date().toISOString();
    } catch (err) {
      warn(`pipeline: poll failed, will retry next interval: ${errMessage(err)}`);
    } finally {
      polling = false;
    }
  }

  return {
    emitter,
    poll,
    lastPollAt: () => lastPoll,
    sourceName: () => source.name,
  };
}

function requireRpc(deps: PipelineDeps): BitcoinRpc {
  if (!deps.rpc) throw new Error('pipeline: either a chain source or an rpc client is required');
  return deps.rpc;
}
