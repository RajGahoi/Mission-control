// shared/timelineView.js
// Renders the "Attention Trajectory" component described in shared/timeline.css.
// This module only builds DOM and exposes small state-setting primitives —
// it has no opinion about *when* nodes change state. dashboard.js calls this
// once with interactive:false and lets every node render fully "visited"
// (a finished report). replay.js calls it with interactive:true and then
// drives setState/setConnectorCharged/moveCursor itself on a timer.

import { el, clear } from './dom.js';
import { formatClock, formatDuration } from '../utils/analytics.js';

const CONNECTOR_MIN_PX = 26;
const CONNECTOR_MAX_PX = 170;

function connectorHeightPx(gapMs) {
  const minutes = Math.max(0, gapMs / 60000);
  const px = 26 + 15 * Math.sqrt(minutes);
  return Math.min(CONNECTOR_MAX_PX, Math.max(CONNECTOR_MIN_PX, Math.round(px)));
}

function isAbandonLabel(label) {
  return typeof label === 'string' && label.toLowerCase().includes('abandon');
}

function categoryClass(item) {
  if (item.type === 'start') return 'cat-start';
  if (item.type === 'end') return isAbandonLabel(item.label) ? 'cat-end-abandon' : 'cat-end-complete';
  return `cat-${item.category || 'neutral'}`;
}

function colorVarForItem(item) {
  if (item.type === 'start') return 'var(--accent-cyan)';
  if (item.type === 'end') return isAbandonLabel(item.label) ? 'var(--cat-distracting)' : 'var(--rank-s)';
  return `var(--cat-${item.category || 'neutral'})`;
}

function nodeIcon(item) {
  if (item.type === 'start') return '🚀';
  if (item.type === 'end') return isAbandonLabel(item.label) ? '🛑' : '🏁';
  const letter = (item.label || '?').trim().charAt(0).toUpperCase();
  return letter || '?';
}

function badgeForCategory(category) {
  if (!category) return null;
  const text = category.charAt(0).toUpperCase() + category.slice(1);
  return el('span', { class: `badge badge--${category}` }, [text]);
}

/**
 * @param {HTMLElement} container - cleared and populated with the timeline
 * @param {Array} items - output of utils/analytics.js buildTimeline()
 * @param {Object} opts
 * @param {boolean} opts.interactive - replay mode (dim/cursor/clickable) vs static report mode
 * @param {(index:number)=>void} [opts.onSeek] - called when a node is clicked (interactive mode only)
 * @returns {{nodes:Array, setState:Function, setConnectorCharged:Function, moveCursor:Function, scrollToIndex:Function}}
 */
export function renderTrajectory(container, items, opts = {}) {
  const interactive = !!opts.interactive;
  clear(container);
  container.classList.add('trajectory');

  if (!items || !items.length) {
    container.appendChild(el('div', { class: 'trajectory-empty' }, ['No activity recorded for this mission yet.']));
    return { nodes: [], setState() {}, setConnectorCharged() {}, moveCursor() {}, scrollToIndex() {} };
  }

  const nodes = [];

  items.forEach((item, index) => {
    const cat = categoryClass(item);
    const isLast = index === items.length - 1;

    const nodeEl = el('div', { class: `trajectory-node ${cat}` }, [
      el('span', { class: 'trajectory-node-icon' }, [nodeIcon(item)])
    ]);

    let connectorEl = null;
    if (!isLast) {
      const gapMs = (items[index + 1].time ?? item.time) - item.time;
      connectorEl = el('div', {
        class: 'trajectory-connector',
        dataset: { cat: item.type === 'start' ? 'start' : (item.category || 'neutral') },
        style: `--connector-h: ${connectorHeightPx(gapMs)}px`
      });
    }

    const railChildren = [nodeEl];
    if (connectorEl) railChildren.push(connectorEl);
    const railEl = el('div', { class: 'trajectory-rail' }, railChildren);

    const labelChildren = [item.label];
    if (item.type === 'visit') labelChildren.push(badgeForCategory(item.category));
    if (item.ongoing) labelChildren.push(el('span', { class: 'trajectory-live-tag' }, ['LIVE']));

    const contentChildren = [
      el('div', { class: 'trajectory-time mono' }, [formatClock(item.time)]),
      el('div', { class: 'trajectory-label' }, labelChildren)
    ];

    if (item.type === 'visit') {
      const durationLabel = formatDuration(item.durationMs, { short: true }) + (item.ongoing ? ' so far' : '');
      const metaText = item.domain ? `${durationLabel} \u00B7 ${item.domain}` : durationLabel;
      contentChildren.push(el('div', { class: 'trajectory-meta mono' }, [metaText]));
    }

    const contentEl = el('div', { class: 'trajectory-content' }, contentChildren);

    const classes = ['trajectory-item', interactive ? 'is-upcoming' : 'is-visited'];
    if (interactive) classes.push('is-clickable');

    const itemEl = el('div', { class: classes.join(' '), dataset: { index } }, [railEl, contentEl]);
    if (interactive && typeof opts.onSeek === 'function') {
      itemEl.addEventListener('click', () => opts.onSeek(index));
    }

    container.appendChild(itemEl);
    nodes.push({ el: itemEl, nodeEl, connectorEl, item, index });
  });

  let cursorEl = null;
  if (interactive) {
    cursorEl = el('div', { class: 'trajectory-cursor' });
    container.appendChild(cursorEl);
  }

  function setState(index, state) {
    const entry = nodes[index];
    if (!entry) return;
    entry.el.classList.remove('is-upcoming', 'is-active', 'is-visited');
    entry.el.classList.add(`is-${state}`);
  }

  function setConnectorCharged(index, charged) {
    const entry = nodes[index];
    if (!entry || !entry.connectorEl) return;
    entry.connectorEl.classList.toggle('is-charged', !!charged);
  }

  function moveCursor(index) {
    if (!cursorEl) return;
    const entry = nodes[index];
    if (!entry) return;
    cursorEl.style.top = `${entry.nodeEl.offsetTop}px`;
    cursorEl.style.setProperty('--cursor-color', colorVarForItem(entry.item));
  }

  function scrollToIndex(index, { smooth = true } = {}) {
    const entry = nodes[index];
    if (!entry) return;
    entry.el.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'center' });
  }

  if (interactive) moveCursor(0);

  return { nodes, setState, setConnectorCharged, moveCursor, scrollToIndex };
}
