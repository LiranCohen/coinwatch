import { Hono } from 'hono';
import type { Database } from 'bun:sqlite';
import type { EntityDetail, EntitySummary } from '@chainwatch/shared';
import { getLabelsForAddressScored } from '../store/apiQueries';
import {
  countEventsForTag,
  listAddressesForTag,
  listEntitySummaryRows,
  listEventsForTag,
} from '../store/analystQueries';
import { serializeEventSummary, toLabel } from './routes';

const RECENT_EVENTS_LIMIT = 10;

export function createEntityRoutes(db: Database): Hono {
  const app = new Hono();

  app.get('/api/entities', (c) => {
    const entities: EntitySummary[] = listEntitySummaryRows(db).map((row) => ({
      tag: row.tag,
      addressCount: row.address_count,
      eventCount: countEventsForTag(db, row.tag),
    }));
    return c.json({ entities });
  });

  app.get('/api/entities/:tag', (c) => {
    const tag = c.req.param('tag');
    const addresses = listAddressesForTag(db, tag);
    if (addresses.length === 0) return c.json({ error: 'unknown entity' }, 404);
    const body: EntityDetail = {
      tag,
      addresses: addresses.map((address) => ({
        address,
        labels: getLabelsForAddressScored(db, address, null).map(toLabel),
      })),
      recentEvents: listEventsForTag(db, tag, RECENT_EVENTS_LIMIT).map((row) =>
        serializeEventSummary(db, row),
      ),
    };
    return c.json(body);
  });

  return app;
}
