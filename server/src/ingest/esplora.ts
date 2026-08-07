import { errMessage } from '../util';

/**
 * Esplora API client (mempool.space / blockstream.info) with endpoint
 * failover, request pacing, TTL caching, timeouts, and retries.
 *
 * Both hosts serve the standard Esplora REST surface under their `/api`
 * base. mempool.space additionally serves extended endpoints under
 * `/api/v1/...` (e.g. `/v1/blocks/{height}` whose `extras.pool.name`
 * carries the mining pool); those are used opportunistically for miner
 * enrichment and never fail a call on their own.
 *
 * All monetary values in Esplora responses (`value`, `fee`,
 * `funded_txo_sum`, ...) are satoshis.
 */

export interface EsploraTxIn {
  txid: string | null;
  vout: number | null;
  address: string | null;
  valueSats: number;
}

export interface EsploraTxOut {
  address: string | null;
  valueSats: number;
  n: number;
}

export interface EsploraTx {
  txid: string;
  /** Coinbase inputs have txid/vout/address null and valueSats 0. */
  inputs: EsploraTxIn[];
  outputs: EsploraTxOut[];
  feeSats: number;
  sizeBytes: number;
  weight: number;
  confirmed: boolean;
  blockHeight: number | null;
  blockHash: string | null;
  /** ISO 8601 timestamp of the containing block, or null if unconfirmed. */
  blockTime: string | null;
  isCoinbase: boolean;
}

export interface EsploraBlock {
  hash: string;
  height: number;
  /** ISO 8601 block timestamp. */
  time: string;
  txCount: number;
  sizeBytes: number;
  weight: number;
  /** Mining pool name from mempool.space extras, when available. */
  miner: string | null;
  /** Median fee rate in sat/vB, when available (mempool.space extras). */
  medianFeeRate: number | null;
}

export interface EsploraAddress {
  address: string;
  /** Confirmed balance (funded minus spent), in sats. */
  balanceSats: number;
  /** Confirmed transaction count. */
  txCount: number;
  totalReceivedSats: number;
  totalSentSats: number;
  unconfirmedTxCount: number;
}

export interface EsploraClientOptions {
  /** Esplora API base URLs, tried in order. Default mempool.space then blockstream.info. */
  endpoints?: string[];
  fetchImpl?: typeof fetch;
  /** Minimum interval between outbound request starts, ms. Default 120. */
  minIntervalMs?: number;
  /** TTL for volatile data (tip, mempool, addresses), ms. Default 60_000. */
  cacheTtlMs?: number;
  /** Cache capacity; oldest entries are evicted first. Default 2000. */
  maxCacheEntries?: number;
  /** Per-request timeout, ms. Default 12_000. */
  timeoutMs?: number;
  /** Extra attempts per endpoint after the first, per request. Default 1. */
  retries?: number;
  /** Injectable clock for tests. Default Date.now. */
  now?: () => number;
}

export const DEFAULT_ESPLORA_ENDPOINTS = ['https://mempool.space/api', 'https://blockstream.info/api'];

const DEFAULT_MIN_INTERVAL_MS = 120;
const DEFAULT_CACHE_TTL_MS = 60_000;
const DEFAULT_MAX_CACHE_ENTRIES = 2000;
const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_RETRIES = 1;
/** Confirmed blocks and confirmed txs are immutable; cache them much longer. */
const IMMUTABLE_CACHE_TTL_MS = 60 * 60 * 1000;
/** Esplora serves block transactions in fixed pages of 25. */
const BLOCK_TXS_PAGE_SIZE = 25;

export class EsploraError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'EsploraError';
  }
}

/** Raw Esplora shapes, as observed live on mempool.space and blockstream.info. */
interface RawVin {
  txid?: string;
  vout?: number;
  prevout?: { scriptpubkey_address?: string; value?: number } | null;
  is_coinbase?: boolean;
}

interface RawVout {
  scriptpubkey_address?: string;
  value?: number;
}

interface RawTxStatus {
  confirmed?: boolean;
  block_height?: number;
  block_hash?: string;
  block_time?: number;
}

interface RawTx {
  txid: string;
  vin?: RawVin[];
  vout?: RawVout[];
  size?: number;
  weight?: number;
  fee?: number;
  status?: RawTxStatus;
}

interface RawBlock {
  id: string;
  height: number;
  timestamp: number;
  tx_count: number;
  size: number;
  weight: number;
}

/** mempool.space `/v1/blocks` entries: RawBlock plus pool/fee extras. */
interface RawV1Block extends RawBlock {
  extras?: {
    pool?: { name?: string };
    medianFee?: number;
  };
}

interface RawAddressStats {
  tx_count?: number;
  funded_txo_sum?: number;
  spent_txo_sum?: number;
}

interface RawAddress {
  address: string;
  chain_stats?: RawAddressStats;
  mempool_stats?: RawAddressStats;
}

interface BlockEnrichment {
  miner: string | null;
  medianFeeRate: number | null;
}

interface RequestOptions {
  parse: 'json' | 'text';
  /** Cache TTL, fixed or derived from the parsed response. */
  ttlMs: number | ((data: unknown) => number);
  /**
   * Treat a 404 as an endpoint failure instead of a definitive answer.
   * Used for mempool.space-only `/v1/...` paths, which plain Esplora
   * hosts (blockstream.info) 404.
   */
  failoverOn404?: boolean;
}

interface CacheEntry {
  at: number;
  ttlMs: number;
  data: unknown;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function unixToIso(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

function normalizeInput(vin: RawVin): EsploraTxIn {
  if (vin.is_coinbase === true) {
    return { txid: null, vout: null, address: null, valueSats: 0 };
  }
  return {
    txid: vin.txid ?? null,
    vout: typeof vin.vout === 'number' ? vin.vout : null,
    address: vin.prevout?.scriptpubkey_address ?? null,
    valueSats: vin.prevout?.value ?? 0,
  };
}

function normalizeTx(raw: RawTx): EsploraTx {
  const vin = raw.vin ?? [];
  const confirmed = raw.status?.confirmed === true;
  return {
    txid: raw.txid,
    inputs: vin.map(normalizeInput),
    outputs: (raw.vout ?? []).map((out, n) => ({
      address: out.scriptpubkey_address ?? null,
      valueSats: out.value ?? 0,
      n,
    })),
    feeSats: raw.fee ?? 0,
    sizeBytes: raw.size ?? 0,
    weight: raw.weight ?? 0,
    confirmed,
    blockHeight: confirmed ? (raw.status?.block_height ?? null) : null,
    blockHash: confirmed ? (raw.status?.block_hash ?? null) : null,
    blockTime:
      confirmed && typeof raw.status?.block_time === 'number' ? unixToIso(raw.status.block_time) : null,
    isCoinbase: vin[0]?.is_coinbase === true,
  };
}

function normalizeBlock(raw: RawBlock, enrichment: BlockEnrichment | null): EsploraBlock {
  return {
    hash: raw.id,
    height: raw.height,
    time: unixToIso(raw.timestamp),
    txCount: raw.tx_count,
    sizeBytes: raw.size,
    weight: raw.weight,
    miner: enrichment?.miner ?? null,
    medianFeeRate: enrichment?.medianFeeRate ?? null,
  };
}

function v1Enrichment(raw: RawV1Block): BlockEnrichment {
  return {
    miner: raw.extras?.pool?.name ?? null,
    medianFeeRate: typeof raw.extras?.medianFee === 'number' ? raw.extras.medianFee : null,
  };
}

function normalizeAddress(raw: RawAddress): EsploraAddress {
  const chain = raw.chain_stats ?? {};
  const mempool = raw.mempool_stats ?? {};
  const received = chain.funded_txo_sum ?? 0;
  const spent = chain.spent_txo_sum ?? 0;
  return {
    address: raw.address,
    balanceSats: received - spent,
    txCount: chain.tx_count ?? 0,
    totalReceivedSats: received,
    totalSentSats: spent,
    unconfirmedTxCount: mempool.tx_count ?? 0,
  };
}

export class EsploraClient {
  private readonly endpoints: string[];
  private readonly fetchImpl: typeof fetch;
  private readonly minIntervalMs: number;
  private readonly cacheTtlMs: number;
  private readonly maxCacheEntries: number;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly now: () => number;

  /** Endpoint that answered most recently; tried first on the next request. */
  private preferredEndpoint: string | null = null;
  /** Serializes outbound requests so pacing applies across concurrent callers. */
  private queue: Promise<void> = Promise.resolve();
  private lastRequestAt = Number.NEGATIVE_INFINITY;
  /** TTL cache keyed by request path (identical resource on every mirror). */
  private readonly cache = new Map<string, CacheEntry>();

  constructor(options: EsploraClientOptions = {}) {
    this.endpoints = options.endpoints ?? DEFAULT_ESPLORA_ENDPOINTS;
    if (this.endpoints.length === 0) throw new EsploraError('esplora: no endpoints configured');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.minIntervalMs = options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.maxCacheEntries = options.maxCacheEntries ?? DEFAULT_MAX_CACHE_ENTRIES;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.retries = options.retries ?? DEFAULT_RETRIES;
    this.now = options.now ?? Date.now;
  }

  /** Current chain tip height. */
  async tipHeight(): Promise<number> {
    const text = await this.getText('/blocks/tip/height', this.cacheTtlMs);
    const height = Number.parseInt(text.trim(), 10);
    if (!Number.isFinite(height)) {
      throw new EsploraError(`esplora: unexpected tip height response: ${text.slice(0, 80)}`);
    }
    return height;
  }

  /**
   * Block hash at a height. Cached with the volatile TTL because the
   * mapping can change near the tip on a reorg.
   */
  async blockHashAt(height: number): Promise<string> {
    const text = await this.getText(`/block-height/${height}`, this.cacheTtlMs);
    const hash = text.trim();
    if (!/^[0-9a-f]{64}$/.test(hash)) {
      throw new EsploraError(`esplora: unexpected block hash response: ${text.slice(0, 80)}`);
    }
    return hash;
  }

  /**
   * The most recent `count` blocks, newest first. Prefers mempool.space
   * `/v1/blocks` pages (15 per page, with miner and median fee rate) and
   * falls back to plain Esplora `/blocks` pages (10 per page, no miner).
   */
  async recentBlocks(count: number): Promise<EsploraBlock[]> {
    if (count <= 0) return [];
    try {
      return await this.pagedBlocks(count, '/v1/blocks', (height) => `/v1/blocks/${height}`, true);
    } catch {
      return this.pagedBlocks(count, '/blocks', (height) => `/blocks/${height}`, false);
    }
  }

  /**
   * A single block by hash, enriched with miner/median-fee extras from
   * mempool.space when reachable. Enrichment failures degrade to nulls.
   */
  async block(hash: string): Promise<EsploraBlock> {
    const raw = (await this.get(`/block/${hash}`, {
      parse: 'json',
      ttlMs: IMMUTABLE_CACHE_TTL_MS,
    })) as RawBlock | null;
    if (raw === null) throw new EsploraError(`esplora: block ${hash} not found`, 404);
    return normalizeBlock(raw, await this.blockEnrichment(raw.height, raw.id));
  }

  /** All txids in a block, in block order. */
  async blockTxids(hash: string): Promise<string[]> {
    const raw = (await this.get(`/block/${hash}/txids`, {
      parse: 'json',
      ttlMs: IMMUTABLE_CACHE_TTL_MS,
    })) as string[] | null;
    if (raw === null) throw new EsploraError(`esplora: block ${hash} not found`, 404);
    return raw;
  }

  /**
   * One Esplora page (25 txs) of a block's transactions starting at
   * `startIndex`, which must be a multiple of 25.
   */
  async blockTxs(hash: string, startIndex: number): Promise<EsploraTx[]> {
    if (!Number.isInteger(startIndex) || startIndex < 0 || startIndex % BLOCK_TXS_PAGE_SIZE !== 0) {
      throw new EsploraError(
        `esplora: startIndex must be a non-negative multiple of ${BLOCK_TXS_PAGE_SIZE}, got ${startIndex}`,
      );
    }
    const raw = (await this.get(`/block/${hash}/txs/${startIndex}`, {
      parse: 'json',
      ttlMs: IMMUTABLE_CACHE_TTL_MS,
    })) as RawTx[] | null;
    if (raw === null) {
      throw new EsploraError(`esplora: block ${hash} txs page ${startIndex} not found`, 404);
    }
    return raw.map(normalizeTx);
  }

  /** A transaction by id, or null if unknown/dropped (HTTP 404). */
  async tx(txid: string): Promise<EsploraTx | null> {
    const raw = (await this.get(`/tx/${txid}`, {
      parse: 'json',
      // A confirmed tx is immutable; an unconfirmed one may confirm soon.
      ttlMs: (data) =>
        (data as RawTx).status?.confirmed === true ? IMMUTABLE_CACHE_TTL_MS : this.cacheTtlMs,
    })) as RawTx | null;
    return raw === null ? null : normalizeTx(raw);
  }

  /** Address summary stats, or null if the host reports it unknown (404). */
  async address(addr: string): Promise<EsploraAddress | null> {
    const raw = (await this.get(`/address/${addr}`, {
      parse: 'json',
      ttlMs: this.cacheTtlMs,
    })) as RawAddress | null;
    return raw === null ? null : normalizeAddress(raw);
  }

  /** Recent transaction history for an address (Esplora's default page: mempool txs plus newest 25 confirmed). */
  async addressTxs(addr: string): Promise<EsploraTx[]> {
    const raw = (await this.get(`/address/${addr}/txs`, {
      parse: 'json',
      ttlMs: this.cacheTtlMs,
    })) as RawTx[] | null;
    if (raw === null) throw new EsploraError(`esplora: address ${addr} not found`, 404);
    return raw.map(normalizeTx);
  }

  /** Txids of the latest transactions to enter the mempool. */
  async recentMempoolTxids(): Promise<string[]> {
    const raw = (await this.get('/mempool/recent', {
      parse: 'json',
      ttlMs: this.cacheTtlMs,
    })) as { txid: string }[] | null;
    if (raw === null) throw new EsploraError('esplora: mempool/recent not found', 404);
    return raw.map((entry) => entry.txid);
  }

  /** Walks block list pages newest-first until `count` blocks are collected. */
  private async pagedBlocks(
    count: number,
    firstPath: string,
    pathAt: (height: number) => string,
    v1: boolean,
  ): Promise<EsploraBlock[]> {
    const blocks: EsploraBlock[] = [];
    let path = firstPath;
    // The first page floats with the tip; pages anchored at a height are stable.
    let ttlMs = this.cacheTtlMs;
    for (;;) {
      const page = (await this.get(path, { parse: 'json', ttlMs, failoverOn404: v1 })) as
        | RawV1Block[]
        | null;
      if (page === null) throw new EsploraError(`esplora: ${path} not found`, 404);
      if (page.length === 0) return blocks;
      for (const raw of page) {
        blocks.push(normalizeBlock(raw, v1 ? v1Enrichment(raw) : null));
        if (blocks.length >= count) return blocks;
      }
      const nextHeight = page[page.length - 1].height - 1;
      if (nextHeight < 0) return blocks;
      path = pathAt(nextHeight);
      ttlMs = IMMUTABLE_CACHE_TTL_MS;
    }
  }

  /**
   * Miner/median-fee extras for a block, from the mempool.space v1 page
   * that starts at its height. Any failure degrades to nulls.
   */
  private async blockEnrichment(height: number, hash: string): Promise<BlockEnrichment | null> {
    try {
      const page = (await this.get(`/v1/blocks/${height}`, {
        parse: 'json',
        ttlMs: IMMUTABLE_CACHE_TTL_MS,
        failoverOn404: true,
      })) as RawV1Block[] | null;
      const match = (page ?? []).find((entry) => entry.id === hash);
      return match ? v1Enrichment(match) : null;
    } catch {
      return null;
    }
  }

  private async getText(path: string, ttlMs: number): Promise<string> {
    const text = (await this.get(path, { parse: 'text', ttlMs })) as string | null;
    if (text === null) throw new EsploraError(`esplora: ${path} not found`, 404);
    return text;
  }

  /**
   * Cached, paced GET with endpoint failover. Returns the parsed body, or
   * null on a definitive 404. Throws EsploraError on other definitive 4xx
   * responses or when every endpoint fails.
   */
  private async get(path: string, opts: RequestOptions): Promise<unknown | null> {
    const cached = this.cacheGet(path);
    if (cached !== undefined) return cached;

    let lastError = 'unreachable';
    for (const endpoint of this.orderedEndpoints()) {
      for (let attempt = 0; attempt <= this.retries; attempt += 1) {
        await this.pace();
        let res: Response;
        try {
          res = await this.fetchImpl(`${endpoint}${path}`, {
            signal: AbortSignal.timeout(this.timeoutMs),
          });
        } catch (err) {
          lastError = `${endpoint}: ${errMessage(err)}`;
          continue;
        }
        if (res.status === 404 && !opts.failoverOn404) {
          // A 404 is a definitive answer about the resource, not an outage.
          this.preferredEndpoint = endpoint;
          return null;
        }
        if (res.status >= 400 && res.status < 500 && res.status !== 404 && res.status !== 429) {
          throw new EsploraError(`esplora: HTTP ${res.status} from ${endpoint}${path}`, res.status);
        }
        if (!res.ok) {
          // 5xx, 429, or a 404 on an optional v1 path: try again / next host.
          lastError = `${endpoint}: HTTP ${res.status}`;
          continue;
        }
        let data: unknown;
        try {
          data = opts.parse === 'text' ? await res.text() : await res.json();
        } catch (err) {
          lastError = `${endpoint}: bad response body: ${errMessage(err)}`;
          continue;
        }
        this.preferredEndpoint = endpoint;
        this.cacheSet(path, data, typeof opts.ttlMs === 'function' ? opts.ttlMs(data) : opts.ttlMs);
        return data;
      }
    }
    throw new EsploraError(`esplora: all endpoints failed for ${path} (last: ${lastError})`);
  }

  /** Configured endpoints, with the last one that answered moved to the front. */
  private orderedEndpoints(): string[] {
    const preferred = this.preferredEndpoint;
    if (preferred === null || this.endpoints[0] === preferred) return this.endpoints;
    return [preferred, ...this.endpoints.filter((endpoint) => endpoint !== preferred)];
  }

  /** Waits for this request's turn, keeping at least minIntervalMs between request starts. */
  private pace(): Promise<void> {
    const turn = this.queue.then(async () => {
      const wait = this.lastRequestAt + this.minIntervalMs - this.now();
      if (wait > 0) await sleep(wait);
      this.lastRequestAt = this.now();
    });
    this.queue = turn.catch(() => undefined);
    return turn;
  }

  private cacheGet(key: string): unknown | undefined {
    const entry = this.cache.get(key);
    if (entry === undefined) return undefined;
    if (this.now() - entry.at >= entry.ttlMs) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.data;
  }

  private cacheSet(key: string, data: unknown, ttlMs: number): void {
    if (!this.cache.has(key) && this.cache.size >= this.maxCacheEntries) {
      const nowMs = this.now();
      for (const [existingKey, entry] of this.cache) {
        if (nowMs - entry.at >= entry.ttlMs) this.cache.delete(existingKey);
      }
      while (this.cache.size >= this.maxCacheEntries) {
        const oldest = this.cache.keys().next();
        if (oldest.done) break;
        this.cache.delete(oldest.value);
      }
    }
    this.cache.delete(key);
    this.cache.set(key, { at: this.now(), ttlMs, data });
  }
}
