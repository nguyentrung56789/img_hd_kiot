// api/ping.mjs
export const config = { runtime: "nodejs", maxDuration: 30 };

export default async function handler(req, res) {
  try {
    const base = `http${req.headers["x-forwarded-proto"] === "https" ? "s" : ""}://${req.headers.host}`;
    const urlObj = new URL(req.url, base);

    // lấy URL mục tiêu (hoặc mặc định image.html)
    const target = urlObj.searchParams.get("url") || "https://img-hd-kiot.vercel.app/image.html";

    // thêm timestamp để tránh cache
    const finalUrl = `${target}${target.includes("?") ? "&" : "?"}t=${Date.now()}`;

    // gọi để refresh trang (chỉ GET)
    const resp = await fetch(finalUrl, { method: "GET" });
    const text = await resp.text();

    return res.status(200).json({
      ok: true,
      status: resp.status,
      url: finalUrl,
      length: text.length,
      message: "Trang đã được ping (refresh) thành công."
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
