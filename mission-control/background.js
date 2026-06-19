// background.js (MV3 service worker, type: "module")
//
// Responsibility: the ONLY place that writes mission.events / mission.activeSegment.
// Popup/dashboard/replay only ever read mission data or flip mission.status
// (start/end/abandon) via missionService — they never touch events or
// activeSegment directly. That single-writer rule is what keeps tab
// tracking correct even when three different pages might be open at once.
//
// Design note: MV3 service workers can be killed and restarted between any
// two events. So every handler below re-reads currentMission from
// chrome.storage.local at the top (never trusts in-memory state across
// events) and writes the full updated mission back at the end. That makes
// every handler idempotent and safe to "wake up cold" for.

import * as storage from './utils/storage.js';
import { classify, getDomain, findMatchingRule } from './utils/classifier.js';
import { computeLiveSnapshot, computeMissionReport, formatDuration } from './utils/analytics.js';
import { MISSION_STATUS, CATEGORY, ALARM_NAME, HEARTBEAT_PERIOD_MINUTES } from './utils/constants.js';

const ICON = 'icons/icon128.png';
const OFFSCREEN_URL = chrome.runtime.getURL('offscreen/offscreen.html');

// ---------------------------------------------------------------------------
// Instant distraction alert helpers (notification + badge + sound)
// ---------------------------------------------------------------------------

/**
 * Fires the moment the active segment switches TO a distracting site.
 * Only triggers when the *previous* segment was NOT distracting (or there
 * was no segment), so switching between two distracting tabs doesn't spam.
 * A 90-second cooldown per domain stops repeated alerts if you switch away
 * and back quickly.
 */
async function handleDistractingAlert(mission, prevCategory) {
  const seg = mission.activeSegment;

  if (!seg || seg.category !== CATEGORY.DISTRACTING) {
    // Cleared to non-distracting — reset badge
    chrome.action.setBadgeText({ text: '' });
    return;
  }

  // Always keep the badge lit while on a distracting site
  chrome.action.setBadgeText({ text: '!' });
  chrome.action.setBadgeBackgroundColor({ color: '#FF3D8F' });

  // Only show the alert when *entering* a distracting site (not while staying on one)
  if (prevCategory === CATEGORY.DISTRACTING) return;

  const settings = await storage.getSettings();
  if (!settings.notificationsEnabled) return;

  // Per-domain cooldown: don't re-alert the same domain within 90 seconds
  const cooldownKey = `distract_last_${seg.domain}`;
  const stored = await storage.getRaw(cooldownKey);
  const lastAlert = stored ? Number(stored) : 0;
  if (Date.now() - lastAlert < 90_000) return;
  await storage.setRaw(cooldownKey, String(Date.now()));

  const siteLabel = seg.classKey || seg.domain;
  notify(
    `distract_enter_${Date.now()}`,
    '\u26A0\uFE0F Distraction Detected',
    `You opened "${siteLabel}" during your mission. Stay on course!`
  );

  // Play the two-tone alert via the offscreen document
  await playAlertSound();
}

async function playAlertSound() {
  try {
    const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
    if (!contexts.length) {
      await chrome.offscreen.createDocument({
        url: OFFSCREEN_URL,
        reasons: ['AUDIO_PLAYBACK'],
        justification: 'Play alert sound when a distracting site is detected during a mission'
      });
    }
    chrome.runtime.sendMessage({ type: 'PLAY_ALERT_SOUND' });
  } catch (err) {
    // Offscreen API or audio failed — non-fatal
    console.warn('Mission Control: alert sound error', err);
  }
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

async function getActiveMissionIfRunning() {
  const mission = await storage.getCurrentMission();
  return mission && mission.status === MISSION_STATUS.ACTIVE ? mission : null;
}

function notify(id, title, message) {
  chrome.notifications.create(id, {
    type: 'basic',
    iconUrl: ICON,
    title,
    message,
    priority: 2
  });
}

/** Closes mission.activeSegment (if any) into mission.events at time `endTime`. Mutates and returns mission. */
function closeActiveSegment(mission, endTime) {
  if (mission.activeSegment) {
    mission.events.push({
      ...mission.activeSegment,
      endTime,
      duration: Math.max(0, endTime - mission.activeSegment.startTime)
    });
    mission.activeSegment = null;
  }
  return mission;
}

/** Opens a new mission.activeSegment for the given tab. Mutates and returns mission. */
async function openSegmentForTab(mission, tab) {
  if (!tab || !tab.url) return mission;
  const classification = await storage.getClassification();
  const domain = getDomain(tab.url);
  const category = classify(tab.url, classification);

  // classKey is the most specific rule that produced this category — e.g.
  // "youtube.com/shorts" rather than just "youtube.com" — so the Boss
  // System and timeline can tell Shorts apart from regular YouTube even
  // though both share the same bare domain (and same favicon).
  let classKey = domain;
  if (category === CATEGORY.DISTRACTING) {
    classKey = findMatchingRule(tab.url, classification.distracting);
  } else if (category === CATEGORY.PRODUCTIVE) {
    classKey = findMatchingRule(tab.url, classification.productive);
  }

  mission.activeSegment = {
    tabId: tab.id,
    url: tab.url,
    domain,
    classKey,
    title: tab.title || domain,
    category,
    startTime: Date.now()
  };
  return mission;
}

/**
 * The core re-entrant routine: close whatever segment was open, then open a
 * fresh one for `tab` (or leave things paused if there's no valid tab —
 * e.g. the browser lost focus entirely). Always reads + writes storage
 * fresh so it's safe no matter how the service worker's lifecycle behaves.
 */
async function switchSegment(tab) {
  const mission = await getActiveMissionIfRunning();
  if (!mission) return;

  // Capture the previous category BEFORE closing (used to decide whether to alert)
  const prevCategory = mission.activeSegment?.category ?? null;

  const now = Date.now();
  closeActiveSegment(mission, now);
  if (tab && tab.url) {
    await openSegmentForTab(mission, tab);
  }
  await storage.setCurrentMission(mission);

  // Fire instant distraction alert AFTER storage is written (non-blocking)
  handleDistractingAlert(mission, prevCategory).catch(() => {});
}

/** Pauses tracking (closes the active segment, opens nothing) — used when the browser loses focus. */
async function pauseTracking() {
  const mission = await getActiveMissionIfRunning();
  if (!mission) return;
  closeActiveSegment(mission, Date.now());
  await storage.setCurrentMission(mission);
  chrome.action.setBadgeText({ text: '' });
}

// ---------------------------------------------------------------------------
// Tab + window event listeners (registered at top level, required for MV3)
// ---------------------------------------------------------------------------

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    await switchSegment(tab);
  } catch (err) {
    // Tab may have closed already; nothing to track.
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!tab.active) return;

  if (changeInfo.url) {
    // Same-tab navigation (typed URL, clicked link, SPA route change with a real URL change).
    await switchSegment(tab);
    return;
  }

  if (changeInfo.title) {
    // Title finished loading for the page we're already tracking — patch it in place,
    // no new segment, no notification side effects.
    const mission = await getActiveMissionIfRunning();
    if (mission?.activeSegment && mission.activeSegment.tabId === tabId) {
      mission.activeSegment.title = changeInfo.title;
      await storage.setCurrentMission(mission);
    }
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const mission = await getActiveMissionIfRunning();
  if (mission?.activeSegment && mission.activeSegment.tabId === tabId) {
    // The tab we were tracking just disappeared (closed window, etc). Pause
    // rather than guess — onActivated/onFocusChanged will resume tracking
    // as soon as a real tab gains focus.
    await pauseTracking();
  }
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    // Chrome itself lost OS focus — user is away from the browser entirely.
    await pauseTracking();
    return;
  }
  try {
    const [tab] = await chrome.tabs.query({ active: true, windowId });
    await switchSegment(tab);
  } catch (err) {
    // No active tab in this window (e.g. devtools-only window) — ignore.
  }
});

// ---------------------------------------------------------------------------
// Mission lifecycle reactions (driven entirely by storage changes — nobody
// has to message background.js to tell it a mission started or ended)
// ---------------------------------------------------------------------------

storage.onStorageChange('currentMission', async (changes) => {
  const { oldValue, newValue } = changes.currentMission;

  const startedNow = newValue?.status === MISSION_STATUS.ACTIVE && (!oldValue || oldValue.id !== newValue.id);
  const endedNow = (!newValue || newValue.status !== MISSION_STATUS.ACTIVE) && oldValue?.status === MISSION_STATUS.ACTIVE;

  if (startedNow) {
    await chrome.alarms.create(ALARM_NAME, { periodInMinutes: HEARTBEAT_PERIOD_MINUTES });
    const settings = await storage.getSettings();
    if (settings.notificationsEnabled) {
      notify(`launch_${newValue.id}`, '\uD83D\uDE80 Mission Launched', `"${newValue.name}" is underway. Stay on course.`);
    }
    // Seed the very first segment from whatever tab is currently focused.
    try {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (tab) await switchSegment(tab);
    } catch (err) {
      /* no active tab available yet */
    }
  }

  if (endedNow) {
    await chrome.alarms.clear(ALARM_NAME);
    chrome.action.setBadgeText({ text: '' });
  }
});

storage.onStorageChange('missionHistory', async (changes) => {
  const { oldValue, newValue } = changes.missionHistory;
  const oldLen = oldValue?.length || 0;
  const newLen = newValue?.length || 0;
  if (newLen <= oldLen) return; // not a new completion (e.g. trimmed/cleared)

  const finished = newValue[newLen - 1];
  const settings = await storage.getSettings();
  if (!settings.notificationsEnabled) return;

  if (finished.status === MISSION_STATUS.ABANDONED) {
    notify(`done_${finished.id}`, '\uD83D\uDED1 Mission Abandoned', `"${finished.name}" was ended early. Every mission still teaches you something.`);
    return;
  }

  const report = computeMissionReport(finished, finished.endTime);
  const pctLabel = report.focusPct === null ? 'N/A' : `${Math.round(report.focusPct)}%`;
  notify(
    `done_${finished.id}`,
    `\uD83C\uDFC1 Mission Complete \u2014 Rank ${report.rank.letter}`,
    `"${finished.name}" \u2014 ${pctLabel} focus, ${formatDuration(report.focusedMs, { short: true })} focused / ${formatDuration(report.distractedMs, { short: true })} distracted.`
  );
});

// ---------------------------------------------------------------------------
// Heartbeat alarm: overtime + boss-alert notifications. Also the safety net
// that keeps the service worker waking up roughly once a minute while a
// mission is active, even if the user never switches tabs.
// ---------------------------------------------------------------------------

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;

  const mission = await getActiveMissionIfRunning();
  if (!mission) {
    await chrome.alarms.clear(ALARM_NAME);
    return;
  }

  const settings = await storage.getSettings();
  const now = Date.now();
  const snapshot = computeLiveSnapshot(mission, now);
  let mutated = false;
  mission.lastNotified = mission.lastNotified || { overtimeSent: false, bossAlertSegmentKey: null };

  if (settings.overtimeAlertsEnabled && !mission.lastNotified.overtimeSent && snapshot.elapsedMs >= snapshot.expectedMs) {
    notify(
      `overtime_${mission.id}`,
      '\u23F0 Mission Overtime',
      `"${mission.name}" has run past its expected ${mission.expectedDurationMinutes} min. Wrap up or push on?`
    );
    mission.lastNotified.overtimeSent = true;
    mutated = true;
  }

  if (settings.notificationsEnabled && mission.activeSegment?.category === CATEGORY.DISTRACTING) {
    const segKey = String(mission.activeSegment.startTime);
    const segMinutes = (now - mission.activeSegment.startTime) / 60000;
    if (segMinutes >= settings.bossAlertThresholdMinutes && mission.lastNotified.bossAlertSegmentKey !== segKey) {
      notify(
        `boss_${segKey}`,
        '\uD83D\uDC09 Boss Alert',
        `${mission.activeSegment.domain} has stolen ${Math.round(segMinutes)} minutes. Return to base!`
      );
      mission.lastNotified.bossAlertSegmentKey = segKey;
      mutated = true;
    }
  }

  if (mutated) await storage.setCurrentMission(mission);
});

// ---------------------------------------------------------------------------
// Startup / install bootstrapping
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(async () => {
  await storage.ensureDefaults();
});

chrome.runtime.onStartup.addListener(async () => {
  await storage.ensureDefaults();
  // If the browser restarted mid-mission, the old activeSegment's clock is
  // meaningless (every tab just reopened). Close it out at "now" and pick
  // up tracking on whatever tab is currently focused.
  const mission = await getActiveMissionIfRunning();
  if (mission) {
    await chrome.alarms.create(ALARM_NAME, { periodInMinutes: HEARTBEAT_PERIOD_MINUTES });
    closeActiveSegment(mission, Date.now());
    await storage.setCurrentMission(mission);
    try {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (tab) await switchSegment(tab);
    } catch (err) {
      /* no active tab yet */
    }
  }
});
