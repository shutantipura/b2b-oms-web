export type DeliveryLocation = { label: string; url: string };
export const MAX_DELIVERY_LOCATIONS = 2;

export function isGoogleMapsUrl(input: string): boolean {
  try {
    const url = new URL(input.trim());
    if (url.protocol !== "https:" || url.username || url.password) return false;
    const hostname = url.hostname.toLowerCase();
    if (hostname === "maps.app.goo.gl") return url.pathname.length > 1;
    if (hostname === "goo.gl") return url.pathname.startsWith("/maps/");
    const googleHosts = ["google.com", "www.google.com", "maps.google.com",
      "google.co.th", "www.google.co.th", "maps.google.co.th"];
    if (!googleHosts.includes(hostname)) return false;
    return url.pathname.startsWith("/maps") ||
      (hostname.startsWith("maps.") && (url.searchParams.has("q") || url.searchParams.has("query")));
  } catch { return false; }
}

export function validateDeliveryLocations(value: unknown): DeliveryLocation[] {
  if (!Array.isArray(value) || value.length > MAX_DELIVERY_LOCATIONS) {
    throw new Error("บันทึกจุดส่งได้สูงสุด 2 จุด");
  }
  const items = value.map((item: unknown): DeliveryLocation => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("ข้อมูลจุดส่งไม่ถูกต้อง");
    }
    const record = item as Record<string, unknown>;
    const label = typeof record.label === "string" ? record.label.trim() : "";
    const url = typeof record.url === "string" ? record.url.trim() : "";
    if (!label || label.length > 60) throw new Error("กรุณาระบุชื่อจุดส่ง ไม่เกิน 60 ตัวอักษร");
    if (!url || url.length > 2048 || !isGoogleMapsUrl(url)) {
      throw new Error("กรุณาวางลิงก์ Google Maps ที่ถูกต้อง");
    }
    return { label, url };
  });
  if (new Set(items.map((location) => location.url)).size !== items.length) {
    throw new Error("จุดส่งไม่สามารถใช้ลิงก์ซ้ำกัน");
  }
  return items;
}
