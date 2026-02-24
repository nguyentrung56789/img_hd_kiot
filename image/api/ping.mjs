// image/api/ping.mjs
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

// Lấy Supabase URL + service role từ file public ./js/internal_key.js
async function getInternalKeys(base) {
  const r = await fetch(`${base}/js/internal_key.js`, { cache: "no-store" });
  if (!r.ok) throw new Error(`Không tải được internal_key.js (${r.status})`);
  const t = await r.text();
  const url = t.match(/url:\s*"([^"]+)"/)?.[1];
  const role = t.match(/role:\s*"([^"]+)"/)?.[1];
  if (!url || !role) throw new Error("Thiếu url/role trong internal_key.js");
  return { SUPABASE_URL: url, SERVICE_KEY: role };
}

// chỉ cho phép mã hoá đơn an toàn
function sanitizeMaHD(v) {
  if (!v) return "";
  return String(v).trim().replace(/[^a-zA-Z0-9_-]/g, "");
}

// sanitize key html: chỉ cho phép a-zA-Z0-9 _ - / . và không cho ".."
function sanitizeObjectKey(v) {
  if (!v) return "";
  let s = String(v).trim().replace(/^\/+/, ""); // bỏ slash đầu
  // chỉ giữ ký tự an toàn
  s = s.replace(/[^a-zA-Z0-9_\-\/.]/g, "");
  // chặn path traversal
  if (s.includes("..")) return "";
  return s;
}

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

    // ---- cấu hình ----
    const BUCKET = "img_hd_kiot";

    // ---- 0) lấy input (ưu tiên key, fallback ma_hd) ----
    let key = sanitizeObjectKey(req.query?.key);
    let ma_hd = sanitizeMaHD(req.query?.ma_hd);

    // cho phép POST body (n8n đôi khi thích POST)
    if ((!key && !ma_hd) && (req.method === "POST" || req.method === "PUT")) {
      const body = await readJsonBody(req);
      key = sanitizeObjectKey(body?.key);
      ma_hd = sanitizeMaHD(body?.ma_hd);
    }

    // ---- 1) xác định HTML_KEY ----
    let HTML_KEY;
    if (key) {
      // key có thể là "img_hd_kiot/img_hd.html" hoặc "img_hd.html"
      HTML_KEY = key.startsWith(`${BUCKET}/`) ? key.slice(BUCKET.length + 1) : key;
    } else {
      if (!ma_hd) return res.status(400).end("Thiếu key hoặc ma_hd");
      HTML_KEY = `hoa_don_${ma_hd}.html`;
    }

    // đảm bảo là file html
    if (!HTML_KEY.toLowerCase().endsWith(".html")) {
      return res.status(400).end("key/HTML_KEY phải là file .html");
    }

    // ---- 2) tải HTML từ Supabase Storage ----
    const htmlURL = `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${encodeURIComponent(HTML_KEY)}`;
    const htmlResp = await fetch(htmlURL, {
      headers: { Authorization: `Bearer ${SERVICE_KEY}` },
      cache: "no-store",
    });

    if (!htmlResp.ok) {
      const txt = await htmlResp.text().catch(() => "");
      return res.status(502).end(`Không tải được HTML (${HTML_KEY}): ${htmlResp.status} ${txt}`);
    }
    const html = await htmlResp.text();

    // ---- 3) render HTML -> PNG ----
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

    // ---- 4) đặt tên PNG ----
    const safeBase =
      (ma_hd && `hoa_don_${ma_hd}`) ||
      `img_${HTML_KEY.replace(/\//g, "_").replace(/\.html$/i, "")}`;

    const PNG_KEY = `${safeBase}_${Date.now()}.png`;

    // ---- 5) upload PNG lên Supabase Storage ----
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
      return res.status(500).end(`Upload PNG lỗi: ${up.status} ${t}`);
    }

    // ---- 6) trả kết quả ----
    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${PNG_KEY}`;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(
      JSON.stringify({
        ok: true,
        bucket: BUCKET,
        html: HTML_KEY,
        png: PNG_KEY,
        url: publicUrl,
      })
    );
  } catch (e) {
    res.statusCode = 500;
    res.end(`Ping render error: ${e.message}`);
  }
}
