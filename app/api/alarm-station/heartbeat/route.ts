import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    if (Number(request.headers.get("content-length") ?? 0) > 1024)
      return NextResponse.json({ error: "Request too large" }, { status: 413 });
    const authorization = request.headers.get("authorization") ?? "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (!/^[a-f0-9]{64}$/.test(token))
      return NextResponse.json({ error: "Unpaired device" }, { status: 401 });

    const payload = await request.json().catch(() => ({}));
    if (typeof payload.monitoring !== "boolean" || typeof payload.pollOk !== "boolean") {
      return NextResponse.json({ error: "Missing station health" }, { status: 400 });
    }
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("Server not configured");
    const supabase = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const hashed = createHash("sha256").update(token, "utf8").digest("hex");
    const time = new Date().toISOString();
    const count = Math.min(200, Math.max(0, Math.trunc(Number(payload.pendingCount) || 0)));
    const error = typeof payload.lastError === "string" ? payload.lastError.slice(0, 180) : "";
    const version = typeof payload.version === "string" ? payload.version.slice(0, 24) : "";
    const { data, error: dbError } = await supabase.from("alarm_stations").update({
      last_seen_at: time,
      ...(payload.pollOk ? { last_success_at: time } : {}),
      monitor_active: payload.monitoring,
      pending_count: count,
      app_version: version,
      last_error: error || null,
    }).eq("secret_hash", hashed).is("revoked_at", null).select("id").maybeSingle();
    if (dbError) throw dbError;
    if (!data)
      return NextResponse.json({ error: "Station revoked or not recognized" }, { status: 401 });
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[alarm-heartbeat]", e instanceof Error ? e.message : "unknown");
    return NextResponse.json({ error: "Unable to report health" }, { status: 503 });
  }
}
