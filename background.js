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
    const { text, tabId, platform } = message;

    handleSummarize(text, tabId, platform)
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: true })); // sidebar reads result from storage

    return true; // keep message channel open for async sendResponse
  }
});

async function handleSummarize(text, tabId, platform) {
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

    const systemPrompt = buildSystemPrompt(platform);

    const response = await fetch(`${rawBase}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: text },
        ],
        temperature: 0.4,
        max_tokens: 10000,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`LM Studio error ${response.status}: ${errText}`);
    }

    const data = await response.json();
    const summary = data?.choices?.[0]?.message?.content;

    if (!summary) throw new Error("No summary returned from the model.");

    // Use lastIndexOf to reliably find the last <output> block.
    // This handles: multiple tags, thinking-phase tags, and unclosed tags.
    const lower      = summary.toLowerCase();
    const lastOpen   = lower.lastIndexOf("<output>");
    const lastClose  = lower.lastIndexOf("</output>");

    let extracted;
    if (lastOpen !== -1) {
      const contentStart = lastOpen + "<output>".length;
      // If closing tag exists and comes after the opening tag, use it; otherwise read to end.
      const contentEnd = lastClose > lastOpen ? lastClose : summary.length;
      extracted = summary.slice(contentStart, contentEnd).trim();
    } else {
      // No <output> tag at all — fall back to full response
      extracted = summary.trim();
    }

    // Write success result — sidepanel reads this via storage.onChanged
    await chrome.storage.local.set({
      [key]: { status: "done", summary: extracted, savedAt: Date.now() },
    });
  } catch (err) {
    // Write error result so the sidebar can display it
    await chrome.storage.local.set({
      [key]: { status: "error", error: err.message, savedAt: Date.now() },
    });
  }
}

// ── Platform-specific system prompts ───────────────────────────────────────
function buildSystemPrompt(platform) {
  const base =
    "Summarize the following post into a concise, structured summary that captures " +
    "all key points, main arguments, important details, numbers, events, and conclusions.\n\n" +
    "Do not add commentary, opinions, filler phrases, or meta explanations.\n" +
    "Do not mention that this is a summary.\n" +
    "Keep the output clear, direct, and information-dense.\n";

  const platformHints = {
    linkedin:
      "This is a LinkedIn post. Pay attention to professional insights, announcements, " +
      "career updates, or industry opinions the author is sharing.\n",
    reddit:
      "This is a Reddit post. Capture the main question or topic, key context, " +
      "and any important details the author provides.\n",
  };

  const hint = platformHints[platform] || "";
  return (
    base +
    hint +
    "Keep your thinking text inside <think> tag and output text separately in <output> tag. Follow this pattern strictly."
  );
}
