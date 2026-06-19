// popup/popup.js
// Three states, one #view-root:
//   1. No active mission             -> Start Mission form
//   2. Active mission                -> live ticking stats + End/Abandon
//   3. Just ended (this popup only)  -> Rank callout + Replay/Report CTAs
//
// State 3 is intentionally ephemeral (plain JS variable, not storage) — if
// the popup is closed and reopened, it falls back to state 1 or 2. That's
// fine: the *real* report lives in the dashboard/replay pages, this is
// just a "nice catch" right after the moment of finishing.

import * as missionService from '../utils/missionService.js';
import * as storage from '../utils/storage.js';
import { computeLiveSnapshot, computeMissionReport, formatDuration } from '../utils/analytics.js';
import { DASHBOARD_PATH, REPLAY_PATH, MISSION_STATUS } from '../utils/constants.js';
import { el, setChildren } from '../shared/dom.js';
import { createRing } from '../shared/ring.js';
import { createMissionForm } from '../shared/missionForm.js';
import { openOrFocusExtensionPage } from '../shared/extensionNav.js';

const viewRoot = document.getElementById('view-root');
const dashboardBtn = document.getElementById('open-dashboard-btn');

let tickHandle = null;
let lastCompletedMission = null;

function stopTicking() {
  if (tickHandle) {
    clearInterval(tickHandle);
    tickHandle = null;
  }
}

dashboardBtn.addEventListener('click', () => openOrFocusExtensionPage(DASHBOARD_PATH));

// ---------------------------------------------------------------------------
// 1. Start Mission form
// ---------------------------------------------------------------------------

function renderStartForm() {
  stopTicking();
  const form = createMissionForm({ onStarted: () => refresh() });
  setChildren(viewRoot, [el('div', { class: 'eyebrow' }, ['New Mission']), form]);
}

// ---------------------------------------------------------------------------
// 2. Active mission — live ticking view
// ---------------------------------------------------------------------------

function renderLiveView(mission) {
  stopTicking();

  const ring = createRing({ size: 92, strokeWidth: 9 });
  const ringPct = el('div', { class: 'ring-pct mono' }, ['\u2014']);
  const ringWrap = el('div', { class: 'ring-wrap' }, [
    ring.svg,
    el('div', { class: 'ring-center' }, [ringPct, el('div', { class: 'ring-pct-label' }, ['Focus'])])
  ]);

  const elapsedVal = el('span', { class: 'mono' }, ['0m']);
  const expectedVal = el('span', { class: 'elapsed-of' }, ['']);
  const expectedFill = el('div', { class: 'expected-bar-fill' });
  const focusedTile = el('div', { class: 'mono' }, ['0m']);
  const distractedTile = el('div', { class: 'mono' }, ['0m']);

  const siteAvatar = el('div', { class: 'current-site-avatar' }, ['\u2014']);
  const siteName = el('div', { class: 'current-site-name' }, ['Not currently tracked']);
  const siteSince = el('div', { class: 'current-site-since' }, ['']);

  const endBtn = el('button', { type: 'button', class: 'btn btn-primary' }, ['\uD83C\uDFC1 End']);
  const dashBtn = el('button', { type: 'button', class: 'btn btn-ghost' }, ['\uD83D\uDCCA Dashboard']);
  const abandonBtn = el('button', { type: 'button', class: 'abandon-link' }, ['Abandon mission']);

  endBtn.addEventListener('click', async () => {
    endBtn.disabled = true;
    const finished = await missionService.endMission();
    lastCompletedMission = finished;
    await refresh();
  });
  dashBtn.addEventListener('click', () => openOrFocusExtensionPage(DASHBOARD_PATH, '?view=live'));
  abandonBtn.addEventListener('click', async () => {
    const ok = window.confirm('Abandon this mission? It will be saved to history, marked abandoned.');
    if (!ok) return;
    const finished = await missionService.abandonMission();
    lastCompletedMission = finished;
    await refresh();
  });

  setChildren(viewRoot, [
    el('div', { class: 'live-header' }, [
      el('div', { class: 'live-mission-name' }, [mission.name]),
      mission.goal ? el('div', { class: 'live-mission-goal' }, [mission.goal]) : null
    ]),
    el('div', { class: 'live-top' }, [
      ringWrap,
      el('div', { class: 'live-top-stats' }, [
        el('div', { class: 'elapsed-row' }, [elapsedVal, expectedVal]),
        el('div', { class: 'expected-bar-track' }, [expectedFill]),
        el('div', { class: 'stat-grid' }, [
          el('div', { class: 'stat-tile is-productive' }, [el('div', { class: 'eyebrow' }, ['Focused']), focusedTile]),
          el('div', { class: 'stat-tile is-distracting' }, [el('div', { class: 'eyebrow' }, ['Distracted']), distractedTile])
        ])
      ])
    ]),
    el('div', { class: 'panel current-site' }, [siteAvatar, el('div', { class: 'current-site-info' }, [siteName, siteSince])]),
    el('div', { class: 'live-actions' }, [endBtn, dashBtn]),
    abandonBtn
  ]);

  function tick(liveMission) {
    const snap = computeLiveSnapshot(liveMission, Date.now());

    ringPct.textContent = snap.focusPct === null ? '\u2014' : `${Math.round(snap.focusPct)}%`;
    ring.setProgress(snap.focusPct, snap.rank.colorVar);

    elapsedVal.textContent = formatDuration(snap.elapsedMs, { short: true });
    expectedVal.textContent = `of ${formatDuration(snap.expectedMs, { short: true })} expected`;
    const expectedPct = snap.expectedMs > 0 ? (snap.elapsedMs / snap.expectedMs) * 100 : 0;
    expectedFill.style.width = `${Math.min(100, expectedPct)}%`;
    expectedFill.classList.toggle('is-overtime', snap.elapsedMs >= snap.expectedMs);

    focusedTile.textContent = formatDuration(snap.focusedMs, { short: true });
    distractedTile.textContent = formatDuration(snap.distractedMs, { short: true });

    if (snap.currentSegment) {
      siteAvatar.className = `current-site-avatar cat-${snap.currentSegment.category}`;
      siteAvatar.textContent = snap.currentSegment.label.charAt(0).toUpperCase();
      siteName.textContent = snap.currentSegment.label;
      siteSince.textContent = `${formatDuration(snap.currentSegment.sinceMs, { short: true })} on this site`;
    } else {
      siteAvatar.className = 'current-site-avatar';
      siteAvatar.textContent = '\u2014';
      siteName.textContent = 'Not currently tracked';
      siteSince.textContent = 'Switch to a tab to resume tracking';
    }
  }

  tick(mission);
  tickHandle = setInterval(async () => {
    const fresh = await storage.getCurrentMission();
    if (!fresh || fresh.status !== MISSION_STATUS.ACTIVE) {
      await refresh();
      return;
    }
    tick(fresh);
  }, 1000);
}

// ---------------------------------------------------------------------------
// 3. Just-completed callout
// ---------------------------------------------------------------------------

function renderCompletedView(mission) {
  stopTicking();

  const report = computeMissionReport(mission, mission.endTime);
  const rank = report.rank;
  const isAbandoned = mission.status === MISSION_STATUS.ABANDONED;
  const pctLabel = report.focusPct === null ? 'N/A' : `${Math.round(report.focusPct)}%`;
  const statsLine = `${pctLabel} focus \u00B7 ${formatDuration(report.focusedMs, { short: true })} focused \u00B7 ${formatDuration(report.distractedMs, { short: true })} distracted`;

  const replayBtn = el('button', { type: 'button', class: 'btn btn-primary btn-block' }, ['\u25B6 Replay Mission']);
  const reportBtn = el('button', { type: 'button', class: 'btn btn-ghost btn-block' }, ['View Full Report']);
  const newMissionBtn = el('button', { type: 'button', class: 'btn btn-ghost btn-block' }, ['Start Another Mission']);

  replayBtn.addEventListener('click', () => openOrFocusExtensionPage(REPLAY_PATH, `?missionId=${encodeURIComponent(mission.id)}`));
  reportBtn.addEventListener('click', () => openOrFocusExtensionPage(DASHBOARD_PATH, `?view=report&missionId=${encodeURIComponent(mission.id)}`));
  newMissionBtn.addEventListener('click', () => {
    lastCompletedMission = null;
    renderStartForm();
  });

  setChildren(viewRoot, [
    el('div', { class: 'complete-callout' }, [
      el('div', { class: 'rank-badge', dataset: { rank: rank.letter } }, [rank.letter]),
      el('div', { class: 'complete-title' }, [isAbandoned ? '\uD83D\uDED1 Mission Abandoned' : `\uD83C\uDFC1 Mission Complete \u2014 Rank ${rank.letter}`]),
      el('div', { class: 'complete-stats' }, [statsLine]),
      el('div', { class: 'complete-actions' }, [replayBtn, reportBtn, newMissionBtn])
    ])
  ]);
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

async function refresh() {
  const mission = await storage.getCurrentMission();
  if (mission && mission.status === MISSION_STATUS.ACTIVE) {
    lastCompletedMission = null;
    renderLiveView(mission);
    return;
  }
  if (lastCompletedMission) {
    renderCompletedView(lastCompletedMission);
    return;
  }
  renderStartForm();
}

missionService.subscribeCurrentMission(() => { refresh(); });

refresh();
