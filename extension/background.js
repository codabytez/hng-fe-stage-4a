// Replace this with your deployed Vercel proxy URL after running: vercel --cwd proxy
const PROXY_URL = "https://your-proxy.vercel.app/api/summarize";

const CACHE_TTL = 86400000; // 24 hours

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "summarize") {
    handleSummarize(message)
      .then(sendResponse)
      .catch(e => sendResponse({ error: e.message }));
    return true;
  }
  if (message.action === "clearCache") {
    chrome.storage.local.remove(message.url).then(() => sendResponse({ ok: true }));
    return true;
  }
});

async function handleSummarize({ text, url }) {
  // 1. Check cache
  const cached = await chrome.storage.local.get(url);
  if (cached[url] && Date.now() - cached[url].timestamp < CACHE_TTL) {
    return { summary: cached[url].summary, cached: true };
  }

  const { bulletCount = 3 } = await chrome.storage.local.get("bulletCount");

  // 2. Call proxy
  try {
    const res = await fetch(PROXY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: text.slice(0, 12000), bulletCount })
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      if (res.status === 429) return { error: "Rate limit reached. Try again shortly." };
      return { error: data.error || `Server error ${res.status}` };
    }

    const { summary } = data;
    if (!summary) return { error: "Empty response from server." };

    // 3. Cache result
    await chrome.storage.local.set({ [url]: { summary, timestamp: Date.now() } });

    return { summary, cached: false };

  } catch {
    return { error: "Network error. Check your connection." };
  }
}
