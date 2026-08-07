import { describe, test, expect } from 'bun:test';
import { Hono } from 'hono';
import type { AnalystProfile } from '@chainwatch/shared';
import { openDatabase, insertEvent, insertLabel } from '../src/store/db';
import { upsertIdentity } from '../src/store/authQueries';
import { applyLabelVote, toggleAiFeedback } from '../src/store/apiQueries';
import { createAnalystRoutes } from '../src/api/analysts';

const ANALYST_DID = 'did:jwk:analyst-alice';
const VOTER_UP_DID = 'did:jwk:voter-up';
const VOTER_DOWN_DID = 'did:jwk:voter-down';
const LABEL_ADDRESS = 'bc1qanalystlabeledaddress000000000000000';

function makeHarness() {
  const db = openDatabase(':memory:');
  const app = new Hono();
  app.route('/', createAnalystRoutes(db));
  return { db, app };
}

describe('GET /api/analysts/:did', () => {
  test('profile reflects authored labels and reputation after votes', async () => {
    const { db, app } = makeHarness();
    upsertIdentity(db, ANALYST_DID, 'alice');
    upsertIdentity(db, VOTER_UP_DID, 'upvoter');
    upsertIdentity(db, VOTER_DOWN_DID, 'downvoter');

    const label = insertLabel(db, {
      address: LABEL_ADDRESS,
      tag: 'alice-exchange',
      note: 'clustered by withdrawal pattern',
      authorDid: ANALYST_DID,
      source: 'crowd',
    })!;
    applyLabelVote(db, label.id, VOTER_UP_DID, 1);
    applyLabelVote(db, label.id, VOTER_DOWN_DID, -1);
    applyLabelVote(db, label.id, VOTER_DOWN_DID, -1); // toggle off

    const { row: event } = insertEvent(db, {
      txid: 'a'.repeat(64),
      rules: ['whale'],
      valueSats: 2_000_000_000,
      inputs: [{ address: LABEL_ADDRESS, valueSats: 2_100_000_000 }],
      outputs: [{ address: null, valueSats: 2_000_000_000 }],
    });
    toggleAiFeedback(db, event!.id, ANALYST_DID, 'confirm');

    const res = await app.request(`/api/analysts/${ANALYST_DID}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as AnalystProfile;
    expect(body.identity).toEqual({ did: ANALYST_DID, handle: 'alice', reputation: 1 });
    expect(body.labels).toHaveLength(1);
    expect(body.labels[0].tag).toBe('alice-exchange');
    expect(body.labels[0].address).toBe(LABEL_ADDRESS);
    expect(body.labels[0].score).toBe(1);
    expect(body.labels[0].author).toEqual({ did: ANALYST_DID, handle: 'alice' });
    expect(body.votesReceived).toEqual({ up: 1, down: 0 });
    expect(body.aiFeedbackGiven).toBe(1);
  });

  test('analyst with multiple labels gets summed tallies', async () => {
    const { db, app } = makeHarness();
    upsertIdentity(db, ANALYST_DID, 'alice');
    upsertIdentity(db, VOTER_UP_DID, 'upvoter');

    const first = insertLabel(db, {
      address: LABEL_ADDRESS,
      tag: 'tag-one',
      authorDid: ANALYST_DID,
      source: 'crowd',
    })!;
    const second = insertLabel(db, {
      address: 'bc1qanotheraddress0000000000000000000000',
      tag: 'tag-two',
      authorDid: ANALYST_DID,
      source: 'crowd',
    })!;
    applyLabelVote(db, first.id, VOTER_UP_DID, 1);
    applyLabelVote(db, second.id, VOTER_UP_DID, -1);

    const res = await app.request(`/api/analysts/${ANALYST_DID}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as AnalystProfile;
    expect(body.labels).toHaveLength(2);
    expect(body.votesReceived).toEqual({ up: 1, down: 1 });
    expect(body.identity.reputation).toBe(0);
    expect(body.aiFeedbackGiven).toBe(0);
  });

  test('unknown did → 404', async () => {
    const { app } = makeHarness();
    const res = await app.request('/api/analysts/did:jwk:nobody');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(typeof body.error).toBe('string');
  });
});
