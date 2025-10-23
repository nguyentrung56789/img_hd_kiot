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
    console.log("[ping] base =", base);

    // ===== Keys =====
    const { SUPABASE_URL, SERVICE_KEY } = await getInternalKeys(base);
    console.log("[ping] SUPABASE_URL =", SUPABASE_URL);

    // ===== Cấu hình cố định (1 thư mục, chỉ đổi đuôi) =====
    const BUCKET   = "img_hd_kiot";
    const HTML_KEY = "img_hd.html";
    const PNG_KEY  = "img_hd.png";

    // 1) lấy HTML từ Supabase
    const htmlURL = `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${encodeURIComponent(HTML_KEY)}`;
    console.log("[ping] GET HTML:", htmlURL);
    const htmlResp = await fetch(htmlURL, { headers: { Authorization: `Bearer ${SERVICE_KEY}` } });
    if (!htmlResp.ok) {
      const txt = await htmlResp.text().catch(()=> "");
      console.error("[ping] GET HTML FAIL", htmlResp.status, txt);
      return res.status(502).end(`Không tải được HTML: ${htmlResp.status} ${txt}`);
    }
    const html = await htmlResp.text();
    console.log("[ping] HTML length =", html.length);

    // 2) render HTML -> PNG bằng Chromium (server-side), bóp khổ 80mm
    const execPath = await chromium.executablePath();
    const browser = await puppeteer.launch({
      args: chromium.args,
      headless: chromium.headless,
      executablePath: execPath,
      // 💡 KHỔ 80MM ≈ 302 PX
      defaultViewport: { width: 302, height: 1000, deviceScaleFactor: 2 }
    });
    const page = await browser.newPage();
    await page.setCacheEnabled(false);
    await page.setContent(html, { waitUntil: "networkidle0" });

    // ép CSS: bỏ margin/padding và set width 80mm cho html/body
    await page.evaluate(() => {
      document.documentElement.style.background = "#fff";
      document.body.style.background = "#fff";
      document.documentElement.style.margin = "0";
      document.documentElement.style.padding = "0";
      document.body.style.margin = "0";
      document.body.style.padding = "0";
      document.documentElement.style.width = "80mm";
      document.body.style.width = "80mm";
    });

    // đợi thêm cho chắc (font/ảnh)
    await page.waitForTimeout(400);

    // đo chiều cao thực tế
    const fullHeight = await page.evaluate(() => document.body.scrollHeight);
    console.log("[ping] fullHeight =", fullHeight);

    const png = await page.screenshot({
      type: "png",
      fullPage: false,
      clip: { x: 0, y: 0, width: 302, height: Math.max(50, fullHeight) }
    });
    await browser.close();
    console.log("[ping] PNG size =", png?.length);

    // 3) upload PNG vào cùng bucket/thư mục
    const uploadURL = `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${encodeURIComponent(PNG_KEY)}`;
    console.log("[ping] UPLOAD PNG ->", uploadURL);
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
      console.error("[ping] UPLOAD FAIL", up.status, t);
      return res.status(500).end(`Upload PNG lỗi: ${up.status} ${t}`);
    }

    // 4) Kiểm tra public URL có hoạt động không
    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${PNG_KEY}`;
    console.log("[ping] TEST public URL:", publicUrl);
    let publicOk = false;
    try {
      const head = await fetch(publicUrl, { method: "HEAD" });
      publicOk = head.ok;
      console.log("[ping] public HEAD =", head.status);
    } catch (e) {
      console.warn("[ping] public HEAD error:", e.message);
    }

    // Nếu bucket không public, trả thêm authenticated URL để bạn biết upload đã OK
    const authUrl = `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${PNG_KEY}`;

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({
      ok: true,
      html: HTML_KEY,
      png: PNG_KEY,
      width_px: 302,
      width_mm: "≈80mm",
      public_url: publicOk ? publicUrl : null,
      note: publicOk ? "public URL OK" : "Bucket có thể chưa PUBLIC — public_url null. Kiểm tra Policies!",
      authenticated_url_hint: publicOk ? null : authUrl
    }));
  } catch (e) {
    console.error("[ping] ERROR", e);
    res.statusCode = 500;
    res.end(`Ping render error: ${e.message}`);
  }
}
