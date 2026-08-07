/**
 * Recompute stored transaction entropy.
 *
 * Event metadata is written once at ingest, so improvements to the entropy
 * engine do not reach transactions already indexed — leaving the stored figure
 * disagreeing with what the same engine now computes on demand. This rewrites
 * meta.entropy for every event from its stored inputs and outputs. No network
 * access is needed: the values are already in the row.
 *
 *   bun run scripts/backfill-entropy.ts [--db path] [--dry-run]
 */

import { Database } from 'bun:sqlite';
import type { EventMeta } from '@chainwatch/shared';
import { loadConfig } from '../src/config';
import { analyzeBoltzmann } from '../src/analytics/boltzmann';

interface Row {
  id: string;
  txid: string;
  inputs: string;
  outputs: string;
  meta: string | null;
}

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const dbIndex = args.indexOf('--db');
const dbFile = dbIndex >= 0 ? args[dbIndex + 1] : loadConfig().dbFile;

const db = new Database(dbFile);
db.exec('PRAGMA busy_timeout = 5000;');

const rows = db.query('SELECT id, txid, inputs, outputs, meta FROM events').all() as Row[];
const update = db.prepare('UPDATE events SET meta = ? WHERE id = ?');

let rewritten = 0;
let nowAnalyzable = 0;
let unchanged = 0;

for (const row of rows) {
  const inputs = (JSON.parse(row.inputs) as { valueSats: number }[]).map((io) => io.valueSats);
  const outputs = (JSON.parse(row.outputs) as { valueSats: number }[]).map((io) => io.valueSats);
  const meta = (row.meta === null ? {} : JSON.parse(row.meta)) as EventMeta;
  const before = meta.entropy?.status ?? 'absent';

  const result = analyzeBoltzmann(inputs, outputs);
  const next: EventMeta = {
    ...meta,
    entropy: {
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
    },
  };

  if (before !== 'ok' && result.status === 'ok') nowAnalyzable++;
  if (before === result.status && before === 'ok') unchanged++;
  if (!dryRun) update.run(JSON.stringify(next), row.id);
  rewritten++;
}

console.log(
  `${dryRun ? '[dry run] ' : ''}${rewritten} events rewritten; ` +
    `${nowAnalyzable} became analyzable that previously were not`,
);
db.close();
