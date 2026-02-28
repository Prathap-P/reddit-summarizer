const SUMMARY_KEY = (tabId) => `summary_${tabId}`;

// ── Open sidebar on toolbar icon click ───────────────────────────────────
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

// ── Clean up storage when a tab is closed ────────────────────────────────
chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.local.remove(SUMMARY_KEY(tabId));
});

// ── Clean up storage when a tab navigates to a new page ──────────────────
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url) {
    chrome.storage.local.remove(SUMMARY_KEY(tabId));
  }
});

// ── Listen for summarization requests from sidepanel.js ──────────────────
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === "summarize" && message.type === "post") {
    const { text, tabId } = message;

    handleSummarize(text, tabId)
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: true })); // sidebar reads result from storage

    return true; // keep message channel open for async sendResponse
  }
});

async function handleSummarize(text, tabId) {
  const key = SUMMARY_KEY(tabId);

  try {
    // Load settings from storage
    const { lmBaseUrl, lmModel } = await chrome.storage.local.get([
      "lmBaseUrl",
      "lmModel",
    ]);

    // Normalize: strip trailing slash and /v1, then always append /v1 ourselves.
    const rawBase = (lmBaseUrl || "http://localhost:1234")
      .replace(/\/$/, "")
      .replace(/\/v1$/, "");
    const model = lmModel || "local-model";

    const systemPrompt =
      "Summarize the following post into a concise, structured summary that captures all key points, main arguments, important details, numbers, events, and conclusions.\n" +
        "\n" +
        "Do not add commentary, opinions, filler phrases, or meta explanations.\n" +
        "Do not mention that this is a summary.\n" +
        "Keep the output clear, direct, and information-dense.\n" +
        "Keep your thinking text inside <think> tag and output text separately in <output> tag. Follow this pattern strictly." +
        "\n";

    const response = await fetch(`${rawBase}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: text },
        ],
        temperature: 0.3,
        max_tokens: -1,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`LM Studio error ${response.status}: ${errText}`);
    }

    const data = await response.json();
    const summary = data?.choices?.[0]?.message?.content;

    if (!summary) throw new Error("No summary returned from the model.");

    // Write success result — sidepanel reads this via storage.onChanged
    await chrome.storage.local.set({
      [key]: { status: "done", summary: summary.trim(), savedAt: Date.now() },
    });
  } catch (err) {
    // Write error result so the sidebar can display it
    await chrome.storage.local.set({
      [key]: { status: "error", error: err.message, savedAt: Date.now() },
    });
  }
}
