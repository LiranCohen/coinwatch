import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { EventSummary } from '@chainwatch/shared';

import { getEvents } from '../../api/client';
import { satsToBtc, timeAgo, truncateMiddle } from '../../lib/format';
import { RuleBadge } from '../badges';

const SLOTS: { style: React.CSSProperties }[] = [
  { style: { top: '1%', left: '0%' } },
  { style: { top: '9%', right: '0%' } },
  { style: { top: '44%', left: '-3%' } },
  { style: { top: '58%', right: '-3%' } },
  { style: { bottom: '12%', left: '3%' } },
  { style: { bottom: '5%', right: '5%' } },
];

const POP_INTERVAL_MS = 2600;
const POP_LIFETIME_MS = 5400;

interface ActivePopup {
  key: number;
  event: EventSummary;
  slot: number;
}

export function TxPopups() {
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [active, setActive] = useState<ActivePopup[]>([]);
  const [staticOnly, setStaticOnly] = useState(false);
  const counter = useRef(0);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    let cancelled = false;
    getEvents({ limit: 12 })
      .then((res) => {
        if (cancelled) return;
        const live = res.events.filter((e) => e.rules.length > 0 && e.source === 'live');
        setEvents(live.length > 0 ? live : res.events);
      })
      .catch(() => {
        if (!cancelled) setEvents([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (events.length === 0) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setStaticOnly(true);
      setActive([{ key: 0, event: events[0], slot: 2 }]);
      return;
    }
    const spawn = () => {
      const k = counter.current++;
      const popup: ActivePopup = { key: k, event: events[k % events.length], slot: k % SLOTS.length };
      setActive((prev) => [...prev.slice(-2), popup]);
      const timer = window.setTimeout(() => {
        setActive((prev) => prev.filter((p) => p.key !== k));
      }, POP_LIFETIME_MS);
      timers.current.push(timer);
    };
    spawn();
    const id = window.setInterval(spawn, POP_INTERVAL_MS);
    return () => {
      window.clearInterval(id);
      for (const t of timers.current) window.clearTimeout(t);
      timers.current = [];
    };
  }, [events]);

  if (active.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      {active.map((p) => (
        <Link
          key={p.key}
          to={`/app?event=${p.event.id}`}
          className={`panel-metal group pointer-events-auto absolute block w-52 rounded-md px-3 py-2.5 transition-colors hover:border-gold/50 ${
            staticOnly ? '' : 'tx-pop'
          }`}
          style={SLOTS[p.slot].style}
          title="Open this transaction in the app"
        >
          <div className="flex items-center justify-between gap-2">
            <RuleBadge rule={p.event.rules[0]} />
            <span className="tnum font-mono text-[11px] font-semibold text-goldbright">
              {satsToBtc(p.event.valueSats)} BTC
            </span>
          </div>
          <div className="mt-1.5 font-mono text-[10px] text-mist">
            tx {truncateMiddle(p.event.txid, 8, 6)} · {timeAgo(p.event.detectedAt)}
          </div>
          <div className="mt-1.5 flex items-center justify-between font-mono text-[9px] tracking-[0.14em] text-mist/70">
            <span>MEMPOOL DETECTION</span>
            <span className="text-gold/80 transition group-hover:text-goldbright">OPEN →</span>
          </div>
        </Link>
      ))}
    </div>
  );
}
