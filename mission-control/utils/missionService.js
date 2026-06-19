// utils/missionService.js
// The "API" that popup/dashboard/replay call into. It owns the mission
// lifecycle (start / end / abandon) and exposes simple subscriptions for
// live updates. background.js is intentionally NOT imported here — these
// pages talk to chrome.storage directly, and background.js reacts to those
// storage changes on its own. Nobody has to send each other messages.

import * as storage from './storage.js';
import { MISSION_STATUS } from './constants.js';
import { getSegmentDurationMs } from './analytics.js';

function generateId() {
  return `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Creates a brand-new active mission and persists it. background.js is
 * listening for this change and will seed the first tracked segment from
 * whatever tab is currently focused, start the heartbeat alarm, and send
 * the "Mission Launched" notification.
 */
export async function startMission({ name, goal, expectedDurationMinutes }) {
  const mission = {
    id: generateId(),
    name: name.trim(),
    goal: (goal || '').trim(),
    expectedDurationMinutes: Number(expectedDurationMinutes) || 60,
    startTime: Date.now(),
    endTime: null,
    status: MISSION_STATUS.ACTIVE,
    events: [],
    activeSegment: null,
    lastNotified: { overtimeSent: false, bossAlertSegmentKey: null }
  };
  await storage.setCurrentMission(mission);
  return mission;
}

/** Closes the open segment (if any) and stamps a final status + endTime. Does not persist. */
function finalizeMission(mission, status, endTime = Date.now()) {
  const finalized = { ...mission, status, endTime, events: [...(mission.events || [])] };
  if (finalized.activeSegment) {
    finalized.events.push({
      ...finalized.activeSegment,
      endTime,
      duration: getSegmentDurationMs(finalized.activeSegment, endTime)
    });
    finalized.activeSegment = null;
  }
  return finalized;
}

/** Ends the current mission successfully and files it into history. */
export async function endMission() {
  const mission = await storage.getCurrentMission();
  if (!mission || mission.status !== MISSION_STATUS.ACTIVE) return null;

  const finalized = finalizeMission(mission, MISSION_STATUS.COMPLETED);
  await storage.addToHistory(finalized);
  await storage.clearCurrentMission();
  return finalized;
}

/** Abandons the current mission (saved to history, but flagged as abandoned). */
export async function abandonMission() {
  const mission = await storage.getCurrentMission();
  if (!mission || mission.status !== MISSION_STATUS.ACTIVE) return null;

  const finalized = finalizeMission(mission, MISSION_STATUS.ABANDONED);
  await storage.addToHistory(finalized);
  await storage.clearCurrentMission();
  return finalized;
}

/** Discards the current mission entirely without saving it to history. */
export async function discardMission() {
  await storage.clearCurrentMission();
}

/** Looks up a mission by id, checking the active mission first, then history. */
export async function findMissionById(id) {
  const current = await storage.getCurrentMission();
  if (current && current.id === id) return current;
  const history = await storage.getHistory();
  return history.find((m) => m.id === id) || null;
}

/** Subscribe to changes in the active mission. Returns an unsubscribe function. */
export function subscribeCurrentMission(callback) {
  return storage.onStorageChange('currentMission', (changes) => {
    callback(changes.currentMission.newValue || null, changes.currentMission.oldValue || null);
  });
}

/** Subscribe to changes in mission history. Returns an unsubscribe function. */
export function subscribeHistory(callback) {
  return storage.onStorageChange('missionHistory', (changes) => {
    callback(changes.missionHistory.newValue || [], changes.missionHistory.oldValue || []);
  });
}
