/** Sales volumes are recorded on the Bangkok billing-completion date, not order date. */
export const STOCK_REPORT_DAYS = 14;

export type StockSalesLine = {
  customerId: string;
  customerCode: string;
  customerName: string;
  sku: string;
  productName: string;
  unit: string;
  quantity: number;
  billingDate: string;
};

export type StockSalesRow = {
  customerCode: string;
  customerName: string;
  sku: string;
  productName: string;
  unit: string;
  dailyQuantities: number[];
  totalQuantity: number;
};

export function bangkokDateKey(value: Date | string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const getPart = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${getPart("year")}-${getPart("month")}-${getPart("day")}`;
}

export function stockReportDates(now = new Date()): string[] {
  const today = bangkokDateKey(now);
  const utcMidnight = Date.parse(`${today}T00:00:00Z`);
  return Array.from({ length: STOCK_REPORT_DAYS }, (_, index) =>
    new Date(utcMidnight - (STOCK_REPORT_DAYS - index - 1) * 86_400_000)
      .toISOString()
      .slice(0, 10)
  );
}

export function normalizeSalesUnit(unit: string, soldByKilogram: boolean): string {
  if (soldByKilogram || /^(kg|kgs|kilogram|กก\.?|กิโลกรัม)$/i.test(unit.trim())) return "กก.";
  return unit.trim() || "ไม่ระบุ";
}

/** One row per customer/SKU/unit. Never combine quantities across incompatible units. */
export function aggregateStockSales(lines: StockSalesLine[], dates: string[]): StockSalesRow[] {
  const dayIndexes = new Map(dates.map((date, index) => [date, index]));
  const rows = new Map<string, StockSalesRow>();

  for (const line of lines) {
    const dayIndex = dayIndexes.get(line.billingDate);
    if (dayIndex === undefined || !Number.isFinite(line.quantity) || line.quantity <= 0) continue;
    const key = JSON.stringify([line.customerId, line.sku, line.unit]);
    let row = rows.get(key);
    if (!row) {
      row = {
        customerCode: line.customerCode,
        customerName: line.customerName,
        sku: line.sku,
        productName: line.productName,
        unit: line.unit,
        dailyQuantities: dates.map(() => 0),
        totalQuantity: 0,
      };
      rows.set(key, row);
    }
    row.dailyQuantities[dayIndex] += line.quantity;
    row.totalQuantity += line.quantity;
  }

  return [...rows.values()].sort((a, b) =>
    a.customerName.localeCompare(b.customerName, "th") ||
    a.customerCode.localeCompare(b.customerCode, "th") ||
    a.sku.localeCompare(b.sku, "en") ||
    a.unit.localeCompare(b.unit, "th")
  );
}
