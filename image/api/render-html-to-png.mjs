import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

// Lấy Supabase URL + Service Role từ ./js/internal_key.js (public)
async function getInternalKeys(base) {
  const r = await fetch(`${base}/js/internal_key.js`, { cache: "no-store" });
  if (!r.ok) throw new Error(`Không tải được /js/internal_key.js (${r.status})`);
  const t = await r.text();
  const url  = t.match(/url:\s*"([^"]+)"/)?.[1];
  const role = t.match(/role:\s*"([^"]+)"/)?.[1];
  if (!url || !role) throw new Error("Thiếu url/role trong internal_key.js");
  return { SUPABASE_URL: url, SERVICE_KEY: role };
}

export const config = { runtime: "nodejs", maxDuration: 60 };

export default async function handler(req, res) {
  try {
    const base = `http${req.headers["x-forwarded-proto"] === "https" ? "s" : ""}://${req.headers.host}`;
    const u = new URL(req.url, base);

    // ⬇️ bạn truyền bucket + path của file HTML trong Supabase
    // Ví dụ bạn nói: thư mục tại supa: img_hd_kiot/  , file: img_hd.html
    // => nếu bucket là "images": path = "img_hd_kiot/img_hd.html"
    const bucket = u.searchParams.get("bucket") || "images";
    const path   = u.searchParams.get("path"); // ví dụ: img_hd_kiot/img_hd.html
    if (!path) return res.status(400).end("Thiếu ?path=");

    // tuỳ chọn render
    const width = Number(u.searchParams.get("w") || 900);
    const scale = Number(u.searchParams.get("s") || 2);
    const full  = u.searchParams.get("full") !== "0";
    const wait  = Number(u.searchParams.get("wait") || 300);
    const bg    = u.searchParams.get("bg") || "#ffffff";

    // 1) lấy key từ internal_key.js
    const { SUPABASE_URL, SERVICE_KEY } = await getInternalKeys(base);

    // 2) đọc HTML từ Supabase Storage
    const fileUrl = `${SUPABASE_URL}/storage/v1/object/${bucket}/${encodeURIComponent(path)}`;
    const htmlResp = await fetch(fileUrl, { headers: { Authorization: `Bearer ${SERVICE_KEY}` } });
    if (!htmlResp.ok) {
      const txt = await htmlResp.text().catch(()=>"");
      return res.status(502).end(`Lấy HTML thất bại: ${htmlResp.status} ${txt}`);
    }
    const html = await htmlResp.text();

    // 3) render HTML → PNG
    const execPath = await chromium.executablePath();
    const browser = await puppeteer.launch({
      args: chromium.args,
      headless: chromium.headless,
      executablePath: execPath,
      defaultViewport: { width, height: 1024, deviceScaleFactor: scale }
    });
    const page = await browser.newPage();
    await page.setCacheEnabled(false);
    await page.setContent(html, { waitUntil: "networkidle0" });

    await page.evaluate(c => {
      document.documentElement.style.background = c;
      document.body.style.background = c;
    }, bg);

    if (wait > 0) await page.waitForTimeout(wait);
    const png = await page.screenshot({ type: "png", fullPage: full });
    await browser.close();

    // 4) trả ảnh PNG (chỉ đổi đuôi)
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-store");
    res.end(png);
  } catch (e) {
    res.status(500).end(`Render error: ${e.message}`);
  }
}
