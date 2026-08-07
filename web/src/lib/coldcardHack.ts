import type { EventDetail, EventSummary, Hack } from '@chainwatch/shared';

import { formatCoins } from './format';

/**
 * Coldcard supply-chain breach (mock dataset, Aug 2026): funds drained from
 * many compromised hardware wallets, peeled through two staging addresses,
 * then consolidated into a single address. Any feed event touching the
 * consolidation address is decorated with the hack rule + this trace.
 */
export const COLDCARD_HACK_ID = 'coldcard-2026';
export const COLDCARD_CONSOLIDATION = 'bc1qq85v2c926eg6pgxhwp6q7lf6cnsz80qs3fcu9r';

const VICTIMS: [string, number][] = [
  ['bc1qf3lt0k29vzu4xq8rn7apw5dm3hj6ce90s2tyg7', 6.21],
  ['bc1qw8ne5mc4d07xrs3vt2kqa9jf6up0zh4l8gy3d2', 4.85],
  ['bc1q0dj4v7t2sy9np6kxw3ecmr8qf5hu1za6b4l9c8', 3.4],
  ['bc1q7hp2ka96wxe3fm0dt58quj4ny1vz6rc3s9g5l7', 2.96],
  ['bc1qm4xr8w03jt6vqc2ne7ypk9df5azh1u3b8s6g4l', 2.3],
  ['bc1q3zs69fw7cpv2xm8kt4nqj0eh5ud1ra6y9g2l4d', 1.74],
  ['bc1q9vc5tp81mdw4xq7rn2kaf6js3uy0ze8h5b3g7l', 1.28],
  ['bc1q5kf8mz24wtx7vq9pn3ecr0dj6ha1su4y7b2g9l', 0.87],
  ['bc1qx2wm7rn94kt5vq0pe3zcf8dj1ha6su9y4b7g2l', 0.52],
];

const STAGING_1 = 'bc1qe80vh5nc27kt4xq9rm3zpa6jf1uy5wd2s8g4l6';
const STAGING_2 = 'bc1qt6ju3zw90fpv5xq2rn8kcm4de7ha1sy6b9g3l5';
const PEEL_1 = 'bc1qa9dk2vt57mwx4eq8rn0zpc3jf6hu1sy5b8g2l7';
const PEEL_2 = 'bc1qh4sn8mz61wtp3vq7re2kcf9dj0ua5xy8b3g6l2';

const BTC = 1e8;
const TOTAL = VICTIMS.reduce((s, [, v]) => s + v, 0);

export const COLDCARD_HACK: Hack = {
  id: COLDCARD_HACK_ID,
  title: 'Coldcard supply-chain breach',
  summary:
    `${formatCoins(Math.round(TOTAL * BTC))} drained from ${VICTIMS.length} compromised Coldcard wallets within a two-hour window, ` +
    'staged through two fresh addresses, then consolidated into a single collection address. ' +
    'Victim devices shared a tampered firmware batch; the sweep keys were exfiltrated at setup.',
  detectedAt: '2026-08-06T21:12:00.000Z',
  status: 'active',
  totalSats: Math.round(TOTAL * BTC),
  hops: [
    {
      txid: 'c01dca4d7e2b84d6059f1e3a72c58b4d9e6f07a2c41d83b5e90f16c2a47d91b8',
      eventId: null,
      inputs: VICTIMS.map(([address, v]) => ({ address, valueSats: Math.round(v * BTC) })),
      outputs: [
        { address: STAGING_1, valueSats: Math.round(23.61 * BTC) },
        { address: PEEL_1, valueSats: Math.round(0.52 * BTC) },
      ],
      carrySats: Math.round(23.61 * BTC),
    },
    {
      txid: 'f1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f80',
      eventId: null,
      inputs: [{ address: STAGING_1, valueSats: Math.round(23.61 * BTC) }],
      outputs: [
        { address: STAGING_2, valueSats: Math.round(22.4 * BTC) },
        { address: PEEL_2, valueSats: Math.round(1.21 * BTC) },
      ],
      carrySats: Math.round(22.4 * BTC),
    },
    {
      txid: '0b5e55edc0ffee4b1d5c0ffee5adca7c41d83b5e90f16c2a47d91b83e6f07a2c',
      eventId: null,
      inputs: [{ address: STAGING_2, valueSats: Math.round(22.4 * BTC) }],
      outputs: [{ address: COLDCARD_CONSOLIDATION, valueSats: Math.round(22.39 * BTC) }],
      carrySats: 0,
    },
  ],
};

function touchesConsolidation(event: EventSummary | EventDetail): boolean {
  if ('inputs' in event) {
    return [...event.inputs, ...event.outputs].some((io) => io.address === COLDCARD_CONSOLIDATION);
  }
  return event.matchedLabels.some((l) => l.address === COLDCARD_CONSOLIDATION);
}

/** Stamp hack rule + trace id onto events tied to the consolidation address. */
export function decorateHackEvent<T extends EventSummary>(event: T): T {
  if (event.hackId || !touchesConsolidation(event)) return event;
  return { ...event, hackId: COLDCARD_HACK_ID, rules: ['hack' as const] };
}
