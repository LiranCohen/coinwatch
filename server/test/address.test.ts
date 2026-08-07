import { describe, test, expect } from 'bun:test';
import {
  classifySearchInput,
  isBitcoinAddress,
  isTxid,
  validateBitcoinAddress,
  type AddressValidation,
  type BitcoinAddressKind,
  type BitcoinNetwork,
} from '@chainwatch/shared';

/**
 * Vector sources:
 *  - BIP-173 (bech32, witness v0)  https://github.com/bitcoin/bips/blob/master/bip-0173.mediawiki
 *  - BIP-350 (bech32m, witness v1+) https://github.com/bitcoin/bips/blob/master/bip-0350.mediawiki
 *  - Bitcoin Core src/test/data/key_io_{valid,invalid}.json, which is the only
 *    maintained vector set covering Base58Check and regtest/signet prefixes.
 *
 * Reasons are asserted, not just the valid flag: for a foreign HRP the only
 * observable difference between "checksum passed" and "checksum failed" is
 * whether the rejection names the prefix or the checksum, so those assertions
 * are what actually pin down the bech32/bech32m constants.
 */

const PREFIX_REASON = /unknown network prefix/;

function reasonOf(address: string): string {
  const reason = validateBitcoinAddress(address).reason;
  expect(reason).not.toBeNull();
  return reason ?? '';
}

describe('validateBitcoinAddress: Base58Check', () => {
  test('the genesis coinbase address is a mainnet P2PKH', () => {
    expect(validateBitcoinAddress('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa')).toEqual({
      valid: true,
      kind: 'p2pkh',
      network: 'mainnet',
      normalized: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
      reason: null,
    });
  });

  test('a real mainnet P2SH is recognised and left unchanged by normalisation', () => {
    expect(validateBitcoinAddress('3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy')).toEqual({
      valid: true,
      kind: 'p2sh',
      network: 'mainnet',
      normalized: '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy',
      reason: null,
    });
    expect(validateBitcoinAddress('34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo').kind).toBe('p2sh');
  });

  test('testnet version bytes map to the testnet network', () => {
    expect(validateBitcoinAddress('mzK2FFDEhxqHcmrJw1ysqFkVyhUULo45hZ')).toMatchObject({
      valid: true,
      kind: 'p2pkh',
      network: 'testnet',
    });
    expect(validateBitcoinAddress('2NC2hEhe28ULKAJkW5MjZ3jtTMJdvXmByvK')).toMatchObject({
      valid: true,
      kind: 'p2sh',
      network: 'testnet',
    });
  });

  test('flipping a single character breaks the double-SHA256 checksum', () => {
    // last character, and a character in the middle of the payload
    for (const corrupted of ['1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNb', '1A1yP1eP5QGefi2DMPTfTL5SLmv7DivfNa']) {
      expect(validateBitcoinAddress(corrupted)).toMatchObject({
        valid: false,
        kind: null,
        network: null,
        normalized: null,
      });
      expect(reasonOf(corrupted)).toMatch(/checksum/);
    }
  });

  test('the base58 alphabet excludes 0, O, I and l', () => {
    for (const swapped of ['0', 'O', 'I', 'l']) {
      const address = `1A1zP1eP5QGefi2DMPTfTL5SLmv7Divf${swapped}a`;
      expect(isBitcoinAddress(address)).toBe(false);
    }
    expect(reasonOf('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfOa')).toMatch(/base58/);
  });

  test('oversized input is refused without paying for a quadratic base58 decode', () => {
    // reachable from GET /api/addresses/:address, so it must not block the loop
    const huge = `1${'A'.repeat(60_000)}`;
    const started = Bun.nanoseconds();
    expect(validateBitcoinAddress(huge)).toMatchObject({ valid: false, kind: null });
    expect(reasonOf(huge)).toMatch(/too long/);
    expect((Bun.nanoseconds() - started) / 1e6).toBeLessThan(50);
    // the longest legitimate address is a 90-character bech32 string
    expect(isBitcoinAddress('bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0')).toBe(true);
  });

  test('a well-formed checksum over an unknown version byte is still refused', () => {
    // WIF private key: valid Base58Check, version 0x80, but not an address
    expect(validateBitcoinAddress('5HueCGU8rMjxEXxiPuD5BDku4MkFqeZyd4dZ1jvhTVqvbTLvyTJ')).toMatchObject({
      valid: false,
      kind: null,
    });
    expect(reasonOf('5HueCGU8rMjxEXxiPuD5BDku4MkFqeZyd4dZ1jvhTVqvbTLvyTJ')).toMatch(/version byte|20 bytes/);
  });
});

describe('the rejection names a cause that is actually a cause', () => {
  const REAL_BASE58 = [
    '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
    '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy',
    '34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo',
    'mzK2FFDEhxqHcmrJw1ysqFkVyhUULo45hZ',
    '2NC2hEhe28ULKAJkW5MjZ3jtTMJdvXmByvK',
  ];

  test("typing '1' for 'i', 'l', 'B' or 'o' is diagnosed as base58, not as bech32 case mixing", () => {
    // the single most likely base58 typo: it is why base58 omits 'l' and 'I'.
    // An inserted '1' near the end drags the apparent bech32 separator there,
    // leaving a tail that is entirely within the bech32 charset by luck
    for (const typo of [
      '1A1zP1eP5QGefi2DMPTfTL5SLmv7D1vfNa',
      '3J98t1WpEZ73CNmQviecrny1WrnqRhWNLy',
      '2NC2hEhe28ULKAJkW5MjZ3jtTMJdvXm1yvK',
      'mzK2FFDEhxqHcmrJw1ysqFkVyhUUL145hZ',
    ]) {
      expect(reasonOf(typo)).toBe('base58 checksum does not match');
    }
    // the controls these were derived from mix case and are perfectly valid,
    // which is what makes the case complaint a non-cause for their typos
    for (const address of REAL_BASE58) {
      expect(address).not.toBe(address.toLowerCase());
      expect(address).not.toBe(address.toUpperCase());
      expect(isBitcoinAddress(address)).toBe(true);
    }
  });

  test('no single-character corruption of a base58 address is blamed on bech32 case rules', () => {
    let checked = 0;
    for (const address of REAL_BASE58) {
      for (let i = 0; i < address.length; i++) {
        for (const replacement of '01IlB1io') {
          const corrupted = `${address.slice(0, i)}${replacement}${address.slice(i + 1)}`;
          if (corrupted === address) continue;
          checked++;
          expect(isBitcoinAddress(corrupted)).toBe(false);
          expect(`${corrupted}: ${reasonOf(corrupted)}`).toMatch(/base58/);
        }
      }
    }
    expect(checked).toBeGreaterThan(1_000);
  });

  test('a segwit address really is blamed on case mixing, prefix and all', () => {
    // the case complaint must survive for the strings it does describe,
    // including a mistyped prefix that leaves the address unmistakably bech32
    for (const address of [
      'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kV8f3t4',
      'BC1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
      'Bc1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4',
      'tb1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3q0sL5k7',
      'bcrt1qYlj2wskkfk2xkkbwjq0nvcpwqf5j9vkw6pwqf6',
    ]) {
      expect(reasonOf(address)).toBe('mixes upper and lower case');
    }
  });

  test('the reason reaches the caller through classifySearchInput', () => {
    const target = classifySearchInput('1A1zP1eP5QGefi2DMPTfTL5SLmv7D1vfNa');
    expect(target.kind).toBe('invalid');
    if (target.kind !== 'invalid') throw new Error('unreachable');
    expect(target.reason).toBe('base58 checksum does not match');
  });
});

describe('validateBitcoinAddress: segwit addresses', () => {
  test('mainnet P2WPKH is accepted in either case and normalised to lower case', () => {
    const expected: AddressValidation = {
      valid: true,
      kind: 'p2wpkh',
      network: 'mainnet',
      normalized: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
      reason: null,
    };
    expect(validateBitcoinAddress('BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4')).toEqual(expected);
    expect(validateBitcoinAddress('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4')).toEqual(expected);
  });

  test('mainnet P2WSH and P2TR are distinguished by program length', () => {
    expect(
      validateBitcoinAddress('bc1qyucykdlhp62tezs0hagqury402qwhk589q80tqs5myh3rxq34nwqhkdhv7'),
    ).toMatchObject({ valid: true, kind: 'p2wsh', network: 'mainnet' });
    expect(
      validateBitcoinAddress('bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0'),
    ).toMatchObject({ valid: true, kind: 'p2tr', network: 'mainnet' });
  });

  test('the tb and bcrt prefixes select testnet and regtest', () => {
    expect(validateBitcoinAddress('tb1qcrh3yqn4nlleplcez2yndq2ry8h9ncg3qh7n54')).toMatchObject({
      valid: true,
      kind: 'p2wpkh',
      network: 'testnet',
    });
    expect(validateBitcoinAddress('bcrt1qdavt4j2sd7dlhqsavtnfxvzppw6k7qy97tmnu9')).toMatchObject({
      valid: true,
      kind: 'p2wpkh',
      network: 'regtest',
    });
    expect(
      validateBitcoinAddress('bcrt1pfwxjqvtt4tcxrtdluukfmy2dv7xd2qzdfy6kajv5nwn4yam3wxkq3553uh'),
    ).toMatchObject({ valid: true, kind: 'p2tr', network: 'regtest' });
  });

  test('mixed case is refused even when each case alone would validate', () => {
    expect(reasonOf('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kV8f3t4')).toMatch(/case/);
    expect(reasonOf('tb1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3q0sL5k7')).toMatch(/case/);
  });
});

describe('the bech32 and bech32m constants are bound to the witness version', () => {
  test('a v0 address re-encoded as bech32m is refused', () => {
    // BIP-350 invalid vectors: same programs as the valid v0 addresses above
    expect(reasonOf('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kemeawh')).toBe(
      'witness version 0 must use bech32, not bech32m',
    );
    expect(reasonOf('tb1q0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vq24jc47')).toBe(
      'witness version 0 must use bech32, not bech32m',
    );
  });

  test('a v1 address encoded as plain bech32 is refused', () => {
    expect(reasonOf('bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqh2y7hd')).toBe(
      'witness version 1 must use bech32m, not bech32',
    );
    expect(reasonOf('tb1z0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqglt7rf')).toMatch(
      /must use bech32m/,
    );
  });

  test("BIP-173's own non-v0 example addresses are superseded by bech32m and now refused", () => {
    const superseded = [
      'bc1pw508d6qejxtdg4y5r3zarvary0c5xw7kw508d6qejxtdg4y5r3zarvary0c5xw7k7grplx',
      'BC1SW50QA3JX3S',
      'bc1zw508d6qejxtdg4y5r3zarvaryvg6kdaj',
    ];
    for (const address of superseded) {
      expect(isBitcoinAddress(address)).toBe(false);
      expect(reasonOf(address)).toMatch(/must use bech32m/);
    }
  });

  test('the bech32m re-encodings from BIP-350 pass the checksum and fail only on witness version', () => {
    // proves the rejection above is the constant, not a broken decoder
    for (const address of ['BC1SW50QGDZ25J', 'bc1zw508d6qejxtdg4y5r3zarvaryvaxxpcs']) {
      expect(reasonOf(address)).toMatch(/is not a supported address type/);
    }
    expect(
      reasonOf('bc1pw508d6qejxtdg4y5r3zarvary0c5xw7kw508d6qejxtdg4y5r3zarvary0c5xw7kt5nd6y'),
    ).toBe('witness version 1 program must be 32 bytes');
  });
});

describe('BIP-173 bech32 string vectors', () => {
  const VALID_STRINGS = [
    'A12UEL5L',
    'a12uel5l',
    'an83characterlonghumanreadablepartthatcontainsthenumber1andtheexcludedcharactersbio1tt5tgs',
    'abcdef1qpzry9x8gf2tvdw0s3jn54khce6mua7lmqqqxw',
    '11qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqc8247j',
    'split1checkupstagehandshakeupstreamerranterredcaperred2y9e3w',
    '?1ezyfcl',
  ];

  const INVALID_STRINGS: [string, string][] = [
    [`${String.fromCharCode(0x20)}1nwldj5`, 'HRP character out of range'],
    [`${String.fromCharCode(0x7f)}1axkwrx`, 'HRP character out of range'],
    [`${String.fromCharCode(0x80)}1eym55h`, 'HRP character out of range'],
    [
      'an84characterslonghumanreadablepartthatcontainsthenumber1andtheexcludedcharactersbio1569pvx',
      'overall max length exceeded',
    ],
    ['pzry9x0s0muk', 'no separator character'],
    ['1pzry9x0s0muk', 'empty HRP'],
    ['x1b4n0q5v', 'invalid data character'],
    ['li1dgmt3', 'too short checksum'],
    [`de1lg7wt${String.fromCharCode(0xff)}`, 'invalid character in checksum'],
    ['A1G7SGD8', 'checksum calculated with uppercase form of HRP'],
    ['10a06t8', 'empty HRP'],
    ['1qzzfhee', 'empty HRP'],
  ];

  test('valid bech32 strings clear the checksum and fail only on their foreign prefix', () => {
    for (const value of VALID_STRINGS) {
      expect(isBitcoinAddress(value)).toBe(false);
      expect(reasonOf(value)).toMatch(PREFIX_REASON);
    }
  });

  test('invalid bech32 strings are rejected before the prefix is ever considered', () => {
    for (const [value, why] of INVALID_STRINGS) {
      expect(isBitcoinAddress(value)).toBe(false);
      expect(`${why}: ${reasonOf(value)}`).not.toMatch(PREFIX_REASON);
    }
  });

  test('specific structural failures are named', () => {
    expect(reasonOf('pzry9x0s0muk')).toMatch(/separator/);
    expect(reasonOf('1qzzfhee')).toMatch(/prefix/);
    expect(reasonOf('li1dgmt3')).toMatch(/checksum is too short/);
    expect(reasonOf('A1G7SGD8')).toMatch(/checksum does not match/);
    expect(
      reasonOf('an84characterslonghumanreadablepartthatcontainsthenumber1andtheexcludedcharactersbio1569pvx'),
    ).toMatch(/90 characters/);
  });
});

describe('BIP-350 bech32m string vectors', () => {
  const VALID_STRINGS = [
    'A1LQFN3A',
    'a1lqfn3a',
    'an83characterlonghumanreadablepartthatcontainsthetheexcludedcharactersbioandnumber11sg7hg6',
    'abcdef1l7aum6echk45nj3s0wdvt2fg8x9yrzpqzd3ryx',
    '11llllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllludsr8',
    'split1checkupstagehandshakeupstreamerranterredcaperredlc445v',
    '?1v759aa',
  ];

  const INVALID_STRINGS: [string, string][] = [
    [`${String.fromCharCode(0x20)}1xj0phk`, 'HRP character out of range'],
    [`${String.fromCharCode(0x7f)}1g6xzxy`, 'HRP character out of range'],
    [`${String.fromCharCode(0x80)}1vctc34`, 'HRP character out of range'],
    [
      'an84characterslonghumanreadablepartthatcontainsthetheexcludedcharactersbioandnumber11d6pts4',
      'overall max length exceeded',
    ],
    ['qyrz8wqd2c9m', 'no separator character'],
    ['1qyrz8wqd2c9m', 'empty HRP'],
    ['y1b0jsk6g', 'invalid data character'],
    ['lt1igcx5c0', 'invalid data character'],
    ['in1muywd', 'too short checksum'],
    ['mm1crxm3i', 'invalid character in checksum'],
    ['au1s5cgom', 'invalid character in checksum'],
    ['M1VUXWEZ', 'checksum calculated with uppercase form of HRP'],
    ['16plkw9', 'empty HRP'],
    ['1p2gdwpf', 'empty HRP'],
  ];

  test('valid bech32m strings clear the checksum and fail only on their foreign prefix', () => {
    for (const value of VALID_STRINGS) {
      expect(isBitcoinAddress(value)).toBe(false);
      expect(reasonOf(value)).toMatch(PREFIX_REASON);
    }
  });

  test('invalid bech32m strings are rejected before the prefix is ever considered', () => {
    for (const [value, why] of INVALID_STRINGS) {
      expect(isBitcoinAddress(value)).toBe(false);
      expect(`${why}: ${reasonOf(value)}`).not.toMatch(PREFIX_REASON);
    }
  });
});

describe('BIP invalid segwit address vectors', () => {
  const BIP173_INVALID: [string, string][] = [
    ['tc1qw508d6qejxtdg4y5r3zarvary0c5xw7kg3g4ty', 'Invalid human-readable part'],
    ['bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t5', 'Invalid checksum'],
    ['BC13W508D6QEJXTDG4Y5R3ZARVARY0C5XW7KN40WF2', 'Invalid witness version'],
    ['bc1rw5uspcuh', 'Invalid program length'],
    [
      'bc10w508d6qejxtdg4y5r3zarvary0c5xw7kw508d6qejxtdg4y5r3zarvary0c5xw7kw5rljs90',
      'Invalid program length',
    ],
    ['BC1QR508D6QEJXTDG4Y5R3ZARVARYV98GJ9P', 'Invalid program length for witness version 0'],
    ['tb1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3q0sL5k7', 'Mixed case'],
    ['bc1zw508d6qejxtdg4y5r3zarvaryvqyzf3du', 'zero padding of more than 4 bits'],
    ['tb1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3pjxtptv', 'Non-zero padding'],
    ['bc1gmk9yu', 'Empty data section'],
  ];

  const BIP350_INVALID: [string, string][] = [
    ['tc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vq5zuyut', 'Invalid human-readable part'],
    [
      'bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqh2y7hd',
      'Invalid checksum (Bech32 instead of Bech32m)',
    ],
    [
      'tb1z0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqglt7rf',
      'Invalid checksum (Bech32 instead of Bech32m)',
    ],
    [
      'BC1S0XLXVLHEMJA6C4DQV22UAPCTQUPFHLXM9H8Z3K2E72Q4K9HCZ7VQ54WELL',
      'Invalid checksum (Bech32 instead of Bech32m)',
    ],
    [
      'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kemeawh',
      'Invalid checksum (Bech32m instead of Bech32)',
    ],
    [
      'tb1q0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vq24jc47',
      'Invalid checksum (Bech32m instead of Bech32)',
    ],
    ['bc1p38j9r5y49hruaue7wxjce0updqjuyyx0kh56v8s25huc6995vvpql3jow4', 'Invalid character in checksum'],
    ['BC130XLXVLHEMJA6C4DQV22UAPCTQUPFHLXM9H8Z3K2E72Q4K9HCZ7VQ7ZWS8R', 'Invalid witness version'],
    ['bc1pw5dgrnzv', 'Invalid program length (1 byte)'],
    [
      'bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7v8n0nx0muaewav253zgeav',
      'Invalid program length (41 bytes)',
    ],
    ['BC1QR508D6QEJXTDG4Y5R3ZARVARYV98GJ9P', 'Invalid program length for witness version 0'],
    ['tb1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vq47Zagq', 'Mixed case'],
    [
      'bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7v07qwwzcrf',
      'zero padding of more than 4 bits',
    ],
    ['tb1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vpggkg4j', 'Non-zero padding'],
    ['bc1gmk9yu', 'Empty data section'],
  ];

  test('every BIP-173 invalid address vector is rejected', () => {
    const accepted = BIP173_INVALID.filter(([address]) => isBitcoinAddress(address));
    expect(accepted).toEqual([]);
  });

  test('every BIP-350 invalid address vector is rejected', () => {
    const accepted = BIP350_INVALID.filter(([address]) => isBitcoinAddress(address));
    expect(accepted).toEqual([]);
  });

  test('the classic traps are rejected for the stated reason, not by accident', () => {
    expect(reasonOf('tc1qw508d6qejxtdg4y5r3zarvary0c5xw7kg3g4ty')).toBe("unknown network prefix 'tc'");
    expect(reasonOf('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t5')).toMatch(/checksum does not match/);
    expect(reasonOf('BC13W508D6QEJXTDG4Y5R3ZARVARY0C5XW7KN40WF2')).toMatch(/witness version is out of range/);
    expect(reasonOf('BC130XLXVLHEMJA6C4DQV22UAPCTQUPFHLXM9H8Z3K2E72Q4K9HCZ7VQ7ZWS8R')).toMatch(
      /witness version is out of range/,
    );
    expect(reasonOf('bc1rw5uspcuh')).toMatch(/2 to 40 bytes/);
    expect(reasonOf('bc1pw5dgrnzv')).toMatch(/2 to 40 bytes/);
    expect(
      reasonOf('bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7v8n0nx0muaewav253zgeav'),
    ).toMatch(/2 to 40 bytes/);
    expect(reasonOf('BC1QR508D6QEJXTDG4Y5R3ZARVARYV98GJ9P')).toBe(
      'witness version 0 program must be 20 or 32 bytes',
    );
    expect(reasonOf('bc1gmk9yu')).toMatch(/missing the witness version/);
    expect(reasonOf('bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7v07qwwzcrf')).toMatch(
      /padding/,
    );
    expect(reasonOf('tb1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vpggkg4j')).toMatch(/padding/);
    expect(reasonOf('bc1p38j9r5y49hruaue7wxjce0updqjuyyx0kh56v8s25huc6995vvpql3jow4')).toMatch(
      /not valid bech32/,
    );
  });
});

describe('BIP-350 valid address vectors', () => {
  // BIP-350's replacement table; every row must decode to the scriptPubKey type
  // implied by its witness version and program length
  const VECTORS: [string, BitcoinAddressKind | null, BitcoinNetwork][] = [
    ['BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4', 'p2wpkh', 'mainnet'],
    ['tb1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3q0sl5k7', 'p2wsh', 'testnet'],
    ['bc1pw508d6qejxtdg4y5r3zarvary0c5xw7kw508d6qejxtdg4y5r3zarvary0c5xw7kt5nd6y', null, 'mainnet'],
    ['BC1SW50QGDZ25J', null, 'mainnet'],
    ['bc1zw508d6qejxtdg4y5r3zarvaryvaxxpcs', null, 'mainnet'],
    ['tb1qqqqqp399et2xygdj5xreqhjjvcmzhxw4aywxecjdzew6hylgvsesrxh6hy', 'p2wsh', 'testnet'],
    ['tb1pqqqqp399et2xygdj5xreqhjjvcmzhxw4aywxecjdzew6hylgvsesf3hn0c', 'p2tr', 'testnet'],
    ['bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0', 'p2tr', 'mainnet'],
  ];

  test('rows with a kind this contract can name are accepted', () => {
    const failures: string[] = [];
    for (const [address, kind, network] of VECTORS) {
      if (kind === null) continue;
      const result = validateBitcoinAddress(address);
      if (!result.valid || result.kind !== kind || result.network !== network) {
        failures.push(`${address} -> ${JSON.stringify(result)}`);
      }
      if (result.normalized !== address.toLowerCase()) {
        failures.push(`${address} normalised to ${result.normalized}`);
      }
    }
    expect(failures).toEqual([]);
  });

  test('rows reserved for future witness versions are refused after the checksum passes', () => {
    for (const [address, kind] of VECTORS) {
      if (kind !== null) continue;
      expect(isBitcoinAddress(address)).toBe(false);
      expect(reasonOf(address)).toMatch(/witness version/);
    }
  });
});

describe('Bitcoin Core key_io vectors', () => {
  /** [address, scriptPubKey hex, chain] — the script is what fixes the expected kind */
  const VALID: [string, string, string][] = [
    ["1FsSia9rv4NeEwvJ2GvXrX7LyxYspbN2mo", "76a914a31c06bd463e3923bc1aadbde48b16976c08071788ac", "main"],
    ["36j4NfKv6Akva9amjWrLG6MuSQym1GuEmm", "a914373b819a068f32b7a6b38b6b38729647cfde01c287", "main"],
    ["mzK2FFDEhxqHcmrJw1ysqFkVyhUULo45hZ", "76a914ce28b26c57472737f5c3561a1761185bd8589a4388ac", "testnet4"],
    ["2NC2hEhe28ULKAJkW5MjZ3jtTMJdvXmByvK", "a914ce0bba75891ff9ec60148d4bd4a09ee2dc5c933187", "testnet4"],
    ["mww4LvqtTMKvmeQvizPz2EQv26xTneWrbg", "76a914b4110ba93ac54afc14da3bdd19614774a2d55d2988ac", "signet"],
    ["2N1r7aC69VHeE7yQJPDLi9T1PYq4wnwvjuT", "a9145e5a35ab44b3efaea5129ba22b88ba3e2976614587", "signet"],
    ["n4fajahJrAuKbN7uNsKjLjQkz9Qn5ewJXQ", "76a914fdeca3b08e38af53d7c4c60e3ad208ce5066441088ac", "regtest"],
    ["2MxFajLApXpYk4VodBSZSt7rw8y4ryABkfA", "a91436e9f191e0b75036a77f65e2eaa4752443233fbe87", "regtest"],
    ["bc1qvyq0cc6rahyvsazfdje0twl7ez82ndmuac2lhv", "00146100fc6343edc8c874496cb2f5bbfec88ea9b77c", "main"],
    ["bc1qyucykdlhp62tezs0hagqury402qwhk589q80tqs5myh3rxq34nwqhkdhv7", "002027304b37f70e94bc8a0fbf500e0c957a80ebda87280ef58214d92f119811acdc", "main"],
    ["bc1p83n3au0rjylefxq2nc2xh2y4jzz4pm6zxj4mw5pagdjjr2a9f36s6jjnnu", "51203c671ef1e3913f94980a9e146ba895908550ef4234abb7503d436521aba54c75", "main"],
    ["bc1z2rksukkjr8", "520250ed", "main"],
    ["tb1qcrh3yqn4nlleplcez2yndq2ry8h9ncg3qh7n54", "0014c0ef1202759fff90ff19128936814321ee59e111", "testnet4"],
    ["tb1quyl9ujpgwr2chdzdnnalen48sup245vdfnh2jxhsuq3yx80rrwlq5hqfe4", "0020e13e5e482870d58bb44d9cfbfccea78702aad18d4ceea91af0e022431de31bbe", "testnet4"],
    ["tb1p35n52jy6xkm4wd905tdy8qtagrn73kqdz73xe4zxpvq9t3fp50aqk3s6gz", "51208d2745489a35b75734afa2da43817d40e7e8d80d17a26cd4460b0055c521a3fa", "testnet4"],
    ["tb1rgv5m6uvdk3kc7qsuz0c79v88ycr5w4wa", "53104329bd718db46d8f021c13f1e2b0e726", "testnet4"],
    ["tb1q3vya2h5435jkugq2few7dmktlrwq4ejmfaw7kr", "00148b09d55e958d256e200a4e5de6eecbf8dc0ae65b", "signet"],
    ["tb1qxkhrl2s6ttrclckldruea0e8anhrehffl8xv7t0pdyrzm08v2hyqy408nf", "002035ae3faa1a5ac78fe2df68f99ebf27ecee3cdd29f9cccf2de169062dbcec55c8", "signet"],
    ["tb1pae5um27ahn8n73pgexe3kcwlp8dhswpn684h2k2w6t9a7w3eq65qephd5y", "5120ee69cdabddbccf3f4428c9b31b61df09db783833d1eb75594ed2cbdf3a3906a8", "signet"],
    ["tb1rx9n9g37az8mu236e5jpxdt0m67y4fuq8rhs0ss3djnm0kscfrwvq0ntlyg", "532031665447dd11f7c54759a48266adfbd78954f0071de0f8422d94f6fb43091b98", "signet"],
    ["bcrt1qdavt4j2sd7dlhqsavtnfxvzppw6k7qy97tmnu9", "00146f58bac9506f9bfb821d62e69330410bb56f0085", "regtest"],
    ["bcrt1qan8gntac7z7me2ejt4hpru42ad2f759fmy0m3ejvs98656znv7eqga4uhv", "0020ecce89afb8f0bdbcab325d6e11f2aaeb549f50a9d91fb8e64c814faa685367b2", "regtest"],
    ["bcrt1pfwxjqvtt4tcxrtdluukfmy2dv7xd2qzdfy6kajv5nwn4yam3wxkq3553uh", "51204b8d20316baaf061adbfe72c9d914d678cd5004d49356ec9949ba752777171ac", "regtest"],
    ["bcrt1sx6p8njlx7h9mc2agz4yg82dzne23050ncq72cneeecez2pst8mahn8xecsf8g6hzx94420", "6028368279cbe6f5cbbc2ba8154883a9a29e5517d1f3c03cac4f39ce3225060b3efb799cd9c412746ae2", "regtest"],
    ["1FjL87pn8ky6Vbavd1ZHeChRXtoxwRGCRd", "76a914a19331b7b2627e663e25a7b001e4c0dcc5e21bc788ac", "main"],
    ["3BZECeAH8gSKkjrTx8PwMrNQBLG18yHpvf", "a9146c382dcdf5b284760c8e3fead91f7422cd76aa8787", "main"],
    ["n4YNbYuFdPwFrxSP8sjHFbAhUbLMUiY9jE", "76a914fc8f9851f3c1e4719cd0b8e4816dd4e88c72e52888ac", "testnet4"],
    ["2NAeQVZayzVFAtgeC3iYJsjpjWDmsDph71A", "a914bedc797342c03fd7a346c4c7857ca03d467013b687", "testnet4"],
    ["mnCBpkNMJEJLehgdEkzSo2eioniyJMxLpZ", "76a914493c455551e48a1423263b62b127b436106a685488ac", "signet"],
    ["2N5sNHomeNJDZv67AcFx9ES7FBZY4jx9KDA", "a9148a776a0f34d56b63e7c595f2b205dbe1c393617a87", "signet"],
    ["mfhE6jAUwjUDNZhaX1PAsDTKfneQF2Nshc", "76a91401f15a4cc063dae4f4d56b89bfbc8bcc9ae5387c88ac", "regtest"],
    ["2MxNm1VHyVU4RuP3u1c1v5aQLk2dQjwy1Qk", "a91438456f7c076356abadcc67b92ad777eb20fb9f8887", "regtest"],
    ["bc1qhxt04s5xnpy0kxw4x99n5hpdf5pmtzpqs52es2", "0014b996fac2869848fb19d5314b3a5c2d4d03b58820", "main"],
    ["bc1qgc9ljrvdf2e0zg9rmmq86xklqwfys7r6wptjlacdgrcdc7sa6ggqu4rrxf", "0020460bf90d8d4ab2f120a3dec07d1adf039248787a70572ff70d40f0dc7a1dd210", "main"],
    ["bc1pve739yap4uxjvfk0jrey69078u0gasm2nwvv483ec6zkzulgw9xqu4w9fd", "5120667d1293a1af0d2626cf90f24d15fe3f1e8ec36a9b98ca9e39c6856173e8714c", "main"],
    ["bc1zmjtqxkzs89", "5202dc96", "main"],
    ["tb1ql4k5ayv7p7w0t0ge7tpntgpkgw53g2payxkszr", "0014fd6d4e919e0f9cf5bd19f2c335a03643a914283d", "testnet4"],
    ["tb1q9jx3x2qqdpempxrcfgyrkjd5fzeacaqj4ua7cs7fe2sfd2wdaueq5wn26y", "00202c8d1328006873b098784a083b49b448b3dc7412af3bec43c9caa096a9cdef32", "testnet4"],
    ["tb1pdswckwd9ym5yf5eyzg8j4jjwnzla8y0tf9cp7aasfkek0u29sz9qfr00yf", "51206c1d8b39a526e844d324120f2aca4e98bfd391eb49701f77b04db367f145808a", "testnet4"],
    ["tb1r0ecpfxg2udhtc556gqrpwwhk4sw3f0kc", "53107e7014990ae36ebc529a4006173af6ac", "testnet4"],
    ["tb1q6mwf89hnqhlu8txjgjfs4s7p93ugffn3k062ll", "0014d6dc9396f305ffc3acd244930ac3c12c7884a671", "signet"],
    ["tb1qafrjalu4d73dql0czau9j6z422434kef235mzljf48ckd5xz3sys09jm97", "0020ea472eff956fa2d07df8177859685552ab1adb295469b17e49a9f166d0c28c09", "signet"],
    ["tb1pwst9qszjrhuv2e7as0flcq9gm698v6gdxzz9e87p07s8rssdx3zqklm3vf", "512074165040521df8c567dd83d3fc00a8de8a76690d30845c9fc17fa071c20d3444", "signet"],
    ["tb1r3ss76jtsuxe8c8c8lxsehnpak55ylrgr345pww076l536ahjr6jsydamx3", "53208c21ed4970e1b27c1f07f9a19bcc3db5284f8d038d681739fed7e91d76f21ea5", "signet"],
    ["bcrt1q65nhlm4hf2ptg3t264al57p7wjxj2c3s6kyt83", "0014d5277feeb74a82b4456ad57bfa783e748d256230", "regtest"],
    ["bcrt1qawvc90lpytw3z3k9etdx54l0exq5f5sqfzu5e45kjnl6slwayeeqx2dyac", "0020eb9982bfe122dd1146c5cada6a57efc98144d20048b94cd69694ffa87ddd2672", "regtest"],
    ["bcrt1p39a4s4vdcw9kqa8w2t0rp7aj8kfxyw7mce5sk5d70x6wnnmpvt7skf2kxy", "5120897b58558dc38b6074ee52de30fbb23d92623bdbc6690b51be79b4e9cf6162fd", "regtest"],
    ["bcrt1s489d9fhmyel0vzfqsrmew4x7r80asuqesm5hgqacy35daflcyufh3j8cgdtflvt99ph05m", "6028a9cad2a6fb267ef6092080f79754de19dfd8701986e97403b82468dea7f8271378c8f843569fb165", "regtest"],
    ["1G9A9j6W8TLuh6dEeVwWeyibK1Uc5MfVFV", "76a914a614da54daacdb8861f451a0b7e3c27cdf8a099e88ac", "main"],
    ["33GA3ZXbw5o5HeUrBEaqkWXFYYZmdxGRRP", "a914113ca1afeb49ff3abf176ffa19c2a2b4df19712a87", "main"],
    ["mwgS2HRbjyfYxFnR1nF9VKLvmdgMfFBmGq", "76a914b14ce7070b53cb0e4b5b5f6e253e876990aeca2e88ac", "testnet4"],
    ["2MwBVrJQ76BdaGD76CTmou8cZzQYLpe4NqU", "a9142b2c149cde619eae3d7fe995243b76a3417541aa87", "testnet4"],
    ["mfnJ8tEkqKNFE5YaHTXFxyHk2mnDK2fvDh", "76a91402e6cd77e649ad8b281271f158fc964ca3f66cb088ac", "signet"],
    ["2My83D67ir7K8PPzeT6mE2oth3ZwNTVRS9F", "a9144074d84d32ff62da7b1b3c61925b934bfeb34b0587", "signet"],
  ];

  const INVALID: string[] = [
    "",
    "x",
    "1GAdfviErV2Ew95FPtZyikz2qGP3gyCB6Hyu94sedAkPpA523m3fQwps9YKUZkKgQckGPKhRsFR",
    "37G2kMDLpmWVhimxRdzwNfE8JFvWXnJYnVcXeeGrek2qumdJuK7XArcVVpRtLLjRra3t64BEPF2",
    "giymtio7u7oqWtmC9YnvAEKkLF3JQpAdkEFkVJKYrVDfaLbhaDpX1ihfF2vZmya1i61fwLPC3YQ",
    "8iVk9nLM3nYwRuwypjy9NK5rsuZH7BbrQRZ1pgcQmvMnjAgRXD",
    "cPTVQ1hbo4qdoysf6Jx5GthqucNmdfqt6J2pZRFeXv8Ep7Kmjqud",
    "cQbR2Ny85XFBzUMx3Ed6HsTLw2pVruSgPvt5AofnBUnhiv86gYeW",
    "2UB3iG3VJbX2TRrMwm6ssWskgvU9VjFBYSqCzwqkrihCwo7mg4mtS4WuGZgxTKuxf5A3EcotYEymz",
    "cQe12pqwPR6ExtZKfrKf1q4b3CTh1Qi7MwuvMvzs79nWXDvESfBJ",
    "tc1qeul5g2xfkvdkrhcfmdursv73ad64jnkjl9c40f",
    "bt1pq65rzej5glw3ra79gav6fqnx4haa0z257qr3mc8cggkefahmgvyseufhc0",
    "tb13hty4qmumlwpp6chxjvcyzza4duqgtmxw3xhm3u9ahj4nyhtwz8eq7ynrj4",
    "bcrt1r2qxpwuge",
    "bc10uexgzna2dpfk0vjt35srz6a27ps6m0l89jweznt83n2sqn2fx4hvn9ym5af8wut34sfrqhk3",
    "tb1qum6uh0pt4q253qaf520929737v63w5gf",
    "bcrt1q888ryfgxpvl0k7vum8zpyar2u2sexvdhkf38ue37yknmqq0ycrwpl3w48y",
    "bc1qdsuzmn04k2z8vryw8l4dj8m5ygqgnne5n",
    "tb1qlj8es50nc8j8r8xshrjgzmw5azx89efghmw8ju6zcqla0g6xcnrstsjz7k",
    "bcrt1qzwmyj0z924g7fzs5yvnrkc43y76RVyr2lh5t4r",
    "bc1qpu6d26mrulzetu4jqhd7rsunv9aqru26f5c4j8",
    "tb1qun6d26ufh77ghny6u5u8cwz9da7qwc6k4wkuceae9tth06eqlw0syupl4w",
    "bcrt1qj7g2jps453kj9htk9cxyyc2nxe69x4kzzmth7v",
    "bc1p702xksx4z3uqf0u2phllxkfe5cgu0adxptqs0uelx0tqt8e885sqryes2l",
    "tb1z7gmh0v6pc30z4xum76lmw8w86yswrlmw",
    "bcrt1sjsrw6nun4h502cr97xmnyyuhkr22q0s6efrgtu",
    "2UVPFpGYnLHJezFzjUo42our6PMEoozzRdM",
    "2MygHQjE1U33q3LSC53p69YqFjP8PihumJAF",
    "KzNbAQ4mexfAxa6RKBzHQqfoTycaeWpv2p",
    "2jDPrDfAKihCGPbPD9ztY8TswAia4V8Bc6vx",
    "4VQUNG1hG64QFtaNyQZQWDdwpxB275Pwb3tvyPt2HDxB8Mi2MgH8Tz3AC83YYiz9LydsLNXEZJLHY",
    "39TKsUQ5QpEL1wowc6GMUqak94ijirPuP69ooV3xsFmiKQX2dau",
    "2UEJjT3dSdwc8dAo7oedPzznXceXCEsBbDfAvSymqpqDrkZMv7JBEUpLyhkghioYAWC9W4sKysry",
    "7VmMEkphxCFSV1y659Th4dkk6x6bJS5eQvbt8rzUYKQyd6ACgwQ4vXHtXKFUwP2kW3XULipnHJdZ7",
    "tc1qdlapns4zkn03juf2k9xwwpct209suj6mgcd9gh",
    "bt1psa5eptk29c4jc9yumeseat3a0l5e2fpmw635za2p4gpwdnthueysxga9je",
    "tb13w8c43lykfj3lvm9sgp6dsnfjla3d57cm83seykunf0ltxjc9lt2q4efm4d",
    "bcrt1rjqr2tdkm",
    "bc10lyxwnxa70l270e6fcmxr4x7dtgu2yvy7gzkurwxy4zhdvgaqrrn6pfg2flyhqzy5t5se8yu3",
    "TB1QFDFM763VXVSUNZHQLPWC0Q8FG5LJX6ZN",
    "bcrt1q60chha7wfwlau4kdr4mlvyeyc8mnnh9dhxk05e0hmrxcuhghefj36uwyha",
    "bc1gmk9yu",
    "tb1ly0q7p",
    "bcrt1qdwttaw38uf42wxw40kwk3u8nguyTQH3hx6jmqp",
    "bc1qtsvlht6730n04f2mpaj5vv8hrledn5n5ug8c79",
    "tb1dclvmr",
    "bcrt1q3fqvctqu48wsvggrt09vj0yk2gzzcscdp4h98u",
    "bc1prklpq7tjcawg89cmwwqr3u5apwav36xa4zz56ady7crsllm6mpnqts7p86",
    "tb1zkm58zyhxz3ffkfgsyprflg543slsl4c4",
    "bcrt1snzr5kaypnfhpnjanrhd20fhqcjxm3hfh7dw9fu",
    "2GgnYKqBGuA2Mm5GnrPsMTZR81xPhNtgMYoFUZngZGiobhCuUpCaTriUHRcgFreEekNdPAR17q8d",
    "AZEah8d1EK362okRBS66e8SvdtYkrE8tsX",
    "gep8xr77FyPW6zYP15RiV9W8nL6w2HyHB16cUDakfyDceMA6ZzUdhJjk2LPuLYHnLkBqkRTTi6z",
    "2NDNP7GY59tTJPZTpbkprhM9SR99Nn5rUs7",
    "2Csgzy2T287YAjeU5tFtt1nPshBZAUFQi4WtgaWyZGKSBNnKXHy2Tmxo8QK4Mfdds977ShcDWC5o",
    "Kwjk3Vy6sdXMQDGWJzaWmqFxUNtWZCX1q4F4Kpt8jNNUoWJUUaTY",
    "Svj8kk98bAS9V4L2crmxakbhmnPm3cJ1tJ4Je4yVzDreU8eSTFURS1SPYv5oWEQD8Q9VBDvx5uF",
    "KNYsv6v9GtkGeD4WdQnBEJCrPKQm91PTxAbCfXr66LEd4JDmhPWC",
    "2UJ2H2xvAeXmFKfQwMyDoSdQTTPFMNCT3SsoUafBWKzoGP3NsUK1buEgQZG38viyD53jgMdpqfT7",
    "6aLMfayKF4TW4ecn5SEc8FExpyJA2peKxYRGZhes6tQ4NTTzuGy",
    "7VP4FmcebU2thJns9MnXde7LWfuqR5vMizrAuUoq2GcJjzTyA4RHFcPVdZL8PLg1SbpSFdJrvLXoY5",
    "tc1q5qdvt99uc92jyz663dtdpfpv6nr67ahmgwcpq2",
    "bt1peu3ppd7x796sjjenp09r8cs22rhylqm9lhggk72qp8q22vzft0wq2a0x6j",
    "tb1323z3lnz7dl3kd0nsuh6xy4he9almzl67anxgg3xdzkaxc9rwntlqdhdzd7",
    "bcrt1r2gc42sky",
    "bc10fd889x4hd54tqu2ewg9t4hhft2wl7m6x50av4uswzw46xe6as0xmltfg7vrjfkvm459vld7w",
    "TB1QZY7V0F2AT3308YGGNGN66ULJTCN3RY6F",
    "bcrt1qjg3cwht92znyw0l4r5rtctmls337nrc7g0ry9drjxmlecjd3atl3fake7c",
    "bc1qmgf8xt8xkecl79k04mma3lz34gqep7hg4",
    "TB1Q3F9WGNXE9ZMTTMDN5VKVKHYZ8Y0LCV72YV7V5LSXTJXEYHNHEHASLYL0TZ",
  ];

  function kindFromScript(script: string): BitcoinAddressKind | null {
    if (script.startsWith('76a914') && script.endsWith('88ac')) return 'p2pkh';
    if (script.startsWith('a914') && script.endsWith('87')) return 'p2sh';
    if (script.startsWith('0014')) return 'p2wpkh';
    if (script.startsWith('0020')) return 'p2wsh';
    if (script.startsWith('5120')) return 'p2tr';
    return null;
  }

  function networkOf(chain: string, address: string): BitcoinNetwork {
    if (chain === 'main') return 'mainnet';
    // signet and testnet4 both use 'tb'/0x6f/0xc4, and regtest reuses the same
    // base58 version bytes, so only a bcrt1 address can claim regtest
    if (address.toLowerCase().startsWith('bcrt1')) return 'regtest';
    return 'testnet';
  }

  test('every valid vector is accepted with the kind and network its scriptPubKey implies', () => {
    const failures: string[] = [];
    for (const [address, script, chain] of VALID) {
      const kind = kindFromScript(script);
      const result = validateBitcoinAddress(address);
      if (kind === null) {
        // witness v2+: the checksum is good but the contract has no kind for it
        if (result.valid || !/witness version/.test(result.reason ?? '')) {
          failures.push(`${address} (${script}) -> ${JSON.stringify(result)}`);
        }
        continue;
      }
      const network = networkOf(chain, address);
      if (!result.valid || result.kind !== kind || result.network !== network) {
        failures.push(`${address} (${script}, ${chain}) -> ${JSON.stringify(result)}`);
      }
    }
    expect(failures).toEqual([]);
  });

  test('uppercase segwit forms validate identically and normalise back down', () => {
    const failures: string[] = [];
    for (const [address, script] of VALID) {
      if (kindFromScript(script) === null || !address.includes('1')) continue;
      if (!address.startsWith('bc1') && !address.startsWith('tb1') && !address.startsWith('bcrt1')) continue;
      const upper = validateBitcoinAddress(address.toUpperCase());
      if (!upper.valid || upper.normalized !== address) {
        failures.push(`${address} -> ${JSON.stringify(upper)}`);
      }
    }
    expect(failures).toEqual([]);
  });

  test('every invalid vector is rejected', () => {
    const accepted = INVALID.filter((address) => isBitcoinAddress(address));
    expect(accepted).toEqual([]);
  });

  test('the vector sets are the full upstream lists', () => {
    expect(VALID.length).toBe(54);
    expect(INVALID.length).toBe(70);
  });
});

describe('isBitcoinAddress and isTxid', () => {
  test('isBitcoinAddress mirrors the valid flag', () => {
    expect(isBitcoinAddress('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa')).toBe(true);
    expect(isBitcoinAddress('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4')).toBe(true);
    expect(isBitcoinAddress('not-an-address')).toBe(false);
    expect(isBitcoinAddress('')).toBe(false);
  });

  test('isTxid accepts exactly 64 hex characters in either case', () => {
    const lower = 'e3bf3d07d4b0375638d5f1db5255fe07ba2c4cb067cd81b84ee974b6585fb468';
    expect(isTxid(lower)).toBe(true);
    expect(isTxid(lower.toUpperCase())).toBe(true);
    expect(isTxid(`  ${lower}  `)).toBe(true);
    expect(isTxid(lower.slice(0, 63))).toBe(false);
    expect(isTxid(`${lower}a`)).toBe(false);
    expect(isTxid(lower.replace('e3', 'g3'))).toBe(false);
    expect(isTxid('')).toBe(false);
  });
});

describe('classifySearchInput', () => {
  const TXID = '4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b';

  test('a valid address yields the normalised value and its validation', () => {
    const target = classifySearchInput('BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4');
    expect(target.kind).toBe('address');
    if (target.kind !== 'address') throw new Error('unreachable');
    expect(target.value).toBe('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4');
    expect(target.validation.kind).toBe('p2wpkh');
    expect(target.validation.network).toBe('mainnet');
  });

  test('a txid is lowercased whichever case it arrives in', () => {
    expect(classifySearchInput(TXID)).toEqual({ kind: 'txid', value: TXID });
    expect(classifySearchInput(TXID.toUpperCase())).toEqual({ kind: 'txid', value: TXID });
  });

  test('surrounding whitespace is trimmed', () => {
    expect(classifySearchInput(`\n  ${TXID}\t `)).toEqual({ kind: 'txid', value: TXID });
    const target = classifySearchInput('  1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa  ');
    expect(target).toMatchObject({ kind: 'address', value: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa' });
  });

  test('a pasted bitcoin: URI is unwrapped, query string and all', () => {
    for (const uri of [
      'bitcoin:1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
      'BITCOIN:1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa?amount=0.1&label=donation',
      'bitcoin://1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
      '  bitcoin:1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa?amount=1.5  ',
    ]) {
      expect(classifySearchInput(uri)).toMatchObject({
        kind: 'address',
        value: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
      });
    }
  });

  test('empty and whitespace-only input asks for input rather than reporting a decode failure', () => {
    for (const raw of ['', '   ', '\t\n', 'bitcoin:']) {
      expect(classifySearchInput(raw)).toEqual({
        kind: 'invalid',
        value: '',
        reason: 'enter an address or transaction id',
      });
    }
  });

  test('garbage and near-misses come back invalid with a reason worth showing', () => {
    const garbage = classifySearchInput('hello world');
    expect(garbage.kind).toBe('invalid');
    if (garbage.kind !== 'invalid') throw new Error('unreachable');
    expect(garbage.value).toBe('hello world');
    expect(garbage.reason.length).toBeGreaterThan(0);

    // one character off a real address, and one hex digit short of a txid
    const nearAddress = classifySearchInput('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNb');
    expect(nearAddress).toMatchObject({ kind: 'invalid' });
    if (nearAddress.kind !== 'invalid') throw new Error('unreachable');
    expect(nearAddress.reason).toMatch(/checksum/);

    expect(classifySearchInput(TXID.slice(0, 63)).kind).toBe('invalid');
  });
});

describe('classifySearchInput: pasted explorer links', () => {
  const TXID = '4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b';
  const P2PKH = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';
  const P2SH = '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy';
  const P2WPKH = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
  const LINK_REASON = 'that link does not contain a recognisable address or transaction id';

  function reasonOfInput(raw: string): string {
    const target = classifySearchInput(raw);
    expect(target.kind).toBe('invalid');
    if (target.kind !== 'invalid') throw new Error('unreachable');
    return target.reason;
  }

  test('the explorers a user is actually likely to copy from are unwrapped', () => {
    const links: [string, string][] = [
      [`https://mempool.space/address/${P2WPKH}`, P2WPKH],
      [`https://mempool.space/tx/${TXID}`, TXID],
      [`https://blockstream.info/address/${P2PKH}`, P2PKH],
      [`https://www.blockchain.com/btc/address/${P2SH}`, P2SH],
      [`https://blockchair.com/bitcoin/transaction/${TXID.toUpperCase()}`, TXID],
      [`https://mempool.space/testnet/address/${P2WPKH}`, P2WPKH],
    ];
    for (const [link, expected] of links) {
      expect(classifySearchInput(link)).toMatchObject({ value: expected });
    }
  });

  test('a link pasted without its scheme still resolves', () => {
    // copying from the address bar of a browser that hides https:// gives this
    expect(classifySearchInput(`mempool.space/address/${P2WPKH}`)).toMatchObject({
      kind: 'address',
      value: P2WPKH,
    });
    expect(classifySearchInput(`blockstream.info/tx/${TXID}`)).toEqual({ kind: 'txid', value: TXID });
    expect(classifySearchInput(`http://mempool.space/address/${P2PKH}`)).toMatchObject({ value: P2PKH });
  });

  test('a trailing slash, a query string and a fragment are all discarded', () => {
    for (const suffix of ['', '/', '?utm_source=x', '/?utm_source=x&ref=y', '#outputs', '/#outputs', '?a=1#b']) {
      expect(classifySearchInput(`https://mempool.space/address/${P2PKH}${suffix}`)).toMatchObject({
        kind: 'address',
        value: P2PKH,
      });
    }
  });

  test('an uppercase segwit address in a link still normalises down', () => {
    expect(classifySearchInput(`https://mempool.space/address/${P2WPKH.toUpperCase()}`)).toMatchObject({
      kind: 'address',
      value: P2WPKH,
      validation: { kind: 'p2wpkh', network: 'mainnet' },
    });
  });

  test('the token is percent-decoded, and a malformed escape does not throw', () => {
    expect(classifySearchInput(`https://mempool.space/address/%31${P2PKH.slice(1)}`)).toMatchObject({
      value: P2PKH,
    });
    expect(classifySearchInput(`https://mempool.space/address/%20${P2PKH}%20`)).toMatchObject({
      value: P2PKH,
    });
    // '%zz' and a lone trailing '%' are not escapes; the raw segment is used
    expect(reasonOfInput(`https://mempool.space/address/${P2PKH}%`)).toBe(LINK_REASON);
    expect(reasonOfInput('https://mempool.space/address/%zz')).toBe(LINK_REASON);
  });

  test('BIP-21 URIs keep working, unaffected by link extraction', () => {
    expect(classifySearchInput(`bitcoin:${P2WPKH}?amount=0.1`)).toMatchObject({
      kind: 'address',
      value: P2WPKH,
    });
    expect(classifySearchInput(`bitcoin://${P2PKH}?amount=1.5&label=donation`)).toMatchObject({
      value: P2PKH,
    });
  });

  test('a link that carries no address is not accused of a bad checksum', () => {
    // the accusation is the bug: the user's clipboard holds a URL, not a typo
    for (const link of [
      'https://mempool.space/address/notanaddress',
      'https://mempool.space/blocks/800000',
      'https://mempool.space/',
      'https://mempool.space',
      `https://mempool.space/address/${P2PKH.slice(0, -1)}b`,
      `https://mempool.space/tx/${TXID.slice(0, 63)}`,
    ]) {
      const reason = reasonOfInput(link);
      expect(reason).toBe(LINK_REASON);
      expect(reason).not.toMatch(/checksum/);
    }
  });

  test('the whole pasted link is echoed back as the value, not the segment blamed for it', () => {
    const link = 'https://mempool.space/address/notanaddress';
    expect(classifySearchInput(link)).toEqual({ kind: 'invalid', value: link, reason: LINK_REASON });
  });

  test('an address in a non-final segment is not silently searched for', () => {
    // mempool.space/address/<addr>/utxo and the like: the trailing segment names
    // a sub-view. Picking the address out of the middle would mean guessing that
    // any address-shaped path component is the lookup target, which stops being
    // true the moment a route contains two of them
    for (const link of [
      `https://mempool.space/address/${P2PKH}/utxo`,
      `https://blockstream.info/address/${P2WPKH}/transactions`,
      `https://www.blockchain.com/btc/address/${P2SH}/summary`,
    ]) {
      expect(reasonOfInput(link)).toBe(LINK_REASON);
    }
    // when two segments are both addresses the last one wins, with no attempt to
    // guess which the user meant: last-segment-only is the whole of the rule
    expect(classifySearchInput(`https://x.test/${P2PKH}/${P2SH}`)).toMatchObject({ value: P2SH });
  });

  test('a bare address or txid is untouched by link handling', () => {
    expect(classifySearchInput(P2PKH)).toMatchObject({ kind: 'address', value: P2PKH });
    expect(classifySearchInput(TXID)).toEqual({ kind: 'txid', value: TXID });
    // input with no '/' is never link-shaped, so the decoder still gets to speak
    expect(reasonOfInput('1A1zP1eP5QGefi2DMPTfTL5SLmv7D1vfNa')).toBe('base58 checksum does not match');
    expect(reasonOfInput('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kV8f3t4')).toBe('mixes upper and lower case');
    expect(reasonOfInput('hello world')).not.toBe(LINK_REASON);
  });

  test('validation is not loosened: a corrupted address inside a link is still refused', () => {
    for (const corrupted of [
      '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNb',
      'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t5',
      'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kemeawh',
      'tc1qw508d6qejxtdg4y5r3zarvary0c5xw7kg3g4ty',
      '5HueCGU8rMjxEXxiPuD5BDku4MkFqeZyd4dZ1jvhTVqvbTLvyTJ',
    ]) {
      expect(classifySearchInput(`https://mempool.space/address/${corrupted}`).kind).toBe('invalid');
    }
  });

  test('nothing throws, whatever arrives in the box', () => {
    const nasty = [
      '/',
      '//',
      '///',
      '?',
      '#',
      'http://',
      'https:///',
      '%%%',
      '/%',
      'https://user:pass@mempool.space:8080/address/',
      'https://[::1]/address/x',
      'bitcoin:',
      'bitcoin:?amount=1',
      '\\\\server\\share',
      '../../etc/passwd',
      'https://mempool.space/address/ ',
      'https://mempool.space/address/日本語',
      `https://mempool.space/address/${'a'.repeat(5_000)}`,
      `${'/'.repeat(5_000)}${P2PKH}`,
    ];
    for (const raw of nasty) {
      const target = classifySearchInput(raw);
      expect(typeof target.kind).toBe('string');
      if (target.kind === 'invalid') expect(target.reason.length).toBeGreaterThan(0);
    }
  });
});
