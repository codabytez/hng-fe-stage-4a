const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-haiku-4-5-20251001";

export default async function handler(req, res) {
  // CORS — allow requests from any Chrome extension
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { text, bulletCount = 3 } = req.body ?? {};

  if (!text || typeof text !== "string" || text.trim().length < 50) {
    return res.status(400).json({ error: "Missing or too-short text" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Server not configured — ANTHROPIC_API_KEY missing" });
  }

  const count = Math.min(Math.max(Number(bulletCount) || 3, 3), 7);

  try {
    const upstream = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        system: "You are a webpage summarizer. Return ONLY valid JSON, no markdown, no backticks.",
        messages: [{
          role: "user",
          content: `Summarize this webpage. Return JSON with exactly this shape:
{
  "bullets": ["string"],
  "insights": ["string", "string"],
  "readingTime": number,
  "wordCount": number
}

Rules:
- bullets: exactly ${count} concise points covering the main content
- insights: exactly 2 key takeaways, distinct from bullet points
- readingTime: estimated minutes to read the original (integer, based on ~200wpm)
- wordCount: approximate word count of the original content (integer)

Webpage content:
${text.slice(0, 12000)}`
        }]
      })
    });

    if (!upstream.ok) {
      const err = await upstream.json().catch(() => ({}));
      const msg = err?.error?.message || "";
      if (upstream.status === 429) return res.status(429).json({ error: "Rate limit reached. Try again shortly." });
      if (upstream.status === 401) return res.status(401).json({ error: "Invalid API key on server." });
      return res.status(upstream.status).json({ error: msg || `Upstream error ${upstream.status}` });
    }

    const data = await upstream.json();
    const raw = data?.content?.[0]?.text?.trim() ?? "";

    let summary;
    try {
      summary = JSON.parse(raw);
    } catch {
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) return res.status(500).json({ error: "Could not parse AI response." });
      summary = JSON.parse(match[0]);
    }

    // Normalise
    summary.bullets     = Array.isArray(summary.bullets)   ? summary.bullets.slice(0, 7)  : [];
    summary.insights    = Array.isArray(summary.insights)  ? summary.insights.slice(0, 2) : [];
    summary.readingTime = typeof summary.readingTime === "number" ? summary.readingTime : 0;
    summary.wordCount   = typeof summary.wordCount   === "number" ? summary.wordCount   : 0;

    return res.status(200).json({ summary });

  } catch (e) {
    return res.status(500).json({ error: "Network error reaching Anthropic." });
  }
}
