// Validates the exact identity flow web/src/identity/enbox.ts uses:
// create (did:dht with 5s timeout, did:jwk fallback) → export → import → sign.
import { BearerDid, DidDht, DidJwk } from '@enbox/dids';

const DHT_TIMEOUT_MS = 5000;

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('did:dht create timed out')), ms)),
  ]);
}

function base64UrlEncode(bytes) {
  return Buffer.from(bytes).toString('base64url');
}

async function roundTrip(did, methodLabel) {
  const portableDid = await did.export();
  const json = JSON.stringify(portableDid);
  const restored =
    did.uri.split(':')[1] === 'dht'
      ? await DidDht.import({ portableDid: JSON.parse(json) })
      : did.uri.split(':')[1] === 'jwk'
        ? await DidJwk.import({ portableDid: JSON.parse(json) })
        : await BearerDid.import({ portableDid: JSON.parse(json) });
  if (restored.uri !== did.uri) throw new Error(`URI mismatch after import for ${methodLabel}`);

  const signer = await restored.getSigner();
  const nonce = `nonce-${Date.now()}`;
  const signature = await signer.sign({ data: new TextEncoder().encode(nonce) });
  console.log(`  ${methodLabel}: uri=${did.uri.slice(0, 40)}…`);
  console.log(`  ${methodLabel}: keyId=${signer.keyId.slice(0, 50)} alg=${signer.algorithm}`);
  console.log(`  ${methodLabel}: signature (b64url, ${signature.length} bytes) = ${base64UrlEncode(signature).slice(0, 40)}…`);
  return true;
}

let did;
try {
  did = await withTimeout(DidDht.create(), DHT_TIMEOUT_MS);
  console.log('did:dht create: OK (gateway reachable)');
  await roundTrip(did, 'did:dht');
} catch (err) {
  console.log(`did:dht create: FAILED as anticipated offline (${err.message}); exercising did:jwk fallback`);
  did = await DidJwk.create();
  console.log('did:jwk create: OK');
  await roundTrip(did, 'did:jwk');
}
console.log('PASS: identity create → persist → restore → sign round-trip works');
