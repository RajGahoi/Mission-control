// shared/extensionNav.js
// Opens one of this extension's own pages (dashboard.html, replay.html) in
// its own tab, reusing an already-open tab for that same page instead of
// letting users pile up duplicates every time they click a CTA.

/**
 * @param {string} path - one of the *_PATH constants from utils/constants.js, e.g. 'replay/replay.html'
 * @param {string} [queryString] - e.g. '?missionId=abc123'
 */
export async function openOrFocusExtensionPage(path, queryString = '') {
  const baseUrl = chrome.runtime.getURL(path);
  const targetUrl = baseUrl + queryString;
  const existing = await chrome.tabs.query({ url: `${baseUrl}*` });
  if (existing.length) {
    await chrome.tabs.update(existing[0].id, { active: true, url: targetUrl });
    await chrome.windows.update(existing[0].windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: targetUrl });
  }
}
