import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { Database } from 'bun:sqlite';
import type {
  AuthChallengeResponse,
  AuthVerifyRequest,
  AuthVerifyResponse,
  Identity,
} from '@chainwatch/shared';
import {
  consumeChallenge,
  createSession,
  insertChallenge,
  updateIdentityHandle,
  upsertIdentity,
} from '../store/authQueries';
import { parseJsonBody, resolveBearerIdentity } from './http';
import { createResolver, verifyDidNonce, DidVerifyError } from '../identity/verify';
import type { DidResolverLike } from '../identity/verify';

export type AuthEnv = {
  Variables: {
    identity: Identity;
  };
};

export interface AuthAppOptions {
  resolver?: DidResolverLike;
}

export function createAuthMiddleware(db: Database) {
  return createMiddleware<AuthEnv>(async (c, next) => {
    const header = c.req.header('Authorization');
    const hasToken = header?.startsWith('Bearer ') && header.slice('Bearer '.length).trim().length > 0;
    if (!hasToken) {
      return c.json({ error: 'missing bearer token' }, 401);
    }
    const identity = resolveBearerIdentity(db, header);
    if (!identity) {
      return c.json({ error: 'invalid or expired token' }, 401);
    }
    c.set('identity', identity);
    await next();
  });
}

export function createAuthApp(db: Database, options: AuthAppOptions = {}) {
  const resolver = options.resolver ?? createResolver();
  const auth = createAuthMiddleware(db);
  const app = new Hono<AuthEnv>();

  app.post('/api/auth/challenge', (c) => {
    const nonce = crypto.randomUUID();
    const row = insertChallenge(db, nonce);
    const body: AuthChallengeResponse = { nonce: row.nonce, expiresAt: row.expires_at };
    return c.json(body);
  });

  app.post('/api/auth/verify', async (c) => {
    const body = await parseJsonBody<AuthVerifyRequest>(c);
    if (body === null) {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const { did, keyId, nonce, signature, handle } = body;
    if (
      typeof did !== 'string' ||
      typeof keyId !== 'string' ||
      typeof nonce !== 'string' ||
      typeof signature !== 'string'
    ) {
      return c.json({ error: 'did, keyId, nonce and signature are required strings' }, 400);
    }
    if (handle !== undefined && typeof handle !== 'string') {
      return c.json({ error: 'handle must be a string' }, 400);
    }

    if (!consumeChallenge(db, nonce)) {
      return c.json({ error: 'unknown or expired nonce' }, 401);
    }

    try {
      await verifyDidNonce({ db, resolver, did, keyId, nonce, signature });
    } catch (err) {
      if (err instanceof DidVerifyError) {
        return c.json({ error: err.message }, 401);
      }
      throw err;
    }

    const identity = upsertIdentity(db, did, handle);
    const token = crypto.randomUUID();
    createSession(db, did, token);
    const response: AuthVerifyResponse = { token, identity };
    return c.json(response);
  });

  app.get('/api/auth/me', auth, (c) => {
    return c.json(c.get('identity'));
  });

  app.patch('/api/identities/me', auth, async (c) => {
    const body = await parseJsonBody<{ handle?: unknown }>(c);
    if (body === null) {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    if (typeof body.handle !== 'string' || body.handle.length === 0) {
      return c.json({ error: 'handle is required and must be a non-empty string' }, 400);
    }
    const identity = updateIdentityHandle(db, c.get('identity').did, body.handle);
    return c.json(identity);
  });

  return { app };
}
