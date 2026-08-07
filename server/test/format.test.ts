import { describe, expect, test } from 'bun:test';

import { formatBitcoin, formatCoins, formatCoinsExact } from '../../web/src/lib/format';

describe('Coin Standard formatting', () => {
  test('everyday amounts render as ¢ integers', () => {
    expect(formatCoins(10_000)).toBe('¢ 10,000');
    expect(formatCoins(500_000)).toBe('¢ 500,000');
    expect(formatCoinsExact(25_000_000)).toBe('¢ 25m');
  });

  test('whole bitcoin switches to ₿ once past ₿ 1', () => {
    expect(formatCoins(100_000_000)).toBe('₿ 1');
    expect(formatCoins(150_000_000)).toBe('₿ 1.5');
    expect(formatBitcoin(4_215_000_000)).toBe('₿ 42.15');
  });

  test('matches coinsymbol.wtf relationship ₿ 1 = ¢ 100m', () => {
    expect(formatCoinsExact(100_000_000)).toBe('¢ 100m');
    expect(formatCoins(100_000_000)).toBe('₿ 1');
  });
});
