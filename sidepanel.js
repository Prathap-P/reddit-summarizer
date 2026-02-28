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

// ── Constants & shared state ───────────────────────────────────────────────
const REDDIT_POST_RE = /^https:\/\/www\.reddit\.com\/r\/[^/]+\/comments\//;
const SUMMARY_TTL_MS = 10 * 60 * 1000;           // 10 minutes
const summaryKey     = (tabId) => `summary_${tabId}`;
let   currentTabId   = null;

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

// ── React to storage changes (result arriving from background) ────────────
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || currentTabId === null) return;
  const key = summaryKey(currentTabId);
  if (!changes[key]) return;
  applyStoredState(changes[key].newValue);
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

  currentTabId = tab ? tab.id : null;

  notRedditNotice.classList.toggle("hidden", isPost);
  mainContent.classList.toggle("hidden", !isPost);

  // Always reset output first, then restore from cache if available
  resetOutputArea(postSummaryArea, postLoading, postSummaryEl);
  btnPost.disabled = false;

  if (isPost && currentTabId !== null) {
    const stored = await chrome.storage.local.get(summaryKey(currentTabId));
    const entry  = stored[summaryKey(currentTabId)];

    if (entry) {
      const age = Date.now() - (entry.savedAt || 0);
      if (age > SUMMARY_TTL_MS) {
        // Expired — clean up silently
        chrome.storage.local.remove(summaryKey(currentTabId));
      } else {
        applyStoredState(entry);
      }
    }
  }
}

// Apply a storage entry to the UI (handles loading / done / error states)
function applyStoredState(entry) {
  if (!entry) return;

  postSummaryArea.classList.remove("hidden");

  if (entry.status === "loading") {
    postLoading.classList.remove("hidden");
    postSummaryEl.innerHTML = "";
    btnPost.disabled = true;
  } else if (entry.status === "done") {
    postLoading.classList.add("hidden");
    renderMarkdown(postSummaryEl, entry.summary);
    btnPost.disabled = false;
  } else if (entry.status === "error") {
    postLoading.classList.add("hidden");
    postSummaryEl.textContent = `Error: ${entry.error}`;
    btnPost.disabled = false;
  }
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

  // Ensure settings are configured before proceeding
  const { lmBaseUrl, lmModel } = await chrome.storage.local.get(["lmBaseUrl", "lmModel"]);
  if (!lmBaseUrl && !lmModel) {
    settingsPanel.classList.remove("hidden");
    settingsPanel.setAttribute("aria-hidden", "false");
    settingsStatus.textContent = "Please set your LM Studio URL and model first.";
    settingsStatus.style.color = "#ff6314";
    setTimeout(() => { settingsStatus.textContent = ""; settingsStatus.style.color = ""; }, 4000);
    return;
  }

  const tabId = tab.id;
  const key   = summaryKey(tabId);

  // Write loading state to storage — background will overwrite with done/error
  await chrome.storage.local.set({ [key]: { status: "loading", savedAt: Date.now() } });
  applyStoredState({ status: "loading" });

  try {
    // Step 1: scrape the post via content script
    const scrapeResult = await sendToContentScript(tabId, { action: "scrapePost" });
    if (!scrapeResult.ok) throw new Error(scrapeResult.error || "Failed to scrape post content.");

    const { title, body } = scrapeResult;
    const text = [title, body].filter(Boolean).join("\n\n");

    // Step 2: fire summarize request to background — result comes back via storage.onChanged
    chrome.runtime.sendMessage({ action: "summarize", type: "post", text, tabId });
  } catch (err) {
    // Scraping failed before even reaching background — write error to storage directly
    await chrome.storage.local.set({
      [key]: { status: "error", error: err.message, savedAt: Date.now() },
    });
  }
});

// ── Markdown rendering ───────────────────────────────────────────────────
function renderMarkdown(el, text) {
  // marked.parse returns HTML; sanitize by relying on marked's default escaping.
  // For an extension context this is acceptable — no user-supplied HTML enters here.
  el.innerHTML = marked.parse(text);
}

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
