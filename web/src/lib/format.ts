/**
 * Coin Standard display (https://coinsymbol.wtf):
 * ¢ for coins, ₿ for whole bitcoin, symbol first with a space.
 * One coin = one satoshi on-chain; only display changes.
 * ₿ 1 = ¢ 100,000,000 (¢ 100m).
 */

export const COIN = '¢';
export const BITCOIN = '₿';
export const COINS_PER_BITCOIN = 100_000_000;

const group = (n: number): string => new Intl.NumberFormat('en-US').format(n);

/** Whole-bitcoin rendering: ₿ 1, ₿ 1.5, ₿ 2.345 — trimmed to at most 8 decimals. */
export function formatBitcoin(coins: number): string {
  const btc = coins / COINS_PER_BITCOIN;
  const fixed = btc.toFixed(8).replace(/\.?0+$/, '');
  const [int, frac] = fixed.split('.');
  return `${BITCOIN} ${group(Number(int))}${frac ? `.${frac}` : ''}`;
}

/** Always ¢: ¢ 25,000; exact millions become ¢ 25m (never lossy). */
export function formatCoinsExact(coins: number): string {
  const n = Math.round(Math.abs(coins));
  if (n >= 1_000_000 && n % 1_000_000 === 0) return `${COIN} ${group(n / 1_000_000)}m`;
  return `${COIN} ${group(n)}`;
}

/**
 * Auto mode: everyday amounts in coins, whole bitcoin in ₿ once the amount
 * crosses ₿ 1 — "collect coins to earn bitcoin".
 */
export function formatCoins(coins: number): string {
  const n = Math.round(Math.abs(coins));
  return n >= COINS_PER_BITCOIN ? formatBitcoin(n) : formatCoinsExact(n);
}

export function truncateMiddle(value: string, head = 10, tail = 8): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export function truncateDid(did: string): string {
  return truncateMiddle(did, 14, 6);
}

export function timeAgo(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000));
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
