# Page Summarizer — AI Chrome Extension

A Manifest V3 Chrome Extension that extracts readable content from any webpage and returns a structured AI summary — bullet points, key insights, reading time, and word count — powered by the Anthropic Claude API via a serverless proxy.

---

## Features

- **Smart content extraction** — targets `<article>`, `[role="main"]`, `<main>`, or the densest paragraph container; strips nav, sidebars, ads, and scripts
- **AI-powered summary** — configurable 3 / 5 / 7 bullet points + 2 key insights via `claude-haiku-4-5-20251001`
- **Reading time & word count** — estimated and returned by the AI
- **Per-URL caching** — results cached in `chrome.storage.local` for 24 hours; no duplicate API calls
- **7 UI states** — idle → extracting → summarizing (progress bar + skeleton) → ready / cached → error / restricted
- **Copy to clipboard** — one-click Markdown copy
- **Configurable bullet count** — 3 / 5 / 7 via settings
- **Zero key exposure** — API key lives in a Vercel environment variable; never in the extension source, never committed to the repo

---

## Setup

### Prerequisites

- Google Chrome (or any Chromium-based browser)
- Node.js ≥ 14 (for icon generation only — no npm install required)

### 1. Clone the repo

```bash
git clone https://github.com/codabytez/hng-fe-stage-4a.git
cd hng-fe-stage-4a
```

### 2. Generate icons

```bash
node scripts/generate-icons.js
```

Creates `extension/icons/icon16.png`, `icon48.png`, `icon128.png` using pure Node.js — no dependencies.

### 3. Load the extension in Chrome

1. Open Chrome and navigate to `chrome://extensions`
2. Enable **Developer mode** (toggle, top-right)
3. Click **Load unpacked**
4. Select the **`extension/`** folder inside this repo
5. Pin the Page Summarizer icon to the toolbar

### 4. Open any article and click **Summarize Page**

No API key setup needed — the extension calls a hosted proxy that handles authentication.

---

## Architecture

```text
hng-fe-stage-4a/
├── extension/               ← Load this folder in Chrome
│   ├── manifest.json        — MV3 manifest
│   ├── background.js        — Service worker: proxy calls, cache, message routing
│   ├── content.js           — Injected into pages: exposes __pageSummarizerExtract()
│   ├── popup/
│   │   ├── popup.html       — All 7 UI states declared in HTML
│   │   ├── popup.css        — Design tokens, animations, state visibility via data-state
│   │   └── popup.js         — State machine, Chrome messaging, settings
│   └── icons/               — Generated PNGs (16 / 48 / 128 px)
├── proxy/                   ← Vercel serverless function
│   ├── api/
│   │   └── summarize.js     — Receives text, calls Anthropic, returns summary
│   ├── package.json
│   └── vercel.json
└── scripts/
    └── generate-icons.js    — Pure Node PNG generator (no npm deps)
```

### Message flow

```text
User clicks "Summarize Page"
        │
        ▼
popup.js — chrome.scripting.executeScript()
        │       calls window.__pageSummarizerExtract() in content.js
        │       returns { title, url, text, wordCount }
        ▼
popup.js — chrome.runtime.sendMessage({ action: "summarize", text, url })
        │
        ▼
background.js (service worker)
        ├── checks chrome.storage.local cache
        └── POST https://page-summarizer-proxy.vercel.app/api/summarize
                │
                ▼
           Vercel proxy  ←  ANTHROPIC_API_KEY (env variable, never in source)
                │
                └── POST https://api.anthropic.com/v1/messages
                        └── returns { bullets, insights, readingTime, wordCount }
        │
        ▼
popup.js renders summary, setState("ready" | "cached")
```

---

## Content Extraction Strategy

`content.js` exposes `window.__pageSummarizerExtract()` which:

1. Tries semantic selectors in priority order: `article` → `[role="main"]` → `main`
2. Falls back to the `<div>` or `<section>` with the most `<p>` children (density heuristic)
3. Falls back to `document.body`
4. Clones the element and strips noise: `nav`, `header`, `footer`, `aside`, `.sidebar`, `.menu`, `script`, `style`, `iframe`, social/cookie/comment widgets
5. Normalizes whitespace and caps output at ~40,000 chars (proxy truncates to 12,000 before sending to the API)

If the content script hasn't been injected yet (tab was open before the extension loaded), `popup.js` injects `content.js` on the fly before calling the extract function.

---

## AI Integration

- **Model**: `claude-haiku-4-5-20251001` — fast and cost-efficient for summarization tasks
- **Prompt**: instructs the model to return strict JSON with `bullets`, `insights`, `readingTime`, and `wordCount`
- **Proxy**: the Vercel serverless function forwards requests to Anthropic, injecting the API key from the server environment. The extension never sees or stores the key.
- **Response parsing**: JSON is parsed directly; a regex fallback extracts the JSON block if the model wraps it in prose

---

## Security Decisions

| Concern | Approach |
| --- | --- |
| API key | Stored as a Vercel environment variable — never in source code, never in the extension, never committed |
| API calls | Made exclusively from the Vercel proxy (server-side) — background.js has no key |
| XSS prevention | All AI output inserted via `textContent`, never `innerHTML` |
| Message validation | Each `onMessage` handler checks `message.action` before processing |
| Content script scope | Matches only `http://` and `https://` — `chrome://` pages blocked before `executeScript` is called |
| Secrets in repo | `.gitignore` excludes `.env`, `secrets.json`; `background.js` contains no credentials |

---

## Proxy Deployment (Vercel)

The proxy is already deployed. If you need to redeploy:

1. Go to [vercel.com](https://vercel.com) → New Project → Import this repo
2. Set **Root Directory** to `proxy`
3. Add environment variable: `ANTHROPIC_API_KEY` = your key
4. Deploy
5. Update `PROXY_URL` in `extension/background.js` with the new URL

---

## Known Limitations

- **`chrome://` pages** — Chrome blocks content scripts on internal pages; the extension shows a "can't run here" message
- **PDFs** — Chrome's native PDF viewer doesn't support content script injection
- **Login-walled pages** — Pages behind a paywall return a login form instead of the article text
- **SPAs with late-loading content** — Content injected after `document_idle` may be missed; reloading and re-summarizing usually fixes this
- **Very short pages** — Fewer than 100 characters of extracted text triggers the "not enough content" state

---

## Demo

Record a 2–5 minute video showing:

1. Loading the extension at `chrome://extensions` → Load Unpacked → `extension/` folder
2. Navigating to an article (e.g. a Medium post, BBC News, or dev.to)
3. Clicking Summarize Page — showing extracting → summarizing (progress bar + skeleton) → summary ready
4. Revisiting the same URL to show the Cached state
5. Clicking Copy and pasting the result
6. Changing bullet count in Settings and re-summarizing
