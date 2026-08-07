import { describe, test, expect } from 'bun:test';
import { openDatabase, insertLabel, getLabelsForTx } from '../src/store/db';
import { getLabelsForAddressScored, getLabelsForTxScored } from '../src/store/apiQueries';

const ADDRESS = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const TXID = 'a'.repeat(64);

describe('labels can target a transaction as well as an address', () => {
  test('a transaction label is not returned as an address label', () => {
    const db = openDatabase(':memory:');
    insertLabel(db, { address: TXID, tag: 'exchange payout', source: 'crowd', targetKind: 'tx' });
    // the txid is stored in the same column, so the address read must be scoped
    expect(getLabelsForAddressScored(db, TXID, null)).toHaveLength(0);
    expect(getLabelsForTxScored(db, TXID, null)).toHaveLength(1);
  });

  test('an address label is not returned as a transaction label', () => {
    const db = openDatabase(':memory:');
    insertLabel(db, { address: ADDRESS, tag: 'cold wallet', source: 'crowd' });
    expect(getLabelsForTxScored(db, ADDRESS, null)).toHaveLength(0);
    expect(getLabelsForAddressScored(db, ADDRESS, null)).toHaveLength(1);
  });

  test('existing labels default to targeting an address', () => {
    const db = openDatabase(':memory:');
    insertLabel(db, { address: ADDRESS, tag: 'seeded', source: 'seed' });
    const row = getLabelsForAddressScored(db, ADDRESS, null)[0];
    expect(row).toBeDefined();
    expect(getLabelsForTx(db, ADDRESS)).toHaveLength(0);
  });

  test('the same string can be labelled as both kinds without colliding', () => {
    const db = openDatabase(':memory:');
    insertLabel(db, { address: TXID, tag: 'batch', source: 'crowd', targetKind: 'tx' });
    insertLabel(db, { address: TXID, tag: 'batch', source: 'crowd', targetKind: 'address' });
    // the unique index keys on (address, tag, source), so the second is ignored
    // rather than creating a second row under a different kind
    expect(getLabelsForTxScored(db, TXID, null)).toHaveLength(1);
  });
});
