// utils/storage.js
// Thin, promise-based wrapper around chrome.storage.local.
// Nothing in this file knows about missions, tabs, or analytics — it only
// knows how to read and write the four keys defined in constants.js.
// Every other part of the extension (background, popup, dashboard, replay)
// goes through here, so storage.local is never touched directly elsewhere.

import {
  STORAGE_KEYS,
  DEFAULT_CLASSIFICATION,
  DEFAULT_SETTINGS
} from './constants.js';

/** Promisified chrome.storage.local.get for one or more keys. */
function rawGet(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (result) => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve(result);
    });
  });
}

/** Promisified chrome.storage.local.set. */
function rawSet(items) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(items, () => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve();
    });
  });
}

/** Promisified chrome.storage.local.remove. */
function rawRemove(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.remove(keys, () => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve();
    });
  });
}

// ---------------------------------------------------------------------------
// Current mission
// ---------------------------------------------------------------------------

export async function getCurrentMission() {
  const result = await rawGet(STORAGE_KEYS.CURRENT_MISSION);
  return result[STORAGE_KEYS.CURRENT_MISSION] || null;
}

export async function setCurrentMission(mission) {
  await rawSet({ [STORAGE_KEYS.CURRENT_MISSION]: mission });
  return mission;
}

export async function clearCurrentMission() {
  await rawRemove(STORAGE_KEYS.CURRENT_MISSION);
}

// ---------------------------------------------------------------------------
// History (completed / abandoned missions)
// ---------------------------------------------------------------------------

export async function getHistory() {
  const result = await rawGet(STORAGE_KEYS.HISTORY);
  return result[STORAGE_KEYS.HISTORY] || [];
}

export async function addToHistory(mission, maxEntries = DEFAULT_SETTINGS.maxHistoryEntries) {
  const history = await getHistory();
  history.push(mission);
  // Keep the most recent N missions, oldest first.
  const trimmed = history.length > maxEntries ? history.slice(history.length - maxEntries) : history;
  await rawSet({ [STORAGE_KEYS.HISTORY]: trimmed });
  return trimmed;
}

export async function clearHistory() {
  await rawSet({ [STORAGE_KEYS.HISTORY]: [] });
}

// ---------------------------------------------------------------------------
// Classification rules
// ---------------------------------------------------------------------------

export async function getClassification() {
  const result = await rawGet(STORAGE_KEYS.CLASSIFICATION);
  return result[STORAGE_KEYS.CLASSIFICATION] || { ...DEFAULT_CLASSIFICATION };
}

export async function setClassification(classification) {
  await rawSet({ [STORAGE_KEYS.CLASSIFICATION]: classification });
  return classification;
}

export async function resetClassification() {
  const fresh = {
    productive: [...DEFAULT_CLASSIFICATION.productive],
    distracting: [...DEFAULT_CLASSIFICATION.distracting]
  };
  await setClassification(fresh);
  return fresh;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function getSettings() {
  const result = await rawGet(STORAGE_KEYS.SETTINGS);
  return { ...DEFAULT_SETTINGS, ...(result[STORAGE_KEYS.SETTINGS] || {}) };
}

export async function setSettings(settings) {
  await rawSet({ [STORAGE_KEYS.SETTINGS]: settings });
  return settings;
}

// ---------------------------------------------------------------------------
// Bootstrapping + change subscriptions
// ---------------------------------------------------------------------------

/** Ensures classification/settings/history exist on first run. Safe to call repeatedly. */
export async function ensureDefaults() {
  const result = await rawGet([STORAGE_KEYS.CLASSIFICATION, STORAGE_KEYS.SETTINGS, STORAGE_KEYS.HISTORY]);
  const updates = {};
  if (!result[STORAGE_KEYS.CLASSIFICATION]) updates[STORAGE_KEYS.CLASSIFICATION] = { ...DEFAULT_CLASSIFICATION };
  if (!result[STORAGE_KEYS.SETTINGS]) updates[STORAGE_KEYS.SETTINGS] = { ...DEFAULT_SETTINGS };
  if (!result[STORAGE_KEYS.HISTORY]) updates[STORAGE_KEYS.HISTORY] = [];
  if (Object.keys(updates).length) await rawSet(updates);
}

/**
 * Subscribes to chrome.storage.onChanged for a specific set of keys.
 * Returns an unsubscribe function. Callback receives (changes) where
 * changes[key] = { oldValue, newValue } for every key that actually changed.
 */
export function onStorageChange(keys, callback) {
  const keySet = new Set(Array.isArray(keys) ? keys : [keys]);
  const listener = (changes, areaName) => {
    if (areaName !== 'local') return;
    const relevant = {};
    let hasRelevant = false;
    for (const key of Object.keys(changes)) {
      if (keySet.has(key)) {
        relevant[key] = changes[key];
        hasRelevant = true;
      }
    }
    if (hasRelevant) callback(relevant);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

// ---------------------------------------------------------------------------
// Raw key access (used by background.js for ephemeral cooldown timestamps)
// ---------------------------------------------------------------------------

/** Read any arbitrary storage key (returns null if absent). */
export async function getRaw(key) {
  const result = await rawGet(key);
  return result[key] ?? null;
}

/** Write any arbitrary storage key. */
export async function setRaw(key, value) {
  await rawSet({ [key]: value });
}
