import { normalizeDemandUnit } from "./stockForecast.ts";

export type B2CSales30DayRow = { sku: string; soldQty: number; unit: string | null };

export type B2CImportPreview = {
  rows: B2CSales30DayRow[];
  errors: string[];
  skippedBlank: number;
};

function normalizedHeader(value: unknown) {
  return String(value ?? "").trim().toLowerCase().replace(/[\s_().\-/]+/g, "");
}

const SKU_HEADERS = new Set(["sku", "itemcode", "productcode", "รหัสสินค้า", "รหัส", "เลขสินค้า"]);
const SALES_HEADERS = new Set([
  "b2csales30days", "b2csales30day", "b2csales", "salesqty", "soldqty",
  "quantitysold", "30daysales", "30daysqty", "ยอดขาย30วัน", "จำนวนขาย30วัน", "ยอดขายb2c", "จำนวนขาย",
]);
const UNIT_HEADERS = new Set(["unit", "uom", "หน่วย", "หน่วยนับ"]);

export function normalizeStockSku(raw: unknown): string | null {
  const value = String(raw ?? "").trim();
  return /^\d{1,9}$/.test(value) ? value.padStart(9, "0") : null;
}

export function validateSalesPeriod(start: string, end: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return false;
  const a = Date.parse(`${start}T00:00:00Z`);
  const b = Date.parse(`${end}T00:00:00Z`);
  return Number.isFinite(a) && Number.isFinite(b) && new Date(a).toISOString().slice(0, 10) === start &&
    new Date(b).toISOString().slice(0, 10) === end && (b - a) / 86_400_000 === 29;
}

function parseQuantity(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
  const raw = String(value ?? "").trim().replace(/,/g, "");
  if (!raw || !/^\d+(\.\d+)?$/.test(raw)) return null;
  const number = Number(raw);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

/** Read the first worksheet in a manager-uploaded 30-day B2C sales workbook. */
export function parseB2CSales30DaySheet(cells: unknown[][]): B2CImportPreview {
  const errors: string[] = [];
  let headerRow = -1;
  let skuColumn = -1;
  let qtyColumn = -1;
  let unitColumn = -1;
  for (let index = 0; index < Math.min(15, cells.length); index++) {
    const headers = (cells[index] ?? []).map(normalizedHeader);
    const sku = headers.findIndex((header) => SKU_HEADERS.has(header));
    const qty = headers.findIndex((header) => SALES_HEADERS.has(header));
    if (sku >= 0 && qty >= 0) {
      headerRow = index;
      skuColumn = sku;
      qtyColumn = qty;
      unitColumn = headers.findIndex((header) => UNIT_HEADERS.has(header));
      break;
    }
  }
  if (headerRow < 0) {
    return { rows: [], skippedBlank: 0, errors: ["ไม่พบหัวคอลัมน์ SKU และ B2C Sales (30 days)"] };
  }

  const rows: B2CSales30DayRow[] = [];
  const seen = new Set<string>();
  let skippedBlank = 0;
  for (let index = headerRow + 1; index < cells.length; index++) {
    const cellsInRow = cells[index] ?? [];
    const skuRaw = cellsInRow[skuColumn];
    const quantityRaw = cellsInRow[qtyColumn];
    if (String(skuRaw ?? "").trim() === "" && String(quantityRaw ?? "").trim() === "") {
      skippedBlank++;
      continue;
    }
    const sku = normalizeStockSku(skuRaw);
    const quantity = parseQuantity(quantityRaw);
    if (!sku) {
      if (errors.length < 100) errors.push(`แถว ${index + 1}: รหัสสินค้าต้องเป็นตัวเลขไม่เกิน 9 หลัก`);
      continue;
    }
    if (quantity === null || Math.round(quantity * 1000) / 1000 !== quantity) {
      if (errors.length < 100) errors.push(`แถว ${index + 1}: ปริมาณขายไม่ถูกต้อง (ใช้ทศนิยมไม่เกิน 3 ตำแหน่ง)`);
      continue;
    }
    if (seen.has(sku)) {
      if (errors.length < 100) errors.push(`แถว ${index + 1}: SKU ${sku} ซ้ำในไฟล์`);
      continue;
    }
    seen.add(sku);
    const rawUnit = unitColumn >= 0 ? String(cellsInRow[unitColumn] ?? "").trim() : "";
    rows.push({ sku, soldQty: quantity, unit: rawUnit ? normalizeDemandUnit(rawUnit) : null });
  }
  if (!rows.length && !errors.length) errors.push("ไม่พบข้อมูลยอดขายที่นำเข้าได้");
  return { rows, errors, skippedBlank };
}

export function b2cDailyMean(soldQty30Days: number | null | undefined) {
  return soldQty30Days === null || soldQty30Days === undefined || !Number.isFinite(soldQty30Days)
    ? null : Math.round(soldQty30Days / 30 * 1000) / 1000;
}
