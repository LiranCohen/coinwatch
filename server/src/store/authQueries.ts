import type { Database } from 'bun:sqlite';
import type { Identity } from '@chainwatch/shared';

export interface ChallengeRow {
  nonce: string;
  expires_at: string;
}

export interface SessionRow {
  token: string;
  did: string;
  expires_at: string;
}

export const CHALLENGE_TTL_MS = 5 * 60 * 1000;
export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export function isoFromNow(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

export function insertChallenge(db: Database, nonce: string): ChallengeRow {
  const expiresAt = isoFromNow(CHALLENGE_TTL_MS);
  db.query('INSERT INTO challenges (nonce, expires_at) VALUES (?, ?)').run(nonce, expiresAt);
  return { nonce, expires_at: expiresAt };
}

export function consumeChallenge(db: Database, nonce: string): ChallengeRow | null {
  const row = db.query('DELETE FROM challenges WHERE nonce = ? RETURNING *').get(nonce) as
    | ChallengeRow
    | null;
  if (!row) return null;
  if (row.expires_at <= new Date().toISOString()) return null;
  return row;
}

export function createSession(db: Database, did: string, token: string): SessionRow {
  const expiresAt = isoFromNow(SESSION_TTL_MS);
  db.query('INSERT INTO sessions (token, did, expires_at) VALUES (?, ?, ?)').run(
    token,
    did,
    expiresAt,
  );
  return { token, did, expires_at: expiresAt };
}

export function getSession(db: Database, token: string): SessionRow | null {
  const row = db.query('SELECT * FROM sessions WHERE token = ?').get(token) as SessionRow | null;
  if (!row) return null;
  if (row.expires_at <= new Date().toISOString()) {
    db.query('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  return row;
}

interface IdentityRow {
  did: string;
  handle: string | null;
  reputation: number;
}

function toIdentity(row: IdentityRow): Identity {
  return { did: row.did, handle: row.handle, reputation: row.reputation };
}

export function getIdentity(db: Database, did: string): Identity | null {
  const row = db
    .query('SELECT did, handle, reputation FROM identities WHERE did = ?')
    .get(did) as IdentityRow | null;
  return row ? toIdentity(row) : null;
}

function setHandle(db: Database, did: string, handle: string): void {
  db.query('UPDATE identities SET handle = ? WHERE did = ?').run(handle, did);
}

export function upsertIdentity(db: Database, did: string, handle?: string): Identity {
  db.query('INSERT OR IGNORE INTO identities (did) VALUES (?)').run(did);
  if (handle !== undefined) {
    setHandle(db, did, handle);
  }
  return getIdentity(db, did)!;
}

export function updateIdentityHandle(db: Database, did: string, handle: string): Identity | null {
  setHandle(db, did, handle);
  return getIdentity(db, did);
}

export function getDidDocument(db: Database, did: string): unknown | null {
  const row = db.query('SELECT document FROM did_documents WHERE did = ?').get(did) as
    | { document: string }
    | null;
  if (!row) return null;
  try {
    return JSON.parse(row.document);
  } catch {
    return null;
  }
}

export function putDidDocument(db: Database, did: string, document: unknown): void {
  db.query(
    `INSERT INTO did_documents (did, document, cached_at) VALUES (?, ?, ?)
     ON CONFLICT (did) DO UPDATE SET document = excluded.document, cached_at = excluded.cached_at`,
  ).run(did, JSON.stringify(document), new Date().toISOString());
}
