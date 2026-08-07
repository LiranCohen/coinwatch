import { DidDht, DidJwk, UniversalResolver } from '@enbox/dids';
import type { DidDocument, DidResolutionResult, DidVerificationMethod } from '@enbox/dids';
import { EdDsaAlgorithm } from '@enbox/crypto';
import type { Database } from 'bun:sqlite';
import { getDidDocument, putDidDocument } from '../store/authQueries';

export interface DidResolverLike {
  resolve(did: string): Promise<DidResolutionResult>;
}

export class DidVerifyError extends Error {
  constructor(
    message: string,
    readonly code: 'resolution-failed' | 'key-not-found' | 'bad-signature',
  ) {
    super(message);
    this.name = 'DidVerifyError';
  }
}

export function createResolver(): UniversalResolver {
  return new UniversalResolver({ didResolvers: [DidJwk, DidDht] });
}

function findVerificationMethod(
  doc: DidDocument,
  keyId: string,
): DidVerificationMethod | null {
  const vms = doc.verificationMethod ?? [];
  const match = vms.find((vm) => vm.id === keyId);
  if (match) return match;
  const fragment = keyId.includes('#') ? keyId.slice(keyId.indexOf('#')) : `#${keyId}`;
  return vms.find((vm) => vm.id.endsWith(fragment)) ?? null;
}

function base64UrlToBytes(value: string): Uint8Array {
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  return new Uint8Array(Buffer.from(padded, 'base64'));
}

export interface VerifyNonceParams {
  db: Database;
  resolver: DidResolverLike;
  did: string;
  keyId: string;
  nonce: string;
  signature: string;
}

export async function verifyDidNonce({
  db,
  resolver,
  did,
  keyId,
  nonce,
  signature,
}: VerifyNonceParams): Promise<true> {
  let document: DidDocument | null = null;
  let resolvedLive = false;
  try {
    const result = await resolver.resolve(did);
    if (result?.didDocument && !result.didResolutionMetadata?.error) {
      document = result.didDocument;
      resolvedLive = true;
    }
  } catch {
    // fall through to cache
  }
  if (!document) {
    const cached = getDidDocument(db, did);
    if (cached) document = cached as DidDocument;
  }
  if (!document) {
    throw new DidVerifyError(`could not resolve DID ${did}`, 'resolution-failed');
  }

  const vm = findVerificationMethod(document, keyId);
  if (!vm?.publicKeyJwk) {
    throw new DidVerifyError(`no verification method ${keyId} on ${did}`, 'key-not-found');
  }

  let signatureBytes: Uint8Array;
  try {
    signatureBytes = base64UrlToBytes(signature);
  } catch {
    throw new DidVerifyError('malformed signature encoding', 'bad-signature');
  }

  const valid = await new EdDsaAlgorithm().verify({
    key: vm.publicKeyJwk,
    signature: signatureBytes,
    data: new TextEncoder().encode(nonce),
  });
  if (!valid) {
    throw new DidVerifyError('signature verification failed', 'bad-signature');
  }

  if (resolvedLive) {
    putDidDocument(db, did, document);
  }
  return true;
}
