/**
 * Chain data sources.
 *
 * The detection pipeline is written against this interface rather than against
 * bitcoind directly, so the same rules run whether transactions come from an
 * operator's own node (the sovereign path) or from public Esplora explorers
 * (the zero-setup path). Explorer output is normalized into the same shape a
 * node produces, so nothing downstream needs to know which one is live.
 */

import type { BitcoinRpc } from '../rpc/client';
import type { EsploraClient, EsploraTx } from './esplora';
import { errMessage } from '../util';

const SATS_PER_BTC = 100_000_000;

/** bitcoind reports values in BTC; everything downstream works in satoshis */
function btcToSats(btc: number): number {
  return Math.round(btc * SATS_PER_BTC);
}

export interface SourceIo {
  address: string | null;
  valueSats: number;
}

export interface SourceTx {
  txid: string;
  inputs: SourceIo[];
  outputs: SourceIo[];
  feeSats: number;
  confirmed: boolean;
  blockHeight: number | null;
  blockHash: string | null;
  /** ISO 8601 */
  blockTime: string | null;
  isCoinbase: boolean;
}

export interface SourceBlock {
  hash: string;
  height: number;
  /** ISO 8601 */
  time: string | null;
  txCount: number;
}

export interface ChainSource {
  readonly name: string;
  /** true when recentMempoolTxids() returns the whole mempool rather than a sample */
  readonly mempoolIsComplete: boolean;
  tipHeight(): Promise<number>;
  blockAt(height: number): Promise<SourceBlock | null>;
  /** one page of a block's transactions; an empty page means the block is exhausted */
  blockTxPage(hash: string, startIndex: number): Promise<SourceTx[]>;
  /** txids currently visible in the mempool; may be a recent sample */
  recentMempoolTxids(): Promise<string[]>;
  /** null when the transaction is unknown to the source (dropped or never seen) */
  getTx(txid: string): Promise<SourceTx | null>;
}

export const BLOCK_PAGE_SIZE = 25;

function fromEsploraTx(tx: EsploraTx): SourceTx {
  return {
    txid: tx.txid,
    inputs: tx.inputs.map((input) => ({ address: input.address, valueSats: input.valueSats })),
    outputs: tx.outputs.map((output) => ({ address: output.address, valueSats: output.valueSats })),
    feeSats: tx.feeSats,
    confirmed: tx.confirmed,
    blockHeight: tx.blockHeight,
    blockHash: tx.blockHash,
    blockTime: tx.blockTime,
    isCoinbase: tx.isCoinbase,
  };
}

export function createEsploraSource(client: EsploraClient): ChainSource {
  return {
    name: 'esplora',
    mempoolIsComplete: false,
    async tipHeight() {
      return client.tipHeight();
    },
    async blockAt(height: number) {
      const hash = await client.blockHashAt(height);
      const block = await client.block(hash);
      return { hash: block.hash, height: block.height, time: block.time, txCount: block.txCount };
    },
    async blockTxPage(hash: string, startIndex: number) {
      const page = await client.blockTxs(hash, startIndex);
      return page.map(fromEsploraTx);
    },
    async recentMempoolTxids() {
      return client.recentMempoolTxids();
    },
    async getTx(txid: string) {
      const tx = await client.tx(txid);
      return tx === null ? null : fromEsploraTx(tx);
    },
  };
}

export function createRpcSource(
  rpc: BitcoinRpc,
  warn: (message: string) => void = (message) => console.warn(message),
): ChainSource {
  const toSourceTx = (
    raw: Awaited<ReturnType<BitcoinRpc['getrawtransaction']>>,
    block: { height: number; time?: number } | null,
  ): SourceTx => {
    const inputs = raw.vin.map((input) => ({
      address: scriptAddress(input.prevout?.scriptPubKey),
      valueSats: btcToSats(input.prevout?.value ?? 0),
    }));
    const outputs = raw.vout.map((output) => ({
      address: scriptAddress(output.scriptPubKey),
      valueSats: btcToSats(output.value),
    }));
    const isCoinbase = raw.vin.length === 1 && raw.vin[0]?.prevout == null && raw.vin[0]?.txid === undefined;
    const totalIn = inputs.reduce((sum, io) => sum + io.valueSats, 0);
    const totalOut = outputs.reduce((sum, io) => sum + io.valueSats, 0);
    return {
      txid: raw.txid,
      inputs,
      outputs,
      feeSats: isCoinbase ? 0 : Math.max(0, totalIn - totalOut),
      confirmed: typeof raw.blockhash === 'string' && raw.blockhash.length > 0,
      blockHeight: block?.height ?? null,
      blockHash: raw.blockhash ?? null,
      blockTime: block?.time ? new Date(block.time * 1000).toISOString() : null,
      isCoinbase,
    };
  };

  return {
    name: 'bitcoind',
    mempoolIsComplete: true,
    async tipHeight() {
      const info = await rpc.getblockchaininfo();
      return info.blocks;
    },
    async blockAt(height: number) {
      const hash = await rpc.getblockhash(height);
      const block = await rpc.getblock(hash);
      return {
        hash: block.hash,
        height: block.height,
        time: typeof block.time === 'number' ? new Date(block.time * 1000).toISOString() : null,
        txCount: block.tx.length,
      };
    },
    async blockTxPage(hash: string, startIndex: number) {
      const block = await rpc.getblock(hash);
      const slice = block.tx.slice(startIndex, startIndex + BLOCK_PAGE_SIZE);
      const txs = await Promise.all(
        slice.map(async (txid) => {
          try {
            const raw = await rpc.getrawtransaction(txid);
            return toSourceTx(raw, { height: block.height, time: block.time });
          } catch {
            return null;
          }
        }),
      );
      return txs.filter((tx): tx is SourceTx => tx !== null);
    },
    async recentMempoolTxids() {
      return rpc.getrawmempool();
    },
    async getTx(txid: string) {
      let raw: Awaited<ReturnType<BitcoinRpc['getrawtransaction']>>;
      try {
        raw = await rpc.getrawtransaction(txid);
      } catch (err) {
        warn(`ingest: getrawtransaction(${txid}) failed: ${errMessage(err)}`);
        return null;
      }
      let block: { height: number; time?: number } | null = null;
      if (typeof raw.blockhash === 'string' && raw.blockhash.length > 0) {
        try {
          const info = await rpc.getblock(raw.blockhash);
          block = { height: info.height, time: info.time };
        } catch (err) {
          // the transaction is still provably mined; we just lack height/time
          warn(`ingest: getblock(${raw.blockhash}) failed: ${errMessage(err)}`);
          block = null;
        }
      }
      return toSourceTx(raw, block);
    },
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

export interface SelectSourceDeps {
  rpc: BitcoinRpc;
  esplora: EsploraClient;
  preference: 'auto' | 'bitcoind' | 'esplora';
  log?: (message: string) => void;
}

/**
 * Pick a source. 'auto' prefers the operator's own node and falls back to public
 * explorers when it cannot be reached, so a misconfigured node degrades to
 * working-with-real-data instead of to silence.
 */
export async function selectChainSource(deps: SelectSourceDeps): Promise<ChainSource> {
  const log = deps.log ?? ((message: string) => console.log(message));
  if (deps.preference === 'esplora') return createEsploraSource(deps.esplora);

  const rpcSource = createRpcSource(deps.rpc);
  try {
    const height = await rpcSource.tipHeight();
    log(`ingest: using bitcoind (tip ${height})`);
    return rpcSource;
  } catch (err) {
    if (deps.preference === 'bitcoind') throw err;
    log(`ingest: bitcoind unreachable (${errMessage(err)}); falling back to public explorers`);
    const esploraSource = createEsploraSource(deps.esplora);
    const height = await esploraSource.tipHeight();
    log(`ingest: using esplora (tip ${height})`);
    return esploraSource;
  }
}
