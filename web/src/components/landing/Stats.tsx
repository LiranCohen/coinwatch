import { Reveal, useCountUp, useInView } from './Reveal';

const STATS = [
  { value: 48213, decimals: 0, suffix: '', label: 'VERIFIED ANALYSTS' },
  { value: 1.2, decimals: 1, suffix: 'M', label: 'TRANSACTIONS TRACED DAILY' },
  { value: 312, decimals: 0, suffix: '', label: 'OPEN MODELS ON THE HUB' },
  { value: 1847, decimals: 0, suffix: '', label: 'CASES CLOSED' },
];

function StatCell({
  value,
  decimals,
  suffix,
  label,
  active,
}: {
  value: number;
  decimals: number;
  suffix: string;
  label: string;
  active: boolean;
}) {
  const v = useCountUp(value, active);
  const display =
    decimals > 0 ? v.toFixed(decimals) : Math.round(v).toLocaleString('en-US');
  return (
    <div className="px-6 py-10 text-center sm:py-12">
      <div className="tnum font-display text-4xl font-semibold text-zinc-50 sm:text-5xl">
        {display}
        <span className="text-gold">{suffix}</span>
      </div>
      <div className="mt-3 font-mono text-[10px] tracking-[0.22em] text-mist">{label}</div>
    </div>
  );
}

export function Stats() {
  const { ref, inView } = useInView<HTMLDivElement>(0.3);
  return (
    <section className="tex-brushed border-y border-line bg-panel">
      <Reveal>
        <div
          ref={ref}
          className="mx-auto grid max-w-6xl grid-cols-2 divide-line sm:divide-x lg:grid-cols-4"
        >
          {STATS.map((s) => (
            <StatCell key={s.label} {...s} active={inView} />
          ))}
        </div>
      </Reveal>
    </section>
  );
}
