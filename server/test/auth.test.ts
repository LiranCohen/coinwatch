import { describe, test, expect, beforeEach } from 'bun:test';
import { DidJwk } from '@enbox/dids';
import type { BearerDid, DidResolutionResult } from '@enbox/dids';
import { Hono } from 'hono';
import type { Database } from 'bun:sqlite';
import type { Identity } from '@chainwatch/shared';
import { openDatabase } from '../src/store/db';
import { insertChallenge } from '../src/store/authQueries';
import { createAuthApp, createAuthMiddleware } from '../src/api/auth';
import type { AuthEnv } from '../src/api/auth';
import type { DidResolverLike } from '../src/identity/verify';

let db: Database;
let app: Hono<AuthEnv>;

beforeEach(() => {
  db = openDatabase(':memory:');
  app = createAuthApp(db).app;
});

function bytesToBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function postChallenge(): Promise<{ nonce: string; expiresAt: string }> {
  const res = await app.request('/api/auth/challenge', { method: 'POST' });
  expect(res.status).toBe(200);
  return res.json();
}

async function signNonce(did: BearerDid, nonce: string) {
  const signer = await did.getSigner();
  const sig = await signer.sign({ data: new TextEncoder().encode(nonce) });
  return { keyId: signer.keyId, signature: bytesToBase64Url(sig) };
}

async function postVerify(
  target: Hono<AuthEnv>,
  did: BearerDid,
  nonce: string,
  overrides: { signature?: string; handle?: string } = {},
) {
  const { keyId, signature } = await signNonce(did, nonce);
  return target.request('/api/auth/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      did: did.uri,
      keyId,
      nonce,
      signature: overrides.signature ?? signature,
      ...(overrides.handle !== undefined ? { handle: overrides.handle } : {}),
    }),
  });
}

async function login(did: BearerDid, handle?: string) {
  const { nonce } = await postChallenge();
  const res = await postVerify(app, did, nonce, { handle });
  expect(res.status).toBe(200);
  return (await res.json()) as { token: string; identity: Identity };
}

describe('auth challenge-verify round trip', () => {
  test('real did:jwk signs nonce, verify issues token, /me returns identity', async () => {
    const did = await DidJwk.create();
    const { nonce, expiresAt } = await postChallenge();
    expect(nonce.length).toBeGreaterThan(0);
    expect(Date.parse(expiresAt)).toBeGreaterThan(Date.now());

    const { token, identity } = await login(did, 'alice');
    expect(identity.did).toBe(did.uri);
    expect(identity.handle).toBe('alice');
    expect(identity.reputation).toBe(0);
    expect(token.length).toBeGreaterThan(0);

    const me = await app.request('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(me.status).toBe(200);
    const meIdentity = (await me.json()) as Identity;
    expect(meIdentity.did).toBe(did.uri);
    expect(meIdentity.handle).toBe('alice');
  });

  test('PATCH /api/identities/me updates handle', async () => {
    const did = await DidJwk.create();
    const { token } = await login(did);

    const res = await app.request('/api/identities/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ handle: 'bob' }),
    });
    expect(res.status).toBe(200);
    const identity = (await res.json()) as Identity;
    expect(identity.handle).toBe('bob');
    expect(identity.did).toBe(did.uri);

    const me = await app.request('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(((await me.json()) as Identity).handle).toBe('bob');
  });

  test('second verify for same DID reuses identity and preserves handle', async () => {
    const did = await DidJwk.create();
    await login(did, 'carol');
    const { identity } = await login(did);
    expect(identity.handle).toBe('carol');
  });
});

describe('challenge rules', () => {
  test('reused nonce rejected', async () => {
    const did = await DidJwk.create();
    const { nonce } = await postChallenge();

    const first = await postVerify(app, did, nonce);
    expect(first.status).toBe(200);

    const second = await postVerify(app, did, nonce);
    expect(second.status).toBe(401);
  });

  test('expired nonce rejected', async () => {
    const did = await DidJwk.create();
    const nonce = 'expired-nonce';
    db.query('INSERT INTO challenges (nonce, expires_at) VALUES (?, ?)').run(
      nonce,
      new Date(Date.now() - 1000).toISOString(),
    );

    const res = await postVerify(app, did, nonce);
    expect(res.status).toBe(401);
  });

  test('unknown nonce rejected', async () => {
    const did = await DidJwk.create();
    const res = await postVerify(app, did, 'never-issued');
    expect(res.status).toBe(401);
  });

  test('bad signature rejected with 401', async () => {
    const did = await DidJwk.create();
    const other = await DidJwk.create();
    const { nonce } = await postChallenge();

    const { signature } = await signNonce(other, nonce);
    const signer = await did.getSigner();
    const res = await app.request('/api/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ did: did.uri, keyId: signer.keyId, nonce, signature }),
    });
    expect(res.status).toBe(401);
  });
});

describe('AE3: unauthenticated writes rejected, reads allowed', () => {
  test('protected endpoints return 401 without token, open routes pass', async () => {
    const me = await app.request('/api/auth/me');
    expect(me.status).toBe(401);

    const patch = await app.request('/api/identities/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle: 'mallory' }),
    });
    expect(patch.status).toBe(401);

    const badToken = await app.request('/api/auth/me', {
      headers: { Authorization: 'Bearer not-a-real-token' },
    });
    expect(badToken.status).toBe(401);

    const readApp = new Hono<AuthEnv>();
    readApp.get('/api/events', (c) => c.json({ events: [] }));
    readApp.post('/api/labels', createAuthMiddleware(db), (c) =>
      c.json({ ok: true }, 201),
    );
    const readRes = await readApp.request('/api/events');
    expect(readRes.status).toBe(200);
    const writeRes = await readApp.request('/api/labels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag: 'x' }),
    });
    expect(writeRes.status).toBe(401);
  });
});

describe('KTD-7 DID document cache', () => {
  test('verify succeeds from cache when resolution fails after one live verify', async () => {
    const did = await DidJwk.create();
    await login(did);

    const cached = db.query('SELECT document FROM did_documents WHERE did = ?').get(did.uri) as
      | { document: string }
      | null;
    expect(cached).not.toBeNull();
    expect(JSON.parse(cached!.document).id).toBe(did.uri);

    const failingResolver: DidResolverLike = {
      resolve: () => Promise.reject(new Error('gateway unreachable')),
    };
    const offlineApp = createAuthApp(db, { resolver: failingResolver }).app;

    const { nonce } = await postChallenge();
    const res = await postVerify(offlineApp, did, nonce);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string; identity: Identity };
    expect(body.identity.did).toBe(did.uri);
  });

  test('resolution failure without cached document yields 401', async () => {
    const did = await DidJwk.create();
    const failingResolver: DidResolverLike = {
      resolve: () =>
        Promise.resolve({
          didDocument: null,
          didResolutionMetadata: { error: 'notFound' },
          didDocumentMetadata: {},
        } as DidResolutionResult),
    };
    const offlineApp = createAuthApp(db, { resolver: failingResolver }).app;

    const { nonce } = await postChallenge();
    const res = await postVerify(offlineApp, did, nonce);
    expect(res.status).toBe(401);
  });

  test('inserted challenge helper keeps TTL in the future', () => {
    const row = insertChallenge(db, 'nonce-ttl');
    expect(Date.parse(row.expires_at)).toBeGreaterThan(Date.now());
    expect(Date.parse(row.expires_at)).toBeLessThanOrEqual(Date.now() + 5 * 60 * 1000 + 1000);
  });
});
