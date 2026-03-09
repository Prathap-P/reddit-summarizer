// ── Dispatcher ────────────────────────────────────────────────────────────
// Routes the scrape action to the right platform scraper based on the current URL.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === "scrapePost") {
    try {
      const result = scrape();
      sendResponse({ ok: true, ...result });
    } catch (err) {
      sendResponse({ ok: false, error: err.message });
    }
    // Synchronous response — no need to return true
  }
});

function scrape() {
  const url = location.href;
  if (/reddit\.com\/r\/[^/]+\/comments\//.test(url)) return scrapeReddit();
  if (/linkedin\.com\/(posts\/|feed\/update\/|pulse\/)/.test(url))  return scrapeLinkedIn();
  throw new Error("Unsupported page. Open a supported post to summarize.");
}

// ── Reddit scraper ────────────────────────────────────────────────────────
function scrapeReddit() {
  const titleEl =
    document.querySelector("shreddit-post h1") ||
    document.querySelector("[slot='title']") ||
    document.querySelector("h1[id^='post-title']") ||
    document.querySelector("h1");

  const title = titleEl ? titleEl.innerText.trim() : "";

  const bodyEl =
    document.querySelector("div[slot='text-body']") ||
    document.querySelector("shreddit-post .md") ||
    document.querySelector("[data-click-id='text'] .md") ||
    document.querySelector(".usertext-body .md");

  const body = bodyEl ? bodyEl.innerText.trim() : "";

  if (!title && !body) {
    throw new Error("Could not find Reddit post content.");
  }

  return { title, body };
}

// ── LinkedIn scraper ──────────────────────────────────────────────────────
function scrapeLinkedIn() {
  // --- Article (LinkedIn Pulse) ---
  const articleTitle = document.querySelector(
    "h1.reader-article-header__title, h1[class*='article-title']"
  );
  const articleBody = document.querySelector(
    ".reader-article-content, [class*='article-body']"
  );

  if (articleTitle || articleBody) {
    const title = articleTitle ? articleTitle.innerText.trim() : "";
    const body  = articleBody  ? articleBody.innerText.trim()  : "";
    if (title || body) return { title, body };
  }

  // --- Feed post / standalone post ---
  // Author name
  const authorEl = document.querySelector(
    ".feed-shared-actor__name, " +
    ".update-components-actor__name, " +
    "[class*='actor__name']"
  );
  const author = authorEl ? authorEl.innerText.trim() : "";

  // Post text — try multiple stable selectors
  const textEl =
    document.querySelector(".feed-shared-update-v2__description .feed-shared-text") ||
    document.querySelector(".feed-shared-text") ||
    document.querySelector(".update-components-text") ||
    document.querySelector(".feed-shared-update-v2__description") ||
    document.querySelector("[class*='attributed-text']") ||
    document.querySelector("[class*='break-words']");

  const body = textEl ? textEl.innerText.trim() : "";

  if (!body) {
    throw new Error(
      "Could not find LinkedIn post content. Make sure the post is fully loaded."
    );
  }

  const title = author ? `Post by ${author}` : "LinkedIn Post";
  return { title, body };
}
