// ── Element references ─────────────────────────────────────────────────────
const settingsToggle    = document.getElementById("settings-toggle");
const settingsPanel     = document.getElementById("settings-panel");
const lmBaseUrlInput    = document.getElementById("lm-base-url");
const lmModelInput      = document.getElementById("lm-model");
const saveSettingsBtn   = document.getElementById("save-settings");
const settingsStatus    = document.getElementById("settings-status");

const notRedditNotice   = document.getElementById("not-reddit-notice");
const mainContent       = document.getElementById("main-content");

const btnPost           = document.getElementById("btn-summarize-post");
const postSummaryArea   = document.getElementById("post-summary-area");
const postLoading       = document.getElementById("post-loading");
const postSummaryEl     = document.getElementById("post-summary");

// ── Regex to detect a Reddit post URL ─────────────────────────────────────
const REDDIT_POST_RE = /^https:\/\/www\.reddit\.com\/r\/[^/]+\/comments\//;

// ── Initialise ────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  await loadSettings();
  await refreshUI();
});

// Re-check URL whenever the active tab changes or navigates
chrome.tabs.onActivated.addListener(() => refreshUI());
chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (changeInfo.status === "complete") refreshUI();
});

// ── Settings ──────────────────────────────────────────────────────────────
settingsToggle.addEventListener("click", () => {
  const isHidden = settingsPanel.classList.contains("hidden");
  settingsPanel.classList.toggle("hidden", !isHidden);
  settingsPanel.setAttribute("aria-hidden", String(isHidden));
});

saveSettingsBtn.addEventListener("click", async () => {
  const baseUrl = lmBaseUrlInput.value.trim();
  const model   = lmModelInput.value.trim();

  await chrome.storage.local.set({
    lmBaseUrl: baseUrl || "http://localhost:1234",
    lmModel:   model   || "local-model",
  });

  settingsStatus.textContent = "Saved!";
  setTimeout(() => (settingsStatus.textContent = ""), 2000);
});

async function loadSettings() {
  const { lmBaseUrl, lmModel } = await chrome.storage.local.get([
    "lmBaseUrl",
    "lmModel",
  ]);
  if (lmBaseUrl) lmBaseUrlInput.value = lmBaseUrl;
  if (lmModel)   lmModelInput.value   = lmModel;
}

// ── Page detection ────────────────────────────────────────────────────────
async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

async function refreshUI() {
  const tab = await getActiveTab();
  const isPost = tab && REDDIT_POST_RE.test(tab.url || "");

  notRedditNotice.classList.toggle("hidden", isPost);
  mainContent.classList.toggle("hidden", !isPost);

  // Clear previous results when navigating away or to a new post
  resetOutputArea(postSummaryArea, postLoading, postSummaryEl);
}

function resetOutputArea(area, spinner, textEl) {
  area.classList.add("hidden");
  spinner.classList.add("hidden");
  textEl.textContent = "";
}

// ── Summarize Post ────────────────────────────────────────────────────────
btnPost.addEventListener("click", async () => {
  const tab = await getActiveTab();
  if (!tab) return;

  // Ensure settings are saved before proceeding
  const { lmBaseUrl, lmModel } = await chrome.storage.local.get([
    "lmBaseUrl",
    "lmModel",
  ]);

  if (!lmBaseUrl && !lmModel) {
    // Prompt user to configure settings on first use
    settingsPanel.classList.remove("hidden");
    settingsPanel.setAttribute("aria-hidden", "false");
    settingsStatus.textContent = "Please set your LM Studio URL and model first.";
    settingsStatus.style.color = "#ff6314";
    setTimeout(() => {
      settingsStatus.textContent = "";
      settingsStatus.style.color = "";
    }, 4000);
    return;
  }

  // Show spinner, clear old summary
  postSummaryArea.classList.remove("hidden");
  postLoading.classList.remove("hidden");
  postSummaryEl.textContent = "";
  btnPost.disabled = true;

  try {
    // Step 1: scrape the post from the content script
    const scrapeResult = await sendToContentScript(tab.id, { action: "scrapePost" });

    if (!scrapeResult.ok) {
      throw new Error(scrapeResult.error || "Failed to scrape post content.");
    }

    const { title, body } = scrapeResult;
    const text = [title, body].filter(Boolean).join("\n\n");

    // Step 2: send text to background service worker for LM Studio call
    const summaryResult = await chrome.runtime.sendMessage({
      action: "summarize",
      type:   "post",
      text,
    });

    if (!summaryResult.ok) {
      throw new Error(summaryResult.error || "Summarization failed.");
    }

    postSummaryEl.textContent = summaryResult.summary;
  } catch (err) {
    postSummaryEl.textContent = `Error: ${err.message}`;
  } finally {
    postLoading.classList.add("hidden");
    btnPost.disabled = false;
  }
});

// ── Messaging helper ──────────────────────────────────────────────────────
// Wraps chrome.tabs.sendMessage and handles the case where the content script
// is not yet injected (e.g. extension freshly installed on an already-open tab).
async function sendToContentScript(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (_err) {
    // Content script not injected — inject it now and retry once
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files:  ["content_script.js"],
      });
      return await chrome.tabs.sendMessage(tabId, message);
    } catch (innerErr) {
      return { ok: false, error: `Could not inject content script: ${innerErr.message}` };
    }
  }
}
