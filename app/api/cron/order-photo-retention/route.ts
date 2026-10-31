import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import sharp from "sharp";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Photo = { file_id: string; storage_path: string; file_type: string;
  mime_type: string; bytes: number | null; finished_at: string };
type Action = "delete" | "compress" | "finalize_delete";
const types = new Set(["cart_photo", "cart_photo_2", "bill", "payment_qr",
  "payment_slip", "payment_slip_2", "delivery_proof", "delivery_proof_2", "bill_2", "payment_qr_2"]);

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  const supplied = request.headers.get("authorization");
  if (!secret || !supplied) return false;
  const a = Buffer.from(supplied), b = Buffer.from("Bearer " + secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
function credentials() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw Error("Service credentials unavailable");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
function validFile(file: Photo) {
  return /^orders\/[0-9]+\/.+\.(jpg|jpeg|png|webp)$/i.test(file.storage_path) &&
    !file.storage_path.includes("..") && types.has(file.file_type);
}
async function optimize(file: Photo, input: Buffer): Promise<Buffer> {
  const qr = file.file_type === "payment_qr" || file.file_type === "payment_qr_2";
  const document = ["bill", "bill_2", "payment_slip", "payment_slip_2"].includes(file.file_type);
  const mime = file.mime_type.split(";")[0].toLowerCase();
  if (!["image/jpeg", "image/png", "image/webp"].includes(mime)) throw Error("Unsupported photo");
  const width = qr ? null : document ? 2400 : 1600;
  const image = sharp(input, { failOn: "error", limitInputPixels: 95_000_000 }).rotate();
  const resized = width
    ? image.resize({ width, height: width, fit: "inside", withoutEnlargement: true })
    : image;
  const result = mime === "image/jpeg"
    ? (qr ? input : await resized.jpeg({ quality: document ? 88 : 76, mozjpeg: true }).toBuffer())
    : mime === "image/png"
      ? await resized.png({ compressionLevel: 9 }).toBuffer()
      : await resized.webp({ quality: document ? 88 : 76, effort: 5, lossless: qr }).toBuffer();
  const meta = await sharp(result).metadata();
  if (!meta.width || !meta.height) throw Error("Image validation failed");
  return result;
}

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) return NextResponse.json({ error: "Cron not configured" }, { status: 503 });
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const start = Date.now(), maxTime = 220000;
  const summary = { compressed: 0, kept: 0, deleted: 0, reconciled: 0, bytesSaved: 0, failed: 0 };
  try {
    const db = credentials(), storage = db.storage.from("order-files");
    const read = async (action: Action, limit: number) => {
      const { data, error } = await db.rpc("order_photo_retention_candidates", {
        p_action: action, p_limit: limit
      });
      if (error) throw Error("Eligibility query failed: " + error.message);
      return (data ?? []) as Photo[];
    };
    const record = async (file: Photo, fields: Record<string, unknown>) => {
      const { error } = await db.from("order_photo_retention_log").upsert({
        storage_path: file.storage_path,
        order_file_id: file.file_id,
        ...fields,
        last_attempt_at: new Date().toISOString()
      }, { onConflict: "storage_path" });
      if (error) throw error;
    };
    // Expired files first; unfinished order groups can never reach delete candidates.
    for (const [action, limit] of [
      ["delete", 70], ["compress", 120], ["finalize_delete", 70]
    ] as const) {
      if (Date.now() - start > maxTime) break;
      const candidates = await read(action, limit);
      for (const file of candidates) {
        if (Date.now() - start > maxTime) break;
        if (!validFile(file)) continue;
        try {
          // A second lookup catches status edits and group changes before modification.
          const stillEligible = (await read(action, 200)).some(
            item => item.file_id === file.file_id && item.storage_path === file.storage_path
          );
          if (!stillEligible) continue;
          if (action === "compress") {
            const { data, error } = await storage.download(file.storage_path);
            if (error || !data) throw error || Error("Photo download failed");
            const original = Buffer.from(await data.arrayBuffer());
            const smaller = await optimize(file, original);
            if (smaller.length < original.length * 0.98) {
              const { error: writeError } = await storage.update(file.storage_path, smaller,
                { contentType: file.mime_type, cacheControl: "600" });
              if (writeError) throw writeError;
              summary.compressed++;
              summary.bytesSaved += original.length - smaller.length;
            } else summary.kept++;
            await record(file, { compressed_at: new Date().toISOString(),
              original_size_bytes: original.length,
              stored_size_bytes: Math.min(smaller.length, original.length),
              compression_note: smaller.length < original.length * 0.98 ? "compressed" : "not_smaller" });
          } else {
            if (action === "delete") {
              const { error } = await storage.remove([file.storage_path]);
              if (error) throw error;
            }
            // Only remove file links; never remove the order, its items or history.
            const { error } = await db.from("order_files").delete()
              .eq("id", file.file_id).eq("storage_path", file.storage_path);
            if (error) throw error;
            await record(file, { deleted_at: new Date().toISOString() });
            if (action === "delete") summary.deleted++; else summary.reconciled++;
          }
        } catch (error) {
          summary.failed++;
          console.error("Photo retention failed for one file", error);
        }
      }
    }
    return NextResponse.json({ ok: summary.failed === 0, ...summary });
  } catch (error) {
    console.error("Photo retention safely stopped", error);
    return NextResponse.json({ error: "Photo maintenance stopped", summary }, { status: 500 });
  }
}
