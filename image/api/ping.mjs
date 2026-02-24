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

// Chỉ cho phép ký tự an toàn trong mã hoá đơn để tránh path traversal
function sanitizeMaHD(v) {
  if (!v) return "";
  const s = String(v).trim();
  // Cho phép chữ, số, gạch dưới, gạch ngang (VD: HD009167, HD-009167)
  const ok = s.replace(/[^a-zA-Z0-9_-]/g, "");
  return ok;
}

// Parse body JSON (dùng khi POST)
async function readJsonBody(req) {
  return await new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
  });
}

export const config = { runtime: "nodejs", maxDuration: 60 };

export default async function handler(req, res) {
  try {
    const base = `http${req.headers["x-forwarded-proto"] === "https" ? "s" : ""}://${req.headers.host}`;
    const { SUPABASE_URL, SERVICE_KEY } = await getInternalKeys(base);

    // ---- 0) Lấy ma_hd từ query hoặc body ----
    let ma_hd = sanitizeMaHD(req.query?.ma_hd);

    if (!ma_hd && (req.method === "POST" || req.method === "PUT")) {
      const body = await readJsonBody(req);
      ma_hd = sanitizeMaHD(body?.ma_hd);
    }

    if (!ma_hd) {
      res.statusCode = 400;
      return res.end("Thiếu ma_hd. Gọi: /image/api/ping?ma_hd=HD009167 hoặc POST JSON {ma_hd:'HD009167'}");
    }

    // ---- cấu hình ----
    const BUCKET = "img_hd_kiot";

    // HTML theo mã hoá đơn (bạn upload sẵn file này vào bucket)
    // Ví dụ: hoa_don_HD009167.html
    const HTML_KEY = `hoa_don_${ma_hd}.html`;

    // PNG output
    const PNG_KEY = `hoa_don_${ma_hd}_${Date.now()}.png`;

    // 1) lấy HTML từ Supabase Storage
    const htmlURL = `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${encodeURIComponent(HTML_KEY)}`;
    const htmlResp = await fetch(htmlURL, {
      headers: { Authorization: `Bearer ${SERVICE_KEY}` },
      cache: "no-store",
    });

    if (!htmlResp.ok) {
      const txt = await htmlResp.text().catch(() => "");
      res.statusCode = 502;
      return res.end(`Không tải được HTML (${HTML_KEY}): ${htmlResp.status} ${txt}`);
    }
    const html = await htmlResp.text();

    // 2) render HTML -> PNG bằng Chromium (server-side)
    const execPath = await chromium.executablePath();
    const browser = await puppeteer.launch({
      args: chromium.args,
      headless: chromium.headless,
      executablePath: execPath,
      defaultViewport: { width: 900, height: 1024, deviceScaleFactor: 2 },
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

    // 3) upload PNG vào cùng bucket
    const uploadURL = `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${encodeURIComponent(PNG_KEY)}`;
    const up = await fetch(uploadURL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "image/png",
        "x-upsert": "true",
      },
      body: png,
    });

    if (!up.ok) {
      const t = await up.text().catch(() => "");
      res.statusCode = 500;
      return res.end(`Upload PNG lỗi: ${up.status} ${t}`);
    }

    // 4) trả kết quả
    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${PNG_KEY}`;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: true, ma_hd, html: HTML_KEY, png: PNG_KEY, url: publicUrl }));
  } catch (e) {
    res.statusCode = 500;
    res.end(`Ping render error: ${e.message}`);
  }
}
