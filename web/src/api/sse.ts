import { useEffect, useRef, useState } from 'react';

import type { EventSummary, Label, Rule } from '@chainwatch/shared';

import { USE_FIXTURES } from './client';

export type StreamStatus = 'live' | 'reconnecting' | 'offline';

export interface StreamHandlers {
  onEventNew?: (event: EventSummary) => void;
  onEventUpdate?: (event: EventSummary) => void;
  onLabelNew?: (label: Label) => void;
  onHealth?: (health: { lastPollAt: string }) => void;
}

export interface StreamState {
  status: StreamStatus;
  lastHealthAt: string | null;
}

const BACKOFF_MS = [1000, 2000, 5000, 10000];

// ---------------------------------------------------------------------------
// Fixtures mode: replay synthetic events on a timer so the UI is exercisable
// with zero network (R16). Demo-source events keep the AE6 marker visible.
// ---------------------------------------------------------------------------

type MockListener = (type: string, payload: unknown) => void;

const mockListeners = new Set<MockListener>();
let mockTimerStarted = false;
let mockSequence = 0;
const pendingAi = new Map<string, ReturnType<typeof setTimeout>>();

const MOCK_TEMPLATES: { rules: Rule[]; source: 'live' | 'demo'; sats: [number, number] }[] = [
  { rules: ['whale'], source: 'live', sats: [1_000_000_000, 25_000_000_000] },
  { rules: ['dormant-wake'], source: 'live', sats: [100_000_000, 900_000_000] },
  { rules: ['coinjoin'], source: 'live', sats: [20_000_000, 400_000_000] },
  { rules: ['hack'], source: 'live', sats: [2_000_000_000, 60_000_000_000] },
];

function mockBroadcast(type: string, payload: unknown): void {
  for (const listener of mockListeners) listener(type, payload);
}

function randomTxid(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function randomInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min));
}

function startMockTimers(): void {
  if (mockTimerStarted) return;
  mockTimerStarted = true;

  setInterval(() => {
    mockBroadcast('health', { lastPollAt: new Date().toISOString() });
  }, 5000);

  setInterval(() => {
    const template = MOCK_TEMPLATES[mockSequence % MOCK_TEMPLATES.length];
    mockSequence += 1;
    const event: EventSummary = {
      id: `evt_mock_${mockSequence}`,
      txid: randomTxid(),
      detectedAt: new Date().toISOString(),
      blockHeight: null,
      blockHash: null,
      blockTime: null,
      meta: null,
      rules: template.rules,
      valueSats: randomInt(template.sats[0], template.sats[1]),
      status: 'active',
      source: template.source,
      aiStatus: 'pending',
      aiTag: null,
      matchedLabels: [],
    };
    mockBroadcast('event:new', event);

    const timer = setTimeout(() => {
      pendingAi.delete(event.id);
      const ruleTag = template.rules[0] ?? 'unknown';
      const aiTag = ruleTag === 'whale' ? 'whale-move' : ruleTag === 'hack' ? 'exchange-flow' : ruleTag;
      mockBroadcast('event:update', { ...event, aiStatus: 'done', aiTag });
    }, 6000);
    pendingAi.set(event.id, timer);
  }, 14000);
}

/** Used by the fixtures-mode injector to push a synthetic event immediately. */
export function emitMockEvent(event: EventSummary): void {
  if (!USE_FIXTURES) return;
  startMockTimers();
  mockBroadcast('event:new', event);
  const timer = setTimeout(() => {
    pendingAi.delete(event.id);
    mockBroadcast('event:update', { ...event, aiStatus: 'done', aiTag: 'whale-move' });
  }, 6000);
  pendingAi.set(event.id, timer);
}

// ---------------------------------------------------------------------------
// Live mode: EventSource with backoff reconnect (U7 test scenario).
// ---------------------------------------------------------------------------

export function useEventStream(handlers: StreamHandlers): StreamState {
  const [status, setStatus] = useState<StreamStatus>(USE_FIXTURES ? 'live' : 'reconnecting');
  const [lastHealthAt, setLastHealthAt] = useState<string | null>(null);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    let disposed = false;

    const dispatch = (type: string, raw: unknown) => {
      const h = handlersRef.current;
      if (type === 'health') {
        const health = raw as { lastPollAt: string };
        setLastHealthAt(health.lastPollAt);
        h.onHealth?.(health);
      } else if (type === 'event:new') {
        h.onEventNew?.(raw as EventSummary);
      } else if (type === 'event:update') {
        h.onEventUpdate?.(raw as EventSummary);
      } else if (type === 'label:new') {
        h.onLabelNew?.(raw as Label);
      }
    };

    if (USE_FIXTURES) {
      startMockTimers();
      const listener: MockListener = (type, payload) => dispatch(type, payload);
      mockListeners.add(listener);
      setStatus('live');
      setLastHealthAt(new Date().toISOString());
      return () => {
        mockListeners.delete(listener);
      };
    }

    let source: EventSource | null = null;
    let attempts = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (disposed) return;
      source = new EventSource((import.meta.env.VITE_API_BASE ?? '') + '/api/stream');

      source.onopen = () => {
        attempts = 0;
        setStatus('live');
      };

      for (const type of ['event:new', 'event:update', 'label:new', 'health'] as const) {
        source.addEventListener(type, (message) => {
          try {
            dispatch(type, JSON.parse(message.data));
          } catch {
            // malformed frame: ignore, stream stays open
          }
        });
      }

      source.onerror = () => {
        source?.close();
        source = null;
        if (disposed) return;
        attempts += 1;
        setStatus(attempts >= 4 ? 'offline' : 'reconnecting');
        const delay = BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)];
        retryTimer = setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      disposed = true;
      source?.close();
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, []);

  return { status, lastHealthAt };
}
