// Listen for scrape requests from sidepanel.js (relayed via background or direct tab message)
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === "scrapePost") {
    try {
      const result = scrapePost();
      sendResponse({ ok: true, ...result });
    } catch (err) {
      sendResponse({ ok: false, error: err.message });
    }
    // Synchronous response — no need to return true
  }
});

function scrapePost() {
  // --- Title ---
  // Try multiple selectors in order of reliability for new Reddit (shreddit layout)
  const titleEl =
    document.querySelector("shreddit-post h1") ||
    document.querySelector("[slot='title']") ||
    document.querySelector("h1[id^='post-title']") ||
    document.querySelector("h1");

  const title = titleEl ? titleEl.innerText.trim() : "";

  // --- Body (self-text posts only; link posts have no body) ---
  const bodyEl =
    document.querySelector("div[slot='text-body']") ||
    document.querySelector("shreddit-post .md") ||
    document.querySelector("[data-click-id='text'] .md") ||
    document.querySelector(".usertext-body .md");

  const body = bodyEl ? bodyEl.innerText.trim() : "";

  if (!title && !body) {
    throw new Error(
      "Could not find post content. Make sure you are on a Reddit post page."
    );
  }

  return { title, body };
}
