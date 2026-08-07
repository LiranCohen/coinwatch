import type { Context } from 'hono';
import type { Database } from 'bun:sqlite';
import type { Identity } from '@chainwatch/shared';
import { getIdentity, getSession } from '../store/authQueries';

export function resolveBearerIdentity(
  db: Database,
  authorizationHeader: string | undefined,
): Identity | null {
  const token = authorizationHeader?.startsWith('Bearer ')
    ? authorizationHeader.slice('Bearer '.length).trim()
    : null;
  if (!token) return null;
  const session = getSession(db, token);
  return session ? getIdentity(db, session.did) : null;
}

export async function parseJsonBody<T>(c: Context): Promise<T | null> {
  try {
    return await c.req.json<T>();
  } catch {
    return null;
  }
}
