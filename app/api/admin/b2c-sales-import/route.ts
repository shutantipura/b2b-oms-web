import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { parseB2CSales30DaySheet, parseB2CDailySheet, validateSalesPeriod, weekdayLabel, type B2CSales30DayRow } from "@/lib/sharedStockInputs";
import { requireStockRole, stockErrorResponse } from "@/lib/server/stockAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_BYTES = 12 * 1024 * 1024;
const MAX_IMPORT_ROWS = 30000;

function chunks<T>(list: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < list.length; index += size) result.push(list.slice(index, index + size));
  return result;
}

export async function GET(request: NextRequest) {
  try {
    const { admin } = await requireStockRole(request, ["manager"]);
    const [daily, legacy] = await Promise.all([
      admin.from("b2c_daily_sales_imports").select("id, period_start, period_end, source_filename, sku_count, imported_at, dates").eq("is_active", true).maybeSingle(),
      admin.from("b2c_sales_30d_imports").select("id, period_start, period_end, source_filename, row_count, imported_at").eq("is_active", true).maybeSingle(),
    ]);
    if (daily.error || legacy.error) throw daily.error ?? legacy.error;
    const activeImport = daily.data ? { ...daily.data, row_count: daily.data.sku_count, format: "daily" } :
      legacy.data ? { ...legacy.data, format: "total" } : null;
    return NextResponse.json({ activeImport }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return stockErrorResponse(error); }
}

export async function POST(request: NextRequest) {
  try {
    const { admin, staffId } = await requireStockRole(request, ["manager"]);
    const form = await request.formData();
    const file = form.get("file");
    const mode = form.get("mode") === "commit" ? "commit" : "preview";
    const blankAsZero = form.get("blankAsZero") === "true";
    const periodStart = String(form.get("periodStart") ?? "");
    const periodEnd = String(form.get("periodEnd") ?? "");
    if (!(file instanceof File) || !/\.(xlsx|xls)$/i.test(file.name) || file.size <= 0 || file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: "กรุณาเลือกไฟล์ Excel .xlsx/.xls ขนาดไม่เกิน 12 MB" }, { status: 400 });
    }
    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(Buffer.from(await file.arrayBuffer()), { type: "buffer", dense: true });
    } catch {
      return NextResponse.json({ error: "ไม่สามารถอ่านไฟล์ Excel ได้ หากเป็นไฟล์เข้ารหัสจาก Power BI กรุณาขอไฟล์ที่มีสิทธิ์ใช้งานจาก IT" }, { status: 400 });
    }
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet) return NextResponse.json({ error: "ไม่พบแผ่นงานในไฟล์" }, { status: 400 });
    const cells = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", blankrows: false });
    const daily = parseB2CDailySheet(cells, blankAsZero);
    const parsed = daily ?? parseB2CSales30DaySheet(cells);
    if (!daily && !validateSalesPeriod(periodStart, periodEnd)) {
      return NextResponse.json({ error: "ไฟล์ยอดรวมต้องระบุช่วง 30 วัน · ไฟล์รายวันจะอ่านช่วงวันที่จากหัวคอลัมน์อัตโนมัติ" }, { status: 400 });
    }
    if (parsed.rows.length > MAX_IMPORT_ROWS) {
      return NextResponse.json({ error: `ไฟล์มีมากกว่า ${MAX_IMPORT_ROWS.toLocaleString()} SKU กรุณาแบ่งเป็นไฟล์ย่อยก่อน` }, { status: 400 });
    }
    if (parsed.errors.length || parsed.rows.length === 0) {
      return NextResponse.json({ error: "ข้อมูลใน Excel ไม่ผ่านการตรวจสอบ", errors: parsed.errors }, { status: 400 });
    }

    // Match SKU to the master catalogue; unmatched rows remain in the import
    // for audit, but cannot contribute to a product forecast until matched.
    const matches = new Map<string, { sku: string; product_name: string; unit: string | null }>();
    const batches = chunks(parsed.rows.map((row) => row.sku), 300);
    for (const group of chunks(batches, 6)) {
      const responses = await Promise.all(group.map((batch) => admin.from("products")
        .select("sku, product_name, unit").in("sku", batch)));
      for (const response of responses) {
        if (response.error) throw response.error;
        for (const product of response.data ?? []) matches.set(product.sku, product);
      }
    }
    const unmatched = parsed.rows.filter((row) => !matches.has(row.sku));
    const unitWarnings: string[] = [];
    for (const row of parsed.rows) {
      const masterUnit = matches.get(row.sku)?.unit;
      if (row.unit && masterUnit && row.unit !== masterUnit && unitWarnings.length < 30) {
        unitWarnings.push(`${row.sku}: หน่วยในไฟล์ ${row.unit} ต่างจาก Master ${masterUnit}`);
      }
    }
    const preview = {
      format: daily ? "daily" : "total",
      periodStart: daily?.dates[0] ?? periodStart,
      periodEnd: daily?.dates.at(-1) ?? periodEnd,
      dates: daily?.dates.map((date) => ({ date, weekday: weekdayLabel(date) })) ?? [],
      blankAsZero: daily ? blankAsZero : null,
      totalSkus: parsed.rows.length,
      matchedSkus: parsed.rows.length - unmatched.length,
      unmatchedSkus: unmatched.length,
      unmatchedExamples: unmatched.slice(0, 30).map((row) => row.sku),
      unitWarnings,
      sample: parsed.rows.slice(0, 15).map((row) => ({ ...row,
        soldQty: daily ? ("quantities" in row ? row.quantities.reduce<number>((sum, qty) => sum + (qty ?? 0), 0) : 0) : "soldQty" in row ? row.soldQty : 0,
        productName: matches.get(row.sku)?.product_name ?? "ไม่พบใน Master" })),
      skippedBlank: parsed.skippedBlank,
    };
    if (mode === "preview") return NextResponse.json({ preview }, { headers: { "Cache-Control": "private, no-store" } });
    if (unitWarnings.length) return NextResponse.json({ error: "พบหน่วยนับไม่ตรง Master กรุณาแก้ไฟล์ก่อนนำเข้า", preview }, { status: 400 });

    if (daily) {
      const { data: importBatch, error: createError } = await admin.from("b2c_daily_sales_imports")
        .insert({ period_start: daily.dates[0], period_end: daily.dates.at(-1), dates: daily.dates,
          source_filename: file.name.slice(0, 200), sku_count: daily.rows.length,
          imported_by_staff_id: staffId, is_active: false }).select("id").single();
      if (createError || !importBatch) throw createError ?? new Error("Could not open daily import batch");
      const profiles = daily.rows.map((row) => ({ import_id: importBatch.id, sku: row.sku,
        unit: row.unit, daily_qty: row.quantities }));
      for (const group of chunks(chunks(profiles, 150), 5)) {
        const writes = await Promise.all(group.map((batch) => admin.from("b2c_daily_sales_profiles").insert(batch)));
        for (const write of writes) if (write.error) throw write.error;
      }
      const { error: activateError } = await admin.rpc("activate_b2c_daily_sales_import", { p_import_id: importBatch.id });
      if (activateError) throw activateError;
      return NextResponse.json({ imported: true, importId: importBatch.id, preview });
    }

    const { data: importBatch, error: createError } = await admin.from("b2c_sales_30d_imports")
      .insert({ period_start: periodStart, period_end: periodEnd, source_filename: file.name.slice(0, 200),
        row_count: parsed.rows.length, imported_by_staff_id: staffId, is_active: false })
      .select("id").single();
    if (createError || !importBatch) throw createError ?? new Error("Could not open import batch");
    const rowsToInsert = (parsed.rows as B2CSales30DayRow[]).map((row) => ({
      import_id: importBatch.id, sku: row.sku, sold_qty: row.soldQty, unit: row.unit,
    }));
    for (const group of chunks(chunks(rowsToInsert, 400), 5)) {
      const writes = await Promise.all(group.map((batch) => admin.from("b2c_sales_30d_rows").insert(batch)));
      for (const write of writes) if (write.error) throw write.error;
    }
    const { error: activateError } = await admin.rpc("activate_b2c_sales_30d_import", { p_import_id: importBatch.id });
    if (activateError) throw activateError;
    return NextResponse.json({ imported: true, importId: importBatch.id, preview });
  } catch (error) { return stockErrorResponse(error); }
}
