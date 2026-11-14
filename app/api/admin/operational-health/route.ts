import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Manager-only monitoring. No passwords, device pairing tokens, personal
// customer details or document URLs are returned by this endpoint.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const noCache = { "Cache-Control": "no-store, max-age=0" };

export async function GET(request: NextRequest) {
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Manager login required" }, { status: 403 });
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret) {
    return NextResponse.json({ error: "Server configuration unavailable" }, { status: 503 });
  }
  const db = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const { data: identity, error: authError } = await db.auth.getUser(header.slice(7));
    if (authError || !identity.user) {
      return NextResponse.json({ error: "Manager login required" }, { status: 403 });
    }
    const { data: profile, error: staffError } = await db.from("staff")
      .select("id").eq("auth_user_id", identity.user.id)
      .eq("account_type", "manager").eq("is_active", true).maybeSingle();
    if (staffError || !profile) {
      return NextResponse.json({ error: "Manager login required" }, { status: 403 });
    }
    const [devices, orders] = await Promise.all([
      db.from("alarm_stations")
        .select("label,last_seen_at,last_success_at,monitor_active")
        .is("revoked_at", null).limit(100),
      db.from("orders")
        .select("order_number,completed_at", { count: "exact" })
        .eq("status", "completed").is("group_root_order_id", null)
        .is("final_amount", null).order("completed_at", { ascending: false }).limit(15),
    ]);
    if (devices.error || orders.error) {
      throw devices.error ?? orders.error;
    }

    const now = Date.now();
    const unhealthyStations = (devices.data ?? []).flatMap(station => {
      const seen = station.last_seen_at ? Date.parse(station.last_seen_at) : NaN;
      const success = station.last_success_at ? Date.parse(station.last_success_at) : NaN;
      const offline = !Number.isFinite(seen) || now - seen > 90_000;
      const degraded = !offline && (!Number.isFinite(success) || now - success > 120_000);
      if (!offline && !degraded) return [];
      return [{
        label: station.label,
        status: offline ? "offline" : "degraded",
        minutesSinceSeen: Number.isFinite(seen) ? Math.max(0, Math.floor((now - seen) / 60_000)) : null,
      }];
    });
    return NextResponse.json({
      checkedAt: new Date(now).toISOString(),
      unhealthyStations,
      missingBillCount: orders.count ?? 0,
      missingBillOrders: (orders.data ?? []).map(order => ({
        orderNumber: order.order_number, completedAt: order.completed_at,
      })),
    }, { headers: noCache });
  } catch (error) {
    console.error("[operational-health] Load failed:", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Unable to check operational health" }, { status: 503 });
  }
}
