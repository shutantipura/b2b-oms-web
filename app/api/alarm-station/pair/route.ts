import { createHash, randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { alarmPairingSourceHash, hashAlarmPairingCode } from "@/lib/alarm-pairing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, max-age=0" };

function db() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase server configuration");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
const sha=(value:string)=>createHash("sha256").update(value,"utf8").digest("hex");

/** No LINE/staff login required. One-time manager-created code is consumed. */
export async function POST(request: NextRequest) {
  try {
    if (Number(request.headers.get("content-length") ?? 0) > 1024) {
      return NextResponse.json({ error: "Request too large" }, { status: 413 });
    }
    const body = await request.json().catch(() => ({}));
    const code = typeof body.code === "string" ? body.code.trim() : "";
    if (!/^[0-9]{6}$/.test(code)) {
      return NextResponse.json({ error: "Pairing code must be exactly 6 digits" },
        { status: 400, headers });
    }
    const client = db();
    // Database-backed limits work across all serverless instances and prevent
    // a public, anonymous endpoint from brute-forcing a six-digit enrollment PIN.
    const { data: allowed, error: limitError } = await client.rpc(
      "allow_alarm_station_pair_attempt",
      { p_source_hash: alarmPairingSourceHash(request.headers) },
    );
    if (limitError) throw limitError;
    if (allowed !== true) {
      return NextResponse.json({ error: "Too many pairing attempts. Try again later." },
        { status: 429, headers: { ...headers, "Retry-After": "900" } });
    }
    const token = randomBytes(32).toString("hex");
    // The code is consumed and the station created in ONE transaction.
    // A temporary DB error cannot strand an otherwise valid pairing code.
    const { data: stationRows, error } = await client.rpc("claim_alarm_station_pairing", {
      p_code_hash: hashAlarmPairingCode(code),
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
    const { data: savedStation, error: lookupError } = await client.from("alarm_stations")
      .select("dedicated_staff_id").eq("id",station.station_id).maybeSingle();
    if (lookupError) throw lookupError;
    return NextResponse.json({ success: true, stationId: station.station_id,
      label: station.station_label, token,
      dedicatedTerminal: !!savedStation?.dedicated_staff_id }, { headers });
  } catch (err) {
    console.error("[alarm-pair]", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Unable to pair device" }, { status: 503 });
  }
}
