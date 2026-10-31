"use client";

// Compress order photos before uploading; leave PDF attachments unchanged.
// QR assets use lossless PNG when already PNG, and never undergo lossy recompression.
export type OrderPhotoKind =
  | "cart_photo" | "cart_photo_2" | "delivery_proof" | "delivery_proof_2"
  | "bill" | "bill_2" | "payment_qr" | "payment_qr_2" | "payment_slip" | "payment_slip_2";

export async function prepareOrderPhoto(file: File, kind: OrderPhotoKind): Promise<File> {
  if (!file.type.startsWith("image/") || typeof document === "undefined") return file;
  const isQr = kind === "payment_qr" || kind === "payment_qr_2";
  // QR codes must remain reliably scannable. PNG is lossless; JPEG QR is preserved.
  if (isQr && file.type !== "image/png") return file;
  const documentPhoto = kind === "bill" || kind === "bill_2" || (kind === "payment_slip" || kind === "payment_slip_2");
  const maxSide = isQr ? null : documentPhoto ? 2400 : 1600;
  const quality = documentPhoto ? 0.88 : 0.76;
  const mime = isQr ? "image/png" : "image/jpeg";

  let image: ImageBitmap | HTMLImageElement | null = null;
  let objectUrl: string | null = null;
  try {
    if (typeof createImageBitmap === "function") {
      image = await createImageBitmap(file, { imageOrientation: "from-image" });
    } else {
      objectUrl = URL.createObjectURL(file);
      const url = objectUrl;
      image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const element = new Image();
        element.onload = () => resolve(element);
        element.onerror = () => reject(new Error("Image cannot be decoded"));
        element.src = url;
      });
    }
    const originalWidth = image.width, originalHeight = image.height;
    if (!originalWidth || !originalHeight || originalWidth * originalHeight > 95_000_000)
      throw new Error("Image dimensions outside safe limits");
    const factor = maxSide ? Math.min(1, maxSide / Math.max(originalWidth, originalHeight)) : 1;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(originalWidth * factor));
    canvas.height = Math.max(1, Math.round(originalHeight * factor));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Cannot prepare image canvas");
    // A white background makes transparent receipts legible after JPEG encoding.
    if (mime === "image/jpeg") {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const optimized = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Image encoding failed")),
        mime, mime === "image/jpeg" ? quality : undefined);
    });
    // Do not enlarge files just to claim they were compressed.
    if (optimized.size >= file.size * 0.98) return file;
    const filename = file.name.replace(/\.[^.]+$/, "") + (mime === "image/jpeg" ? ".jpg" : ".png");
    return new File([optimized], filename, { type: mime, lastModified: Date.now() });
  } catch (error) {
    // Never block a picker or rider if an older browser cannot decode an image.
    console.warn("Order photo optimization skipped:", error);
    return file;
  } finally {
    if (image && "close" in image && typeof image.close === "function") image.close();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}
