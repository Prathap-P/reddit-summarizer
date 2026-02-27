// Open the side panel when the extension toolbar icon is clicked
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

// Listen for summarization requests from sidepanel.js
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === "summarize" && message.type === "post") {
    handleSummarize(message.text)
      .then((summary) => sendResponse({ ok: true, summary }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));

    // Return true to keep the message channel open for the async response
    return true;
  }
});

async function handleSummarize(text) {
  // Load settings from storage
  const { lmBaseUrl, lmModel } = await chrome.storage.local.get([
    "lmBaseUrl",
    "lmModel",
  ]);

  // Normalize: strip trailing slash and trailing /v1, then always add /v1 ourselves.
  // This makes it work whether the user saved "http://localhost:1234" or "http://localhost:1234/v1".
  const rawBase = (lmBaseUrl || "http://localhost:1234").replace(/\/$/, "").replace(/\/v1$/, "");
  const model = lmModel || "local-model";

  const systemPrompt =
    "You are a concise assistant. Summarize the following Reddit post clearly and briefly. " +
    "Cover the main topic, key points, and any important context.";

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
      max_tokens: 300,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`LM Studio error ${response.status}: ${errText}`);
  }

  const data = await response.json();
  const summary = data?.choices?.[0]?.message?.content;

  if (!summary) {
    throw new Error("No summary returned from the model.");
  }

  return summary.trim();
}
