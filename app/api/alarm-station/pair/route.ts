import { createHash, randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, max-age=0" };

function db() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase server configuration");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
function sha(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** No LINE/staff login required. One-time manager-created code is consumed. */
export async function POST(request: NextRequest) {
  try {
    if (Number(request.headers.get("content-length") ?? 0) > 1024) {
      return NextResponse.json({ error: "Request too large" }, { status: 413 });
    }
    const body = await request.json().catch(() => ({}));
    const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
    if (!/^[A-F0-9]{32}$/.test(code)) {
      return NextResponse.json({ error: "Invalid or expired pairing code" }, { status: 400 });
    }
    const client = db();
    const token = randomBytes(32).toString("hex");
    // The code is consumed and the station created in ONE transaction.
    // A temporary DB error cannot strand an otherwise valid pairing code.
    const { data: stationRows, error } = await client.rpc("claim_alarm_station_pairing", {
      p_code_hash: sha(code),
      p_station_secret_hash: sha(token),
    });
    if (error) throw error;
    const station = Array.isArray(stationRows) ? stationRows[0] : null;
    if (!station) {
      return NextResponse.json(
        { error: "Invalid, expired, or already-used pairing code" },
        { status: 400, headers },
      );
    }
    return NextResponse.json({ success: true, stationId: station.station_id,
      label: station.station_label, token }, { headers });
  } catch (err) {
    console.error("[alarm-pair]", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Unable to pair device" }, { status: 503 });
  }
}
