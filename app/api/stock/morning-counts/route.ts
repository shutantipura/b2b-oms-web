import { NextRequest, NextResponse } from "next/server";
import { bangkokDateKey, isFreshMeat } from "@/lib/stockForecast";
import { normalizeStockSku } from "@/lib/sharedStockInputs";
import { requireStockRole, stockErrorResponse } from "@/lib/server/stockAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MEAT_CATEGORIES = ["Fresh Meat", "เนื้อสัตว์และอาหารทะเล", "MEAT+SEAFOOD", "B2B-MEAT+SEAFOOD"];

export async function GET(request: NextRequest) {
  try {
    const { admin } = await requireStockRole(request, ["staff", "manager"]);
    const countDate = bangkokDateKey(new Date());
    const [products, counts] = await Promise.all([
      admin.from("products")
        .select("sku, product_name, category, unit, sales_score")
        .in("category", MEAT_CATEGORIES).eq("is_active", true).limit(1500),
      admin.from("stock_morning_counts")
        .select("sku, quantity_kg, counted_at")
        .eq("count_date", countDate),
    ]);
    if (products.error || counts.error) throw products.error ?? counts.error;
    const list = (products.data ?? []).filter((product) => product.sku && isFreshMeat(product.category, product.product_name ?? ""))
      .sort((a, b) => (Number(b.sales_score) || 0) - (Number(a.sales_score) || 0) || a.sku.localeCompare(b.sku))
      .map((product) => ({ sku: product.sku, productName: product.product_name, unit: product.unit }));
    return NextResponse.json({ countDate, products: list, counts: counts.data ?? [] },
      { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return stockErrorResponse(error); }
}

export async function POST(request: NextRequest) {
  try {
    const { admin, staffId } = await requireStockRole(request, ["staff", "manager"]);
    const body = await request.json();
    const inputs = Array.isArray(body?.counts) ? body.counts : [];
    if (!inputs.length || inputs.length > 150) {
      return NextResponse.json({ error: "กรุณาระบุสินค้า 1–150 รายการต่อการบันทึก" }, { status: 400 });
    }
    const quantities = new Map<string, number>();
    for (const item of inputs) {
      const sku = normalizeStockSku(item?.sku);
      const quantity = typeof item?.quantityKg === "number" ? item.quantityKg : NaN;
      if (!sku || !Number.isFinite(quantity) || quantity < 0 || quantity > 100000 ||
          Math.abs(quantity * 1000 - Math.round(quantity * 1000)) > 1e-6 || quantities.has(sku)) {
        return NextResponse.json({ error: "รหัสสินค้า/จำนวนคงเหลือไม่ถูกต้อง หรือมี SKU ซ้ำ" }, { status: 400 });
      }
      quantities.set(sku, quantity);
    }
    const { data: products, error: productsError } = await admin.from("products")
      .select("sku, product_name, category").in("sku", [...quantities.keys()]);
    if (productsError) throw productsError;
    const valid = new Set((products ?? []).filter((product) =>
      isFreshMeat(product.category, product.product_name ?? "")
    ).map((product) => product.sku));
    if (valid.size !== quantities.size) return NextResponse.json({ error: "มี SKU ที่ไม่ใช่เนื้อสดหรือไม่มีใน Master" }, { status: 400 });
    const countDate = bangkokDateKey(new Date());
    const countedAt = new Date().toISOString();
    const rows = [...quantities].map(([sku, quantity_kg]) => ({
      count_date: countDate, sku, quantity_kg, counted_at: countedAt, counted_by_staff_id: staffId,
    }));
    const { error } = await admin.from("stock_morning_counts")
      .upsert(rows, { onConflict: "count_date,sku" });
    if (error) throw error;
    return NextResponse.json({ saved: rows.length, countDate, countedAt },
      { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return stockErrorResponse(error); }
}
