import { createHash, randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function adminDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret) throw new Error("Missing server-side Supabase configuration");
  return createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function requireManager(request: NextRequest) {
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) return null;
  const db = adminDb();
  const { data: identity, error } = await db.auth.getUser(header.slice(7));
  if (error || !identity.user) return null;
  const { data: profile } = await db.from("staff").select("id")
    .eq("auth_user_id", identity.user.id)
    .eq("account_type", "manager")
    .eq("is_active", true).maybeSingle();
  return profile ? db : null;
}

function hash(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function invalidAccess() {
  return NextResponse.json({ error: "Manager login required" }, { status: 403 });
}

const noCache = { "Cache-Control": "no-store, max-age=0" };

export async function GET(request: NextRequest) {
  try {
    const db = await requireManager(request);
    if (!db) return invalidAccess();
    const { data, error } = await db.from("alarm_stations").select(
      "id,label,created_at,last_seen_at,last_success_at,monitor_active,pending_count,app_version,last_error,revoked_at"
    ).order("created_at", { ascending: false }).limit(100);
    if (error) throw error;
    return NextResponse.json({ stations: data ?? [], serverTime: new Date().toISOString() },
      { headers: noCache });
  } catch (error) {
    console.error("[alarm-stations:GET]", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Unable to check alarm station health" }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const db = await requireManager(request);
    if (!db) return invalidAccess();
    const body = await request.json().catch(() => ({}));
    const label = typeof body.label === "string" ? body.label.trim() : "";
    if (!label || label.length > 80) {
      return NextResponse.json({ error: "Please enter a device name, up to 80 characters" }, { status: 400 });
    }
    // 128-bit one-use pairing code. No device password or LINE login required.
    const pairingCode = randomBytes(16).toString("hex").toUpperCase();
    const expires = new Date(Date.now() + 15 * 60_000).toISOString();
    const { error } = await db.from("alarm_station_pairing_codes").insert({
      code_hash: hash(pairingCode),
      label,
      expires_at: expires,
    });
    if (error) throw error;
    return NextResponse.json({ pairingCode, expiresAt: expires, label },
      { headers: noCache });
  } catch (error) {
    console.error("[alarm-stations:POST]", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Unable to generate station pairing code" }, { status: 503 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const db = await requireManager(request);
    if (!db) return invalidAccess();
    const body = await request.json().catch(() => ({}));
    const stationId = typeof body.stationId === "string" ? body.stationId : "";
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(stationId)) {
      return NextResponse.json({ error: "Invalid station" }, { status: 400 });
    }
    const { data, error } = await db.from("alarm_stations")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", stationId).is("revoked_at", null).select("id").maybeSingle();
    if (error) throw error;
    return NextResponse.json({ success: !!data }, { headers: noCache });
  } catch (error) {
    console.error("[alarm-stations:DELETE]", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Unable to revoke station monitoring" }, { status: 503 });
  }
}
