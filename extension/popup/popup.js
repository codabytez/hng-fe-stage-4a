// Page Summarizer — popup.js
// State machine: idle | extracting | summarizing | ready | cached | error | restricted

const $ = id => document.getElementById(id);
const app = $("app");

let currentTab = null;
let progressTimer = null;

// ── Bootstrap ──────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  bindEvents();
  await loadSettings();

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTab = tab;

    setPageInfo(tab.title, tab.url);

    // Restricted page check
    if (isRestricted(tab.url)) {
      setState("restricted");
      setRestrictedMessage("Page Summarizer can't run on this page.");
      return;
    }

    $("summarize-btn").disabled = false;
    setState("idle");

  } catch {
    setState("error");
    setErrorMessage("Could not load tab info.");
  }
});

// ── Events ─────────────────────────────────────────────────────────────────
function bindEvents() {
  $("summarize-btn").addEventListener("click", onSummarize);
  $("retry-btn").addEventListener("click", onSummarize);
  $("clear-btn").addEventListener("click", onClear);
  $("copy-btn").addEventListener("click", onCopy);
  $("settings-btn").addEventListener("click", openSettings);
  $("close-settings-btn").addEventListener("click", closeSettings);
  $("save-settings-btn").addEventListener("click", onSaveSettings);

  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && $("settings-panel").classList.contains("open")) {
      closeSettings();
    }
  });
}

// ── Summarize flow ─────────────────────────────────────────────────────────
async function onSummarize() {
  if (!currentTab) return;
  if (isRestricted(currentTab.url)) { setState("restricted"); return; }

  // ── Step 1: extract ──
  setState("extracting");
  setButtonLabel("Summarize Page");

  let extracted;
  try {
    let results = await chrome.scripting.executeScript({
      target: { tabId: currentTab.id },
      func: () => window.__pageSummarizerExtract?.()
    });

    // Content script not yet injected (tab was open before extension loaded) — inject and retry
    if (!results[0]?.result) {
      await chrome.scripting.executeScript({
        target: { tabId: currentTab.id },
        files: ["content.js"]
      });
      results = await chrome.scripting.executeScript({
        target: { tabId: currentTab.id },
        func: () => window.__pageSummarizerExtract?.()
      });
    }

    extracted = results[0]?.result;
  } catch {
    setState("error");
    setErrorMessage("Could not read this page. Try reloading it.");
    return;
  }

  if (!extracted?.text || extracted.text.trim().length < 100) {
    setState("restricted");
    setRestrictedMessage("Not enough content to summarize.");
    return;
  }

  // ── Step 2: summarise ──
  setState("summarizing");
  startProgress();

  const settings = await chrome.storage.local.get(["bulletCount"]);

  const result = await chrome.runtime.sendMessage({
    action: "summarize",
    text: extracted.text,
    url: currentTab.url,
    settings
  });

  finishProgress();

  if (result?.error) {
    setState("error");
    setErrorMessage(result.error);
    return;
  }

  // ── Step 3: render ──
  renderSummary(result.summary);
  setState(result.cached ? "cached" : "ready");
  setButtonLabel("Re-summarize");
}

// ── Render ─────────────────────────────────────────────────────────────────
function renderSummary(summary) {
  // Meta chips
  $("meta-time").textContent = summary.readingTime
    ? `${summary.readingTime} min read`
    : "— min read";

  $("meta-words").textContent = summary.wordCount
    ? `${summary.wordCount.toLocaleString()} words`
    : "— words";

  // Bullets
  const list = $("bullets-list");
  list.innerHTML = "";
  (summary.bullets || []).forEach(text => {
    const li = document.createElement("li");
    const dot = document.createElement("span");
    dot.className = "bullet-dot";
    dot.setAttribute("aria-hidden", "true");
    const textNode = document.createElement("span");
    textNode.textContent = safeText(text); // textContent prevents XSS
    li.appendChild(dot);
    li.appendChild(textNode);
    list.appendChild(li);
  });

  // Insights
  const insights = $("insights-list");
  insights.innerHTML = "";
  (summary.insights || []).forEach(text => {
    const card = document.createElement("div");
    card.className = "insight-card";
    card.textContent = safeText(text);
    insights.appendChild(card);
  });
}

// ── Clear ──────────────────────────────────────────────────────────────────
async function onClear() {
  if (currentTab) {
    const store = await chrome.storage.local.get(["summaryLanguage", "bulletCount"]);
    const summaryLanguage = store.summaryLanguage || "English";
    const bulletCount = store.bulletCount || 3;
    const cacheKey = `${currentTab.url}::${summaryLanguage}::${bulletCount}`;
    await chrome.runtime.sendMessage({ action: "clearCache", cacheKey });
  }
  setButtonLabel("Summarize Page");
  setState("idle");
}

// ── Copy ───────────────────────────────────────────────────────────────────
async function onCopy() {
  const bullets = Array.from($("bullets-list").querySelectorAll("li span:last-child"))
    .map(s => `• ${s.textContent}`)
    .join("\n");

  const insights = Array.from($("insights-list").querySelectorAll(".insight-card"))
    .map((c, i) => `${i + 1}. ${c.textContent}`)
    .join("\n");

  const time  = $("meta-time").textContent;
  const words = $("meta-words").textContent;

  const text = `SUMMARY\n${bullets}\n\nKEY INSIGHTS\n${insights}\n\n${time} · ${words}`;

  try {
    await navigator.clipboard.writeText(text);
    flashCopyBtn();
  } catch {
    // Clipboard unavailable — silently skip
  }
}

function flashCopyBtn() {
  const btn = $("copy-btn");
  btn.querySelector(".copy-icon").classList.add("hidden");
  btn.querySelector(".copy-check").classList.remove("hidden");
  setTimeout(() => {
    btn.querySelector(".copy-icon").classList.remove("hidden");
    btn.querySelector(".copy-check").classList.add("hidden");
  }, 1500);
}

// ── Settings ───────────────────────────────────────────────────────────────
async function loadSettings() {
  const store = await chrome.storage.local.get(["bulletCount", "summaryLanguage", "cacheTTL"]);

  const count = String(store.bulletCount || 3);
  const bulletRadio = document.querySelector(`input[name="bulletCount"][value="${count}"]`);
  if (bulletRadio) bulletRadio.checked = true;

  const lang = store.summaryLanguage || "English";
  $("language-select").value = lang;

  const ttl = String(store.cacheTTL || 24);
  const ttlRadio = document.querySelector(`input[name="cacheTTL"][value="${ttl}"]`);
  if (ttlRadio) ttlRadio.checked = true;
}

function openSettings() {
  app.classList.add("settings-open");
  $("settings-panel").classList.add("open");
  $("settings-panel").setAttribute("aria-hidden", "false");
}

function closeSettings() {
  app.classList.remove("settings-open");
  $("settings-panel").classList.remove("open");
  $("settings-panel").setAttribute("aria-hidden", "true");
}

async function onSaveSettings() {
  const bulletCount = Number(
    document.querySelector("input[name='bulletCount']:checked")?.value || 3
  );
  const summaryLanguage = $("language-select").value || "English";
  const cacheTTL = Number(
    document.querySelector("input[name='cacheTTL']:checked")?.value || 24
  );

  await chrome.storage.local.set({ bulletCount, summaryLanguage, cacheTTL });
  showSavedButton();
}

let saveRevertTimer = null;

function showSavedButton() {
  const btn = $("save-settings-btn");
  const label = btn.querySelector(".save-label");
  const check = btn.querySelector(".save-check");

  btn.classList.add("saved");
  check.classList.remove("hidden");
  label.textContent = "Saved";

  clearTimeout(saveRevertTimer);
  saveRevertTimer = setTimeout(() => {
    btn.classList.remove("saved");
    check.classList.add("hidden");
    label.textContent = "Save";
  }, 2000);
}

// ── Progress bar ───────────────────────────────────────────────────────────
function startProgress() {
  const bar = $("progress-bar");
  bar.classList.remove("complete");
  // Force reflow so animation restarts cleanly
  void bar.offsetWidth;
}

function finishProgress() {
  const bar = $("progress-bar");
  bar.classList.add("complete");
  clearTimeout(progressTimer);
}

// ── State management ───────────────────────────────────────────────────────
function setState(name) {
  app.dataset.state = name;
}

function setPageInfo(title, url) {
  $("page-title").textContent = title || "Untitled page";
  try {
    $("page-url").textContent = new URL(url).hostname;
  } catch {
    $("page-url").textContent = url || "";
  }
}

function setErrorMessage(msg) {
  $("error-message").textContent = msg;
}

function setRestrictedMessage(msg) {
  $("restricted-message").textContent = msg;
}

function setButtonLabel(label) {
  $("summarize-btn").querySelector(".btn-label").textContent = label;
}

// ── Helpers ────────────────────────────────────────────────────────────────
function isRestricted(url) {
  if (!url) return true;
  return (
    url.startsWith("chrome://") ||
    url.startsWith("chrome-extension://") ||
    url.startsWith("about:") ||
    url.startsWith("edge://") ||
    url.startsWith("data:")
  );
}

function safeText(str) {
  // Defensive cast — content should already be plain text from textContent
  return typeof str === "string" ? str : String(str ?? "");
}
