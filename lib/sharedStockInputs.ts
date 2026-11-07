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

const WEEKDAYS = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"];
export function weekdayForDate(date: string) {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}
export function weekdayLabel(date: string) { return WEEKDAYS[weekdayForDate(date)]; }

/** Excel's date serials and ISO or day-first Power BI date headers. */
export function parseCalendarHeader(value: unknown, order: "DMY" | "MDY" = "DMY"): string | null {
  let date: Date | null = null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) date = new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()));
  else if (typeof value === "number" && Number.isInteger(value) && value >= 36000 && value < 90000) {
    date = new Date(Date.UTC(1899, 11, 30) + value * 86_400_000);
  } else {
    const text = String(value ?? "").trim();
    const iso = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(text);
    const local = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(text);
    if (iso) date = new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3]));
    if (local) date = new Date(Date.UTC(+local[3], (order === "DMY" ? +local[2] : +local[1]) - 1, order === "DMY" ? +local[1] : +local[2]));
  }
  if (!date || Number.isNaN(date.getTime())) return null;
  const result = date.toISOString().slice(0, 10);
  const values = /^(\d{4})-(\d{2})-(\d{2})$/.exec(result);
  if (!values || (+values[1] < 2020 || +values[1] > 2100)) return null;
  if (typeof value === "string") {
    const digits = value.match(/\d+/g);
    if (digits?.length === 3) {
      const suppliedDay = digits[0].length === 4 ? +digits[2] : +(order === "DMY" ? digits[0] : digits[1]);
      const suppliedMonth = digits[0].length === 4 ? +digits[1] : +(order === "DMY" ? digits[1] : digits[0]);
      if (suppliedDay !== +values[3] || suppliedMonth !== +values[2]) return null;
    }
  }
  return result;
}

export type B2CDailyRow = { sku: string; unit: string | null; quantities: (number | null)[] };
export type B2CDailySheet = {
  format: "daily";
  dates: string[];
  rows: B2CDailyRow[];
  errors: string[];
  skippedBlank: number;
};

export function parseB2CDailySheet(cells: unknown[][], blankAsZero = false): B2CDailySheet | null {
  for (let headerIndex = 0; headerIndex < Math.min(15, cells.length); headerIndex++) {
    const headers = cells[headerIndex] ?? [];
    const numericDates = headers.flatMap((header) => {
      if (typeof header !== "string") return [];
      const match = /^(\d{1,2})[/-](\d{1,2})[/-]\d{4}$/.exec(header.trim());
      return match ? [{ first: +match[1], second: +match[2] }] : [];
    });
    const usEvidence = numericDates.some((value) => value.second > 12 && value.first <= 12);
    const dayFirstEvidence = numericDates.some((value) => value.first > 12 && value.second <= 12);
    const dateOrder = usEvidence && !dayFirstEvidence ? "MDY" : "DMY";
    const skuColumn = headers.findIndex((value) => SKU_HEADERS.has(normalizedHeader(value)));
    const dateColumns = headers.flatMap((value, index) => {
      const date = parseCalendarHeader(value, dateOrder);
      return date ? [{ index, date }] : [];
    });
    if (skuColumn < 0 || dateColumns.length < 7) continue;
    const unitColumn = headers.findIndex((value) => UNIT_HEADERS.has(normalizedHeader(value)));
    const errors: string[] = [];
    if (usEvidence && dayFirstEvidence) errors.push("พบรูปแบบวันที่ DD/MM และ MM/DD ปะปนกัน กรุณาใช้รูปแบบเดียวทั้งไฟล์");
    const sorted = [...dateColumns].sort((a, b) => a.date.localeCompare(b.date));
    const dates = sorted.map((column) => column.date);
    if (dates.length > 120) errors.push("รองรับข้อมูลรายวันสูงสุด 120 วันต่อไฟล์");
    for (let i = 1; i < dates.length; i++) {
      if (Date.parse(dates[i]) - Date.parse(dates[i - 1]) !== 86_400_000) {
        errors.push("หัวคอลัมน์วันที่ต้องไม่ซ้ำและต้องต่อเนื่องทุกวัน (ไม่มีวันที่ขาด)"); break;
      }
    }
    const rows: B2CDailyRow[] = [];
    const seen = new Set<string>();
    let skippedBlank = 0;
    for (let index = headerIndex + 1; index < cells.length; index++) {
      const record = cells[index] ?? [];
      const skuValue = record[skuColumn];
      if (String(skuValue ?? "").trim() === "") { skippedBlank++; continue; }
      const sku = normalizeStockSku(skuValue);
      if (!sku) { if (errors.length < 100) errors.push(`แถว ${index + 1}: รหัสสินค้าไม่ถูกต้อง`); continue; }
      if (seen.has(sku)) { if (errors.length < 100) errors.push(`แถว ${index + 1}: SKU ${sku} ซ้ำ`); continue; }
      const quantities = sorted.map(({ index: column }) => {
        const value = record[column];
        if (value === null || value === undefined || String(value).trim() === "") return blankAsZero ? 0 : null;
        return parseQuantity(value);
      });
      if (quantities.some((value, offset) => {
        const raw = record[sorted[offset].index];
        return String(raw ?? "").trim() !== "" && (value === null || Math.round(value * 1000) / 1000 !== value);
      })) { if (errors.length < 100) errors.push(`แถว ${index + 1}: ยอดขายไม่ใช่จำนวนที่ถูกต้อง`); continue; }
      const unitValue = unitColumn < 0 ? "" : String(record[unitColumn] ?? "").trim();
      rows.push({ sku, unit: unitValue ? normalizeDemandUnit(unitValue) : null, quantities });
      seen.add(sku);
    }
    if (!rows.length) errors.push("ไม่พบยอดขายราย SKU");
    return { format: "daily", dates, rows, errors, skippedBlank };
  }
  return null;
}

export function dailyWeekdayBaseline(dates: string[], quantities: (number | null)[], targetDate: string) {
  const observations = quantities.flatMap((qty, index) => qty === null ? [] : [{ qty, weekday: weekdayForDate(dates[index]) }]);
  if (!observations.length) return null;
  const overall = observations.reduce((sum, item) => sum + item.qty, 0) / observations.length;
  const weekday = weekdayForDate(targetDate);
  const group = observations.filter((item) => item.weekday === weekday);
  if (!group.length) return overall;
  const groupMean = group.reduce((sum, item) => sum + item.qty, 0) / group.length;
  // Four equivalent prior observations of the overall mean damp noisy weekday effects.
  return (groupMean * group.length + overall * 4) / (group.length + 4);
}
