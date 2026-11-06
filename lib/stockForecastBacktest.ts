import {
  aggregateForecastByProduct,
  bangkokDateKey,
  buildStockForecast,
  normalizeDemandUnit,
  type ForecastCustomerInput,
  type ForecastItemInput,
  type ForecastOrderInput,
} from "./stockForecast.ts";

export const BACKTEST_DAYS = 14;
export const BACKTEST_CUTOFF_HOUR = 16;
const MIN_TRAINING_DAYS = 7;

export type DemandBacktestDay = {
  deliveryDate: string;
  cutoffAt: string;
  unit: string;
  actualQty: number;
  forecastQty: number;
  bookedOnlyQty: number;
  absoluteError: number;
  bookedAbsoluteError: number;
  wape: number | null;
  bookedWape: number | null;
  skuCount: number;
};

export type DemandBacktestUnit = {
  unit: string;
  evaluatedSkuDays: number;
  actualQty: number;
  forecastQty: number;
  bookedOnlyQty: number;
  modelWape: number | null;
  bookedOnlyWape: number | null;
  modelBiasPct: number | null;
};

export type DemandBacktestReport = {
  asOf: string;
  cutoffHourBangkok: number;
  evaluatedDays: number;
  evaluatedSkuDays: number;
  byUnit: DemandBacktestUnit[];
  skuOccurrenceBrier: number | null;
  scoredSkuOccurrences: number;
  days: DemandBacktestDay[];
  limitations: string[];
};

function addDays(date: string, delta: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + delta * 86_400_000).toISOString().slice(0, 10);
}

function productKey(sku: string, unit: string) {
  return JSON.stringify([sku, normalizeDemandUnit(unit)]);
}

function skuCustomerKey(customerId: string, sku: string, unit: string) {
  return JSON.stringify([customerId, sku, normalizeDemandUnit(unit)]);
}

function percentError(error: number, actual: number) {
  return actual > 0 ? (100 * error) / actual : null;
}

/**
 * Walk-forward, as-of-cutoff evaluation. Each historical forecast is generated
 * using only orders submitted by that cutoff, with no future quantities used
 * for fitting. The holdout is the *original requested quantity*, not sales.
 *
 * IMPORTANT: The OMS does not yet store point-in-time histories of cancellation,
 * edited delivery dates and item corrections. This is a retrospective replay of
 * surviving records, not a fully audit-grade historical reconstruction.
 */
export function backtestStockForecast(
  orders: ForecastOrderInput[],
  items: ForecastItemInput[],
  customers: ForecastCustomerInput[],
  asOf = new Date(),
  dayCount = BACKTEST_DAYS
): DemandBacktestReport {
  const today = bangkokDateKey(asOf);
  const validCustomers = new Set(customers.filter((customer) => !customer.isTest).map((customer) => customer.id));
  const oldestRecordedDate = orders
    .filter((order) => order.status !== "cancelled" && validCustomers.has(order.customerId) && order.deliveryDate !== null && order.deliveryDate < today)
    .map((order) => order.deliveryDate!)
    .sort()[0];
  const earliestTrainingCutoff = oldestRecordedDate ? addDays(oldestRecordedDate, MIN_TRAINING_DAYS + 1) : today;
  const validOrders = new Map(orders.filter((order) =>
    order.status !== "cancelled" &&
    validCustomers.has(order.customerId) &&
    order.deliveryDate !== null &&
    Number.isFinite(Date.parse(order.createdAt)) &&
    Date.parse(order.createdAt) <= asOf.getTime()
  ).map((order) => [order.id, order]));

  const requestedByDate = new Map<string, Map<string, number>>();
  const requestedByDateCustomer = new Map<string, Map<string, number>>();
  for (const item of items) {
    const order = validOrders.get(item.orderId);
    if (!order?.deliveryDate || item.requestedQty === null || !Number.isFinite(item.requestedQty) || item.requestedQty <= 0) continue;
    const date = order.deliveryDate;
    const key = productKey(item.sku, item.unit);
    const daily = requestedByDate.get(date) ?? new Map<string, number>();
    daily.set(key, (daily.get(key) ?? 0) + item.requestedQty);
    requestedByDate.set(date, daily);

    const customerKey = skuCustomerKey(order.customerId, item.sku, item.unit);
    const customerDaily = requestedByDateCustomer.get(date) ?? new Map<string, number>();
    customerDaily.set(customerKey, (customerDaily.get(customerKey) ?? 0) + item.requestedQty);
    requestedByDateCustomer.set(date, customerDaily);
  }

  const days: DemandBacktestDay[] = [];
  const unitTotals = new Map<string, {
    skuDays: number; actual: number; forecast: number; booked: number; error: number; bookedError: number;
  }>();
  let evaluatedDays = 0;
  let totalSkuDays = 0;
  let brierTotal = 0;
  let brierCount = 0;

  for (let daysAgo = dayCount; daysAgo >= 1; daysAgo--) {
    const deliveryDate = addDays(today, -daysAgo);
    if (deliveryDate < earliestTrainingCutoff) continue;
    const priorDay = addDays(deliveryDate, -1);
    const cutoff = new Date(`${priorDay}T${String(BACKTEST_CUTOFF_HOUR).padStart(2, "0")}:00:00+07:00`);
    if (cutoff > asOf) continue;
    const forecast = buildStockForecast(orders, items, customers, cutoff);
    const predictions = aggregateForecastByProduct(forecast.rows, forecast.dates);
    const forecastByProduct = new Map(predictions.map((row) => [
      productKey(row.sku, row.unit),
      { total: row.days[1]?.totalQty ?? 0, booked: row.days[1]?.knownQty ?? 0 },
    ]));
    const actual = requestedByDate.get(deliveryDate) ?? new Map<string, number>();
    const keys = new Set([...actual.keys(), ...forecastByProduct.keys()]);
    const dailyByUnit = new Map<string, {
      actual: number; forecast: number; booked: number; error: number; bookedError: number; skuCount: number;
    }>();
    for (const key of keys) {
      const [, unit] = JSON.parse(key) as [string, string];
      const observed = actual.get(key) ?? 0;
      const estimated = forecastByProduct.get(key);
      const predicted = estimated?.total ?? 0;
      const booked = estimated?.booked ?? 0;
      const daily = dailyByUnit.get(unit) ?? { actual: 0, forecast: 0, booked: 0, error: 0, bookedError: 0, skuCount: 0 };
      daily.actual += observed;
      daily.forecast += predicted;
      daily.booked += booked;
      daily.error += Math.abs(predicted - observed);
      daily.bookedError += Math.abs(booked - observed);
      daily.skuCount++;
      dailyByUnit.set(unit, daily);
    }

    // Brier scores evaluate predicted customer-SKU *additional* order events.
    // The sample is restricted to SKUs the model had enough context to score.
    const customerActual = requestedByDateCustomer.get(deliveryDate) ?? new Map<string, number>();
    for (const row of forecast.rows) {
      const day = row.days[1];
      if (!day || day.knownQty > 0 || day.projectedProbability === undefined || day.possibleQty === 0) continue;
      const observed = (customerActual.get(skuCustomerKey(row.customerId, row.sku, row.unit)) ?? 0) > 0 ? 1 : 0;
      brierTotal += (day.projectedProbability - observed) ** 2;
      brierCount++;
    }

    evaluatedDays++;
    for (const [unit, daily] of dailyByUnit) {
      days.push({
        deliveryDate, cutoffAt: cutoff.toISOString(), unit,
        actualQty: daily.actual, forecastQty: daily.forecast, bookedOnlyQty: daily.booked,
        absoluteError: daily.error, bookedAbsoluteError: daily.bookedError,
        wape: percentError(daily.error, daily.actual),
        bookedWape: percentError(daily.bookedError, daily.actual),
        skuCount: daily.skuCount,
      });
      const totals = unitTotals.get(unit) ?? { skuDays: 0, actual: 0, forecast: 0, booked: 0, error: 0, bookedError: 0 };
      totals.skuDays += daily.skuCount;
      totals.actual += daily.actual;
      totals.forecast += daily.forecast;
      totals.booked += daily.booked;
      totals.error += daily.error;
      totals.bookedError += daily.bookedError;
      unitTotals.set(unit, totals);
    }
    totalSkuDays += keys.size;
  }

  const byUnit: DemandBacktestUnit[] = [...unitTotals].map(([unit, totals]) => ({
    unit,
    evaluatedSkuDays: totals.skuDays,
    actualQty: totals.actual,
    forecastQty: totals.forecast,
    bookedOnlyQty: totals.booked,
    modelWape: percentError(totals.error, totals.actual),
    bookedOnlyWape: percentError(totals.bookedError, totals.actual),
    modelBiasPct: percentError(totals.forecast - totals.actual, totals.actual),
  })).sort((a, b) => b.actualQty - a.actualQty);

  return {
    asOf: asOf.toISOString(),
    cutoffHourBangkok: BACKTEST_CUTOFF_HOUR,
    evaluatedDays,
    evaluatedSkuDays: totalSkuDays,
    byUnit,
    skuOccurrenceBrier: brierCount ? brierTotal / brierCount : null,
    scoredSkuOccurrences: brierCount,
    days,
    limitations: [
      "จำลองจากข้อมูลย้อนหลังที่ยังคงอยู่ในระบบ โดยไม่มีประวัติสถานะและวันส่งทุกครั้งที่ถูกแก้ไข จึงไม่ใช่ข้อมูล snapshot ณ เวลานั้นอย่างสมบูรณ์",
      "วัด Requested Qty ตามวันส่ง ไม่ใช่ยอดขายจริง และตัดสินที่เวลา 16:00 ของวันก่อนส่ง (เวลาไทย)",
      "WAPE คำนวณแยกตามหน่วยนับ (เช่น กก. และ ชิ้น) ไม่นำยอดคนละหน่วยมาบวกกัน",
      "ยังไม่ใช่การวัดที่ผ่านการยืนยันเชิงสถิติจากหลายเดือน และไม่มีการบันทึก snapshot ก่อนหน้า จึงใช้เพื่อเฝ้าระวังความแม่นยำเบื้องต้นเท่านั้น",
    ],
  };
}
