// replay/replay.js
// The flagship "Distraction Replay" feature: an animated chronological
// walk through a mission's Attention Trajectory. Every render is owned by
// buildPage(), which is the single entry point — all playback state
// (currentIndex, isPlaying, speed, the pending step timer) lives as local
// closures inside it, so calling buildPage() again (e.g. "Catch Up to Now"
// on a still-active mission) always starts from a clean slate with no
// leftover timers or stale references from the previous render.

import * as missionService from '../utils/missionService.js';
import { buildTimeline, getRank, formatDuration, formatClock } from '../utils/analytics.js';
import { el, clear, setChildren } from '../shared/dom.js';
import { renderTrajectory } from '../shared/timelineView.js';
import { openOrFocusExtensionPage } from '../shared/extensionNav.js';
import { DASHBOARD_PATH, MISSION_STATUS } from '../utils/constants.js';

const root = document.getElementById('replay-root');
const missionId = new URLSearchParams(location.search).get('missionId');
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const SPEED_OPTIONS = [0.5, 1, 2, 4];
const MIN_STEP_MS = 700;
const MAX_STEP_MS = 5000;
const MS_PER_MINUTE_OF_GAP = 2000; // how much real wait-time one "minute of gap" maps to, before speed/clamping

let mission = null;

function buildBackButton() {
  const btn = el('button', { type: 'button', class: 'btn btn-ghost' }, ['\u2190 Back to Dashboard']);
  btn.addEventListener('click', () => openOrFocusExtensionPage(DASHBOARD_PATH));
  return btn;
}

function renderError(message) {
  setChildren(root, [
    el('div', { class: 'panel replay-error' }, [
      el('div', { class: 'panel-title' }, ['Replay Unavailable']),
      el('div', {}, [message]),
      el('div', { style: 'margin-top:16px;' }, [buildBackButton()])
    ])
  ]);
}

/** Sums only the timeline entries visited so far into focus stats. Deliberately
 * separate from utils/analytics.js's mission-level aggregator — "so far" is a
 * UI-only concept during playback (it has no meaning once the mission is over). */
function computeStatsSoFar(visitedItems) {
  let productiveMs = 0;
  let distractingMs = 0;
  let neutralMs = 0;
  for (const item of visitedItems) {
    if (item.type !== 'visit') continue;
    if (item.category === 'productive') productiveMs += item.durationMs;
    else if (item.category === 'distracting') distractingMs += item.durationMs;
    else neutralMs += item.durationMs;
  }
  const denom = productiveMs + distractingMs;
  return { productiveMs, distractingMs, neutralMs, focusPct: denom > 0 ? (productiveMs / denom) * 100 : null };
}

async function init() {
  if (!missionId) {
    renderError('No mission specified. Open a replay from a Mission Report or the popup.');
    return;
  }
  mission = await missionService.findMissionById(missionId);
  if (!mission) {
    renderError('Mission not found \u2014 it may have been cleared from history.');
    return;
  }
  buildPage();
}

async function reload() {
  const fresh = await missionService.findMissionById(missionId);
  if (fresh) mission = fresh;
  buildPage({ jumpToEnd: true });
}

function buildPage({ jumpToEnd = false } = {}) {
  const timeline = buildTimeline(mission, mission.status === MISSION_STATUS.ACTIVE ? Date.now() : (mission.endTime || mission.startTime));

  let currentIndex = 0;
  let isPlaying = false;
  let speed = 1;
  let stepTimer = null;

  clear(root);

  const header = el('div', { class: 'replay-header' }, [
    el('div', {}, [
      el('div', { class: 'eyebrow' }, ['Distraction Replay']),
      el('div', { class: 'replay-mission-name' }, [mission.name]),
      mission.goal ? el('div', { class: 'replay-mission-goal' }, [mission.goal]) : null
    ]),
    buildBackButton()
  ]);

  // ---- Live "so far" stats panel ----
  const liveFocusEl = el('div', { class: 'mono' }, ['\u2014']);
  const liveFocusedEl = el('div', { class: 'mono' }, ['0m']);
  const liveDistractedEl = el('div', { class: 'mono' }, ['0m']);
  const currentSiteEl = el('div', { class: 'replay-current-site' }, ['']);
  const currentTimeEl = el('div', { class: 'replay-current-time mono' }, ['']);
  const stepCounterEl = el('div', { class: 'replay-step-counter mono' }, ['']);

  const statsPanel = el('div', { class: 'panel replay-stats-panel' }, [
    el('div', { class: 'replay-live-focus' }, [liveFocusEl, el('div', { class: 'eyebrow' }, ['Focus So Far'])]),
    el('div', { class: 'replay-live-grid' }, [
      el('div', { class: 'replay-live-tile is-productive' }, [el('div', { class: 'eyebrow' }, ['Focused']), liveFocusedEl]),
      el('div', { class: 'replay-live-tile is-distracting' }, [el('div', { class: 'eyebrow' }, ['Distracted']), liveDistractedEl])
    ]),
    el('div', { class: 'replay-current' }, [el('div', { class: 'eyebrow' }, ['Now Watching']), currentSiteEl, currentTimeEl]),
    stepCounterEl
  ]);

  // ---- Playback controls ----
  const playPauseBtn = el('button', { type: 'button', class: 'btn btn-primary replay-play-btn' }, ['\u25B6 Play']);
  const speedButtons = SPEED_OPTIONS.map((s) => {
    const btn = el('button', { type: 'button', class: `btn btn-ghost btn-sm${s === speed ? ' is-selected' : ''}` }, [`${s}\u00D7`]);
    btn.addEventListener('click', () => {
      speed = s;
      updatePlaybackUI();
    });
    return btn;
  });

  const controlsPanel = el('div', { class: 'panel replay-controls-panel' }, [
    playPauseBtn,
    el('div', { class: 'speed-controls' }, speedButtons)
  ]);

  const endPanelEl = el('div', { class: 'end-panel panel' });
  const timelineContainer = el('div', { class: 'replay-timeline-container' });

  root.appendChild(header);
  root.appendChild(el('div', { class: 'replay-top-row' }, [controlsPanel, statsPanel]));
  root.appendChild(endPanelEl);
  root.appendChild(el('div', { class: 'panel replay-timeline-panel' }, [timelineContainer]));

  const handle = renderTrajectory(timelineContainer, timeline, {
    interactive: true,
    onSeek: (index) => {
      pause();
      setActive(index);
    }
  });

  function setActive(index) {
    for (let i = 0; i < timeline.length; i++) {
      if (i < index) handle.setState(i, 'visited');
      else if (i === index) handle.setState(i, 'active');
      else handle.setState(i, 'upcoming');
    }
    for (let i = 0; i < timeline.length - 1; i++) handle.setConnectorCharged(i, i < index);
    handle.moveCursor(index);
    handle.scrollToIndex(index, { smooth: !prefersReducedMotion });

    currentIndex = index;
    updateLiveStats();
    updatePlaybackUI();
    if (currentIndex >= timeline.length - 1) showEndPanel();
    else hideEndPanel();
  }

  function updateLiveStats() {
    const stats = computeStatsSoFar(timeline.slice(0, currentIndex + 1));
    const rank = getRank(stats.focusPct);
    liveFocusEl.textContent = stats.focusPct === null ? '\u2014' : `${Math.round(stats.focusPct)}%`;
    liveFocusEl.style.color = `var(${rank.colorVar})`;
    liveFocusedEl.textContent = formatDuration(stats.productiveMs, { short: true });
    liveDistractedEl.textContent = formatDuration(stats.distractingMs, { short: true });

    const node = timeline[currentIndex];
    currentSiteEl.textContent = node.type === 'visit' ? `${node.label}${node.ongoing ? ' \u2014 still open' : ''}` : node.label;
    currentTimeEl.textContent = formatClock(node.time);
    stepCounterEl.textContent = `Step ${currentIndex + 1} of ${timeline.length}`;
  }

  function updatePlaybackUI() {
    speedButtons.forEach((btn, i) => btn.classList.toggle('is-selected', SPEED_OPTIONS[i] === speed));
    if (prefersReducedMotion) {
      playPauseBtn.textContent = '\u23E9 Show Result';
      return;
    }
    if (currentIndex >= timeline.length - 1) playPauseBtn.textContent = '\u21BB Replay Again';
    else if (isPlaying) playPauseBtn.textContent = '\u23F8 Pause';
    else playPauseBtn.textContent = currentIndex === 0 ? '\u25B6 Play' : '\u25B6 Resume';
  }

  function stepDurationMs(index) {
    if (index >= timeline.length - 1) return 0;
    const gapMs = timeline[index + 1].time - timeline[index].time;
    const minutes = Math.max(0, gapMs / 60000);
    const base = Math.min(MAX_STEP_MS, Math.max(MIN_STEP_MS, minutes * MS_PER_MINUTE_OF_GAP));
    return base / speed;
  }

  function scheduleNext() {
    clearTimeout(stepTimer);
    if (currentIndex >= timeline.length - 1) {
      isPlaying = false;
      updatePlaybackUI();
      return;
    }
    stepTimer = setTimeout(() => {
      setActive(currentIndex + 1);
      if (currentIndex >= timeline.length - 1) {
        isPlaying = false;
        updatePlaybackUI();
        return;
      }
      if (isPlaying) scheduleNext();
    }, stepDurationMs(currentIndex));
  }

  function play() {
    if (currentIndex >= timeline.length - 1) setActive(0);
    isPlaying = true;
    updatePlaybackUI();
    scheduleNext();
  }

  function pause() {
    isPlaying = false;
    clearTimeout(stepTimer);
    updatePlaybackUI();
  }

  playPauseBtn.addEventListener('click', () => {
    if (prefersReducedMotion) {
      setActive(timeline.length - 1);
      return;
    }
    if (isPlaying) pause();
    else play();
  });

  function showEndPanel() {
    const isMissionActive = mission.status === MISSION_STATUS.ACTIVE;
    const stats = computeStatsSoFar(timeline);
    const rank = getRank(stats.focusPct);

    const replayAgainBtn = el('button', { type: 'button', class: 'btn btn-primary' }, ['\u21BB Replay Again']);
    replayAgainBtn.addEventListener('click', () => {
      pause();
      play();
    });
    const backBtn = buildBackButton();

    let body;
    if (isMissionActive) {
      const refreshBtn = el('button', { type: 'button', class: 'btn btn-ghost' }, ['\u27F3 Catch Up to Now']);
      refreshBtn.addEventListener('click', () => reload());
      body = el('div', { class: 'end-panel-body' }, [
        el('div', { class: 'end-panel-icon' }, ['\uD83D\uDEF0\uFE0F']),
        el('div', { class: 'end-panel-title' }, ['Mission Still in Progress']),
        el('div', { class: 'end-panel-sub' }, ['You\u2019re caught up to the latest tracked activity. Keep the mission running and check back to replay more.']),
        el('div', { class: 'end-panel-actions' }, [refreshBtn, replayAgainBtn, backBtn])
      ]);
    } else {
      const pctLabel = stats.focusPct === null ? 'N/A' : `${Math.round(stats.focusPct)}%`;
      body = el('div', { class: 'end-panel-body' }, [
        el('div', { class: 'rank-badge', dataset: { rank: rank.letter } }, [rank.letter]),
        el('div', { class: 'end-panel-title' }, ['Replay Complete']),
        el('div', { class: 'end-panel-sub' }, [
          `${pctLabel} focus \u00B7 ${formatDuration(stats.productiveMs, { short: true })} focused \u00B7 ${formatDuration(stats.distractingMs, { short: true })} distracted`
        ]),
        el('div', { class: 'end-panel-actions' }, [replayAgainBtn, backBtn])
      ]);
    }

    setChildren(endPanelEl, [body]);
    endPanelEl.classList.add('is-visible');
  }

  function hideEndPanel() {
    endPanelEl.classList.remove('is-visible');
    clear(endPanelEl);
  }

  setActive(jumpToEnd ? timeline.length - 1 : 0);
}

init();
