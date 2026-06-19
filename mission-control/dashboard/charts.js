// dashboard/charts.js
// Small hand-rolled chart builders — no chart library (MV3's default CSP
// blocks remote scripts anyway, and the brief asks for zero frameworks).
// Both functions return plain DOM nodes built with shared/dom.js's el(),
// so nothing here ever touches innerHTML on dynamic data.

import { el } from '../shared/dom.js';
import { getRank, formatDuration } from '../utils/analytics.js';

function shortDayLabel(dayKeyStr) {
  const [y, m, d] = dayKeyStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/**
 * Bar chart of average focus % per active day (last 14 days of activity).
 * Bars are colored by the same rank thresholds used everywhere else, so
 * the chart visually agrees with every rank badge in the extension.
 */
export function buildFocusOverTimeChart(chartData, { width = 640, height = 220 } = {}) {
  const padding = { top: 22, right: 16, bottom: 34, left: 38 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;

  const svg = el('svg', { ns: 'svg', viewBox: `0 0 ${width} ${height}`, class: 'chart-svg', preserveAspectRatio: 'xMidYMid meet' });

  [0, 25, 50, 75, 100].forEach((tick) => {
    const y = padding.top + innerH * (1 - tick / 100);
    svg.appendChild(el('line', { ns: 'svg', x1: padding.left, x2: width - padding.right, y1: y, y2: y, class: 'chart-grid-line' }));
    svg.appendChild(el('text', { ns: 'svg', x: padding.left - 8, y: y + 3, class: 'chart-axis-label', 'text-anchor': 'end' }, [`${tick}`]));
  });

  const n = chartData.length;
  if (n === 0) {
    svg.appendChild(el('text', { ns: 'svg', x: width / 2, y: height / 2, class: 'chart-empty-label', 'text-anchor': 'middle' }, ['No completed missions yet']));
    return svg;
  }

  const slot = innerW / n;
  const barWidth = Math.min(34, slot * 0.6);

  chartData.forEach((day, i) => {
    const cx = padding.left + slot * i + slot / 2;
    const hasScore = day.avgFocusPct !== null && day.avgFocusPct !== undefined;
    const pct = hasScore ? day.avgFocusPct : 0;
    const barH = innerH * (pct / 100);
    const y = padding.top + innerH - barH;

    if (hasScore) {
      const rank = getRank(day.avgFocusPct);
      const bar = el('rect', {
        ns: 'svg', x: cx - barWidth / 2, y, width: barWidth, height: Math.max(2, barH), rx: 4,
        class: 'chart-bar', style: `fill: var(${rank.colorVar});`
      }, [
        el('title', { ns: 'svg' }, [`${shortDayLabel(day.date)}: ${Math.round(day.avgFocusPct)}% focus across ${day.count} mission${day.count === 1 ? '' : 's'}`])
      ]);
      svg.appendChild(bar);
      svg.appendChild(el('text', { ns: 'svg', x: cx, y: y - 6, class: 'chart-bar-label', 'text-anchor': 'middle' }, [`${Math.round(day.avgFocusPct)}%`]));
    }

    svg.appendChild(el('text', { ns: 'svg', x: cx, y: height - padding.bottom + 16, class: 'chart-axis-label', 'text-anchor': 'middle' }, [shortDayLabel(day.date)]));
  });

  return svg;
}

/** Horizontal CSS-bar leaderboard, reused for both a single mission's bosses and the all-time list. */
export function buildBossLeaderboard(bosses) {
  if (!bosses || !bosses.length) {
    return el('div', { class: 'empty-note' }, ['No distractions recorded on this one \u2014 nicely done.']);
  }
  const maxMs = Math.max(...bosses.map((b) => b.ms));
  return el('div', { class: 'boss-list' }, bosses.map((boss) => {
    const pct = maxMs > 0 ? (boss.ms / maxMs) * 100 : 0;
    const tierClass = `boss-tier--${boss.tier.replace(/\s+/g, '-').toLowerCase()}`;
    return el('div', { class: 'boss-row' }, [
      el('div', { class: 'boss-row-top' }, [
        el('span', { class: 'boss-emoji' }, [boss.emoji]),
        el('span', { class: 'boss-label' }, [boss.label]),
        el('span', { class: `boss-tier ${tierClass}` }, [boss.tier]),
        el('span', { class: 'boss-time mono' }, [formatDuration(boss.ms, { short: true })])
      ]),
      el('div', { class: 'boss-bar-track' }, [el('div', { class: 'boss-bar-fill', style: `width:${pct}%` })])
    ]);
  }));
}
