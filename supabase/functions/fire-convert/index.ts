// fire-convert：管理員按「立即轉檔」時，由這支小程式確認身分，再叫「驗屋報告轉檔」排程馬上跑。
// 觸發排程的鑰匙只存在 Supabase 的 Secrets（ROUTINE_FIRE_URL、ROUTINE_TOKEN），網站上看不到。
// 部署：Supabase 後台 → Edge Functions → Deploy a new function → Via Editor，名稱 fire-convert，整份貼上。
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = Deno.env.get("ROUTINE_FIRE_URL"), token = Deno.env.get("ROUTINE_TOKEN");
  if (!url || !token) return reply(500, { error: "還沒設定 ROUTINE_FIRE_URL / ROUTINE_TOKEN" });

  // 用按按鈕的人自己的登入身分查資料庫，確認是管理員
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: admin, error } = await sb.rpc("is_admin");
  if (error || admin !== true) return reply(403, { error: "只有管理員可以要求立即轉檔" });

  // 排隊中、標了立即轉檔的份數；排程一次處理 3 份，不夠就多叫幾次（最多 4 次）
  const { count } = await sb.from("report_jobs").select("id", { count: "exact", head: true })
    .eq("status", "pending").eq("urgent", true);
  const times = Math.min(4, Math.max(1, Math.ceil((count ?? 0) / 3)));
  let fired = 0, last = "";
  for (let i = 0; i < times; i++) {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "anthropic-beta": "experimental-cc-routine-2026-04-01",
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: "管理員要求立即轉檔" }),
    });
    if (r.ok) fired++; else { last = `${r.status} ${(await r.text()).slice(0, 300)}`; break; }
  }
  if (!fired) return reply(502, { error: "叫不動排程：" + last });
  return reply(200, { fired, pending: count ?? 0 });
});
