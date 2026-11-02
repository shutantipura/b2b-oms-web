import { createHmac, randomInt } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

const PAIRING_CODE_TTL_MS = 15 * 60_000;
const MAX_CODE_COLLISION_RETRIES = 12;

function serverSecret() {
  const secret = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("Missing server-side pairing secret");
  return secret;
}

/** The PIN is an enrollment code, never the long-lived station credential. */
export function hashAlarmPairingCode(code: string) {
  return createHmac("sha256", serverSecret())
    .update("alarm-station-pairing:" + code)
    .digest("hex");
}

/** Keep addresses out of the database and use Vercel's trusted client IP. */
export function alarmPairingSourceHash(headers: Headers) {
  const address = (headers.get("x-vercel-forwarded-for")
    ?? headers.get("x-forwarded-for")
    ?? "unknown").split(",")[0].trim().slice(0, 128);
  return createHmac("sha256", serverSecret())
    .update("alarm-station-source:" + address)
    .digest("hex");
}

/** Cryptographically uniform six-digit PIN, preserving leading zeroes.
 * The database's unique code_hash index catches any historical collision.
 */
export async function issueAlarmPairingCode(
  db: SupabaseClient,
  label: string,
  dedicatedStaffId?: string,
) {
  const expiresAt = new Date(Date.now() + PAIRING_CODE_TTL_MS).toISOString();
  for (let attempt = 0; attempt < MAX_CODE_COLLISION_RETRIES; attempt++) {
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const { error } = await db.from("alarm_station_pairing_codes").insert({
      code_hash: hashAlarmPairingCode(code),
      label,
      expires_at: expiresAt,
      ...(dedicatedStaffId ? { dedicated_staff_id: dedicatedStaffId } : {}),
    });
    if (!error) return { code, expiresAt };
    if (error.code !== "23505") throw error;
  }
  throw new Error("Could not allocate a unique terminal pairing PIN");
}
