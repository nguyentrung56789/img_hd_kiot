// image/api/ping.mjs
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

// Lấy Supabase URL + service role từ file public ./js/internal_key.js
async function getInternalKeys(base) {
  const r = await fetch(`${base}/js/internal_key.js`, { cache: "no-store" });
  if (!r.ok) throw new Error(`Không tải được internal_key.js (${r.status})`);
  const t = await r.text();
  const url  = t.match(/url:\s*"([^"]+)"/)?.[1];
  const role = t.match(/role:\s*"([^"]+)"/)?.[1];
  if (!url || !role) throw new Error("Thiếu url/role trong internal_key.js");
  return { SUPABASE_URL: url, SERVICE_KEY: role };
}

export const config = { runtime: "nodejs", maxDuration: 60 };

export default async function handler(req, res) {
  try {
    const base = `http${req.headers["x-forwarded-proto"]==="https"?"s":""}://${req.headers.host}`;
    const { SUPABASE_URL, SERVICE_KEY } = await getInternalKeys(base);

    // ---- cấu hình cố định (1 thư mục, chỉ đổi đuôi) ----
    const BUCKET   = "img_hd_kiot";
    const HTML_KEY = "img_hd.html";
    const PNG_KEY  = "img_hd.png";

    // 1) lấy HTML từ Supabase
    const htmlURL = `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${encodeURIComponent(HTML_KEY)}`;
    const htmlResp = await fetch(htmlURL, { headers: { Authorization: `Bearer ${SERVICE_KEY}` } });
    if (!htmlResp.ok) {
      const txt = await htmlResp.text().catch(()=> "");
      return res.status(502).end(`Không tải được HTML: ${htmlResp.status} ${txt}`);
    }
    const html = await htmlResp.text();

    // 2) render HTML -> PNG bằng Chromium (server-side)
    const execPath = await chromium.executablePath();
    const browser = await puppeteer.launch({
      args: chromium.args,
      headless: chromium.headless,
      executablePath: execPath,
      defaultViewport: { width: 900, height: 1024, deviceScaleFactor: 2 }
    });
    const page = await browser.newPage();
    await page.setCacheEnabled(false);
    await page.setContent(html, { waitUntil: "networkidle0" });
    await page.evaluate(() => {
      document.documentElement.style.background = "#fff";
      document.body.style.background = "#fff";
    });
    const png = await page.screenshot({ type: "png", fullPage: true });
    await browser.close();

    // 3) upload PNG vào cùng bucket/thư mục
    const uploadURL = `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${encodeURIComponent(PNG_KEY)}`;
    const up = await fetch(uploadURL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "image/png",
        "x-upsert": "true"
      },
      body: png
    });
    if (!up.ok) {
      const t = await up.text().catch(()=> "");
      return res.status(500).end(`Upload PNG lỗi: ${up.status} ${t}`);
    }

    // 4) trả kết quả
    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${PNG_KEY}`;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: true, html: HTML_KEY, png: PNG_KEY, url: publicUrl }));
  } catch (e) {
    res.statusCode = 500;
    res.end(`Ping render error: ${e.message}`);
  }
}
