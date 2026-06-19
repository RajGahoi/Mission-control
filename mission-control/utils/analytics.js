// utils/analytics.js
// The "focus engine". Pure functions only — nothing here touches
// chrome.storage or chrome.tabs, so it can be unit-tested or reused
// from background.js, popup.js, dashboard.js, and replay.js alike.

import { CATEGORY, RANK_THRESHOLDS, BOSS_TIERS } from './constants.js';
import { getDisplayName, getBossEmoji } from './classifier.js';

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/** "1h 23m", "23m 12s", "45s", "0s" */
export function formatDuration(ms, { short = false } = {}) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;

  if (h > 0) return short ? `${h}h ${m}m` : `${h}h ${m}m ${s}s`;
  if (m > 0) return short ? `${m}m` : `${m}m ${s}s`;
  return `${s}s`;
}

/** "10:02 AM" in the user's local time. */
export function formatClock(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** "Mon, Jun 15" */
export function formatDateLabel(ts) {
  return new Date(ts).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

/** "2026-06-15", used as a stable grouping key (local calendar day). */
export function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Time aggregation
// ---------------------------------------------------------------------------

/** Duration of a single segment in ms. Open segments are measured against `now`. */
export function getSegmentDurationMs(segment, now = Date.now()) {
  if (!segment) return 0;
  if (typeof segment.duration === 'number') return segment.duration;
  if (typeof segment.endTime === 'number') return Math.max(0, segment.endTime - segment.startTime);
  return Math.max(0, now - segment.startTime);
}

/**
 * Sums time per category across a mission's closed events plus its
 * currently open segment (if any). This is the one function every
 * stat on every screen ultimately derives from.
 */
export function aggregateByCategory(mission, now = Date.now()) {
  const totals = { productive: 0, distracting: 0, neutral: 0 };
  if (!mission) return { productiveMs: 0, distractingMs: 0, neutralMs: 0, totalMs: 0 };

  for (const event of mission.events || []) {
    const ms = getSegmentDurationMs(event, now);
    if (totals[event.category] !== undefined) totals[event.category] += ms;
  }
  if (mission.activeSegment) {
    const ms = getSegmentDurationMs(mission.activeSegment, now);
    if (totals[mission.activeSegment.category] !== undefined) totals[mission.activeSegment.category] += ms;
  }

  return {
    productiveMs: totals.productive,
    distractingMs: totals.distracting,
    neutralMs: totals.neutral,
    totalMs: totals.productive + totals.distracting + totals.neutral
  };
}

/**
 * focusPercentage = focusedTime / (focusedTime + distractedTime)
 * Neutral time is intentionally excluded from the denominator, per spec —
 * browsing neutral sites neither helps nor hurts your score. Returns
 * null when there's no productive or distracting time yet (nothing to
 * judge), rather than guessing.
 */
export function computeFocusPercentage(productiveMs, distractingMs) {
  const denom = productiveMs + distractingMs;
  if (denom <= 0) return null;
  return (productiveMs / denom) * 100;
}

/** Maps a focus percentage (or null) to a rank descriptor. */
export function getRank(focusPct) {
  if (focusPct === null || focusPct === undefined || Number.isNaN(focusPct)) {
    return { letter: '—', label: 'No Data Yet', colorVar: '--text-dim' };
  }
  for (const tier of RANK_THRESHOLDS) {
    if (focusPct >= tier.min) return { letter: tier.letter, label: tier.label, colorVar: tier.colorVar };
  }
  return RANK_THRESHOLDS[RANK_THRESHOLDS.length - 1];
}

function getBossTier(minutes) {
  for (const tier of BOSS_TIERS) {
    if (minutes >= tier.min) return tier.tier;
  }
  return BOSS_TIERS[BOSS_TIERS.length - 1].tier;
}

/**
 * Aggregates distracting time by domain into a ranked "boss" leaderboard.
 * Each boss carries a display name, emoji, total ms, and a flavor tier.
 */
export function aggregateBosses(mission, { limit = 10, now = Date.now() } = {}) {
  const byDomain = new Map();

  const allSegments = [...(mission?.events || [])];
  if (mission?.activeSegment) allSegments.push(mission.activeSegment);

  for (const seg of allSegments) {
    if (seg.category !== CATEGORY.DISTRACTING) continue;
    const key = seg.classKey || seg.domain || 'unknown';
    const ms = getSegmentDurationMs(seg, now);
    byDomain.set(key, (byDomain.get(key) || 0) + ms);
  }

  const bosses = Array.from(byDomain.entries())
    .map(([key, ms]) => ({
      domain: key,
      label: getDisplayName(key),
      emoji: getBossEmoji(key),
      ms,
      tier: getBossTier(ms / 60000)
    }))
    .sort((a, b) => b.ms - a.ms)
    .slice(0, limit);

  return bosses;
}

/**
 * Builds the chronological "Distraction Replay" timeline:
 * Mission Started -> every visited site, in order -> Mission Completed
 * (the last entry only appears once the mission has actually ended).
 */
export function buildTimeline(mission, now = Date.now()) {
  if (!mission) return [];
  const timeline = [{ type: 'start', time: mission.startTime, label: 'Mission Started' }];

  for (const event of mission.events || []) {
    timeline.push({
      type: 'visit',
      time: event.startTime,
      url: event.url,
      domain: event.domain,
      classKey: event.classKey || event.domain,
      label: getDisplayName(event.classKey || event.domain),
      title: event.title,
      category: event.category,
      durationMs: getSegmentDurationMs(event, now)
    });
  }

  if (mission.activeSegment) {
    timeline.push({
      type: 'visit',
      time: mission.activeSegment.startTime,
      url: mission.activeSegment.url,
      domain: mission.activeSegment.domain,
      classKey: mission.activeSegment.classKey || mission.activeSegment.domain,
      label: getDisplayName(mission.activeSegment.classKey || mission.activeSegment.domain),
      title: mission.activeSegment.title,
      category: mission.activeSegment.category,
      durationMs: getSegmentDurationMs(mission.activeSegment, now),
      ongoing: true
    });
  }

  if (mission.status !== 'active' && mission.endTime) {
    timeline.push({ type: 'end', time: mission.endTime, label: mission.status === 'abandoned' ? 'Mission Abandoned' : 'Mission Completed' });
  }

  return timeline;
}

// ---------------------------------------------------------------------------
// Bundled snapshots for the UI
// ---------------------------------------------------------------------------

/** Everything the live dashboard / popup needs while a mission is active. */
export function computeLiveSnapshot(mission, now = Date.now()) {
  const elapsedMs = now - mission.startTime;
  const { productiveMs, distractingMs, neutralMs } = aggregateByCategory(mission, now);
  const focusPct = computeFocusPercentage(productiveMs, distractingMs);
  const rank = getRank(focusPct);

  let currentSegment = null;
  if (mission.activeSegment) {
    currentSegment = {
      domain: mission.activeSegment.domain,
      label: getDisplayName(mission.activeSegment.classKey || mission.activeSegment.domain),
      category: mission.activeSegment.category,
      sinceMs: getSegmentDurationMs(mission.activeSegment, now)
    };
  }

  return {
    elapsedMs,
    expectedMs: mission.expectedDurationMinutes * 60000,
    focusedMs: productiveMs,
    distractedMs: distractingMs,
    neutralMs,
    focusPct,
    rank,
    currentSegment
  };
}

/** Everything the Mission Report / Distraction Replay needs once a mission ends (or to preview mid-flight). */
export function computeMissionReport(mission, now = Date.now()) {
  const durationMs = (mission.endTime || now) - mission.startTime;
  const { productiveMs, distractingMs, neutralMs } = aggregateByCategory(mission, now);
  const focusPct = computeFocusPercentage(productiveMs, distractingMs);
  const rank = getRank(focusPct);
  const bosses = aggregateBosses(mission, { now });
  const timeline = buildTimeline(mission, now);

  return {
    mission,
    durationMs,
    focusedMs: productiveMs,
    distractedMs: distractingMs,
    neutralMs,
    focusPct,
    rank,
    bosses,
    timeline
  };
}

// ---------------------------------------------------------------------------
// History / weekly analytics
// ---------------------------------------------------------------------------

/**
 * Aggregates a full mission history into the stats shown on the
 * Weekly Analytics screen: totals, averages, the all-time "final boss",
 * and best/worst calendar days.
 */
export function computeHistoryAnalytics(history) {
  const completed = history || [];

  if (!completed.length) {
    return {
      totalMissions: 0,
      averageFocusPct: null,
      mostCommonDistraction: null,
      bestDay: null,
      worstDay: null,
      chartData: [],
      allTimeBosses: []
    };
  }

  const reports = completed.map((m) => computeMissionReport(m, m.endTime || m.startTime));

  // Average focus % across missions that actually produced a score.
  const scored = reports.filter((r) => r.focusPct !== null);
  const averageFocusPct = scored.length
    ? scored.reduce((sum, r) => sum + r.focusPct, 0) / scored.length
    : null;

  // All-time boss leaderboard (sum distracting ms per domain across every mission).
  const allTimeByDomain = new Map();
  for (const report of reports) {
    for (const boss of report.bosses) {
      allTimeByDomain.set(boss.domain, (allTimeByDomain.get(boss.domain) || 0) + boss.ms);
    }
  }
  const allTimeBosses = Array.from(allTimeByDomain.entries())
    .map(([domain, ms]) => ({ domain, label: getDisplayName(domain), emoji: getBossEmoji(domain), ms, tier: getBossTier(ms / 60000) }))
    .sort((a, b) => b.ms - a.ms);

  const mostCommonDistraction = allTimeBosses[0] || null;

  // Group by calendar day for best/worst day + chart.
  const byDay = new Map();
  for (let i = 0; i < reports.length; i++) {
    const report = reports[i];
    const key = dayKey(report.mission.startTime);
    if (!byDay.has(key)) byDay.set(key, { date: key, time: report.mission.startTime, scores: [], count: 0 });
    const bucket = byDay.get(key);
    bucket.count += 1;
    if (report.focusPct !== null) bucket.scores.push(report.focusPct);
  }

  const dayStats = Array.from(byDay.values())
    .map((bucket) => ({
      date: bucket.date,
      time: bucket.time,
      count: bucket.count,
      avgFocusPct: bucket.scores.length ? bucket.scores.reduce((a, b) => a + b, 0) / bucket.scores.length : null
    }))
    .sort((a, b) => a.time - b.time);

  const scoredDays = dayStats.filter((d) => d.avgFocusPct !== null);
  let bestDay = null;
  let worstDay = null;
  if (scoredDays.length) {
    bestDay = scoredDays.reduce((best, d) => (d.avgFocusPct > best.avgFocusPct ? d : best));
    worstDay = scoredDays.reduce((worst, d) => (d.avgFocusPct < worst.avgFocusPct ? d : worst));
  }

  return {
    totalMissions: reports.length,
    averageFocusPct,
    mostCommonDistraction,
    bestDay,
    worstDay,
    chartData: dayStats.slice(-14), // last 14 active days, chronological
    allTimeBosses: allTimeBosses.slice(0, 5)
  };
}
