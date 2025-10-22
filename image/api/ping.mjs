// api/ping.mjs
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

export const config = { runtime: "nodejs", maxDuration: 60 };

export default async function handler(req, res) {
  try {
    const base = `http${req.headers["x-forwarded-proto"] === "https" ? "s" : ""}://${req.headers.host}`;
    const u = new URL(req.url, base);

    const target = u.searchParams.get("url") || "https://img-hd-kiot.vercel.app/image.html";
    const waitMs = Number(u.searchParams.get("wait") || 8000);

    const urlToOpen = `${target}${target.includes("?") ? "&" : "?"}t=${Date.now()}`;

    const browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();
    await page.goto(urlToOpen, { waitUntil: "networkidle2", timeout: 45000 });
    await page.waitForTimeout(waitMs); // cho JS trong image.html chạy upload
    await browser.close();

    return res.status(200).json({ ok: true, url: urlToOpen, waitedMs: waitMs });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
}
