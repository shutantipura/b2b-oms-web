import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";

export function stockAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("STOCK_SERVER_CONFIG");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function requireStockRole(request: NextRequest, roles: ("staff" | "manager")[]) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token) throw new Error("UNAUTHORIZED");
  const admin = stockAdminClient();
  const { data: auth, error: authError } = await admin.auth.getUser(token);
  if (authError || !auth.user) throw new Error("UNAUTHORIZED");
  const { data: staff, error: staffError } = await admin.from("staff")
    .select("id, account_type, is_active")
    .eq("auth_user_id", auth.user.id).maybeSingle();
  if (staffError || !staff || staff.is_active !== true || !roles.includes(staff.account_type)) throw new Error("FORBIDDEN");
  return { admin, staffId: staff.id as string, role: staff.account_type as "staff" | "manager" };
}

export function stockErrorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message === "UNAUTHORIZED") return Response.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
  if (message === "FORBIDDEN") return Response.json({ error: "ไม่มีสิทธิ์ใช้งาน" }, { status: 403 });
  console.error("Shared stock request failed", error);
  return Response.json({ error: "ไม่สามารถดำเนินการได้ กรุณาลองใหม่" }, { status: 500 });
}
