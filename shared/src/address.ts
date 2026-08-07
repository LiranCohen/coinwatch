/**
 * Bitcoin address validation for search input.
 *
 * Shape matching is not enough here: a mistyped address almost always keeps a
 * plausible shape, and only the checksum catches it. Base58Check addresses are
 * verified against their double-SHA256 checksum, segwit addresses against
 * BIP-173 (bech32, witness v0) or BIP-350 (bech32m, witness v1+).
 *
 * SHA-256 is implemented here instead of imported from 'node:crypto' because
 * this package is bundled into the browser app as well as the Bun server, and
 * Vite replaces node: builtins with an empty object for the browser build —
 * createHash would be undefined at runtime. A local implementation also keeps
 * validateBitcoinAddress synchronous, which Web Crypto's digest() would not.
 */

export type BitcoinAddressKind = 'p2pkh' | 'p2sh' | 'p2wpkh' | 'p2wsh' | 'p2tr';
export type BitcoinNetwork = 'mainnet' | 'testnet' | 'regtest';

export interface AddressValidation {
  valid: boolean;
  kind: BitcoinAddressKind | null;
  network: BitcoinNetwork | null;
  /** canonical form (bech32/bech32m lowercased; base58 unchanged); null when invalid */
  normalized: string | null;
  /** short human-readable explanation when invalid; null when valid */
  reason: string | null;
}

export type SearchTarget =
  | { kind: 'address'; value: string; validation: AddressValidation }
  | { kind: 'txid'; value: string }
  | { kind: 'invalid'; value: string; reason: string };

const BASE58_CHARSET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

/** BIP-173 checksum constant, mandatory for witness v0 */
const BECH32_CONSTANT = 1;
/** BIP-350 checksum constant, mandatory for witness v1..v16 */
const BECH32M_CONSTANT = 0x2bc830a3;

const MAX_BECH32_LENGTH = 90;
const CHECKSUM_LENGTH = 6;
const HASH160_LENGTH = 20;

/**
 * Base58 decoding is quadratic in the input length, and this runs on a request
 * path, so oversized input is refused before any decoding starts. The longest
 * address that can possibly be valid is a 90-character bech32 string.
 */
const MAX_ADDRESS_LENGTH = 128;

const BASE58_VERSIONS = new Map<number, { kind: BitcoinAddressKind; network: BitcoinNetwork }>([
  [0x00, { kind: 'p2pkh', network: 'mainnet' }],
  [0x05, { kind: 'p2sh', network: 'mainnet' }],
  // testnet, signet and regtest all share these two version bytes, so a base58
  // address carries no way to tell them apart; 'testnet' stands for all three
  [0x6f, { kind: 'p2pkh', network: 'testnet' }],
  [0xc4, { kind: 'p2sh', network: 'testnet' }],
]);

const SEGWIT_PREFIXES = new Map<string, BitcoinNetwork>([
  ['bc', 'mainnet'],
  ['tb', 'testnet'],
  ['bcrt', 'regtest'],
]);

const TXID_PATTERN = /^[0-9a-fA-F]{64}$/;
const BITCOIN_URI_PATTERN = /^bitcoin:(\/\/)?/i;

const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function rotateRight(value: number, bits: number): number {
  return ((value >>> bits) | (value << (32 - bits))) >>> 0;
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0
  );
}

function writeUint32BE(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

function sha256(message: Uint8Array): Uint8Array {
  const state = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const blockCount = Math.floor((message.length + 8) / 64) + 1;
  const padded = new Uint8Array(blockCount * 64);
  padded.set(message);
  padded[message.length] = 0x80;
  const bitLength = message.length * 8;
  writeUint32BE(padded, padded.length - 8, Math.floor(bitLength / 0x100000000));
  writeUint32BE(padded, padded.length - 4, bitLength >>> 0);

  const schedule = new Array<number>(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) {
      schedule[i] = readUint32BE(padded, offset + i * 4);
    }
    for (let i = 16; i < 64; i++) {
      const previous = schedule[i - 15];
      const recent = schedule[i - 2];
      const s0 = rotateRight(previous, 7) ^ rotateRight(previous, 18) ^ (previous >>> 3);
      const s1 = rotateRight(recent, 17) ^ rotateRight(recent, 19) ^ (recent >>> 10);
      schedule[i] = (schedule[i - 16] + s0 + schedule[i - 7] + s1) >>> 0;
    }

    let a = state[0];
    let b = state[1];
    let c = state[2];
    let d = state[3];
    let e = state[4];
    let f = state[5];
    let g = state[6];
    let h = state[7];

    for (let i = 0; i < 64; i++) {
      const s1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + choice + SHA256_K[i] + schedule[i]) >>> 0;
      const s0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    state[0] = (state[0] + a) >>> 0;
    state[1] = (state[1] + b) >>> 0;
    state[2] = (state[2] + c) >>> 0;
    state[3] = (state[3] + d) >>> 0;
    state[4] = (state[4] + e) >>> 0;
    state[5] = (state[5] + f) >>> 0;
    state[6] = (state[6] + g) >>> 0;
    state[7] = (state[7] + h) >>> 0;
  }

  const digest = new Uint8Array(32);
  for (let i = 0; i < 8; i++) {
    writeUint32BE(digest, i * 4, state[i]);
  }
  return digest;
}

function rejected(reason: string): AddressValidation {
  return { valid: false, kind: null, network: null, normalized: null, reason };
}

function accepted(kind: BitcoinAddressKind, network: BitcoinNetwork, normalized: string): AddressValidation {
  return { valid: true, kind, network, normalized, reason: null };
}

function base58Decode(input: string): Uint8Array | null {
  const bytes: number[] = [];
  for (const character of input) {
    const digit = BASE58_CHARSET.indexOf(character);
    if (digit < 0) return null;
    let carry = digit;
    for (let i = bytes.length - 1; i >= 0; i--) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>>= 8;
    }
    while (carry > 0) {
      bytes.unshift(carry & 0xff);
      carry >>>= 8;
    }
  }
  // a leading '1' is the base58 digit zero, which the loop above cannot
  // distinguish from absent; each one stands for one leading zero byte
  let leadingZeros = 0;
  while (leadingZeros < input.length && input[leadingZeros] === '1') {
    leadingZeros++;
  }
  const decoded = new Uint8Array(leadingZeros + bytes.length);
  decoded.set(bytes, leadingZeros);
  return decoded;
}

function decodeBase58Address(address: string): AddressValidation {
  const decoded = base58Decode(address);
  if (decoded === null) return rejected('contains a character that is not valid base58');
  if (decoded.length < 5) return rejected('too short to be a bitcoin address');

  const body = decoded.subarray(0, decoded.length - 4);
  const checksum = decoded.subarray(decoded.length - 4);
  const expected = sha256(sha256(body));
  for (let i = 0; i < 4; i++) {
    if (checksum[i] !== expected[i]) return rejected('base58 checksum does not match');
  }

  const version = BASE58_VERSIONS.get(body[0]);
  if (version === undefined) return rejected('unknown address version byte');
  if (body.length - 1 !== HASH160_LENGTH) return rejected('address payload must be 20 bytes');

  return accepted(version.kind, version.network, address);
}

interface Bech32Decoded {
  hrp: string;
  /** 5-bit groups, checksum removed */
  data: number[];
  isBech32m: boolean;
}

function bech32Polymod(values: number[]): number {
  const generator = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let checksum = 1;
  for (const value of values) {
    const top = checksum >>> 25;
    checksum = ((checksum & 0x1ffffff) << 5) ^ value;
    for (let i = 0; i < 5; i++) {
      if ((top >>> i) & 1) checksum ^= generator[i];
    }
  }
  return checksum >>> 0;
}

function bech32HrpExpand(hrp: string): number[] {
  const expanded: number[] = [];
  for (let i = 0; i < hrp.length; i++) {
    expanded.push(hrp.charCodeAt(i) >>> 5);
  }
  expanded.push(0);
  for (let i = 0; i < hrp.length; i++) {
    expanded.push(hrp.charCodeAt(i) & 31);
  }
  return expanded;
}

/**
 * BIP-173 forbids mixing so that the checksum, which is computed over one case
 * only, cannot be made to pass for two different-looking strings. Base58Check
 * has no such rule and mixes case by construction, so this doubles as the test
 * for which of the two encodings a string can possibly be.
 */
function mixesCase(value: string): boolean {
  let hasLower = false;
  let hasUpper = false;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0x61 && code <= 0x7a) hasLower = true;
    else if (code >= 0x41 && code <= 0x5a) hasUpper = true;
    if (hasLower && hasUpper) return true;
  }
  return false;
}

function bech32Decode(input: string): Bech32Decoded | string {
  if (input.length > MAX_BECH32_LENGTH) return `longer than ${MAX_BECH32_LENGTH} characters`;

  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    if (code < 33 || code > 126) return 'contains a character that is not allowed';
  }
  if (mixesCase(input)) return 'mixes upper and lower case';

  const lowered = input.toLowerCase();
  const separator = lowered.lastIndexOf('1');
  if (separator < 0) return "missing the '1' separator";
  if (separator === 0) return 'missing the network prefix';
  if (lowered.length - separator - 1 < CHECKSUM_LENGTH) return 'checksum is too short';

  const hrp = lowered.slice(0, separator);
  const data: number[] = [];
  for (const character of lowered.slice(separator + 1)) {
    const value = BECH32_CHARSET.indexOf(character);
    if (value < 0) return 'contains a character that is not valid bech32';
    data.push(value);
  }

  const polymod = bech32Polymod([...bech32HrpExpand(hrp), ...data]);
  if (polymod !== BECH32_CONSTANT && polymod !== BECH32M_CONSTANT) return 'checksum does not match';

  return { hrp, data: data.slice(0, data.length - CHECKSUM_LENGTH), isBech32m: polymod === BECH32M_CONSTANT };
}

/** regroups 5-bit bech32 data into bytes, rejecting any padding a real encoder would not emit */
function convertBits(data: number[], fromBits: number, toBits: number): number[] | null {
  const maxValue = (1 << toBits) - 1;
  const maxAccumulator = (1 << (fromBits + toBits - 1)) - 1;
  let accumulator = 0;
  let bits = 0;
  const result: number[] = [];
  for (const value of data) {
    accumulator = ((accumulator << fromBits) | value) & maxAccumulator;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      result.push((accumulator >>> bits) & maxValue);
    }
  }
  if (bits >= fromBits || ((accumulator << (toBits - bits)) & maxValue) !== 0) return null;
  return result;
}

function segwitKind(version: number, programLength: number): BitcoinAddressKind | string {
  if (version === 0) {
    if (programLength === 20) return 'p2wpkh';
    if (programLength === 32) return 'p2wsh';
    return 'witness version 0 program must be 20 or 32 bytes';
  }
  if (version === 1) {
    if (programLength === 32) return 'p2tr';
    return 'witness version 1 program must be 32 bytes';
  }
  // v2..v16 are reserved for future soft forks and have no address type this
  // app can render or track, so they are refused rather than surfaced untyped
  return `witness version ${version} is not a supported address type`;
}

function decodeSegwitAddress(address: string): AddressValidation {
  const decoded = bech32Decode(address);
  if (typeof decoded === 'string') return rejected(decoded);

  const network = SEGWIT_PREFIXES.get(decoded.hrp);
  if (network === undefined) return rejected(`unknown network prefix '${decoded.hrp}'`);
  if (decoded.data.length === 0) return rejected('missing the witness version');

  const version = decoded.data[0];
  if (version > 16) return rejected('witness version is out of range');

  const program = convertBits(decoded.data.slice(1), 5, 8);
  if (program === null) return rejected('witness program has invalid padding');
  if (program.length < 2 || program.length > 40) return rejected('witness program must be 2 to 40 bytes');

  // the whole point of BIP-350: the constant is bound to the witness version,
  // so a v0 address re-encoded as bech32m (or the reverse) must not validate
  if (version === 0 && decoded.isBech32m) {
    return rejected('witness version 0 must use bech32, not bech32m');
  }
  if (version > 0 && !decoded.isBech32m) {
    return rejected(`witness version ${version} must use bech32m, not bech32`);
  }

  const kind = segwitKind(version, program.length);
  if (kind === 'p2wpkh' || kind === 'p2wsh' || kind === 'p2tr') {
    return accepted(kind, network, address.toLowerCase());
  }
  return rejected(kind);
}

/**
 * Decides which decoder's complaint to surface when neither accepts the input.
 * A bitcoin HRP settles it outright, since no base58 address can start with
 * one — including when the case is mixed, where naming the case is the useful
 * answer. Failing that, mixed case rules bech32 out entirely, and ruling it out
 * matters here: typing '1' for 'i' or 'l' is the commonest base58 typo, it is
 * why base58 omits 'l' and 'I' in the first place, and it drags the apparent
 * separator to the end of the string, leaving a short tail that the charset
 * test below almost always waves through. Only once case has cleared the string
 * for bech32 is that tail worth consulting: the bech32 charset excludes 'b',
 * 'i' and 'o', which base58 addresses use freely.
 */
function looksLikeBech32(address: string): boolean {
  const lowered = address.toLowerCase();
  for (const prefix of SEGWIT_PREFIXES.keys()) {
    if (lowered.startsWith(`${prefix}1`)) return true;
  }
  if (mixesCase(address)) return false;
  const separator = lowered.lastIndexOf('1');
  const tail = separator < 0 ? lowered : lowered.slice(separator + 1);
  if (tail.length === 0) return false;
  for (const character of tail) {
    if (!BECH32_CHARSET.includes(character)) return false;
  }
  return true;
}

export function validateBitcoinAddress(input: string): AddressValidation {
  const address = input.trim();
  if (address.length === 0) return rejected('enter an address');
  if (address.length > MAX_ADDRESS_LENGTH) return rejected('too long to be a bitcoin address');

  const segwit = decodeSegwitAddress(address);
  if (segwit.valid) return segwit;

  const base58 = decodeBase58Address(address);
  if (base58.valid) return base58;

  return looksLikeBech32(address) ? segwit : base58;
}

export function isBitcoinAddress(input: string): boolean {
  return validateBitcoinAddress(input).valid;
}

export function isTxid(input: string): boolean {
  return TXID_PATTERN.test(input.trim());
}

/** wallets and explorers hand out BIP-21 URIs, and users paste them whole */
function stripBitcoinUri(input: string): string {
  const withoutScheme = input.replace(BITCOIN_URI_PATTERN, '');
  const query = withoutScheme.indexOf('?');
  return (query < 0 ? withoutScheme : withoutScheme.slice(0, query)).trim();
}

const LINK_REASON = 'that link does not contain a recognisable address or transaction id';

function percentDecode(value: string): string {
  if (!value.includes('%')) return value;
  try {
    return decodeURIComponent(value);
  } catch {
    // a stray '%' is not an escape sequence; the raw text is still the best
    // candidate, and decodeURIComponent is the only thing here that can throw
    return value;
  }
}

/**
 * A block explorer link is the commonest way an address reaches the clipboard,
 * so the whole URL is what reaches the search box.
 *
 * Only the last path segment is taken as the candidate: every explorer puts the
 * address or txid at the end of the route, and something address-shaped earlier
 * in a path belongs to the route rather than to the lookup, so searching for it
 * would answer a question nobody asked. Returns null when the input is not
 * link-shaped at all, and '' when it is a link with no segment to offer.
 *
 * The URL constructor is deliberately not used: it throws on scheme-less input,
 * which is exactly the shape a paste from a browser address bar often has.
 */
function extractLinkToken(input: string): string | null {
  const path = input.split('#')[0].split('?')[0];
  if (!path.includes('/')) return null;
  const segments = path.split('/');
  for (let i = segments.length - 1; i >= 0; i--) {
    const segment = segments[i].trim();
    if (segment.length > 0) return percentDecode(segment);
  }
  return '';
}

/** full validation, no shortcuts: the token from a link earns nothing extra */
function classifyToken(token: string): SearchTarget {
  if (isTxid(token)) {
    return { kind: 'txid', value: token.toLowerCase() };
  }

  const validation = validateBitcoinAddress(token);
  if (validation.valid && validation.normalized !== null) {
    return { kind: 'address', value: validation.normalized, validation };
  }
  return {
    kind: 'invalid',
    value: token,
    reason: validation.reason ?? 'not a bitcoin address or transaction id',
  };
}

export function classifySearchInput(raw: string): SearchTarget {
  const cleaned = stripBitcoinUri(raw.trim());
  if (cleaned.length === 0) {
    return { kind: 'invalid', value: cleaned, reason: 'enter an address or transaction id' };
  }

  // no address or txid can contain '/', so what the user typed is classified
  // first and link extraction only ever sees input nothing else could explain
  const direct = classifyToken(cleaned);
  if (direct.kind !== 'invalid') return direct;

  const token = extractLinkToken(cleaned);
  if (token === null) return direct;

  const fromLink = classifyToken(token);
  if (fromLink.kind !== 'invalid') return fromLink;
  // the decoder's complaint describes the segment, not what was pasted: telling
  // someone their checksum is broken when they handed over a URL is a lie about
  // where the fault is, and sends them looking at an address that is likely fine
  return { kind: 'invalid', value: cleaned, reason: LINK_REASON };
}
