// utils/classifier.js
// Turns a raw tab URL into a domain, a display label, and a category
// (productive / distracting / neutral) based on the user's configurable
// rule lists. This is the only file that needs to change if someone wants
// smarter matching (regex rules, subdomains-only mode, time-of-day rules…).

import { CATEGORY, DISPLAY_NAMES, DEFAULT_BOSS_EMOJI, BOSS_EMOJI } from './constants.js';

/**
 * Extracts a normalized domain from a URL.
 * - Strips "www."
 * - Maps internal/browser pages to friendly synthetic domains so the
 *   timeline never shows a raw chrome:// string.
 */
export function getDomain(urlString) {
  if (!urlString) return 'unknown';

  try {
    const url = new URL(urlString);
    const protocol = url.protocol;

    if (protocol === 'chrome:' || protocol === 'edge:' || protocol === 'about:') {
      if (url.hostname === 'newtab' || urlString.includes('newtab')) return 'newtab';
      return 'chrome-internal';
    }
    if (protocol === 'chrome-extension:') return 'extension';
    if (protocol === 'file:') return 'file';
    if (protocol === 'devtools:') return 'chrome-internal';

    let hostname = url.hostname.toLowerCase();
    if (hostname.startsWith('www.')) hostname = hostname.slice(4);
    return hostname || 'unknown';
  } catch (err) {
    return 'unknown';
  }
}

/** Extracts the pathname from a URL, lowercased, defaulting to "/". */
export function getPath(urlString) {
  if (!urlString) return '/';
  try {
    const url = new URL(urlString);
    return (url.pathname || '/').toLowerCase();
  } catch (err) {
    return '/';
  }
}

/**
 * Checks whether a (domain, path) pair matches a single rule string.
 * Rules look like "github.com" (whole-domain) or "youtube.com/shorts"
 * (domain + required path prefix).
 */
export function matchesRule(domain, path, rule) {
  if (!rule) return false;
  const normalizedRule = rule.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '');
  const slashIndex = normalizedRule.indexOf('/');

  const ruleDomain = slashIndex === -1 ? normalizedRule : normalizedRule.slice(0, slashIndex);
  const rulePath = slashIndex === -1 ? null : normalizedRule.slice(slashIndex); // includes leading "/"

  const domainMatches = domain === ruleDomain || domain.endsWith(`.${ruleDomain}`);
  if (!domainMatches) return false;
  if (!rulePath) return true;
  return path.startsWith(rulePath);
}

/**
 * Classifies a URL against a { productive: [...], distracting: [...] }
 * rule set. Productive and distracting rules are both checked; productive
 * wins ties (so a user can carve out a productive sub-path of an otherwise
 * distracting site, e.g. "reddit.com/r/leetcode").
 */
export function classify(urlString, classification) {
  const domain = getDomain(urlString);
  const path = getPath(urlString);

  const productiveRules = classification?.productive || [];
  const distractingRules = classification?.distracting || [];

  const isProductive = productiveRules.some((rule) => matchesRule(domain, path, rule));
  if (isProductive) return CATEGORY.PRODUCTIVE;

  const isDistracting = distractingRules.some((rule) => matchesRule(domain, path, rule));
  if (isDistracting) return CATEGORY.DISTRACTING;

  return CATEGORY.NEUTRAL;
}

/**
 * Finds the most specific matching rule string for a URL, if any.
 * Used so the UI/boss system can show "youtube.com/shorts" rather than
 * just "youtube.com" when a path-scoped rule is what actually matched.
 */
export function findMatchingRule(urlString, rules) {
  const domain = getDomain(urlString);
  const path = getPath(urlString);
  const matches = (rules || []).filter((rule) => matchesRule(domain, path, rule));
  if (!matches.length) return domain;
  // Prefer the rule with a path component (more specific) if present.
  matches.sort((a, b) => (b.includes('/') ? 1 : 0) - (a.includes('/') ? 1 : 0));
  return matches[0];
}

/** Friendly label for a domain or domain/path key, falling back to title-case. */
export function getDisplayName(key) {
  if (!key) return 'Unknown';
  if (DISPLAY_NAMES[key]) return DISPLAY_NAMES[key];
  const bareDomain = key.split('/')[0];
  if (DISPLAY_NAMES[bareDomain]) return DISPLAY_NAMES[bareDomain];
  // Title-case the first label segment, e.g. "myodddomain.io" -> "Myodddomain"
  const base = bareDomain.split('.')[0];
  return base.charAt(0).toUpperCase() + base.slice(1);
}

/** Boss flavor emoji for a domain/key. */
export function getBossEmoji(key) {
  if (!key) return DEFAULT_BOSS_EMOJI;
  return BOSS_EMOJI[key] || BOSS_EMOJI[key.split('/')[0]] || DEFAULT_BOSS_EMOJI;
}
