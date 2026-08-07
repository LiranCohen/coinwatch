import { BearerDid, DidDht, DidJwk } from '@enbox/dids';
import type { PortableDid } from '@enbox/dids';

import { base64UrlEncode } from '../lib/format';

const IDENTITY_KEY = 'chainwatch:identity';
const DHT_TIMEOUT_MS = 5000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('did:dht create timed out')), ms)),
  ]);
}

export function hasStoredIdentity(): boolean {
  return localStorage.getItem(IDENTITY_KEY) !== null;
}

export function storedDidUri(): string | null {
  const raw = localStorage.getItem(IDENTITY_KEY);
  if (!raw) return null;
  try {
    return (JSON.parse(raw) as PortableDid).uri ?? null;
  } catch {
    return null;
  }
}

/**
 * One-click account creation (KTD-7): try did:dht (publishes to the enbox
 * gateway) with a short timeout, fall back to fully-offline did:jwk.
 */
export async function createIdentity(): Promise<BearerDid> {
  let did: BearerDid;
  try {
    did = await withTimeout(DidDht.create(), DHT_TIMEOUT_MS);
  } catch {
    did = await DidJwk.create();
  }
  const portableDid = await did.export();
  localStorage.setItem(IDENTITY_KEY, JSON.stringify(portableDid));
  return did;
}

/** Restore from localStorage, choosing the importer by DID method prefix. */
export async function loadIdentity(): Promise<BearerDid | null> {
  const raw = localStorage.getItem(IDENTITY_KEY);
  if (!raw) return null;
  const portableDid = JSON.parse(raw) as PortableDid;
  const method = portableDid.uri.split(':')[1];
  if (method === 'dht') return DidDht.import({ portableDid });
  if (method === 'jwk') return DidJwk.import({ portableDid });
  return BearerDid.import({ portableDid });
}

export function clearIdentity(): void {
  localStorage.removeItem(IDENTITY_KEY);
}

export async function signChallenge(
  did: BearerDid,
  nonce: string,
): Promise<{ keyId: string; signature: string }> {
  const signer = await did.getSigner();
  const signature = await signer.sign({ data: new TextEncoder().encode(nonce) });
  return { keyId: signer.keyId, signature: base64UrlEncode(signature) };
}

/** Portable-DID backup as a downloaded JSON file (R8 portability). */
export function downloadIdentityBackup(): void {
  const raw = localStorage.getItem(IDENTITY_KEY);
  if (!raw) return;
  const blob = new Blob([raw], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'coinwatch-identity.json';
  anchor.click();
  URL.revokeObjectURL(url);
}
