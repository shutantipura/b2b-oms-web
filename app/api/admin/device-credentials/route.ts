import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Server authentication is not configured");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function authorizeManager(request: NextRequest) {
  const value = request.headers.get("authorization") ?? "";
  if (!value.startsWith("Bearer ")) {
    return { error: NextResponse.json({ error: "Please log in" }, { status: 401 }) };
  }
  const admin = serviceClient();
  const { data: identity, error } = await admin.auth.getUser(value.slice(7));
  if (error || !identity.user) {
    return { error: NextResponse.json({ error: "Session expired" }, { status: 401 }) };
  }
  const { data: manager } = await admin.from("staff")
    .select("id, account_type, is_active")
    .eq("auth_user_id", identity.user.id).maybeSingle();
  if (!manager || !manager.is_active || manager.account_type !== "manager") {
    return { error: NextResponse.json({ error: "Manager permission required" }, { status: 403 }) };
  }
  return { admin };
}

function safeError(err: unknown) {
  console.error("[device-credentials] operation failed", err instanceof Error ? err.name : "Unknown");
  return NextResponse.json({ error: "ไม่สามารถจัดการข้อมูลเข้าสู่ระบบอุปกรณ์ได้" }, { status: 500 });
}

/**
 * GET /api/admin/device-credentials?staffId=<uuid>
 * Manager-only: retrieves Supabase Auth login email for a linked staff profile.
 * Never returns passwords, hashes, access tokens or refresh tokens.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authorizeManager(request);
    if (auth.error) return auth.error;
    const staffId = request.nextUrl.searchParams.get("staffId") ?? "";
    if (!/^[0-9a-f-]{36}$/i.test(staffId)) {
      return NextResponse.json({ error: "Invalid staff account" }, { status: 400 });
    }
    const { data: staff } = await auth.admin!.from("staff")
      .select("staff_code, auth_user_id, is_active").eq("id", staffId).maybeSingle();
    if (!staff || !staff.auth_user_id) {
      return NextResponse.json({ error: "Staff account is not linked to OMS authentication" }, { status: 404 });
    }
    const { data, error } = await auth.admin!.auth.admin.getUserById(staff.auth_user_id);
    if (error || !data.user?.email) throw error ?? new Error("Missing authentication email");
    return NextResponse.json({
      staffCode: staff.staff_code,
      loginEmail: data.user.email,
      isActive: staff.is_active,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) { return safeError(err); }
}

/**
 * POST: manager explicitly sets or rotates a staff member's password.
 * Existing LINE authentication remains linked to the same auth_user_id.
 * A separate staff account is recommended for a shared store device.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await authorizeManager(request);
    if (auth.error) return auth.error;
    const body = await request.json().catch(() => ({}));
    const staffId = typeof body.staffId === "string" ? body.staffId : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!/^[0-9a-f-]{36}$/i.test(staffId) || password.length < 12 ||
      password.length > 128 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      return NextResponse.json({
        error: "ต้องใช้รหัสผ่าน 12–128 ตัวอักษร มีทั้งตัวอักษรและตัวเลข",
      }, { status: 400 });
    }
    const { data: staff, error: staffError } = await auth.admin!.from("staff")
      .select("staff_code, auth_user_id, is_active")
      .eq("id", staffId).maybeSingle();
    if (staffError || !staff || !staff.is_active || !staff.auth_user_id) {
      return NextResponse.json({ error: "Active staff account not found" }, { status: 404 });
    }
    const { data: updated, error: updateError } = await auth.admin!.auth.admin.updateUserById(
      staff.auth_user_id, { password }
    );
    if (updateError || !updated.user?.email) throw updateError ?? new Error("Auth account missing email");

    return NextResponse.json({
      success: true,
      staffCode: staff.staff_code,
      loginEmail: updated.user.email,
      // Never echo the secret back in API responses or log it.
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) { return safeError(err); }
}
