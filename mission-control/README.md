# Mission Control — Distraction Replay

A Chrome extension (Manifest V3, vanilla HTML/CSS/JS — no frameworks, no build step) that turns
browsing into **missions**. Start a mission with a name, a goal, and an expected duration; browse
normally; Mission Control tracks every tab you visit and how long you spend there, classifies each
visit as **productive**, **distracting**, or **neutral**, and scores you with a focus percentage and
a letter rank. When the mission ends, the flagship feature — **Distraction Replay** — plays back an
animated, chronological walk through exactly how your attention moved, site by site.

## What it does

- **Mission tracking.** Start a mission from the popup or dashboard. Every tab switch, navigation,
  and window focus change is logged as a timestamped segment (`tabId`, `url`, `domain`, `category`,
  `startTime`/`endTime`/`duration`).
- **Classification.** A configurable rule list (`utils/classifier.js` + the Classification tab in the
  dashboard) maps each visit to productive / distracting / neutral. Rules can be a whole domain
  (`reddit.com`) or a domain + path prefix (`youtube.com/shorts`), so you can separate "YouTube
  Shorts" from regular YouTube, or carve out `reddit.com/r/leetcode` as productive even though the
  rest of Reddit is distracting.
- **Focus scoring.** `focusPercentage = focusedTime / (focusedTime + distractedTime)`. Neutral time
  is intentionally excluded from the denominator — browsing a neutral site neither helps nor hurts
  your score. A null score ("no data yet") is shown honestly rather than guessed when there's no
  productive or distracting time at all.
- **Ranks.** S (≥90%, "Locked In") down to D (<60%, "Off Course"), with its own color used
  consistently for the rank badge, the focus ring, and the bar chart in Weekly Analytics.
- **Boss System.** Distracting domains become "bosses" ranked by time lost, with cosmetic tiers
  (Minion < 2 min, Elite < 10 min, Raid Boss < 25 min, World Boss ≥ 25 min) and a per-domain emoji.
  There's a per-mission leaderboard and an all-time leaderboard across every mission you've logged.
- **Distraction Replay.** The headline feature: a vertical "Attention Trajectory" timeline that plays
  back a finished (or still-in-progress) mission node by node — Play/Pause, 0.5×–4× speed, click any
  node to seek, and live "focus so far" stats that update as the playback head moves. Respects
  `prefers-reduced-motion` by swapping Play for an instant "Show Result" jump.
- **Weekly Analytics.** Total missions, average focus %, your most common distraction, best/worst
  day, a 14-day focus % bar chart, the all-time boss leaderboard, and a full sortable mission
  history table.

## Installation

1. Download/unzip this folder somewhere permanent (Chrome loads unpacked extensions by reference,
   not by copying them).
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the `mission-control` folder (the one containing
   `manifest.json`).
5. Pin the extension (puzzle-piece icon in the toolbar → pin Mission Control) for one-click access
   to the popup.

No host permissions are required — Mission Control only ever reads the tab metadata Chrome already
exposes through the `tabs` permission (URL, title, active state), never page content.

## How the pieces fit together

```
manifest.json        MV3 config — popup, background service worker, permissions, icons
background.js        The ONLY writer of mission.events / mission.activeSegment
popup/                Compact toolbar popup: start a mission, watch it live, or see a just-finished summary
dashboard/             Full-page app: Home, Mission Report, Weekly Analytics, Classification
replay/                The Distraction Replay player
utils/                 Pure logic — storage, classification, analytics, mission lifecycle
shared/                Design tokens + small reusable UI building blocks
icons/                 Toolbar icon at 16/48/128px
```

### Single source of truth

`chrome.storage.local` is the only state. Four keys, defined once in `utils/constants.js` and never
touched directly outside `utils/storage.js`:

| Key | Shape | Written by |
|---|---|---|
| `currentMission` | the active mission object, or absent | `background.js` (events/segments), `utils/missionService.js` (start/end/abandon) |
| `missionHistory` | array of finished/abandoned missions, oldest first, capped at `settings.maxHistoryEntries` | `utils/missionService.js` |
| `classification` | `{ productive: string[], distracting: string[] }` | dashboard's Classification tab |
| `settings` | notification toggles, boss alert threshold | dashboard's Classification tab |

**`background.js` is the only thing that ever writes `mission.events` or `mission.activeSegment`.**
Every popup/dashboard/replay page reads storage directly and calls into `missionService.js` for
lifecycle actions (start/end/abandon) — there's no message-passing between pages. Instead, every
page subscribes to `chrome.storage.onChanged` and reacts when something else (another open tab,
or `background.js`) changes the data. This means you can have the popup, the dashboard, and a
replay tab all open at once and they'll stay in sync automatically.

Every handler in `background.js` re-reads `currentMission` fresh from storage at the start and
writes the full mission back at the end, rather than trusting any in-memory state — MV3 service
workers can be killed and restarted between any two events, so nothing here assumes it survived
since the last call.

### Mission object shape

```js
{
  id, name, goal, expectedDurationMinutes,
  startTime, endTime, status,            // 'active' | 'completed' | 'abandoned'
  events: [
    { tabId, url, domain, classKey, title, category, startTime, endTime, duration }
  ],
  activeSegment,                          // same shape as an event, minus endTime/duration, while open
  lastNotified: { overtimeSent, bossAlertSegmentKey }
}
```

`classKey` is the most specific classification rule that actually matched (e.g.
`youtube.com/shorts`), while `domain` stays the bare hostname. That split is what lets the Boss
System and the timeline tell "YouTube Shorts" apart from plain "YouTube" even though they share a
domain — `domain` is kept around untouched in case a future version wants it for favicons.

### Why no message passing

Tab-tracking logic, mission lifecycle, and UI rendering are fully decoupled: `background.js` only
listens to `chrome.tabs`/`chrome.windows`/`chrome.alarms` and to its own storage changes; it never
imports anything UI-related. The popup/dashboard/replay only import `utils/` and `shared/` — never
`background.js`. The two sides agree entirely through the shape of `chrome.storage.local`.

## Design system

A dark "Mission Control Room" theme (`shared/theme.css`) with three separate color systems that are
never allowed to blur together:

- **Category colors** (functional, not decorative): phosphor green = productive, magenta =
  distracting, slate = neutral.
- **Rank gradient**: gold (S) → cyan (A) → green (B) → orange (C) → magenta (D) — a different
  five-step scale from the three category colors above, so "rank" and "category" never compete for
  the same visual language.
- **Telemetry typography**: numbers and timestamps render in a monospace face; headings use a
  tracked-out display face. No external fonts or CDNs (MV3's default CSP wouldn't allow it anyway).

The signature **Attention Trajectory** component (`shared/timeline.css` + `shared/timelineView.js`)
is a single reusable vertical timeline used two ways from the same markup: as a fully-lit static
report (Mission Report tab) and as the animated, cursor-driven centerpiece of Distraction Replay.

## File guide

**`manifest.json`** — MV3 manifest: popup, module-type background service worker,
`storage`/`tabs`/`alarms`/`notifications` permissions, icon set.

**`background.js`** — Tab/window event listeners that open and close tracked segments; reacts to
`currentMission`/`missionHistory` storage changes to fire notifications and manage the heartbeat
alarm; the heartbeat alarm itself checks for overtime and boss-alert conditions once a minute.

**`utils/constants.js`** — Every storage key, default classification list, default settings, rank
thresholds, boss tiers, and display-name/emoji lookup tables. The one file to edit if you want to
change a threshold or add a default site.

**`utils/storage.js`** — Promise-wrapped `chrome.storage.local` get/set/remove for each of the four
keys, plus `onStorageChange(keys, callback)` for subscriptions.

**`utils/classifier.js`** — URL → domain/path extraction, rule matching (supports `domain` or
`domain/path` rules), and the productive/distracting/neutral classification itself. Also exposes
`findMatchingRule` (used to compute `classKey`) and friendly display-name/emoji lookups.

**`utils/analytics.js`** — Every number on every screen is derived from the pure functions here:
duration/clock/date formatting, category time aggregation, the focus % formula, rank lookup, the
Boss System aggregator, the Attention Trajectory builder, and the bundled snapshots used by the
live views, mission reports, and Weekly Analytics. Nothing in this file touches `chrome.*` — it's
plain data in, plain data out.

**`utils/missionService.js`** — The mission lifecycle API (`startMission`, `endMission`,
`abandonMission`, `discardMission`, `findMissionById`) and the `subscribeCurrentMission` /
`subscribeHistory` change subscriptions every page uses.

**`shared/theme.css`** — All design tokens (colors, type, radii, glows) plus base panel/button/
form/badge/rank-badge styles shared by every page.

**`shared/dom.js`** — A tiny `el(tag, props, children)` DOM-builder used everywhere instead of
`innerHTML`, since tab titles and URLs are untrusted strings. Supports the SVG namespace for the
progress rings and timeline cursor.

**`shared/ring.js`** — The SVG progress-ring builder shared by the popup and dashboard.

**`shared/timeline.css` / `shared/timelineView.js`** — The Attention Trajectory component described
above.

**`shared/missionForm.js` / `shared/missionForm.css`** — The "Start Mission" form, shared by the
popup and the dashboard's Home tab.

**`shared/extensionNav.js`** — Opens the dashboard/replay in their own tab, reusing an existing tab
for the same page instead of letting CTAs spawn duplicates.

**`popup/`** — The toolbar popup: a Start Mission form when idle, live ticking stats with End/
Abandon while a mission is active, and a Replay/Report callout right after a mission ends.

**`dashboard/`** — The full-page app. `dashboard.js` is a small hash-based router (`#/live`,
`#/report?missionId=`, `#/analytics`, `#/config`) over four view renderers; `charts.js` holds the
two hand-rolled chart builders (an SVG bar chart for focus % over time, and a CSS-bar boss
leaderboard reused by both the Mission Report and Weekly Analytics views).

**`replay/`** — The Distraction Replay player: a self-contained playback state machine
(`buildPage()` in `replay.js`) driving the shared Attention Trajectory component's `setState` /
`setConnectorCharged` / `moveCursor` / `scrollToIndex` primitives.

**`icons/`** — 16/48/128px toolbar icons (a cyan radar/reticle with a magenta "locked-on" center
dot, generated programmatically to match the theme).

## Roadmap

Ideas for a v2, roughly in order of how much value they'd add:

- **`chrome.idle`-based AFK detection** rather than relying only on window focus, so a user who
  leaves the browser focused but walks away doesn't keep accumulating tracked time.
- **Regex / wildcard classification rules** beyond the current domain-or-domain+path matching.
- **Multi-day streaks** and a calendar heatmap view in Weekly Analytics.
- **Cloud sync** (e.g. `chrome.storage.sync` for classification/settings, keeping history local)
  so rules follow you across machines without syncing potentially large event histories.
- **An Options page** for settings currently only reachable indirectly, plus export/import of the
  classification config as JSON for sharing rule sets.
- **More chart types** in Weekly Analytics — a category-mix donut, a day-of-week heatmap.
- **Optional sound cues** in Distraction Replay (a soft chime on category changes) for users who
  want an even more cinematic replay.
- **Mission templates** ("Deep Work — 90 min", "Quick Sprint — 25 min") to skip the form for
  recurring mission types.
