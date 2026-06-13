export default function handler(req, res) {
  res.status(200).json({
    name: "page-summarizer-proxy",
    status: "ok",
    endpoint: "POST /api/summarize",
  });
}
