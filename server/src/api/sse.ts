import { Hono } from 'hono';
import { streamSSE, type SSEStreamingApi } from 'hono/streaming';
import type { EventEmitter } from 'node:events';
import type { EventSummary, HealthMessage, Label, SseMessageName } from '@chainwatch/shared';
import type { EventRow } from '../store/db';

export interface SseHubOptions {
  emitter: EventEmitter;
  serializeEvent: (row: EventRow) => EventSummary;
}

export interface SseHub {
  app: Hono;
  broadcastLabel(label: Label): void;
  broadcastHealth(lastPollAt: string): void;
  clientCount(): number;
}

export function createSseHub(options: SseHubOptions): SseHub {
  const clients = new Set<SSEStreamingApi>();

  function broadcast(name: SseMessageName, data: unknown): void {
    const payload = JSON.stringify(data);
    for (const client of clients) {
      void client.writeSSE({ event: name, data: payload }).catch(() => clients.delete(client));
    }
  }

  options.emitter.on('event:new', (row: EventRow) => {
    broadcast('event:new', options.serializeEvent(row));
  });
  options.emitter.on('event:update', (row: EventRow) => {
    broadcast('event:update', options.serializeEvent(row));
  });

  const app = new Hono();
  app.get('/api/stream', (c) =>
    streamSSE(c, async (stream) => {
      clients.add(stream);
      await new Promise<void>((resolve) => {
        stream.onAbort(() => {
          clients.delete(stream);
          resolve();
        });
      });
    }),
  );

  return {
    app,
    broadcastLabel(label: Label): void {
      broadcast('label:new', label);
    },
    broadcastHealth(lastPollAt: string): void {
      const message: HealthMessage = { lastPollAt };
      broadcast('health', message);
    },
    clientCount(): number {
      return clients.size;
    },
  };
}
