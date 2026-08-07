import { useEffect, useRef } from 'react';

interface Particle {
  r: number;
  a: number;
  s: number;
  sz: number;
  gold: boolean;
  e: number;
}

export function HeroCanvas({ className = '' }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let raf = 0;
    let w = 0;
    let h = 0;

    const particles: Particle[] = Array.from({ length: 110 }, (_, i) => {
      const band = i % 3;
      return {
        r: 0.34 + band * 0.085 + Math.random() * 0.035,
        a: Math.random() * Math.PI * 2,
        s: (0.0016 + Math.random() * 0.0022) * (band % 2 ? -1 : 1),
        sz: 0.6 + Math.random() * 1.5,
        gold: Math.random() < 0.68,
        e: 0.86 + Math.random() * 0.12,
      };
    });

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      w = rect.width;
      h = rect.height;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const frame = (advance: boolean) => {
      ctx.clearRect(0, 0, w, h);
      const cx = w / 2;
      const cy = h / 2;
      const R = Math.min(w, h) / 2;

      ctx.strokeStyle = 'rgba(151,161,182,0.10)';
      ctx.lineWidth = 1;
      for (const rr of [0.34, 0.425, 0.51]) {
        ctx.beginPath();
        ctx.ellipse(cx, cy, R * rr, R * rr * 0.92, 0, 0, Math.PI * 2);
        ctx.stroke();
      }

      for (const p of particles) {
        if (advance) p.a += p.s;
        ctx.beginPath();
        ctx.fillStyle = p.gold ? 'rgba(242,179,61,0.75)' : 'rgba(76,141,255,0.6)';
        ctx.arc(cx + Math.cos(p.a) * R * p.r, cy + Math.sin(p.a) * R * p.r * p.e, p.sz, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    if (reduced) {
      frame(false);
    } else {
      const loop = () => {
        frame(true);
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    }

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
