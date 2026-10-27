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
    const codeHash = sha(code);
    const now = new Date().toISOString();
    const { data: pairing, error } = await client.from("alarm_station_pairing_codes")
      .update({ consumed_at: now })
      .eq("code_hash", codeHash)
      .is("consumed_at", null)
      .gt("expires_at", now)
      .select("id,label")
      .maybeSingle();
    if (error) throw error;
    if (!pairing) {
      return NextResponse.json({ error: "Invalid, expired, or already-used pairing code" }, { status: 400 });
    }
    const token = randomBytes(32).toString("hex");
    const { data: station, error: insertError } = await client.from("alarm_stations")
      .insert({ label: pairing.label, secret_hash: sha(token) })
      .select("id,label").single();
    if (insertError || !station) throw insertError ?? new Error("Station creation failed");

    await client.from("alarm_station_pairing_codes")
      .update({ station_id: station.id }).eq("id", pairing.id);

    return NextResponse.json({ success: true, stationId: station.id,
      label: station.label, token }, { headers });
  } catch (err) {
    console.error("[alarm-pair]", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Unable to pair device" }, { status: 503 });
  }
}
