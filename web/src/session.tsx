import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import type { Identity } from '@chainwatch/shared';

import { getMe, patchHandle, postChallenge, postVerify } from './api/client';
import {
  createIdentity,
  hasStoredIdentity,
  loadIdentity,
  signChallenge,
} from './identity/enbox';
import { clearToken, getToken, setToken } from './identity/session';

interface SessionContextValue {
  identity: Identity | null;
  token: string | null;
  busy: boolean;
  error: string | null;
  hasIdentity: boolean;
  createAccount: () => Promise<void>;
  signIn: () => Promise<void>;
  signOut: () => void;
  saveHandle: (handle: string) => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

async function login(): Promise<{ token: string; identity: Identity }> {
  const did = await loadIdentity();
  if (!did) throw new Error('no local identity');
  const { nonce } = await postChallenge();
  const { keyId, signature } = await signChallenge(did, nonce);
  return postVerify({ did: did.uri, keyId, nonce, signature });
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [token, setTokenState] = useState<string | null>(getToken());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [identityExists, setIdentityExists] = useState<boolean>(hasStoredIdentity());

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    getMe(token)
      .then((me) => {
        if (!cancelled) setIdentity(me);
      })
      .catch(() => {
        if (cancelled) return;
        clearToken();
        setTokenState(null);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const run = useCallback(async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'something went wrong');
    } finally {
      setBusy(false);
    }
  }, []);

  const createAccount = useCallback(() => {
    return run(async () => {
      await createIdentity();
      setIdentityExists(true);
      const session = await login();
      setToken(session.token);
      setIdentity(session.identity);
      setTokenState(session.token);
    });
  }, [run]);

  const signIn = useCallback(() => {
    return run(async () => {
      const session = await login();
      setToken(session.token);
      setIdentity(session.identity);
      setTokenState(session.token);
    });
  }, [run]);

  const signOut = useCallback(() => {
    clearToken();
    setTokenState(null);
    setIdentity(null);
  }, []);

  const saveHandle = useCallback(
    async (handle: string) => {
      if (!token) return;
      const updated = await patchHandle(handle, token);
      setIdentity(updated);
    },
    [token],
  );

  const value = useMemo<SessionContextValue>(
    () => ({
      identity,
      token,
      busy,
      error,
      hasIdentity: identityExists,
      createAccount,
      signIn,
      signOut,
      saveHandle,
    }),
    [identity, token, busy, error, identityExists, createAccount, signIn, signOut, saveHandle],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside SessionProvider');
  return ctx;
}
