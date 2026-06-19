// utils/constants.js
// Single source of truth for storage keys, defaults, and lookup tables.
// Every other module imports from here so the "rules of the universe"
// (rank cutoffs, default site lists, alarm timing) only ever live in one place.

export const STORAGE_KEYS = {
  CURRENT_MISSION: 'currentMission',
  HISTORY: 'missionHistory',
  CLASSIFICATION: 'classification',
  SETTINGS: 'settings'
};

// Mission lifecycle states
export const MISSION_STATUS = {
  ACTIVE: 'active',
  COMPLETED: 'completed',
  ABANDONED: 'abandoned'
};

// Segment / timeline categories
export const CATEGORY = {
  PRODUCTIVE: 'productive',
  DISTRACTING: 'distracting',
  NEUTRAL: 'neutral'
};

// Out-of-the-box site lists, exactly as specified in the product brief.
// Entries may be a bare domain ("github.com") or a domain + path prefix
// ("youtube.com/shorts") for rules that only apply to part of a site.
export const DEFAULT_CLASSIFICATION = {
  productive: [
    'leetcode.com',
    'github.com',
    'geeksforgeeks.org',
    'codeforces.com',
    'stackoverflow.com',
    'developer.mozilla.org'
  ],
  distracting: [
    'instagram.com',
    'facebook.com',
    'youtube.com/shorts',
    'netflix.com',
    'reddit.com'
  ]
};

export const DEFAULT_SETTINGS = {
  notificationsEnabled: true,
  overtimeAlertsEnabled: true,
  bossAlertThresholdMinutes: 5,
  // History list is capped so local storage never grows unbounded.
  maxHistoryEntries: 200
};

// Friendly display names for common domains / domain+path rules.
// Anything not listed here falls back to a title-cased domain.
export const DISPLAY_NAMES = {
  'leetcode.com': 'LeetCode',
  'github.com': 'GitHub',
  'geeksforgeeks.org': 'GeeksforGeeks',
  'codeforces.com': 'Codeforces',
  'stackoverflow.com': 'Stack Overflow',
  'developer.mozilla.org': 'MDN Web Docs',
  'instagram.com': 'Instagram',
  'facebook.com': 'Facebook',
  'netflix.com': 'Netflix',
  'reddit.com': 'Reddit',
  'youtube.com': 'YouTube',
  'youtube.com/shorts': 'YouTube Shorts',
  'twitter.com': 'Twitter / X',
  'x.com': 'Twitter / X',
  'tiktok.com': 'TikTok',
  'newtab': 'New Tab',
  'chrome-internal': 'Browser UI',
  'extension': 'Mission Control',
  'unknown': 'Unknown'
};

// Small flavor icons for the Boss leaderboard. Anything missing uses the
// generic alien invader.
export const BOSS_EMOJI = {
  'instagram.com': '📸',
  'facebook.com': '📘',
  'netflix.com': '🎬',
  'reddit.com': '👽',
  'youtube.com/shorts': '📱',
  'youtube.com': '▶️',
  'twitter.com': '🐦',
  'x.com': '🐦',
  'tiktok.com': '🎵'
};
export const DEFAULT_BOSS_EMOJI = '👾';

// Rank cutoffs, evaluated highest-first.
export const RANK_THRESHOLDS = [
  { min: 90, letter: 'S', label: 'Locked In', colorVar: '--rank-s' },
  { min: 80, letter: 'A', label: 'Sharp Focus', colorVar: '--rank-a' },
  { min: 70, letter: 'B', label: 'Steady', colorVar: '--rank-b' },
  { min: 60, letter: 'C', label: 'Wandering', colorVar: '--rank-c' },
  { min: 0, letter: 'D', label: 'Off Course', colorVar: '--rank-d' }
];

// Boss "power level" tiers, based on cumulative minutes lost to one domain
// within a single mission. Purely cosmetic, purely fun.
export const BOSS_TIERS = [
  { min: 25, tier: 'World Boss' },
  { min: 10, tier: 'Raid Boss' },
  { min: 2, tier: 'Elite' },
  { min: 0, tier: 'Minion' }
];

export const ALARM_NAME = 'missionControlHeartbeat';
export const HEARTBEAT_PERIOD_MINUTES = 1;

export const DASHBOARD_PATH = 'dashboard/dashboard.html';
export const REPLAY_PATH = 'replay/replay.html';
