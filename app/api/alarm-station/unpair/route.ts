import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "no-store, max-age=0" };

/**
 * Unpair the calling physical station. The bearer token authorizes only its
 * own station; no staff account or order record is ever deleted.
 * Idempotent: a manager-revoked station may still clear its local enrollment.
 */
export async function POST(request: NextRequest) {
  try {
    if (Number(request.headers.get("content-length") ?? 0) > 1024)
      return NextResponse.json({ error: "Request too large" }, { status: 413, headers: noStore });
    const authorization = request.headers.get("authorization") ?? "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (!/^[a-f0-9]{64}$/.test(token))
      return NextResponse.json({ error: "Device not enrolled" }, { status: 401, headers: noStore });

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const secret = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !secret) throw new Error("Server environment missing");
    const db = createClient(url, secret, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const secretHash = createHash("sha256").update(token, "utf8").digest("hex");
    const { data: station, error: stationError } = await db.from("alarm_stations")
      .select("id,dedicated_staff_id,revoked_at")
      .eq("secret_hash", secretHash).maybeSingle();
    if (stationError) throw stationError;
    if (!station)
      return NextResponse.json({ error: "Unknown device" }, { status: 401, headers: noStore });

    // Important: an old revoked token must never be able to deactivate a
    // subsequently reactivated account or its new physical station.
    if (station.revoked_at)
      return NextResponse.json({ success: true }, { headers: noStore });

    const now = new Date().toISOString();
    const { error: revokeError } = await db.from("alarm_stations")
      .update({ revoked_at: now }).eq("id", station.id).is("revoked_at", null);
    if (revokeError) throw revokeError;
    if (station.dedicated_staff_id) {
      const { error: disableError } = await db.from("staff")
        .update({ is_active: false }).eq("id", station.dedicated_staff_id);
      if (disableError) throw disableError;
      const { error: expireError } = await db.from("alarm_station_pairing_codes")
        .update({ expires_at: now })
        .eq("dedicated_staff_id", station.dedicated_staff_id).is("consumed_at", null)
        .gt("expires_at", now);
      if (expireError) throw expireError;
    }
    return NextResponse.json({ success: true }, { headers: noStore });
  } catch (error) {
    console.error("[alarm-station:unpair]", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Unable to unpair. Check the connection and retry." },
      { status: 503, headers: noStore });
  }
}
