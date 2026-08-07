import { Hono } from 'hono';
import type { Database } from 'bun:sqlite';
import type { AnalystProfile } from '@chainwatch/shared';
import { getIdentity } from '../store/authQueries';
import {
  countAiFeedbackByVoter,
  getVoteTalliesForAuthor,
  listLabelsByAuthor,
} from '../store/analystQueries';
import { toLabel } from './routes';

export function createAnalystRoutes(db: Database): Hono {
  const app = new Hono();

  app.get('/api/analysts/:did', (c) => {
    const identity = getIdentity(db, c.req.param('did'));
    if (!identity) return c.json({ error: 'unknown analyst' }, 404);
    const body: AnalystProfile = {
      identity,
      labels: listLabelsByAuthor(db, identity.did).map(toLabel),
      votesReceived: getVoteTalliesForAuthor(db, identity.did),
      aiFeedbackGiven: countAiFeedbackByVoter(db, identity.did),
    };
    return c.json(body);
  });

  return app;
}
