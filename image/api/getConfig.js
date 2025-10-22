// /api/getConfig.js
export default function handler(req, res) {
  // ===== CORS cơ bản =====
  res.setHeader('Access-Control-Allow-Origin', '*'); // có thể siết domain khi deploy
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  // ===== CẤU HÌNH — CHỈ 1 KHỐI =====
  // 👉 Khi deploy, bạn có thể đổi sang đọc từ ENV (comment 3 dòng trên và bỏ comment 6 dòng dưới)
  const env = {
    url: "https://cywtgdtsxajczljspwxe.supabase.co",
    anon: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN5d3RnZHRzeGFqY3psanNwd3hlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY3MzI1NjQsImV4cCI6MjA3MjMwODU2NH0.FZ6z6kfUWyf8l7WnA5J1wkrAy7KjpU6VT65EdyXCka8",
    webhookUrl: "https://dhsybbqoe.datadex.vn/webhook/hoadon",
    mapUrl: "https://script.google.com/macros/s/AKfycbxvwPYBOGUyex1ZOgM3E4g2sKMcz3QLao8DaiZz4oRJmnMOwFdF0M30fQD_QR2ubzcK/exec",
    mapSheet: "18YC3kOwKLLvbzYeuXbZ-5U348EV_hAY2Y3wdot42P1c",
    mapSecret: "t123456",
  };

  // // ===== (Tuỳ chọn) Đọc từ ENV khi deploy =====
  // const env = {
  //   url: process.env.SUPABASE_URL || '',
  //   anon: process.env.SUPABASE_ANON_KEY || '',
  //   webhookUrl: process.env.link_webhook || '',
  //   mapUrl: process.env.link_map_apps_script || '',
  //   mapSheet: process.env.sheet_id_map || '',
  //   mapSecret: process.env.MAP_SHARED_SECRET || '',
  // };

  if (!env.url || !env.anon) {
    return res.status(500).json({ error: 'Thiếu Supabase config' });
  }


  return res.status(200).json({
    url: env.url,
    anon: env.anon,
    webhookUrl: env.webhookUrl,
    map: {
      APPS_URL: env.mapUrl,
      SHEET_ID: env.mapSheet,
      SHARED_SECRET: env.mapSecret,
      WEBHOOK_URL: env.webhookUrl,
    }
  });
}
