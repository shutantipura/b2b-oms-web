import {
  aggregateForecastByProduct,
  bangkokDateKey,
  buildStockForecast,
  normaliseForecastQuantity,
  normalizeDemandUnit,
  type ForecastCustomerInput,
  type ForecastItemInput,
  type ForecastOrderInput,
} from "./stockForecast.ts";

export const BACKTEST_DAYS = 28;
export const BACKTEST_CUTOFF_HOUR = 12;
const MIN_TRAINING_DAYS = 7;

export type DemandBacktestDay = {
  deliveryDate: string;
  cutoffAt: string;
  unit: string;
  actualQty: number;
  forecastQty: number;
  planningQty: number;
  bookedOnlyQty: number;
  absoluteError: number;
  bookedAbsoluteError: number;
  wape: number | null;
  bookedWape: number | null;
  planningCoveragePct: number | null;
  underforecastQty: number;
  skuCount: number;
};

export type DemandBacktestUnit = {
  unit: string;
  evaluatedSkuDays: number;
  actualQty: number;
  forecastQty: number;
  planningQty: number;
  bookedOnlyQty: number;
  modelWape: number | null;
  bookedOnlyWape: number | null;
  modelBiasPct: number | null;
  planningCoveragePct: number | null;
  underforecastQty: number;
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

function skuCustomerKey(customerId: string, sku: string) {
  return JSON.stringify([customerId, sku]);
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

  const requestedItemsByDate = new Map<string, ForecastItemInput[]>();
  const requestedByDateCustomer = new Map<string, Map<string, number>>();
  for (const item of items) {
    const order = validOrders.get(item.orderId);
    if (!order?.deliveryDate || item.requestedQty === null || !Number.isFinite(item.requestedQty) || item.requestedQty <= 0) continue;
    const date = order.deliveryDate;
    const dailyItems = requestedItemsByDate.get(date) ?? [];
    dailyItems.push(item);
    requestedItemsByDate.set(date, dailyItems);

    const customerKey = skuCustomerKey(order.customerId, item.sku);
    const customerDaily = requestedByDateCustomer.get(date) ?? new Map<string, number>();
    customerDaily.set(customerKey, (customerDaily.get(customerKey) ?? 0) + item.requestedQty);
    requestedByDateCustomer.set(date, customerDaily);
  }

  const days: DemandBacktestDay[] = [];
  const unitTotals = new Map<string, {
    skuDays: number; actual: number; forecast: number; planning: number; booked: number;
    error: number; bookedError: number; planningCovered: number; underforecast: number;
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
    const forecastByProduct = new Map(predictions.flatMap((product) => product.units.map((unit) => [
      productKey(product.sku, unit.unit),
      {
        total: unit.days[1]?.totalQty ?? 0,
        planning: unit.days[1]?.planningQty ?? unit.days[1]?.totalQty ?? 0,
        booked: unit.days[1]?.knownQty ?? 0,
      },
    ] as const)));
    // Use the *cutoff-time* kg/pc calibration on the held-out requested pieces.
    // Using weights learned after the cutoff would leak future information.
    const actual = new Map<string, number>();
    for (const item of requestedItemsByDate.get(deliveryDate) ?? []) {
      const normalized = normaliseForecastQuantity(item.sku, item.unit, item.requestedQty!, forecast.weightConversions);
      const key = productKey(item.sku, normalized.unit);
      actual.set(key, (actual.get(key) ?? 0) + normalized.quantity);
    }
    const keys = new Set([...actual.keys(), ...forecastByProduct.keys()]);
    const dailyByUnit = new Map<string, {
      actual: number; forecast: number; planning: number; booked: number;
      error: number; bookedError: number; planningCovered: number; underforecast: number; skuCount: number;
    }>();
    for (const key of keys) {
      const [, unit] = JSON.parse(key) as [string, string];
      const observed = actual.get(key) ?? 0;
      const estimated = forecastByProduct.get(key);
      const predicted = estimated?.total ?? 0;
      const planning = estimated?.planning ?? 0;
      const booked = estimated?.booked ?? 0;
      const daily = dailyByUnit.get(unit) ?? {
        actual: 0, forecast: 0, planning: 0, booked: 0, error: 0, bookedError: 0,
        planningCovered: 0, underforecast: 0, skuCount: 0,
      };
      daily.actual += observed;
      daily.forecast += predicted;
      daily.planning += planning;
      daily.booked += booked;
      daily.error += Math.abs(predicted - observed);
      daily.bookedError += Math.abs(booked - observed);
      daily.planningCovered += observed <= planning + 0.001 ? 1 : 0;
      daily.underforecast += Math.max(0, observed - planning);
      daily.skuCount++;
      dailyByUnit.set(unit, daily);
    }

    // Score each customer's SKU event once, regardless of unit; unit switches
    // do not create an additional repeat-order opportunity.
    const customerActual = requestedByDateCustomer.get(deliveryDate) ?? new Map<string, number>();
    const alreadyBooked = new Set(forecast.rows
      .filter((row) => (row.days[1]?.knownQty ?? 0) > 0)
      .map((row) => skuCustomerKey(row.customerId, row.sku)));
    const customerSkuProbability = new Map<string, number>();
    for (const row of forecast.rows) {
      const day = row.days[1];
      if (!day || day.projectedProbability === undefined || day.possibleQty === 0) continue;
      const key = skuCustomerKey(row.customerId, row.sku);
      if (alreadyBooked.has(key)) continue;
      customerSkuProbability.set(key, (customerSkuProbability.get(key) ?? 0) + day.projectedProbability);
    }
    for (const [key, probability] of customerSkuProbability) {
      const observed = (customerActual.get(key) ?? 0) > 0 ? 1 : 0;
      brierTotal += (Math.min(1, probability) - observed) ** 2;
      brierCount++;
    }

    evaluatedDays++;
    for (const [unit, daily] of dailyByUnit) {
      days.push({
        deliveryDate, cutoffAt: cutoff.toISOString(), unit,
        actualQty: daily.actual, forecastQty: daily.forecast, planningQty: daily.planning,
        bookedOnlyQty: daily.booked,
        absoluteError: daily.error, bookedAbsoluteError: daily.bookedError,
        wape: percentError(daily.error, daily.actual),
        bookedWape: percentError(daily.bookedError, daily.actual),
        planningCoveragePct: daily.skuCount ? daily.planningCovered * 100 / daily.skuCount : null,
        underforecastQty: daily.underforecast,
        skuCount: daily.skuCount,
      });
      const totals = unitTotals.get(unit) ?? {
        skuDays: 0, actual: 0, forecast: 0, planning: 0, booked: 0,
        error: 0, bookedError: 0, planningCovered: 0, underforecast: 0,
      };
      totals.skuDays += daily.skuCount;
      totals.actual += daily.actual;
      totals.forecast += daily.forecast;
      totals.planning += daily.planning;
      totals.booked += daily.booked;
      totals.error += daily.error;
      totals.bookedError += daily.bookedError;
      totals.planningCovered += daily.planningCovered;
      totals.underforecast += daily.underforecast;
      unitTotals.set(unit, totals);
    }
    totalSkuDays += keys.size;
  }

  const byUnit: DemandBacktestUnit[] = [...unitTotals].map(([unit, totals]) => ({
    unit,
    evaluatedSkuDays: totals.skuDays,
    actualQty: totals.actual,
    forecastQty: totals.forecast,
    planningQty: totals.planning,
    bookedOnlyQty: totals.booked,
    modelWape: percentError(totals.error, totals.actual),
    bookedOnlyWape: percentError(totals.bookedError, totals.actual),
    modelBiasPct: percentError(totals.forecast - totals.actual, totals.actual),
    planningCoveragePct: totals.skuDays ? totals.planningCovered * 100 / totals.skuDays : null,
    underforecastQty: totals.underforecast,
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
      "วัด Requested Qty ตามวันส่ง ไม่ใช่ยอดขายจริง และตัดสินที่เวลา 12:00 ของวันก่อนส่ง (เวลาไทย)",
      "WAPE คำนวณแยกตามหน่วยนับ (เช่น กก. และ ชิ้น) ไม่นำยอดคนละหน่วยมาบวกกัน",
      "P80 coverage วัดว่ายอดขอสั่งจริงไม่เกินแผน P80 ต่อ SKU/วันกี่เปอร์เซ็นต์ หากต่ำกว่า 80% ต่อเนื่องควรปรับเทียบใหม่",
      "แม้ทดสอบย้อนหลัง 28 วัน ยังไม่มี snapshot ออเดอร์ ณ เวลานั้นแบบครบถ้วน จึงควรใช้ผลเป็นสัญญาณเบื้องต้นเท่านั้น",
    ],
  };
}
