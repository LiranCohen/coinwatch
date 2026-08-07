import { useId } from 'react';

interface LogoMarkProps {
  size?: number;
  animate?: boolean;
  className?: string;
}

/**
 * The CoinWatch mark: a coin whose reeded edge doubles as a minute track,
 * with a single hand resting at 2 o'clock — an upward trend line.
 */
export function LogoMark({ size, animate = false, className = '' }: LogoMarkProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const ticks = Array.from({ length: 60 }, (_, i) => i * 6);
  const dims = size ? { width: size, height: size } : {};

  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      {...dims}
      role="img"
      aria-label="CoinWatch logo"
    >
      <defs>
        <linearGradient id={`${uid}-edge`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ffd97a" />
          <stop offset="55%" stopColor="#f2b33d" />
          <stop offset="100%" stopColor="#9a6a15" />
        </linearGradient>
        <radialGradient id={`${uid}-face`} cx="0.38" cy="0.3" r="0.9">
          <stop offset="0%" stopColor="#171e2b" />
          <stop offset="70%" stopColor="#0b0f16" />
          <stop offset="100%" stopColor="#07090d" />
        </radialGradient>
      </defs>

      {/* reeded rim — coin edge or minute track, depending on how you look at it */}
      <g>
        {ticks.map((deg) => (
          <line
            key={deg}
            x1="32"
            y1="1.6"
            x2="32"
            y2={deg % 30 === 0 ? 5.4 : 3.7}
            stroke="#f2b33d"
            strokeOpacity={deg % 30 === 0 ? 0.9 : 0.36}
            strokeWidth={deg % 30 === 0 ? 1.3 : 0.9}
            transform={`rotate(${deg} 32 32)`}
          />
        ))}
      </g>
      <circle cx="32" cy="32" r="28.6" fill="none" stroke={`url(#${uid}-edge)`} strokeWidth="1.4" />
      <circle
        cx="32"
        cy="32"
        r="24.6"
        fill={`url(#${uid}-face)`}
        stroke="#f2b33d"
        strokeOpacity="0.22"
        strokeWidth="0.8"
      />

      <g
        className={animate ? 'cw-needle-sweep' : undefined}
        style={animate ? undefined : { transform: 'rotate(60deg)', transformOrigin: '32px 32px' }}
      >
        <path d="M32 9.2 L34 29.5 L32 33 L30 29.5 Z" fill={`url(#${uid}-edge)`} />
        <path d="M31.1 33 L31.1 40.8 L32.9 40.8 L32.9 33 Z" fill="#f2b33d" fillOpacity="0.85" />
        <circle cx="32" cy="43" r="1.7" fill="none" stroke="#f2b33d" strokeOpacity="0.5" strokeWidth="1" />
      </g>
      <circle cx="32" cy="32" r="2.6" fill="#f2b33d" />
      <circle cx="32" cy="32" r="1" fill="#05070b" />
    </svg>
  );
}
