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

    // ===== 2) render HTML -> PNG =====
    const BILL_WIDTH_PX = 302; // ~80mm ở 96dpi
    const MAX_HEIGHT_SAFE = 16000; // tránh vượt giới hạn ảnh của Chrome/Skia
    // Có thể đổi qua query ?s=2 nếu muốn nét hơn, mặc định để 1 cho an toàn upload
    const urlObj = new URL(req.url, base);
    const SCALE = Number(urlObj.searchParams.get("s") || 1);

    const execPath = await chromium.executablePath();
    const browser = await puppeteer.launch({
      args: chromium.args,
      headless: chromium.headless,
      executablePath: execPath,
      // Bóp ngang 80mm; chiều cao khởi tạo tạm thời
      defaultViewport: { width: BILL_WIDTH_PX, height: 1000, deviceScaleFactor: SCALE }
    });

    const page = await browser.newPage();
    await page.setCacheEnabled(false);
    await page.setContent(html, { waitUntil: "networkidle0" });

    // Ép nền trắng (KHÔNG sửa nội dung hóa đơn)
    await page.evaluate(() => {
      document.documentElement.style.background = "#fff";
      document.body.style.background = "#fff";
      // KHÔNG ép CSS width ở đây để tránh làm layout lại nặng nề
    });

    // Cho tài nguyên (font/ảnh) có thêm chút thời gian
    const waitMs = Number(urlObj.searchParams.get("wait") || 200);
    if (waitMs > 0) await page.waitForTimeout(waitMs);

    // Đo chiều cao thật sự của nội dung
    let fullHeight = await page.evaluate(() => {
      const b = document.body;
      const e = document.documentElement;
      return Math.max(
        b.scrollHeight, b.offsetHeight, b.clientHeight,
        e.scrollHeight, e.offsetHeight, e.clientHeight
      );
    });

    // Giới hạn chiều cao để tránh crash/timeout khi ảnh quá dài
    const finalHeight = Math.min(Math.max(1, fullHeight), MAX_HEIGHT_SAFE);

    // Set viewport đúng kích thước cần chụp (ngang 302px, cao = finalHeight)
    await page.setViewport({ width: BILL_WIDTH_PX, height: finalHeight, deviceScaleFactor: SCALE });

    // Chụp ảnh phần viewport (KHÔNG dùng fullPage/clip để tránh "out of bounds" và giảm RAM)
    let png;
    try {
      png = await page.screenshot({ type: "png", fullPage: false });
    } catch (err) {
      // Fallback: nếu vẫn lỗi, thử giảm scale xuống 1 và chụp lại
      if (SCALE !== 1) {
        await page.setViewport({ width: BILL_WIDTH_PX, height: finalHeight, deviceScaleFactor: 1 });
        png = await page.screenshot({ type: "png", fullPage: false });
      } else {
        throw err;
      }
    }

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
    res.end(JSON.stringify({
      ok: true,
      html: HTML_KEY,
      png: PNG_KEY,
      url: publicUrl,
      width_px: BILL_WIDTH_PX,
      height_px: finalHeight,
      scale: SCALE,
      note: (fullHeight > MAX_HEIGHT_SAFE)
        ? `Bill rất dài, ảnh đã cắt ở ${MAX_HEIGHT_SAFE}px để an toàn.`
        : "Rendered within safe size."
    }));
  } catch (e) {
    res.statusCode = 500;
    res.end(`Ping render error: ${e.message}`);
  }
}
