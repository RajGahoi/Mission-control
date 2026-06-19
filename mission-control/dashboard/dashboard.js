// dashboard/dashboard.js
// A tiny hash-based router over one #content-root: #/live, #/report?missionId=,
// #/analytics, #/config. Each render*View() function is responsible for
// appending everything it needs to contentRoot and registering any interval
// (assigned to routeInterval) or storage subscription (via trackUnsub) it
// needs cleaned up — renderRoute() does that cleanup before every render.

import * as storage from '../utils/storage.js';
import * as missionService from '../utils/missionService.js';
import {
  computeLiveSnapshot, computeMissionReport, computeHistoryAnalytics, aggregateBosses,
  formatDuration, formatClock, formatDateLabel
} from '../utils/analytics.js';
import { el, clear, setChildren } from '../shared/dom.js';
import { createRing } from '../shared/ring.js';
import { renderTrajectory } from '../shared/timelineView.js';
import { createMissionForm } from '../shared/missionForm.js';
import { openOrFocusExtensionPage } from '../shared/extensionNav.js';
import { buildFocusOverTimeChart, buildBossLeaderboard } from './charts.js';
import { MISSION_STATUS, REPLAY_PATH } from '../utils/constants.js';

const contentRoot = document.getElementById('content-root');
const navButtons = Array.from(document.querySelectorAll('.nav-item'));
const sidebarStatusEl = document.getElementById('sidebar-status');

let routeInterval = null;
let routeUnsubs = [];

function stopRouteInterval() {
  if (routeInterval) {
    clearInterval(routeInterval);
    routeInterval = null;
  }
}
function clearRouteSubs() {
  routeUnsubs.forEach((unsub) => unsub());
  routeUnsubs = [];
}
function trackUnsub(unsub) {
  routeUnsubs.push(unsub);
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [view, qs] = raw.split('?');
  return { view: view || 'live', params: new URLSearchParams(qs || '') };
}

function navigate(view, params = {}) {
  const qs = new URLSearchParams(params).toString();
  location.hash = `/${view}${qs ? `?${qs}` : ''}`;
}

function setActiveNav(view) {
  navButtons.forEach((btn) => btn.classList.toggle('is-active', btn.dataset.view === view));
}

async function renderRoute() {
  stopRouteInterval();
  clearRouteSubs();
  clear(contentRoot);
  const { view, params } = parseHash();
  setActiveNav(view);

  try {
    if (view === 'report') await renderReportView(params.get('missionId'));
    else if (view === 'analytics') await renderAnalyticsView();
    else if (view === 'config') await renderConfigView();
    else await renderLiveView();
  } catch (err) {
    console.error('Mission Control dashboard render error:', err);
    contentRoot.appendChild(el('div', { class: 'panel' }, [`Something went wrong rendering this view: ${err.message}`]));
  }
}

window.addEventListener('hashchange', renderRoute);
navButtons.forEach((btn) => btn.addEventListener('click', () => navigate(btn.dataset.view)));

(function bootstrapRoute() {
  if (!location.hash) {
    // Support being opened with a plain query string (from the popup's
    // "View Full Report" / "Dashboard" buttons) by translating it into our
    // hash-based route once, without leaving an extra history entry.
    const qp = new URLSearchParams(location.search);
    const view = qp.get('view') || 'live';
    const missionId = qp.get('missionId');
    const qs = missionId ? `?missionId=${encodeURIComponent(missionId)}` : '';
    history.replaceState(null, '', `${location.pathname}#/${view}${qs}`);
  }
  renderRoute();
})();

// ---------------------------------------------------------------------------
// Sidebar status — always live, independent of whichever view is open
// ---------------------------------------------------------------------------

async function refreshSidebarStatus() {
  const mission = await storage.getCurrentMission();
  if (!mission || mission.status !== MISSION_STATUS.ACTIVE) {
    setChildren(sidebarStatusEl, [el('div', { class: 'sidebar-status-empty' }, ['No active mission'])]);
    return;
  }
  const snap = computeLiveSnapshot(mission, Date.now());
  setChildren(sidebarStatusEl, [
    el('div', { class: 'sidebar-status-name' }, [mission.name]),
    el('div', { class: 'sidebar-status-row' }, ['Focus', el('span', { class: 'mono' }, [snap.focusPct === null ? '\u2014' : `${Math.round(snap.focusPct)}%`])]),
    el('div', { class: 'sidebar-status-row' }, ['Elapsed', el('span', { class: 'mono' }, [formatDuration(snap.elapsedMs, { short: true })])])
  ]);
}
missionService.subscribeCurrentMission(refreshSidebarStatus);
refreshSidebarStatus();
setInterval(refreshSidebarStatus, 5000);

// ---------------------------------------------------------------------------
// Toast (for the Classification view's instant-save feedback)
// ---------------------------------------------------------------------------

let toastTimer = null;
function showToast(message) {
  let toastEl = document.getElementById('save-toast');
  if (!toastEl) {
    toastEl = el('div', { class: 'save-toast', id: 'save-toast' }, ['']);
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = message;
  toastEl.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('is-visible'), 1600);
}

// ---------------------------------------------------------------------------
// View: Home / Live
// ---------------------------------------------------------------------------

async function renderLiveView() {
  trackUnsub(missionService.subscribeCurrentMission(() => renderRoute()));

  const mission = await storage.getCurrentMission();
  const history = await storage.getHistory();
  const recent = [...history].reverse().slice(0, 5);

  const isActive = mission && mission.status === MISSION_STATUS.ACTIVE;

  contentRoot.appendChild(el('div', { class: 'view-header' }, [
    el('div', {}, [
      el('div', { class: 'view-title' }, ['Home']),
      el('div', { class: 'view-subtitle' }, [isActive ? 'Mission in progress \u2014 stay locked in.' : 'No mission running. Launch one below to start tracking.'])
    ])
  ]));

  if (isActive) {
    contentRoot.appendChild(buildLiveMissionPanel(mission));
  } else {
    const formPanel = el('div', { class: 'panel view-section' }, [
      el('div', { class: 'panel-header' }, [el('div', { class: 'panel-title' }, ['Launch a Mission'])])
    ]);
    formPanel.appendChild(createMissionForm({ onStarted: () => renderRoute() }));
    contentRoot.appendChild(formPanel);
  }

  const recentSection = el('div', { class: 'view-section' }, [el('div', { class: 'view-section-title' }, ['Recent Missions'])]);
  if (!recent.length) {
    recentSection.appendChild(el('div', { class: 'empty-note' }, ['No completed missions yet \u2014 your first one will show up here.']));
  } else {
    recentSection.appendChild(el('div', { class: 'recent-list' }, recent.map(buildRecentRow)));
  }
  contentRoot.appendChild(recentSection);
}

function buildRecentRow(mission) {
  const report = computeMissionReport(mission, mission.endTime || mission.startTime);
  const row = el('div', { class: 'recent-row' }, [
    el('div', {
      class: 'rank-badge recent-row-rank',
      dataset: { rank: report.rank.letter },
      style: 'width:40px;height:40px;font-size:18px;'
    }, [report.rank.letter]),
    el('div', { class: 'recent-row-main' }, [
      el('div', { class: 'recent-row-name' }, [mission.name]),
      el('div', { class: 'recent-row-meta' }, [
        `${formatDateLabel(mission.startTime)} \u00B7 ${mission.status === MISSION_STATUS.ABANDONED ? 'Abandoned' : 'Completed'} \u00B7 ${formatDuration(report.durationMs, { short: true })}`
      ])
    ]),
    el('div', { class: 'recent-row-pct mono', style: `color: var(${report.rank.colorVar});` }, [report.focusPct === null ? 'N/A' : `${Math.round(report.focusPct)}%`])
  ]);
  row.addEventListener('click', () => navigate('report', { missionId: mission.id }));
  return row;
}

function buildLiveMissionPanel(mission) {
  const ring = createRing({ size: 152, strokeWidth: 12 });
  const ringPctEl = el('div', { class: 'ring-pct' }, ['\u2014']);
  const ringWrap = el('div', { class: 'ring-wrap-lg' }, [
    ring.svg,
    el('div', { class: 'ring-center-lg' }, [ringPctEl, el('div', { class: 'ring-pct-label' }, ['Focus'])])
  ]);

  const elapsedLeft = el('span', {}, ['Elapsed \u2014']);
  const elapsedRight = el('span', {}, ['Expected \u2014']);
  const expectedFill = el('div', { class: 'expected-bar-fill' });
  const focusedTile = el('div', { class: 'mono' }, ['0m']);
  const distractedTile = el('div', { class: 'mono' }, ['0m']);

  const siteAvatar = el('div', { class: 'current-site-avatar-lg' }, ['\u2014']);
  const siteName = el('div', { class: 'current-site-name-lg' }, ['Not currently tracked']);
  const siteSince = el('div', { class: 'current-site-since-lg' }, ['']);

  const endBtn = el('button', { type: 'button', class: 'btn btn-primary' }, ['\uD83C\uDFC1 End Mission']);
  const previewBtn = el('button', { type: 'button', class: 'btn btn-ghost' }, ['\u25B6 Preview Replay']);
  const abandonBtn = el('button', { type: 'button', class: 'btn btn-danger' }, ['Abandon']);

  endBtn.addEventListener('click', async () => {
    endBtn.disabled = true;
    const finished = await missionService.endMission();
    if (finished) navigate('report', { missionId: finished.id });
  });
  previewBtn.addEventListener('click', () => openOrFocusExtensionPage(REPLAY_PATH, `?missionId=${encodeURIComponent(mission.id)}`));
  abandonBtn.addEventListener('click', async () => {
    if (!window.confirm('Abandon this mission? It will be saved to history, marked abandoned.')) return;
    const finished = await missionService.abandonMission();
    if (finished) navigate('report', { missionId: finished.id });
  });

  const leftPanel = el('div', { class: 'panel' }, [
    el('div', { class: 'ring-panel' }, [
      ringWrap,
      el('div', { class: 'ring-panel-side' }, [
        el('div', { class: 'ring-panel-name' }, [mission.name]),
        mission.goal ? el('div', { class: 'ring-panel-goal' }, [mission.goal]) : null,
        el('div', { class: 'expected-bar-caption' }, [elapsedLeft, elapsedRight]),
        el('div', { class: 'expected-bar-track' }, [expectedFill])
      ])
    ]),
    el('div', { class: 'live-stat-grid' }, [
      el('div', { class: 'live-stat-tile panel is-productive' }, [el('div', { class: 'eyebrow' }, ['Focused']), focusedTile]),
      el('div', { class: 'live-stat-tile panel is-distracting' }, [el('div', { class: 'eyebrow' }, ['Distracted']), distractedTile])
    ]),
    el('div', { class: 'panel current-site-panel' }, [siteAvatar, el('div', { class: 'current-site-info-lg' }, [siteName, siteSince])]),
    el('div', { class: 'live-actions-row' }, [endBtn, previewBtn, abandonBtn])
  ]);

  const bossListContainer = el('div', {}, [el('div', { class: 'empty-note' }, ['No distractions yet \u2014 nicely done.'])]);
  const rightPanel = el('div', { class: 'panel' }, [
    el('div', { class: 'panel-header' }, [el('div', { class: 'panel-title' }, ['Live Distractions'])]),
    bossListContainer
  ]);

  function tick(liveMission) {
    const snap = computeLiveSnapshot(liveMission, Date.now());

    ringPctEl.textContent = snap.focusPct === null ? '\u2014' : `${Math.round(snap.focusPct)}%`;
    ring.setProgress(snap.focusPct, snap.rank.colorVar);

    elapsedLeft.textContent = `Elapsed ${formatDuration(snap.elapsedMs, { short: true })}`;
    elapsedRight.textContent = `Expected ${formatDuration(snap.expectedMs, { short: true })}`;
    const expectedPct = snap.expectedMs > 0 ? (snap.elapsedMs / snap.expectedMs) * 100 : 0;
    expectedFill.style.width = `${Math.min(100, expectedPct)}%`;
    expectedFill.classList.toggle('is-overtime', snap.elapsedMs >= snap.expectedMs);

    focusedTile.textContent = formatDuration(snap.focusedMs, { short: true });
    distractedTile.textContent = formatDuration(snap.distractedMs, { short: true });

    if (snap.currentSegment) {
      siteAvatar.className = `current-site-avatar-lg cat-${snap.currentSegment.category}`;
      siteAvatar.textContent = snap.currentSegment.label.charAt(0).toUpperCase();
      siteName.textContent = snap.currentSegment.label;
      siteSince.textContent = `${formatDuration(snap.currentSegment.sinceMs, { short: true })} on this site`;
    } else {
      siteAvatar.className = 'current-site-avatar-lg';
      siteAvatar.textContent = '\u2014';
      siteName.textContent = 'Not currently tracked';
      siteSince.textContent = 'Switch to a tab to resume tracking';
    }

    setChildren(bossListContainer, [buildBossLeaderboard(aggregateBosses(liveMission))]);
  }

  tick(mission);
  routeInterval = setInterval(async () => {
    const fresh = await storage.getCurrentMission();
    if (!fresh || fresh.status !== MISSION_STATUS.ACTIVE) {
      renderRoute();
      return;
    }
    tick(fresh);
  }, 1000);

  return el('div', { class: 'live-grid' }, [leftPanel, rightPanel]);
}

// ---------------------------------------------------------------------------
// View: Mission Report
// ---------------------------------------------------------------------------

async function renderReportView(missionId) {
  const current = await storage.getCurrentMission();
  const history = await storage.getHistory();
  const sortedHistory = [...history].sort((a, b) => (b.endTime || b.startTime) - (a.endTime || a.startTime));
  const currentIsActive = current && current.status === MISSION_STATUS.ACTIVE;

  let mission = null;
  if (missionId) mission = await missionService.findMissionById(missionId);
  if (!mission && currentIsActive) mission = current;
  if (!mission) mission = sortedHistory[0] || null;

  contentRoot.appendChild(el('div', { class: 'view-header' }, [
    el('div', {}, [
      el('div', { class: 'view-title' }, ['Mission Report']),
      el('div', { class: 'view-subtitle' }, ['A finished flight recording \u2014 every site, in order.'])
    ])
  ]));

  if (!mission) {
    contentRoot.appendChild(el('div', { class: 'panel' }, [
      el('div', { class: 'empty-note' }, ['No missions yet. Start one from the Home tab to get your first report.'])
    ]));
    return;
  }

  const options = [];
  if (currentIsActive) {
    options.push(el('option', { value: current.id, selected: mission.id === current.id || undefined }, [`\uD83D\uDFE2 ${current.name} (live)`]));
  }
  for (const m of sortedHistory) {
    const label = `${m.name} \u2014 ${formatDateLabel(m.startTime)}${m.status === MISSION_STATUS.ABANDONED ? ' (abandoned)' : ''}`;
    options.push(el('option', { value: m.id, selected: mission.id === m.id || undefined }, [label]));
  }
  const picker = el('select', {}, options);
  picker.addEventListener('change', () => navigate('report', { missionId: picker.value }));
  contentRoot.appendChild(el('div', { class: 'report-picker' }, [el('span', { class: 'eyebrow' }, ['Viewing']), picker]));

  const isLiveMission = mission.status === MISSION_STATUS.ACTIVE;
  const report = computeMissionReport(mission, isLiveMission ? Date.now() : (mission.endTime || mission.startTime));

  const replayBtn = el('button', { type: 'button', class: 'btn btn-primary' }, ['\u25B6 Replay Mission']);
  replayBtn.addEventListener('click', () => openOrFocusExtensionPage(REPLAY_PATH, `?missionId=${encodeURIComponent(mission.id)}`));

  const statusBadge = isLiveMission
    ? el('span', { class: 'badge badge--neutral' }, ['LIVE'])
    : (mission.status === MISSION_STATUS.ABANDONED
      ? el('span', { class: 'badge badge--distracting' }, ['Abandoned'])
      : el('span', { class: 'badge badge--productive' }, ['Completed']));

  const summaryPanel = el('div', { class: 'panel view-section' }, [
    el('div', { class: 'report-summary' }, [
      el('div', { class: 'rank-badge', dataset: { rank: report.rank.letter } }, [report.rank.letter]),
      el('div', { class: 'report-summary-main' }, [
        el('div', { class: 'report-summary-name' }, [mission.name]),
        mission.goal ? el('div', { class: 'report-summary-goal' }, [mission.goal]) : null,
        el('div', { class: 'report-summary-dates' }, [
          `${formatDateLabel(mission.startTime)} \u00B7 ${formatClock(mission.startTime)} \u2192 ${isLiveMission ? 'in progress' : formatClock(mission.endTime)}`
        ])
      ]),
      statusBadge
    ]),
    el('div', { class: 'report-stat-row' }, [
      el('div', { class: 'report-stat-tile panel is-productive' }, [el('div', { class: 'eyebrow' }, ['Focus']), el('div', { class: 'mono' }, [report.focusPct === null ? 'N/A' : `${Math.round(report.focusPct)}%`])]),
      el('div', { class: 'report-stat-tile panel is-productive' }, [el('div', { class: 'eyebrow' }, ['Focused']), el('div', { class: 'mono' }, [formatDuration(report.focusedMs, { short: true })])]),
      el('div', { class: 'report-stat-tile panel is-distracting' }, [el('div', { class: 'eyebrow' }, ['Distracted']), el('div', { class: 'mono' }, [formatDuration(report.distractedMs, { short: true })])]),
      el('div', { class: 'report-stat-tile panel is-neutral' }, [el('div', { class: 'eyebrow' }, ['Total Duration']), el('div', { class: 'mono' }, [formatDuration(report.durationMs, { short: true })])])
    ]),
    el('div', { class: 'report-replay-cta' }, [replayBtn])
  ]);
  contentRoot.appendChild(summaryPanel);

  contentRoot.appendChild(el('div', { class: 'panel view-section' }, [
    el('div', { class: 'panel-header' }, [el('div', { class: 'panel-title' }, ['\uD83D\uDC79 Boss Leaderboard'])]),
    buildBossLeaderboard(report.bosses)
  ]));

  const trajectoryContainer = el('div', { class: 'trajectory-panel' });
  contentRoot.appendChild(el('div', { class: 'panel view-section' }, [
    el('div', { class: 'panel-header' }, [el('div', { class: 'panel-title' }, ['\uD83D\uDEF0\uFE0F Attention Trajectory'])]),
    trajectoryContainer
  ]));
  renderTrajectory(trajectoryContainer, report.timeline, { interactive: false });

  if (isLiveMission) {
    // Lightweight refresh for the rare "preview an in-progress mission's
    // report" case — not as smooth as the Home tab's per-second ticking,
    // but this view is read-only, so a periodic full re-render is simplest.
    routeInterval = setInterval(() => renderRoute(), 5000);
  }
}

// ---------------------------------------------------------------------------
// View: Weekly Analytics
// ---------------------------------------------------------------------------

async function renderAnalyticsView() {
  const history = await storage.getHistory();
  const stats = computeHistoryAnalytics(history);

  contentRoot.appendChild(el('div', { class: 'view-header' }, [
    el('div', {}, [
      el('div', { class: 'view-title' }, ['Weekly Analytics']),
      el('div', { class: 'view-subtitle' }, ['Patterns across every mission you\u2019ve logged.'])
    ])
  ]));

  contentRoot.appendChild(el('div', { class: 'analytics-summary-grid view-section' }, [
    el('div', { class: 'analytics-summary-tile panel' }, [el('div', { class: 'eyebrow' }, ['Total Missions']), el('div', { class: 'mono' }, [String(stats.totalMissions)])]),
    el('div', { class: 'analytics-summary-tile panel' }, [el('div', { class: 'eyebrow' }, ['Average Focus']), el('div', { class: 'mono' }, [stats.averageFocusPct === null ? 'N/A' : `${Math.round(stats.averageFocusPct)}%`])]),
    el('div', { class: 'analytics-summary-tile panel' }, [
      el('div', { class: 'eyebrow' }, ['Most Common Distraction']),
      el('div', { class: 'mono' }, [stats.mostCommonDistraction ? `${stats.mostCommonDistraction.emoji} ${stats.mostCommonDistraction.label}` : '\u2014'])
    ]),
    el('div', { class: 'analytics-summary-tile panel' }, [
      el('div', { class: 'eyebrow' }, ['Best Day']),
      el('div', { class: 'mono' }, [stats.bestDay ? `${Math.round(stats.bestDay.avgFocusPct)}%` : '\u2014']),
      stats.bestDay ? el('div', { class: 'summary-sub' }, [formatDateLabel(stats.bestDay.time)]) : null
    ]),
    el('div', { class: 'analytics-summary-tile panel' }, [
      el('div', { class: 'eyebrow' }, ['Toughest Day']),
      el('div', { class: 'mono' }, [stats.worstDay ? `${Math.round(stats.worstDay.avgFocusPct)}%` : '\u2014']),
      stats.worstDay ? el('div', { class: 'summary-sub' }, [formatDateLabel(stats.worstDay.time)]) : null
    ])
  ]));

  contentRoot.appendChild(el('div', { class: 'panel view-section' }, [
    el('div', { class: 'panel-header' }, [el('div', { class: 'panel-title' }, ['Focus % \u2014 Last 14 Active Days'])]),
    buildFocusOverTimeChart(stats.chartData)
  ]));

  contentRoot.appendChild(el('div', { class: 'panel view-section' }, [
    el('div', { class: 'panel-header' }, [el('div', { class: 'panel-title' }, ['\uD83D\uDC51 All-Time Boss Leaderboard'])]),
    buildBossLeaderboard(stats.allTimeBosses)
  ]));

  const sortedHistory = [...history].sort((a, b) => (b.endTime || b.startTime) - (a.endTime || a.startTime));
  const tableSection = el('div', { class: 'panel view-section' }, [
    el('div', { class: 'panel-header' }, [el('div', { class: 'panel-title' }, ['Mission History'])])
  ]);
  if (!sortedHistory.length) {
    tableSection.appendChild(el('div', { class: 'empty-note' }, ['No missions logged yet.']));
  } else {
    const rows = sortedHistory.map((m) => {
      const report = computeMissionReport(m, m.endTime || m.startTime);
      const tr = el('tr', {}, [
        el('td', { class: 'is-name' }, [m.name]),
        el('td', {}, [formatDateLabel(m.startTime)]),
        el('td', {}, [m.status === MISSION_STATUS.ABANDONED ? 'Abandoned' : 'Completed']),
        el('td', { class: 'is-mono' }, [report.focusPct === null ? 'N/A' : `${Math.round(report.focusPct)}%`]),
        el('td', {}, [el('span', { class: 'rank-badge', dataset: { rank: report.rank.letter }, style: 'width:32px;height:32px;font-size:13px;' }, [report.rank.letter])]),
        el('td', { class: 'is-mono' }, [formatDuration(report.durationMs, { short: true })])
      ]);
      tr.addEventListener('click', () => navigate('report', { missionId: m.id }));
      return tr;
    });
    const table = el('table', { class: 'history-table' }, [
      el('thead', {}, [el('tr', {}, [
        el('th', {}, ['Mission']), el('th', {}, ['Date']), el('th', {}, ['Status']),
        el('th', {}, ['Focus']), el('th', {}, ['Rank']), el('th', {}, ['Duration'])
      ])]),
      el('tbody', {}, rows)
    ]);
    tableSection.appendChild(el('div', { class: 'history-table-wrap' }, [table]));
  }
  contentRoot.appendChild(tableSection);
}

// ---------------------------------------------------------------------------
// View: Classification Config
// ---------------------------------------------------------------------------

function buildSwitch(checked, onChange) {
  const input = el('input', { type: 'checkbox' });
  input.checked = !!checked;
  input.addEventListener('change', () => onChange(input.checked));
  return el('label', { class: 'switch' }, [input, el('span', { class: 'switch-track' })]);
}

function buildChipColumn({ title, category, classification }) {
  const chipListEl = el('div', { class: 'chip-list' });
  const input = el('input', { type: 'text', placeholder: 'e.g. example.com or example.com/path' });
  const addBtn = el('button', { type: 'button', class: 'btn btn-ghost btn-sm' }, ['+ Add']);

  function renderChips() {
    const chips = classification[category].map((rule) => {
      const removeBtn = el('button', { type: 'button', class: 'chip-remove', 'aria-label': `Remove ${rule}` }, ['\u00D7']);
      removeBtn.addEventListener('click', async () => {
        classification[category] = classification[category].filter((r) => r !== rule);
        await storage.setClassification(classification);
        showToast('Saved');
        renderChips();
      });
      return el('span', { class: `chip is-${category}` }, [rule, removeBtn]);
    });
    if (!chips.length) chips.push(el('span', { class: 'empty-note' }, ['No rules yet.']));
    setChildren(chipListEl, chips);
  }

  async function addRule() {
    const value = input.value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
    if (!value) return;
    if (!classification[category].includes(value)) {
      classification[category] = [...classification[category], value];
      await storage.setClassification(classification);
      showToast('Saved');
      renderChips();
    }
    input.value = '';
    input.focus();
  }

  addBtn.addEventListener('click', addRule);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addRule();
    }
  });

  renderChips();

  return el('div', { class: 'panel' }, [
    el('div', { class: 'panel-header' }, [el('div', { class: 'panel-title' }, [title])]),
    chipListEl,
    el('div', { class: 'chip-add-row' }, [input, addBtn])
  ]);
}

async function renderConfigView() {
  const classification = await storage.getClassification();
  const settings = await storage.getSettings();

  const resetBtn = el('button', { type: 'button', class: 'btn btn-ghost btn-sm' }, ['Reset to Defaults']);
  resetBtn.addEventListener('click', async () => {
    if (!window.confirm('Reset productive/distracting lists back to the built-in defaults? This cannot be undone.')) return;
    await storage.resetClassification();
    showToast('Reset to defaults');
    renderRoute();
  });

  contentRoot.appendChild(el('div', { class: 'view-header' }, [
    el('div', {}, [
      el('div', { class: 'view-title' }, ['Classification']),
      el('div', { class: 'view-subtitle' }, ['Decide what counts as productive vs. distracting. Changes save instantly and apply to new browsing right away.'])
    ]),
    el('div', { class: 'view-header-actions' }, [resetBtn])
  ]));

  contentRoot.appendChild(el('div', { class: 'config-grid view-section' }, [
    buildChipColumn({ title: '\u2705 Productive', category: 'productive', classification }),
    buildChipColumn({ title: '\u26A0\uFE0F Distracting', category: 'distracting', classification })
  ]));

  contentRoot.appendChild(el('div', { class: 'view-section' }, [
    el('div', { class: 'config-hint' }, [
      'Rules can be a whole domain ("reddit.com") or a domain plus path prefix ("youtube.com/shorts") to target just one section of a site. If a site matches both lists, productive wins.'
    ])
  ]));

  const notifSwitch = buildSwitch(settings.notificationsEnabled, async (checked) => {
    const fresh = await storage.getSettings();
    fresh.notificationsEnabled = checked;
    await storage.setSettings(fresh);
    showToast('Saved');
  });
  const overtimeSwitch = buildSwitch(settings.overtimeAlertsEnabled, async (checked) => {
    const fresh = await storage.getSettings();
    fresh.overtimeAlertsEnabled = checked;
    await storage.setSettings(fresh);
    showToast('Saved');
  });
  const thresholdInput = el('input', { type: 'number', min: 1, max: 120, value: settings.bossAlertThresholdMinutes });
  thresholdInput.addEventListener('change', async () => {
    const minutes = Math.max(1, Number(thresholdInput.value) || 1);
    thresholdInput.value = minutes;
    const fresh = await storage.getSettings();
    fresh.bossAlertThresholdMinutes = minutes;
    await storage.setSettings(fresh);
    showToast('Saved');
  });

  contentRoot.appendChild(el('div', { class: 'panel view-section' }, [
    el('div', { class: 'panel-header' }, [el('div', { class: 'panel-title' }, ['Notifications'])]),
    el('div', { class: 'settings-row' }, [
      el('div', {}, [el('div', { class: 'settings-row-label' }, ['Mission notifications']), el('div', { class: 'settings-row-desc' }, ['Launch / complete / abandon alerts.'])]),
      el('div', { class: 'settings-row-control' }, [notifSwitch])
    ]),
    el('div', { class: 'settings-row' }, [
      el('div', {}, [el('div', { class: 'settings-row-label' }, ['Overtime + boss alerts']), el('div', { class: 'settings-row-desc' }, ['Get notified when you run over your expected duration or binge a distraction.'])]),
      el('div', { class: 'settings-row-control' }, [overtimeSwitch])
    ]),
    el('div', { class: 'settings-row' }, [
      el('div', {}, [el('div', { class: 'settings-row-label' }, ['Boss alert threshold']), el('div', { class: 'settings-row-desc' }, ['Minutes on one distracting site before a boss alert fires.'])]),
      el('div', { class: 'settings-row-control' }, [thresholdInput, el('span', { class: 'eyebrow' }, ['min'])])
    ])
  ]));
}
