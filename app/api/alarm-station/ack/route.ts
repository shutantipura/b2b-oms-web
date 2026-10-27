import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const noCache = { "Cache-Control": "no-store, max-age=0" };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Central acknowledgement: a paired alarm station can acknowledge the order
 * alerts it is displaying. Every other device stops on its next feed poll.
 * No staff session is needed; only a non-revoked pairing token may write.
 */
export async function POST(request: NextRequest) {
  try {
    if (Number(request.headers.get("content-length") ?? 0) > 10000)
      return NextResponse.json({ error: "Too many alerts" }, { status: 413, headers: noCache });

    const auth = request.headers.get("authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!/^[a-f0-9]{64}$/.test(token))
      return NextResponse.json({ error: "Pair this alarm station first" }, { status: 401, headers: noCache });

    const body = await request.json().catch(() => ({}));
    const rawIds: unknown = body.alertIds;
    if (!Array.isArray(rawIds) || rawIds.length < 1 || rawIds.length > 200 ||
        !rawIds.every((item): item is string =>
          typeof item === "string" && uuidPattern.test(item))) {
      return NextResponse.json({ error: "Invalid alert selection" }, { status: 400, headers: noCache });
    }
    const alertIds = [...new Set(rawIds as string[])];

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const secret = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !secret) throw new Error("Server missing Supabase configuration");
    const db = createClient(url, secret, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const tokenHash = createHash("sha256").update(token, "utf8").digest("hex");
    const { data: station, error: stationError } = await db.from("alarm_stations")
      .select("id")
      .eq("secret_hash", tokenHash).is("revoked_at", null).maybeSingle();
    if (stationError) throw stationError;
    if (!station) {
      return NextResponse.json({ error: "Station not paired or access revoked" },
        { status: 401, headers: noCache });
    }

    // Idempotent and race-safe. If two devices acknowledge concurrently,
    // only the first write updates an unacknowledged row.
    const { data: changed, error: updateError } = await db.from("order_alerts")
      .update({
        acknowledged_at: new Date().toISOString(),
        acknowledged_by: null,
        acknowledged_by_station: station.id,
      })
      .in("id", alertIds)
      .is("acknowledged_at", null)
      .select("id");
    if (updateError) throw updateError;

    return NextResponse.json({
      success: true,
      acknowledgedCount: (changed ?? []).length,
      requestedCount: alertIds.length,
    }, { headers: noCache });
  } catch (e) {
    console.error("[android-alarm:ack]", e instanceof Error ? e.message : "Unknown");
    return NextResponse.json({ error: "Could not acknowledge shared alarms" },
      { status: 503, headers: noCache });
  }
}
