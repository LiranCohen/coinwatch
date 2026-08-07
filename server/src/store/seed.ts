import type { Database } from 'bun:sqlite';
import { insertLabel } from './db';
import defaultSeedEntries from '../../fixtures/seed-labels.json';

export interface SeedEntry {
  address: string;
  tag: string;
  evidenceUrl: string | null;
}

export interface SeedResult {
  imported: number;
  skipped: number;
}

const BASE58_RE = /^[13][1-9A-HJ-NP-Za-km-z]{25,34}$/;
const BECH32_RE = /^bc1[02-9ac-hj-np-z]{11,87}$/i;

export function isBitcoinAddress(address: unknown): address is string {
  if (typeof address !== 'string') return false;
  if (BASE58_RE.test(address)) return true;
  if (BECH32_RE.test(address) && (address === address.toLowerCase() || address === address.toUpperCase())) {
    return true;
  }
  return false;
}

function isValidEntry(entry: unknown): entry is SeedEntry {
  if (typeof entry !== 'object' || entry === null) return false;
  const e = entry as Record<string, unknown>;
  return (
    isBitcoinAddress(e.address) &&
    typeof e.tag === 'string' &&
    e.tag.length > 0 &&
    (e.evidenceUrl === null || typeof e.evidenceUrl === 'string')
  );
}

export function importSeedEntries(
  db: Database,
  entries: unknown[],
  warn: (message: string) => void = console.warn,
): SeedResult {
  let imported = 0;
  let skipped = 0;
  const importAll = db.transaction((items: unknown[]): void => {
    for (const entry of items) {
      if (!isValidEntry(entry)) {
        skipped += 1;
        warn(`seed: skipping malformed entry ${JSON.stringify(entry)}`);
        continue;
      }
      insertLabel(db, {
        address: entry.address,
        tag: entry.tag,
        evidenceUrl: entry.evidenceUrl,
        authorDid: null,
        source: 'seed',
      });
      imported += 1;
    }
  });
  importAll(entries);
  return { imported, skipped };
}

export function seedDatabase(
  db: Database,
  entries: unknown[] = defaultSeedEntries,
  warn?: (message: string) => void,
): SeedResult {
  return importSeedEntries(db, entries, warn);
}
