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
    //    ✅ BÓP KHỔ 80mm ≈ 302px mà KHÔNG SỬA HTML HÓA ĐƠN
    const BILL_WIDTH_PX = 302; // ~80mm ở 96dpi
    const SCALE = 2;           // ảnh nét hơn
    const execPath = await chromium.executablePath();
    const browser = await puppeteer.launch({
      args: chromium.args,
      headless: chromium.headless,
      executablePath: execPath,
      defaultViewport: { width: BILL_WIDTH_PX, height: 1000, deviceScaleFactor: SCALE }
    });

    const page = await browser.newPage();
    await page.setCacheEnabled(false);
    await page.setContent(html, { waitUntil: "networkidle0" });

    // Không chạm HTML: chỉ đảm bảo nền trắng để PNG đẹp
    await page.evaluate(() => {
      document.documentElement.style.background = "#fff";
      document.body.style.background = "#fff";
    });

    // Đợi tài nguyên (font/ảnh) nạp xong
    await page.waitForTimeout(300);

    // Tính chiều cao thật của nội dung để cắt đúng khổ (ngang 302px, cao linh hoạt)
    const fullHeight = await page.evaluate(() => {
      // Lấy chiều cao lớn nhất giữa body & documentElement
      const b = document.body;
      const e = document.documentElement;
      return Math.max(
        b.scrollHeight, b.offsetHeight, b.clientHeight,
        e.scrollHeight, e.offsetHeight, e.clientHeight
      );
    });

    const png = await page.screenshot({
      type: "png",
      fullPage: false, // 🔑 không chụp full trang A4, chỉ khung 302px
      clip: { x: 0, y: 0, width: BILL_WIDTH_PX, height: Math.max(1, fullHeight) }
    });

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

    // 4) trả kết quả (giữ nguyên cách trả public URL)
    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${PNG_KEY}`;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: true, html: HTML_KEY, png: PNG_KEY, url: publicUrl, width_px: BILL_WIDTH_PX }));
  } catch (e) {
    res.statusCode = 500;
    res.end(`Ping render error: ${e.message}`);
  }
}
