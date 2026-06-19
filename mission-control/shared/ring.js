// shared/ring.js
// A small reusable SVG progress ring. Returns the <svg> element to mount
// plus a setProgress(pct, colorVar) function to animate it. Built on top
// of shared/dom.js's el() so the <svg>/<circle> nodes are created in the
// correct SVG namespace.

import { el } from './dom.js';

export function createRing({ size = 120, strokeWidth = 10 } = {}) {
  const radius = (size - strokeWidth) / 2;
  const center = size / 2;
  const circumference = 2 * Math.PI * radius;

  const track = el('circle', {
    ns: 'svg', class: 'ring-track', cx: center, cy: center, r: radius, 'stroke-width': strokeWidth
  });
  const fill = el('circle', {
    ns: 'svg', class: 'ring-fill', cx: center, cy: center, r: radius, 'stroke-width': strokeWidth,
    transform: `rotate(-90 ${center} ${center})`,
    style: `stroke-dasharray:${circumference}px; stroke-dashoffset:${circumference}px;`
  });
  const svg = el('svg', { ns: 'svg', viewBox: `0 0 ${size} ${size}`, width: size, height: size, class: 'progress-ring' }, [track, fill]);

  /** pct: 0-100 or null (renders an empty ring). colorVar: a CSS variable name like '--rank-b'. */
  function setProgress(pct, colorVar) {
    const clamped = pct === null || pct === undefined || Number.isNaN(pct) ? 0 : Math.max(0, Math.min(100, pct));
    const offset = circumference * (1 - clamped / 100);
    fill.style.strokeDashoffset = `${offset}px`;
    if (colorVar) fill.style.stroke = `var(${colorVar})`;
  }

  return { svg, setProgress, size, strokeWidth };
}
