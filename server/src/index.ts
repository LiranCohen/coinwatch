import { EventEmitter } from 'node:events';
import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import type { Database } from 'bun:sqlite';
import { loadConfig, type Config } from './config';
import { openDatabase, type EventRow } from './store/db';
import { seedDatabase } from './store/seed';
import { getTopLabelsForAddresses, setEventAiResult } from './store/apiQueries';
import { BitcoinRpcClient } from './rpc/client';
import type { AddressInfoClient } from './external/addressinfo';
import { createEsploraAddressInfo } from './ingest/addressInfo';
import { createPipeline, type Pipeline } from './detect/pipeline';
import { createAiProvider, type AiProvider } from './ai/provider';
import type { Rule } from '@chainwatch/shared';
import { createAuthApp } from './api/auth';
import { createApiRoutes, involvedAddresses, serializeEventSummary } from './api/routes';
import { createSseHub, type SseHub } from './api/sse';
import { createInjectApp } from './api/inject';
import { createAnalystRoutes } from './api/analysts';
import { createEntityRoutes } from './api/entities';
import { createCoinjoinRoutes } from './api/coinjoins';
import { createBatchRoutes } from './api/batches';
import { createBlockRoutes } from './api/blocks';
import { createAddressTxRoutes } from './api/addressTxs';
import { EsploraClient } from './ingest/esplora';
import { selectChainSource } from './ingest/source';

export interface AiPassDeps {
  emitter: EventEmitter;
  db: Database;
  ai: AiProvider;
  log?: (message: string) => void;
}

export function registerAiPass(deps: AiPassDeps): void {
  const log = deps.log ?? ((message: string) => console.log(message));
  deps.emitter.on('event:new', (row: EventRow) => {
    void (async () => {
      const addresses = involvedAddresses(row);
      const matchedLabels = getTopLabelsForAddresses(deps.db, addresses, 3, null).map((l) => ({
        address: l.address,
        tag: l.tag,
        note: l.note,
      }));
      const result = await deps.ai.summarizeEvent({
        rules: JSON.parse(row.rules) as Rule[],
        valueSats: row.value_sats,
        addresses,
        matchedLabels,
      });
      const updated = result.ok
        ? setEventAiResult(deps.db, row.id, 'done', result.summary, result.tag)
        : setEventAiResult(deps.db, row.id, 'failed', null, null);
      if (updated) {
        log(`pipeline: ai pass ${result.ok ? 'done' : 'failed'} for ${row.txid}`);
        deps.emitter.emit('event:update', updated);
      }
    })().catch((err) => {
      console.warn(`ai pass: unexpected failure for ${row.txid}: ${String(err)}`);
    });
  });
}

export function startPipelineLoop(
  pipeline: Pipeline,
  hub: SseHub,
  intervalMs: number,
): () => void {
  const tick = async () => {
    const before = pipeline.lastPollAt();
    await pipeline.poll();
    const after = pipeline.lastPollAt();
    if (after !== null && after !== before) {
      hub.broadcastHealth(after);
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), intervalMs);
  return () => clearInterval(timer);
}

export interface ComposeDeps {
  db: Database;
  config: Config;
  emitter: EventEmitter;
  ai: AiProvider;
  addressInfo: AddressInfoClient | null;
  /** chain data for the block ticker; omitted in tests that don't exercise it */
  esplora?: EsploraClient;
  sourceName?: () => string;
  getRemoteAddress?: (c: Context) => string | undefined;
  log?: (message: string) => void;
}

export function composeApp(deps: ComposeDeps): { app: Hono; hub: SseHub } {
  const { db, config, emitter } = deps;
  const { app: authApp } = createAuthApp(db);
  const hub = createSseHub({
    emitter,
    serializeEvent: (row) => serializeEventSummary(db, row),
  });
  registerAiPass({ emitter, db, ai: deps.ai, log: deps.log });
  const app = new Hono();
  app.use('*', cors({ origin: '*', allowHeaders: ['Content-Type', 'Authorization'], allowMethods: ['GET', 'POST', 'PATCH', 'OPTIONS'] }));
  app.route('/', authApp);
  app.route(
    '/',
    createApiRoutes({ db, hub, config, addressInfo: deps.addressInfo, sourceName: deps.sourceName }),
  );
  app.route('/', createAnalystRoutes(db));
  app.route('/', createEntityRoutes(db));
  app.route('/', createCoinjoinRoutes(db));
  app.route('/', createBatchRoutes(db));
  if (deps.esplora) {
    app.route(
      '/',
      createBlockRoutes({
        esplora: deps.esplora,
        sourceName: deps.sourceName ?? (() => 'esplora'),
      }),
    );
    app.route('/', createAddressTxRoutes({ db, esplora: deps.esplora }));
  }
  app.route('/', hub.app);
  app.route(
    '/',
    createInjectApp({ db, emitter, config, getRemoteAddress: deps.getRemoteAddress }),
  );
  return { app, hub };
}

async function main(): Promise<void> {
  const config = loadConfig();
  const db = openDatabase(config.dbFile);
  const seeded = seedDatabase(db, { demoData: config.demoSeedEnabled });
  console.log(
    `seed: ${seeded.imported} address labels loaded (${seeded.skipped} skipped)` +
      (config.demoSeedEnabled ? ' + demo fixture' : ''),
  );

  const rpc = new BitcoinRpcClient(config);
  // public explorers rate-limit aggressively; pace requests rather than get 429'd
  const esplora = new EsploraClient({
    endpoints: config.chainApis,
    minIntervalMs: 400,
    // A dead endpoint must not eat the whole failover budget: a healthy Esplora
    // answers well under a second, so a short per-request bound with no retry
    // lets the chain reach a working mirror quickly. The client then prefers
    // whichever endpoint last succeeded, so only the first call pays for it.
    timeoutMs: 3000,
    retries: 0,
  });
  const addressInfo = createEsploraAddressInfo(esplora);
  const emitter = new EventEmitter();
  const source = await selectChainSource({ rpc, esplora, preference: config.chainSource });
  const pipeline = createPipeline({ db, source, config, addressInfo, emitter });
  const ai = createAiProvider(config);
  const { app, hub } = composeApp({
    db,
    config,
    emitter,
    ai,
    addressInfo,
    esplora,
    sourceName: pipeline.sourceName,
  });
  const stopPipeline = startPipelineLoop(pipeline, hub, config.pollIntervalMs);

  const server = Bun.serve({
    port: config.port,
    // SSE clients hold the connection open between events, and explorer-backed
    // reads can outlast the 10s default
    idleTimeout: 120,
    fetch: (req, bunServer) => app.fetch(req, { server: bunServer }),
  });
  console.log(
    `chainwatch server: listening on http://localhost:${server.port} ` +
      `(chain=${pipeline.sourceName()}, ai=${ai.name}, injector=${config.injectorEnabled ? 'enabled' : 'disabled'})`,
  );

  const shutdown = () => {
    stopPipeline();
    server.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(`chainwatch server: failed to start: ${String(err)}`);
    process.exit(1);
  });
}
