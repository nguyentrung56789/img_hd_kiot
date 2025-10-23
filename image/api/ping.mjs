import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

// lấy key từ file ./js/internal_key.js (public)
async function getInternalKeys(base) {
  const resp = await fetch(`${base}/js/internal_key.js`, { cache: "no-store" });
  if (!resp.ok) throw new Error("Không tải được internal_key.js");
  const text = await resp.text();

  const url  = text.match(/url:\s*"([^"]+)"/)?.[1];
  const role = text.match(/role:\s*"([^"]+)"/)?.[1];
  if (!url || !role) throw new Error("Thiếu Supabase URL hoặc Role key trong internal_key.js");

  return { SUPABASE_URL: url, SERVICE_KEY: role };
}

export const config = { runtime: "nodejs", maxDuration: 60 };

export default async function handler(req, res) {
  try {
    // ====== Lấy param ======
    const base = `http${req.headers["x-forwarded-proto"] === "https" ? "s" : ""}://${req.headers.host}`;
    const u = new URL(req.url, base);
    const bucket = u.searchParams.get("bucket") || "images";
    const path   = u.searchParams.get("path"); // ví dụ: html/HD0033.html
    if (!path) return res.status(400).end("Thiếu ?path=");

    const width = Number(u.searchParams.get("w") || 794);
    const scale = Number(u.searchParams.get("s") || 2);
    const full  = u.searchParams.get("full") !== "0";
    const wait  = Number(u.searchParams.get("wait") || 300);
    const bg    = u.searchParams.get("bg") || "#ffffff";

    // ====== Lấy key từ internal_key.js ======
    const { SUPABASE_URL, SERVICE_KEY } = await getInternalKeys(base);

    // ====== Tải file HTML từ Supabase Storage ======
    const fileUrl = `${SUPABASE_URL}/storage/v1/object/${bucket}/${encodeURIComponent(path)}`;
    const htmlResp = await fetch(fileUrl, { headers: { Authorization: `Bearer ${SERVICE_KEY}` } });
    if (!htmlResp.ok) {
      const t = await htmlResp.text().catch(()=> "");
      return res.status(502).end(`Lấy HTML thất bại: ${htmlResp.status} ${t}`);
    }
    const html = await htmlResp.text();

    // ====== Render HTML → PNG bằng Chromium ======
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

    // ép màu nền
    await page.evaluate(color => {
      document.documentElement.style.background = color;
      document.body.style.background = color;
    }, bg);

    if (wait > 0) await page.waitForTimeout(wait);
    const png = await page.screenshot({ type: "png", fullPage: full });
    await browser.close();

    // ====== Xuất ảnh PNG ======
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-store");
    res.end(png);
  } catch (e) {
    res.status(500).end(`Render error: ${e.message}`);
  }
}
