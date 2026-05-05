// Exposes window.__pageSummarizerExtract so popup.js can call it via
// chrome.scripting.executeScript. Runs at document_idle on all http/https pages.

window.__pageSummarizerExtract = function () {
  const title = document.title.trim();
  const url = location.href;

  const contentEl = findMainContent();
  const cleaned = removeNoise(contentEl.cloneNode(true));
  const text = normaliseText(cleaned.innerText || cleaned.textContent || "");
  const wordCount = text.split(/\s+/).filter(Boolean).length;

  return { title, url, text: text.slice(0, 8000 * 5), wordCount };
};

// ── Content selection ──────────────────────────────────────────────────────

function findMainContent() {
  // Priority 1-3: semantic selectors
  for (const selector of ["article", "[role='main']", "main"]) {
    const el = document.querySelector(selector);
    if (el && textLength(el) > 200) return el;
  }

  // Priority 4: div/section with the most <p> children
  let best = null;
  let bestScore = 0;
  document.querySelectorAll("div, section").forEach(el => {
    const pCount = el.querySelectorAll("p").length;
    if (pCount > bestScore) {
      bestScore = pCount;
      best = el;
    }
  });
  if (best && bestScore >= 3) return best;

  // Priority 5: body fallback
  return document.body;
}

function textLength(el) {
  return (el.innerText || el.textContent || "").trim().length;
}

// ── Noise removal ──────────────────────────────────────────────────────────

const NOISE_SELECTORS = [
  "nav", "header", "footer", "aside",
  ".sidebar", ".side-bar", ".nav", ".navbar", ".menu", ".navigation",
  ".ads", ".ad", ".advertisement", ".ad-unit",
  ".comments", ".comment-section",
  ".social-share", ".share", ".share-buttons",
  ".cookie", ".cookie-banner", ".cookie-notice",
  ".popup", ".modal", ".overlay",
  ".newsletter", ".subscribe",
  ".related", ".related-posts",
  ".breadcrumb", ".pagination",
  "script", "style", "noscript", "iframe",
  "[role='navigation']", "[role='banner']",
  "[role='complementary']", "[role='contentinfo']"
];

function removeNoise(el) {
  NOISE_SELECTORS.forEach(sel => {
    try { el.querySelectorAll(sel).forEach(n => n.remove()); } catch { /* skip */ }
  });
  return el;
}

// ── Text normalisation ─────────────────────────────────────────────────────

function normaliseText(text) {
  return text
    .replace(/\t/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
