// Replace this with your deployed Vercel proxy URL after running: vercel --cwd proxy
const PROXY_URL = "https://hng-fe-stage-4a.vercel.app/api/summarize";


chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "summarize") {
    handleSummarize(message)
      .then(sendResponse)
      .catch(e => sendResponse({ error: e.message }));
    return true;
  }
  if (message.action === "clearCache") {
    const key = message.cacheKey || message.url;
    chrome.storage.local.remove(key).then(() => sendResponse({ ok: true }));
    return true;
  }
});

async function handleSummarize({ text, url }) {
  const store = await chrome.storage.local.get(["bulletCount", "summaryLanguage", "cacheTTL"]);
  const bulletCount = store.bulletCount || 3;
  const summaryLanguage = store.summaryLanguage || "English";
  const cacheTTLHours = store.cacheTTL !== undefined ? Number(store.cacheTTL) : 24;
  const cacheTTL = cacheTTLHours * 60 * 60 * 1000;

  // Cache key includes language and bullet count so changing either fetches fresh
  const cacheKey = `${url}::${summaryLanguage}::${bulletCount}`;

  // 1. Check cache (skip entirely if cacheTTL is 0)
  if (cacheTTL > 0) {
    const cached = await chrome.storage.local.get(cacheKey);
    if (cached[cacheKey] && Date.now() - cached[cacheKey].timestamp < cacheTTL) {
      return { summary: cached[cacheKey].summary, cached: true };
    }
  }

  // 2. Call proxy
  try {
    const res = await fetch(PROXY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: text.slice(0, 12000), bulletCount, summaryLanguage })
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      if (res.status === 429) return { error: "Rate limit reached. Try again shortly." };
      return { error: data.error || `Server error ${res.status}` };
    }

    const { summary } = data;
    if (!summary) return { error: "Empty response from server." };

    // 3. Cache result (skip if cache is off)
    if (cacheTTL > 0) {
      await chrome.storage.local.set({ [cacheKey]: { summary, timestamp: Date.now() } });
    }

    return { summary, cached: false };

  } catch {
    return { error: "Network error. Check your connection." };
  }
}
