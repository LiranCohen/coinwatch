import { loadConfig, type Config } from '../config';
import type { AddressActivity } from '../detect/rules';
import { errMessage } from '../util';

export interface ExternalAddressTx {
  txid: string;
  vin?: { prevout?: { scriptpubkey_address?: string } | null }[];
  status?: { confirmed?: boolean; block_height?: number };
}

export interface AddressStats {
  address: string;
  chain_stats?: { tx_count?: number; funded_txo_sum?: number; spent_txo_sum?: number };
  mempool_stats?: { tx_count?: number; funded_txo_sum?: number; spent_txo_sum?: number };
}

export interface AddressInfoClient {
  getAddressTxs(address: string): Promise<ExternalAddressTx[] | null>;
  getAddressStats(address: string): Promise<AddressStats | null>;
  getAddressActivity(address: string): Promise<AddressActivity[] | null>;
}

export interface AddressInfoOptions {
  fetchImpl?: typeof fetch;
  cacheTtlMs?: number;
  now?: () => number;
  warn?: (message: string) => void;
}

const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 1000;
const FETCH_TIMEOUT_MS = 8000;

class RateLimitError extends Error {
  constructor(url: string) {
    super(`addressinfo: HTTP 429 from ${url}`);
    this.name = 'RateLimitError';
  }
}

export function createAddressInfoClient(
  config: Pick<Config, 'mempoolApi' | 'blockstreamApi'> = loadConfig(),
  options: AddressInfoOptions = {},
): AddressInfoClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const now = options.now ?? Date.now;
  const warn = options.warn ?? ((message: string) => console.warn(message));
  const cache = new Map<string, { at: number; data: unknown }>();

  async function getJson(baseUrl: string, path: string): Promise<unknown> {
    const url = `${baseUrl}${path}`;
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (res.status === 429) throw new RateLimitError(url);
    if (!res.ok) throw new Error(`addressinfo: HTTP ${res.status} from ${url}`);
    return res.json();
  }

  function cacheSet(cacheKey: string, data: unknown): void {
    if (cache.size >= MAX_CACHE_ENTRIES && !cache.has(cacheKey)) {
      const nowMs = now();
      for (const [key, entry] of cache) {
        if (nowMs - entry.at >= cacheTtlMs) cache.delete(key);
      }
      if (cache.size >= MAX_CACHE_ENTRIES) cache.clear();
    }
    cache.set(cacheKey, { at: now(), data });
  }

  async function lookup<T>(cacheKey: string, path: string): Promise<T | null> {
    const cached = cache.get(cacheKey);
    if (cached && now() - cached.at < cacheTtlMs) return cached.data as T;
    for (const baseUrl of [config.mempoolApi, config.blockstreamApi]) {
      try {
        const data = (await getJson(baseUrl, path)) as T;
        cacheSet(cacheKey, data);
        return data;
      } catch (err) {
        warn(`addressinfo: ${baseUrl} lookup failed for ${path}: ${errMessage(err)}`);
      }
    }
    warn(`addressinfo: all providers failed for ${path}; skipping address check this cycle`);
    return null;
  }

  return {
    getAddressTxs(address: string): Promise<ExternalAddressTx[] | null> {
      return lookup<ExternalAddressTx[]>(`txs:${address}`, `/address/${address}/txs`);
    },
    getAddressStats(address: string): Promise<AddressStats | null> {
      return lookup<AddressStats>(`stats:${address}`, `/address/${address}`);
    },
    async getAddressActivity(address: string): Promise<AddressActivity[] | null> {
      const txs = await this.getAddressTxs(address);
      if (txs === null) return null;
      return summarizeAddressHistory(address, txs);
    },
  };
}

export function summarizeAddressHistory(address: string, txs: ExternalAddressTx[]): AddressActivity[] {
  return txs.map((tx) => ({
    txid: tx.txid,
    spendsFromAddress: (tx.vin ?? []).some(
      (input) => input.prevout?.scriptpubkey_address === address,
    ),
    blockHeight:
      tx.status?.confirmed && typeof tx.status.block_height === 'number'
        ? tx.status.block_height
        : null,
  }));
}
