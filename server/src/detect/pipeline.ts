import { EventEmitter } from 'node:events';
import type { Database } from 'bun:sqlite';
import type { Config } from '../config';
import type { CoinjoinMeta, Rule } from '@chainwatch/shared';
import type { BitcoinRpc, VerboseTx } from '../rpc/client';
import type { AddressInfoClient } from '../external/addressinfo';
import { classifyCoinjoin, dormantWake, whale, type NormalizedTx } from './rules';
import { addBatchTx, findBatchByTxid, insertBatch, insertEvent } from '../store/db';
import { findCoinjoinEventByOutputAddress, setEventMeta } from '../store/batchQueries';
import { listSweepableEvents, setEventConfirmed, setEventStatus } from '../store/pipelineQueries';
import { errMessage } from '../util';

const SATS_PER_BTC = 100_000_000;
const FETCH_CONCURRENCY = 8;

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

export interface PipelineDeps {
  db: Database;
  rpc: BitcoinRpc;
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
}

export function createPipeline(deps: PipelineDeps): Pipeline {
  const { db, rpc, config } = deps;
  const emitter = deps.emitter ?? new EventEmitter();
  const log = deps.log ?? ((message: string) => console.log(message));
  const warn = deps.warn ?? ((message: string) => console.warn(message));
  const whaleThresholdSats = btcToSats(config.whaleThresholdBtc);
  const dormantMinValueSats = btcToSats(config.dormantMinValueBtc);

  let prevMempool: Set<string> | null = null;
  let lastPoll: string | null = null;
  let polling = false;

  interface RuleEvaluation {
    rules: Rule[];
    coinjoinMeta: CoinjoinMeta | null;
  }

  async function evaluateRules(tx: NormalizedTx, tipHeight: number): Promise<RuleEvaluation> {
    const rules: Rule[] = [];
    if (whale(tx, whaleThresholdSats)) rules.push('whale');
    const coinjoinMeta = classifyCoinjoin(tx, config.coinjoinMinEqualOutputs);
    if (coinjoinMeta !== null) rules.push('coinjoin');
    if (deps.addressInfo && tx.totalOutputSats >= dormantMinValueSats) {
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

  async function processNewcomer(txid: string, tipHeight: number): Promise<void> {
    let raw: VerboseTx;
    try {
      raw = await rpc.getrawtransaction(txid);
    } catch (err) {
      warn(`pipeline: getrawtransaction(${txid}) failed: ${errMessage(err)}`);
      return;
    }
    const tx = normalizeTx(raw);
    const { rules, coinjoinMeta } = await evaluateRules(tx, tipHeight);
    if (rules.length === 0) return;
    const { row, inserted } = insertEvent(db, {
      txid,
      rules,
      valueSats: tx.totalOutputSats,
      inputs: tx.inputs,
      outputs: tx.outputs,
    });
    if (inserted && row) {
      let finalRow = row;
      if (coinjoinMeta !== null) {
        finalRow = setEventMeta(db, row.id, { coinjoin: coinjoinMeta }) ?? row;
        linkCoinjoinRound(tx, coinjoinMeta.kind);
      }
      log(`pipeline: event detected txid=${txid} rules=${rules.join(',')}`);
      emitter.emit('event:new', finalRow);
    }
  }

  async function processNewcomers(newcomers: string[], tipHeight: number): Promise<void> {
    for (let i = 0; i < newcomers.length; i += FETCH_CONCURRENCY) {
      await Promise.all(
        newcomers.slice(i, i + FETCH_CONCURRENCY).map((txid) => processNewcomer(txid, tipHeight)),
      );
    }
  }

  async function sweepEvent(row: { id: string; txid: string }, mempool: Set<string>): Promise<void> {
    if (mempool.has(row.txid)) return;
    let blockhash: string | null = null;
    try {
      const tx = await rpc.getrawtransaction(row.txid);
      if (typeof tx.blockhash === 'string' && tx.blockhash.length > 0) {
        blockhash = tx.blockhash;
      }
    } catch {
      blockhash = null;
    }
    if (blockhash === null) {
      const evicted = setEventStatus(db, row.id, 'evicted');
      if (evicted) {
        log(`pipeline: event ${row.txid} -> evicted`);
        emitter.emit('event:update', evicted);
      }
      return;
    }
    let blockHeight: number | null = null;
    let blockTime: string | null = null;
    try {
      const block = await rpc.getblock(blockhash);
      blockHeight = block.height;
      if (typeof block.time === 'number') {
        blockTime = new Date(block.time * 1000).toISOString();
      }
    } catch (err) {
      warn(`pipeline: getblock(${blockhash}) failed: ${errMessage(err)}`);
    }
    const updated = setEventConfirmed(db, row.id, { blockHeight, blockHash: blockhash, blockTime });
    if (updated) {
      log(`pipeline: event ${row.txid} -> confirmed`);
      emitter.emit('event:update', updated);
    }
  }

  async function evictionSweep(mempool: Set<string>): Promise<void> {
    const rows = listSweepableEvents(db);
    for (let i = 0; i < rows.length; i += FETCH_CONCURRENCY) {
      await Promise.all(rows.slice(i, i + FETCH_CONCURRENCY).map((row) => sweepEvent(row, mempool)));
    }
  }

  async function poll(): Promise<void> {
    if (polling) return;
    polling = true;
    try {
      const [info, txids] = await Promise.all([rpc.getblockchaininfo(), rpc.getrawmempool()]);
      const mempool = new Set(txids);
      if (prevMempool === null) {
        prevMempool = mempool;
        lastPoll = new Date().toISOString();
        log(`pipeline: baseline snapshot (${mempool.size} txs)`);
        return;
      }
      const newcomers = [...mempool].filter((txid) => !prevMempool!.has(txid));
      await processNewcomers(newcomers, info.blocks);
      await evictionSweep(mempool);
      prevMempool = mempool;
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
  };
}
