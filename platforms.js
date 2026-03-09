/**
 * Platform registry — the single place to register a new supported site.
 *
 * To add a new platform:
 *   1. Add an entry to PLATFORMS below.
 *   2. Add its URL match patterns to manifest.json (content_scripts + host_permissions).
 *   3. Add a scraper function in content_script.js and register it in SCRAPERS.
 *
 * Fields:
 *   id          — unique identifier used in storage keys and messages
 *   name        — display name shown in the sidebar header badge
 *   test(url)   — returns true when this platform should handle the given URL
 *   buttonLabel — text for the primary summarize button
 */
const PLATFORMS = [
  {
    id: "reddit",
    name: "Reddit",
    test: (url) =>
      /^https:\/\/www\.reddit\.com\/r\/[^/]+\/comments\//.test(url),
    buttonLabel: "Summarize Post",
  },
  {
    id: "linkedin",
    name: "LinkedIn",
    test: (url) =>
      /^https:\/\/www\.linkedin\.com\/(posts\/|feed\/update\/|pulse\/)/.test(url),
    buttonLabel: "Summarize Post",
  },
];

/**
 * Returns the matching platform config for a given URL, or null if unsupported.
 * @param {string} url
 * @returns {{ id: string, name: string, buttonLabel: string } | null}
 */
function detectPlatform(url) {
  return PLATFORMS.find((p) => p.test(url)) || null;
}
