import { Hono } from 'hono';
import type { Database } from 'bun:sqlite';
import { RULES, type Rule } from '@chainwatch/shared';

import { listEvents } from '../store/apiQueries';
import type { EventRow } from '../store/db';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export interface RssDeps {
  db: Database;
  /** Absolute URL of the web app, used for item <link> targets. */
  publicSiteUrl: string;
}

function formatCoins(valueSats: number): string {
  const n = Math.round(Math.abs(valueSats));
  const COINS_PER_BITCOIN = 100_000_000;
  if (n >= COINS_PER_BITCOIN) {
    const btc = n / COINS_PER_BITCOIN;
    const fixed = btc.toFixed(8).replace(/\.?0+$/, '');
    return `₿ ${fixed}`;
  }
  if (n >= 1_000_000 && n % 1_000_000 === 0) {
    return `¢ ${(n / 1_000_000).toLocaleString('en-US')}m`;
  }
  return `¢ ${n.toLocaleString('en-US')}`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function truncateTxid(txid: string): string {
  if (txid.length <= 16) return txid;
  return `${txid.slice(0, 8)}…${txid.slice(-6)}`;
}

function siteBase(url: string): string {
  return url.replace(/\/+$/, '');
}

function eventLink(publicSiteUrl: string, eventId: string): string {
  return `${siteBase(publicSiteUrl)}/app?event=${encodeURIComponent(eventId)}`;
}

function itemTitle(row: EventRow): string {
  const rules = JSON.parse(row.rules) as Rule[];
  const rulePart = rules.map((r) => r.toUpperCase()).join('+') || 'EVENT';
  const tag = row.ai_tag ? ` · ${row.ai_tag}` : '';
  return `[${rulePart}] ${formatCoins(row.value_sats)}${tag}`;
}

function itemDescription(row: EventRow): string {
  const rules = JSON.parse(row.rules) as Rule[];
  const lines: string[] = [];
  if (row.ai_summary) {
    lines.push(row.ai_summary);
  } else if (row.ai_status === 'pending') {
    lines.push('AI analysis pending.');
  } else if (row.ai_status === 'failed') {
    lines.push('AI analysis failed.');
  }
  lines.push(`Rules: ${rules.join(', ') || 'none'}. Status: ${row.status}. Source: ${row.source}.`);
  lines.push(`txid ${truncateTxid(row.txid)}`);
  return lines.join(' ');
}

export function buildRssFeed(options: {
  rows: EventRow[];
  publicSiteUrl: string;
  feedSelfUrl: string;
  title?: string;
  description?: string;
}): string {
  const site = siteBase(options.publicSiteUrl);
  const title = options.title ?? 'CoinWatch events';
  const description =
    options.description ??
    'Live Bitcoin events detected by CoinWatch: whales, dormant wakes, coinjoins, and multi-tx hacks.';
  const lastBuild =
    options.rows[0] !== undefined
      ? new Date(options.rows[0].detected_at).toUTCString()
      : new Date().toUTCString();

  const items = options.rows
    .map((row) => {
      const link = eventLink(options.publicSiteUrl, row.id);
      const categories = (JSON.parse(row.rules) as Rule[])
        .map((rule) => `    <category>${escapeXml(rule)}</category>`)
        .join('\n');
      return [
        '  <item>',
        `    <title>${escapeXml(itemTitle(row))}</title>`,
        `    <link>${escapeXml(link)}</link>`,
        `    <guid isPermaLink="false">${escapeXml(row.id)}</guid>`,
        `    <pubDate>${new Date(row.detected_at).toUTCString()}</pubDate>`,
        categories,
        `    <description>${escapeXml(itemDescription(row))}</description>`,
        '  </item>',
      ].join('\n');
    })
    .join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '<channel>',
    `  <title>${escapeXml(title)}</title>`,
    `  <link>${escapeXml(site)}</link>`,
    `  <description>${escapeXml(description)}</description>`,
    '  <language>en-us</language>',
    `  <lastBuildDate>${lastBuild}</lastBuildDate>`,
    `  <atom:link href="${escapeXml(options.feedSelfUrl)}" rel="self" type="application/rss+xml"/>`,
    items,
    '</channel>',
    '</rss>',
    '',
  ].join('\n');
}

export function createRssRoutes(deps: RssDeps): Hono {
  const app = new Hono();

  const handle = (c: { req: { url: string; query: () => Record<string, string> } }) => {
    const query = c.req.query();
    const rule = RULES.find((r) => r === query.rule);
    if (query.rule !== undefined && rule === undefined) {
      return new Response(JSON.stringify({ error: `rule must be one of ${RULES.join(', ')}` }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    let limit = DEFAULT_LIMIT;
    if (query.limit !== undefined) {
      const parsed = Number(query.limit);
      if (!Number.isInteger(parsed) || parsed < 1) {
        return new Response(JSON.stringify({ error: 'limit must be a positive integer' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      limit = Math.min(parsed, MAX_LIMIT);
    }

    const rows = listEvents(deps.db, { rule, limit });
    const selfUrl = new URL(c.req.url);
    const publicSiteUrl = deps.publicSiteUrl || `${selfUrl.protocol}//${selfUrl.host}`;
    const xml = buildRssFeed({
      rows,
      publicSiteUrl,
      feedSelfUrl: selfUrl.toString(),
      title: rule ? `CoinWatch ${rule} events` : 'CoinWatch events',
    });

    return new Response(xml, {
      status: 200,
      headers: {
        'Content-Type': 'application/rss+xml; charset=utf-8',
        'Cache-Control': 'public, max-age=30',
      },
    });
  };

  app.get('/api/feed.xml', (c) => handle(c));
  app.get('/feed.xml', (c) => handle(c));
  return app;
}
