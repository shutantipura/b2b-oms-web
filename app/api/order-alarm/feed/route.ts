import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Intentionally public, read-only alarm feed for dedicated Android stations.
// The service key never leaves this server route. Do not return customer names,
// addresses, product contents, bill amounts or other order details.
export const dynamic = "force-dynamic";

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) {
    return NextResponse.json({ error: "Alarm station is not configured" }, { status: 503 });
  }

  try {
    const admin = createClient(url, secret, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Only recent, not-yet-acknowledged orders are made available publicly.
    // A station can locally dismiss an alert without mutating the global queue.
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await admin
      .from("order_alerts")
      .select("id, created_at, orders!inner(order_number)")
      .is("acknowledged_at", null)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) throw error;

    const alerts = (data ?? []).flatMap((item) => {
      const related = Array.isArray(item.orders) ? item.orders[0] : item.orders;
      const number = Number(related?.order_number);
      if (!item.id || !Number.isSafeInteger(number) || number <= 0) return [];
      return [{
        alert_id: String(item.id),
        order_number: number,
        created_at: String(item.created_at),
      }];
    });

    return NextResponse.json(
      { alerts },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch (e) {
    console.error("Public order-alarm feed error", e);
    return NextResponse.json(
      { error: "Unable to check new orders" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
