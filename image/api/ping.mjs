// ping.mjs
// Ping (GET) tới 1 URL (mặc định: http://127.0.0.1:5500/image.html)
// Cách dùng:
//   node ping.mjs
//   node ping.mjs https://your-app.vercel.app/image.html
//   TARGET=https://your-app.vercel.app/image.html node ping.mjs

const DEFAULT_TARGET = "http://127.0.0.1:5500/image.html";

function getTarget() {
  const arg = process.argv[2];
  const env = process.env.TARGET;
  return (arg && arg.trim()) || (env && env.trim()) || DEFAULT_TARGET;
}

async function main() {
  const target = getTarget();
  const t0 = Date.now();
  console.log("🔔 PING:", target);
  try {
    // Node 18+ có fetch sẵn
    const resp = await fetch(target, { method: "GET", cache: "no-store" });
    const text = await resp.text();
    const ms = Date.now() - t0;
    console.log(`✅ Status: ${resp.status} ${resp.statusText} — ${text.length} bytes — ${ms}ms`);
    console.log("✅ Done (nếu image.html có code upload, nó sẽ tự chạy).");
    process.exit(0);
  } catch (e) {
    console.error("❌ Ping lỗi:", e?.message || String(e));
    process.exit(1);
  }
}

main();
