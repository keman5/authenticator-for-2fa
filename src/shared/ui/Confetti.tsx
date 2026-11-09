import { useEffect, useRef, useState } from 'react';

const colors = [
  '#7045ff',
  '#2998ff',
  '#f4b931',
  '#ff4f57',
  '#26bc83',
  '#f23bb1'
];
const step = 1 / 120;

export function Confetti({ onComplete }: { onComplete?: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (!visible) return;
    const layer = root.current!;
    const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (motion?.matches) {
      setVisible(false);
      onComplete?.();
      return;
    }

    let width = layer.clientWidth || window.innerWidth;
    let height = layer.clientHeight || window.innerHeight;
    let frame = 0;
    let stopped = false;
    let previous = performance.now();
    let elapsed = 0;
    let accumulator = 0;
    const random = (min: number, max: number) =>
      min + Math.random() * (max - min);
    const fragment = document.createDocumentFragment();
    const particles = Array.from(
      { length: width < 600 ? 140 : 220 },
      (_, index) => {
        const direction = index % 2 ? -1 : 1;
        const element = document.createElement('i');

        const size = random(5, 9);
        const shape = Math.random();
        Object.assign(element.style, {
          width: `${size}px`,
          height: `${size * (shape < 0.65 ? random(1.3, 2.1) : 1)}px`,
          backgroundColor: colors[Math.floor(random(0, colors.length))],
          borderRadius: shape > 0.85 ? '50%' : '0',
          clipPath:
            shape >= 0.65 && shape <= 0.85
              ? 'polygon(50% 0, 100% 100%, 0 100%)'
              : ''
        });
        fragment.append(element);
        return {
          element,
          x: direction > 0 ? -8 : width + 8,
          y: height * random(0.88, 0.94),
          vx: direction * width * random(0.18, 1.25),
          vy: -height * random(1.4, 2.2),
          gravity: height * random(1.1, 1.45),
          drag: random(0.7, 1.1),
          phase: random(0, Math.PI * 2),
          roll: random(0, Math.PI * 2),
          flip: random(0, Math.PI * 2),
          spin: random(7, 15) * (Math.random() < 0.5 ? -1 : 1),
          flutter: random(3, 6),
          wind: random(-18, 18),
          delay: random(0, 0.16),
          active: true
        };
      }
    );
    layer.append(fragment);

    function finish() {
      if (stopped) return;
      stopped = true;
      cancelAnimationFrame(frame);
      layer.replaceChildren();
      setVisible(false);
      onComplete?.();
    }

    function tick(now: number) {
      // Fixed substeps keep the same flight at 60/120 Hz and across dropped frames.
      accumulator += Math.min((now - previous) / 1000, 0.1);
      previous = now;
      while (accumulator >= step) {
        elapsed += step;
        for (const p of particles) {
          if (!p.active || elapsed < p.delay) continue;
          const falling = Math.max(0, Math.min(1, p.vy / 100));
          const face = Math.abs(Math.cos(p.flip));
          // Thin paper loses its launch momentum, then falls with much more drag
          // as it tumbles broadside. Flutter changes acceleration, not position.
          const drag = p.drag + falling * (2.5 + face * 1.8);
          const air =
            p.wind + Math.sin(elapsed * p.flutter + p.phase) * 45 * falling;
          p.vx += (air - p.vx) * (1.4 + falling * 1.2) * step;
          p.vy += (p.gravity - drag * p.vy) * step;
          p.x += p.vx * step;
          p.y += p.vy * step;
          p.flip += p.spin * step;
          p.roll +=
            (p.spin * 0.3 + Math.sin(elapsed * p.flutter + p.phase)) * step;
          p.spin *= Math.exp(-0.16 * step);
          if (p.y > height + 40 && p.vy > 0) {
            p.active = false;
            p.element.remove();
          }
        }
        accumulator -= step;
      }
      for (const p of particles) {
        if (!p.active || elapsed < p.delay) continue;
        p.element.style.opacity = '1';
        p.element.style.transform = `translate3d(${p.x}px, ${p.y}px, 0) rotateZ(${p.roll}rad) rotateX(${p.flip}rad) rotateY(${Math.sin(p.flip * 0.6 + p.phase) * 0.8}rad)`;
      }
      if (particles.every((p) => !p.active)) finish();
      else frame = requestAnimationFrame(tick);
    }

    function resize() {
      const nextWidth = layer.clientWidth || window.innerWidth;
      const nextHeight = layer.clientHeight || window.innerHeight;
      for (const p of particles) {
        p.x *= nextWidth / width;
        p.vx *= nextWidth / width;
        p.y *= nextHeight / height;
        p.vy *= nextHeight / height;
        p.gravity *= nextHeight / height;
      }
      width = nextWidth;
      height = nextHeight;
    }
    function visibilityChanged() {
      if (document.hidden) finish();
    }
    function motionChanged() {
      if (motion?.matches) finish();
    }
    frame = requestAnimationFrame(tick);
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', visibilityChanged);
    motion?.addEventListener('change', motionChanged);
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      layer.replaceChildren();
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', visibilityChanged);
      motion?.removeEventListener('change', motionChanged);
    };
  }, [onComplete, visible]);

  return visible ? (
    <div ref={root} className="confetti" aria-hidden="true" />
  ) : null;
}
