import { TICKER_ITEMS } from './data';

function TickerRow({ hidden }: { hidden?: boolean }) {
  return (
    <div className="flex shrink-0 items-center" aria-hidden={hidden}>
      {TICKER_ITEMS.map((item) => (
        <div
          key={item.label}
          className="flex items-center gap-3 border-r border-line px-6 py-3 whitespace-nowrap"
        >
          <span className="font-mono text-xs text-mist">{item.label}</span>
          <span className="tnum font-mono text-xs font-semibold text-zinc-100">{item.p}</span>
          <span className={`tnum font-mono text-[11px] ${item.delta >= 0 ? 'text-up' : 'text-down'}`}>
            {item.delta >= 0 ? '▲' : '▼'} {Math.abs(item.delta).toFixed(1)}
          </span>
        </div>
      ))}
    </div>
  );
}

export function Ticker() {
  return (
    <div className="tex-brushed relative border-y border-line bg-panel">
      <div className="animate-ticker flex hover:[animation-play-state:paused]">
        <TickerRow />
        <TickerRow hidden />
      </div>
      <div className="pointer-events-none absolute inset-y-0 left-0 w-24 bg-gradient-to-r from-ink to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-24 bg-gradient-to-l from-ink to-transparent" />
    </div>
  );
}
