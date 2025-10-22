export const config = { runtime: "nodejs" };

export default async function handler(req, res) {
  try {
    const base = `http${req.headers["x-forwarded-proto"] === "https" ? "s" : ""}://${req.headers.host}`;
    const u = new URL(req.url, base);

    const target = u.searchParams.get("url");
    if (!target) return res.status(400).json({ ok: false, error: "Missing ?url=" });

    const t0 = Date.now();
    const r = await fetch(target, { method: "GET", cache: "no-store" });
    const text = await r.text();
    const ms = Date.now() - t0;

    return res.status(200).json({
      ok: true,
      status: r.status,
      url: target,
      length: text.length,
      elapsedMs: ms
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
}
