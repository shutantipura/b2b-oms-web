import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";

export type SalesRole = "manager" | "salesman";

export class SalesAuthorizationError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

/** Service-role access is server-only; never trust client-supplied staff IDs. */
export async function requireSalesRole(
  request: NextRequest, roles: SalesRole[],
) {
  const bearer = request.headers.get("authorization") ?? "";
  const token = bearer.startsWith("Bearer ") ? bearer.slice(7) : "";
  if (!token) throw new SalesAuthorizationError("กรุณาเข้าสู่ระบบ", 401);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret) throw new Error("Supabase server configuration missing");
  const admin = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error: userError } = await admin.auth.getUser(token);
  if (userError || !user) throw new SalesAuthorizationError("เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง", 401);
  const { data: staff, error: staffError } = await admin.from("staff")
    .select("id,staff_code,staff_name,account_type,is_active")
    .eq("auth_user_id",user.id).maybeSingle();
  if (staffError) throw new Error("Unable to verify staff identity");
  if (!staff?.is_active || !roles.includes(staff.account_type as SalesRole))
    throw new SalesAuthorizationError("บัญชีนี้ไม่มีสิทธิ์สำหรับรายการนี้", 403);
  return { admin, staff: { ...staff, account_type: staff.account_type as SalesRole } };
}

export function salesApiError(error: unknown) {
  const message = error instanceof Error ? error.message : "เกิดข้อผิดพลาด";
  const status = error instanceof SalesAuthorizationError ? error.status
    : /duplicate key|unique constraint/i.test(message) ? 409
    : /required|Invalid|not found|positive|too long|already reviewed|modified again|Field not editable|cannot/i.test(message) ? 400 : 500;
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}
