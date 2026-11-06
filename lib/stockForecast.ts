/** Standalone helpers keep the forecasting model runnable in Node unit tests. */
export function bangkokDateKey(value: Date | string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(value));
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function normalizeDemandUnit(unit: string) {
  if (/^(kg|kgs|kilogram|กก\.?|กิโลกรัม)$/i.test(unit.trim())) return "กก.";
  return unit.trim() || "ไม่ระบุ";
}

export const FORECAST_HISTORY_DAYS = 90;
export const FORECAST_DAYS = 3;
const MIN_ORDER_TIMING_SAMPLES = 3;
const MAX_ORDER_TIMING_SAMPLES = 12;

export type ForecastOrderInput = {
  id: string;
  customerId: string;
  createdAt: string;
  deliveryDate: string | null;
  status: string;
  groupRootOrderId: string | null;
};

export type ForecastItemInput = {
  orderId: string;
  sku: string;
  productName: string;
  unit: string;
  category: string | null;
  requestedQty: number | null;
};

export type ForecastCustomerInput = {
  id: string;
  code: string;
  name: string;
  isTest: boolean;
};

export type ForecastDay = {
  date: string;
  knownQty: number;
  projectedQty: number;
  totalQty: number;
};

export type ForecastRow = {
  customerId: string;
  customerCode: string;
  customerName: string;
  sku: string;
  productName: string;
  unit: string;
  freshMeat: boolean;
  customerCadenceDays: number | null;
  skuCadenceDays: number | null;
  effectiveCadenceDays: number | null;
  purchaseDays: number;
  confidence: "high" | "medium" | "low" | "insufficient";
  /** Typical order creation time in minutes relative to midnight on the delivery date (Bangkok). */
  customerUsualOrderOffsetMinutes: number | null;
  customerOrderTimingSamples: number;
  yesterdayRequestedQty: number;
  todayRequestedQty: number;
  days: ForecastDay[];
};

export type StockForecast = {
  asOf: string;
  yesterdayDate: string;
  dates: string[];
  historyDays: number;
  rows: ForecastRow[];
};

export type ProductForecastRow = {
  sku: string;
  productName: string;
  unit: string;
  freshMeat: boolean;
  customerCount: number;
  yesterdayRequestedQty: number;
  todayRequestedQty: number;
  customers: ForecastRow[];
  days: ForecastDay[];
};

/** Demand totals sum original requested quantities across customers, keeping each unit separate. */
export function aggregateForecastByProduct(rows: ForecastRow[], dates: string[]): ProductForecastRow[] {
  const products = new Map<string, ProductForecastRow>();
  for (const row of rows) {
    const key = JSON.stringify([row.sku, row.unit]);
    let product = products.get(key);
    if (!product) {
      product = {
        sku: row.sku,
        productName: row.productName,
        unit: row.unit,
        freshMeat: row.freshMeat,
        customerCount: 0,
        yesterdayRequestedQty: 0,
        todayRequestedQty: 0,
        customers: [],
        days: dates.map((date) => ({ date, knownQty: 0, projectedQty: 0, totalQty: 0 })),
      };
      products.set(key, product);
    }
    product.customers.push(row);
    product.freshMeat ||= row.freshMeat;
    product.yesterdayRequestedQty += row.yesterdayRequestedQty ?? 0;
    product.todayRequestedQty += row.todayRequestedQty ?? 0;
    for (const day of row.days) {
      const aggregateDay = product.days.find((candidate) => candidate.date === day.date);
      if (!aggregateDay) continue;
      aggregateDay.knownQty += day.knownQty;
      aggregateDay.projectedQty += day.projectedQty;
    }
  }
  for (const product of products.values()) {
    product.customerCount = new Set(product.customers.map((row) => row.customerId)).size;
    product.yesterdayRequestedQty = clampQty(product.yesterdayRequestedQty);
    product.todayRequestedQty = clampQty(product.todayRequestedQty);
    product.customers.sort((a, b) => a.customerName.localeCompare(b.customerName, "th") || a.customerCode.localeCompare(b.customerCode));
    for (const day of product.days) {
      day.knownQty = clampQty(day.knownQty);
      day.projectedQty = clampQty(day.projectedQty);
      day.totalQty = clampQty(day.knownQty + day.projectedQty);
    }
  }
  // Prioritise tomorrow's largest requested demand, rather than alphabetical SKU order.
  return [...products.values()].sort((a, b) =>
    (b.days[1]?.totalQty ?? 0) - (a.days[1]?.totalQty ?? 0) ||
    a.sku.localeCompare(b.sku, "en") ||
    a.unit.localeCompare(b.unit, "th")
  );
}

function addDays(date: string, count: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + count * 86_400_000).toISOString().slice(0, 10);
}

function daysBetween(early: string, later: string) {
  return Math.round((Date.parse(`${later}T00:00:00Z`) - Date.parse(`${early}T00:00:00Z`)) / 86_400_000);
}

/** Bangkok has UTC+07:00 year-round; this is midnight on the customer's delivery date. */
function deliveryMidnightMillis(deliveryDate: string) {
  return Date.parse(`${deliveryDate}T00:00:00+07:00`);
}

/**
 * A typical submission time is measured relative to the *delivery day*, not
 * the order day. For example, -120 means 22:00 on the previous evening;
 * +780 means 13:00 on the delivery date.
 */
function orderOffsetMinutes(createdAt: string, deliveryDate: string) {
  return Math.round((Date.parse(createdAt) - deliveryMidnightMillis(deliveryDate)) / 60_000);
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/** Label a typical order time relative to the delivery day, in Bangkok time. */
export function describeCustomerOrderTime(offsetMinutes: number | null, sampleCount: number) {
  if (offsetMinutes === null || sampleCount < MIN_ORDER_TIMING_SAMPLES) return "ข้อมูลยังไม่พอ";
  const dayOffset = Math.floor(offsetMinutes / 1440);
  const minutesOfDay = ((offsetMinutes % 1440) + 1440) % 1440;
  const clock = `${String(Math.floor(minutesOfDay / 60)).padStart(2, "0")}:${String(minutesOfDay % 60).padStart(2, "0")}`;
  if (dayOffset === 0) return `วันส่ง ${clock}`;
  if (dayOffset === -1) return `วันก่อนส่ง ${clock}`;
  if (dayOffset < 0) return `${-dayOffset} วันก่อนส่ง ${clock}`;
  return `หลังวันส่ง ${dayOffset} วัน ${clock}`;
}

/**
 * Fraction of this customer's past orders that could still be submitted for
 * the specified delivery day. This updates continuously as the clock moves.
 * Sparse histories do not impose a speculative cutoff.
 */
export function remainingOrderWindowShare(asOf: Date, deliveryDate: string, historicalOffsets: number[]) {
  if (historicalOffsets.length < MIN_ORDER_TIMING_SAMPLES) return 1;
  const elapsed = (asOf.getTime() - deliveryMidnightMillis(deliveryDate)) / 60_000;
  return historicalOffsets.filter((offset) => offset >= elapsed).length / historicalOffsets.length;
}

/** Category alone is unsafe: "meat and seafood" also contains fish and eggs. */
export function isFreshMeat(category: string | null, productName: string) {
  const group = (category ?? "").trim().toLowerCase();
  if (/frozen|แช่แข็ง|\(f\)/i.test(productName)) return false;
  if (group === "fresh meat") return true;
  if (group !== "เนื้อสัตว์และอาหารทะเล") return false;
  if (/ไข่|ปลา|กุ้ง|หมึก|ปู|seafood|fish|shrimp|squid|egg|frozen|แช่แข็ง|\(f\)/i.test(productName)) return false;
  return /หมู|ไก่|วัว|เนื้อโค|เนื้อบด|เป็ด|คากิ|ขาหลัง|สันนอก|สันใน|สะโพก|ปีกกลาง|pork|chicken|beef|duck/i.test(productName);
}

function weightedAverage(numbers: number[]) {
  if (!numbers.length) return null;
  const recent = numbers.slice(-8);
  const weight = recent.reduce((sum, _, index) => sum + index + 1, 0);
  return recent.reduce((sum, n, index) => sum + n * (index + 1), 0) / weight;
}

function averageInterval(dateKeys: string[]) {
  const days = [...new Set(dateKeys)].sort();
  if (days.length < 2) return null;
  return weightedAverage(days.slice(1).map((date, index) => Math.max(1, daysBetween(days[index], date))));
}

function clampQty(qty: number) {
  return Math.round(Math.max(0, qty) * 1000) / 1000;
}

function conditionalOrderProbability(age: number, periodicity: number) {
  if (age < 1) return 0;
  const spread = Math.max(0.45, Math.min(1.8, periodicity * 0.22));
  const centered = periodicity - 0.4;
  let probability = 1 / (1 + Math.exp(-(age - centered) / spread));
  // A long silence is evidence that a repeat customer might have stopped buying.
  if (age > periodicity * 2 + 2) {
    probability *= Math.exp(-(age - (periodicity * 2 + 2)) / Math.max(2, periodicity * 1.8));
  }
  return Math.min(0.97, probability);
}

/** Modal demand: select the more likely of a full order and no order. */
export function mostLikelyOrderQty(orderProbability: number, typicalOrderQty: number) {
  return orderProbability > 0.5 ? clampQty(typicalOrderQty) : 0;
}

function dailyDemandForecast(
  dates: string[],
  lastPurchaseDate: string,
  periodicity: number,
  typicalQty: number,
  known: Map<string, number>,
  historicalOrderOffsets: number[],
  asOf: Date
): ForecastDay[] {
  let age = Math.max(0, daysBetween(lastPurchaseDate, dates[0]));
  const nextBookedDate = dates.find((date) => (known.get(date) ?? 0) > 0);
  return dates.map((date) => {
    const knownQty = known.get(date) ?? 0;
    if (knownQty > 0) {
      age = 1;
      return { date, knownQty: clampQty(knownQty), projectedQty: 0, totalQty: clampQty(knownQty) };
    }
    // A future order already placed by this customer replaces the speculative
    // order in the preceding days; do not predict a second order before it.
    if (nextBookedDate && date < nextBookedDate) {
      age += 1;
      return { date, knownQty: 0, projectedQty: 0, totalQty: 0 };
    }
    const stillPossible = remainingOrderWindowShare(asOf, date, historicalOrderOffsets);
    const projectedQty = mostLikelyOrderQty(conditionalOrderProbability(age, periodicity) * stillPossible, typicalQty);
    // A modal order becomes the new purchase date for subsequent forecast days.
    age = projectedQty > 0 ? 1 : age + 1;
    return { date, knownQty: 0, projectedQty, totalQty: projectedQty };
  });
}

type Series = {
  customerId: string;
  sku: string;
  productName: string;
  unit: string;
  freshMeat: boolean;
  requestedByDay: Map<string, number>;
  knownByDay: Map<string, number>;
};

export function buildStockForecast(
  orders: ForecastOrderInput[],
  items: ForecastItemInput[],
  customers: ForecastCustomerInput[],
  asOf = new Date()
): StockForecast {
  const today = bangkokDateKey(asOf);
  const yesterdayDate = addDays(today, -1);
  const dates = Array.from({ length: FORECAST_DAYS }, (_, i) => addDays(today, i));
  const historyStartDate = addDays(today, -FORECAST_HISTORY_DAYS);
  const customerById = new Map(customers.filter((c) => !c.isTest).map((c) => [c.id, c]));
  const activeOrders = orders.filter((o) =>
    o.status !== "cancelled" &&
    customerById.has(o.customerId) &&
    o.deliveryDate !== null &&
    o.deliveryDate >= historyStartDate &&
    o.deliveryDate <= dates[dates.length - 1] &&
    Number.isFinite(Date.parse(o.createdAt)) &&
    Date.parse(o.createdAt) <= asOf.getTime()
  );
  const orderById = new Map(activeOrders.map((o) => [o.id, o]));
  const orderDates = new Map<string, string[]>();
  const customerOrderOffsets = new Map<string, { deliveryDate: string; offsetMinutes: number }[]>();
  for (const order of activeOrders) {
    // Frequency and lead-time history both use the requested delivery date.
    const orderDay = order.deliveryDate!;
    if (orderDay > today) continue;
    const days = orderDates.get(order.customerId) ?? [];
    days.push(orderDay);
    orderDates.set(order.customerId, days);
    const offsetMinutes = orderOffsetMinutes(order.createdAt, orderDay);
    if (Number.isFinite(offsetMinutes) && offsetMinutes <= 24 * 60) {
      const offsets = customerOrderOffsets.get(order.customerId) ?? [];
      offsets.push({ deliveryDate: orderDay, offsetMinutes });
      customerOrderOffsets.set(order.customerId, offsets);
    }
  }
  const customerCadence = new Map([...orderDates].map(([customerId, days]) => [customerId, averageInterval(days)]));
  const timingHistory = new Map([...customerOrderOffsets].map(([customerId, observations]) => [
    customerId,
    observations.sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate)).slice(-MAX_ORDER_TIMING_SAMPLES).map((o) => o.offsetMinutes),
  ]));

  const seriesByKey = new Map<string, Series>();
  for (const item of items) {
    const order = orderById.get(item.orderId);
    if (!order) continue;
    // Demand is the quantity originally requested at checkout. Stock checks,
    // picking, billing and stockouts must not reduce it.
    const quantity = item.requestedQty;
    if (quantity === null || !Number.isFinite(quantity) || quantity <= 0) continue;
    // Items requested in pieces must remain pieces, even when the eventual
    // bill is calculated by weight. Never fabricate a kg conversion.
    const unit = normalizeDemandUnit(item.unit);
    const key = JSON.stringify([order.customerId, item.sku, unit]);
    let series = seriesByKey.get(key);
    if (!series) {
      series = {
        customerId: order.customerId,
        sku: item.sku,
        productName: item.productName,
        unit,
        freshMeat: isFreshMeat(item.category, item.productName),
        requestedByDay: new Map(),
        knownByDay: new Map(),
      };
      seriesByKey.set(key, series);
    }
    const serviceDate = order.deliveryDate!;
    if (serviceDate <= today) {
      series.requestedByDay.set(serviceDate, (series.requestedByDay.get(serviceDate) ?? 0) + quantity);
    }
    if (serviceDate < today || serviceDate > dates[dates.length - 1]) continue;
    series.knownByDay.set(serviceDate, (series.knownByDay.get(serviceDate) ?? 0) + quantity);
  }

  const rows: ForecastRow[] = [];
  for (const series of seriesByKey.values()) {
    const customer = customerById.get(series.customerId)!;
    const orderOffsets = timingHistory.get(series.customerId) ?? [];
    const yesterdayRequestedQty = clampQty(series.requestedByDay.get(yesterdayDate) ?? 0);
    const todayRequestedQty = clampQty(series.requestedByDay.get(today) ?? 0);
    const purchases = [...series.requestedByDay.entries()].sort(([a], [b]) => a.localeCompare(b));
    const customerPeriod = customerCadence.get(series.customerId) ?? null;
    const skuObservedPeriod = averageInterval(purchases.map(([date]) => date));
    const purchaseFrequency = purchases.length / Math.max(1, new Set(orderDates.get(series.customerId) ?? []).size);
    const baseline = customerPeriod !== null ? customerPeriod / Math.max(0.15, purchaseFrequency) : null;
    const skuPeriod = skuObservedPeriod === null ? null
      : purchases.length < 4 && baseline !== null
        ? 0.75 * skuObservedPeriod + 0.25 * baseline
        : skuObservedPeriod;
    const effectivePeriod = skuPeriod === null ? null : Math.max(1, series.freshMeat ? Math.min(2, skuPeriod) : skuPeriod);
    const typicalRequestedQty = weightedAverage(purchases.map(([, qty]) => qty)) ?? 0;
    const typicalCycleQty = skuPeriod !== null && effectivePeriod !== null
      ? typicalRequestedQty * effectivePeriod / skuPeriod
      : 0;
    const confidence = purchases.length >= 7 ? "high" : purchases.length >= 4 ? "medium" : purchases.length >= 2 ? "low" : "insufficient";
    const lastPurchaseDate = purchases.at(-1)?.[0];
    const forecastDays = lastPurchaseDate && effectivePeriod !== null
      ? dailyDemandForecast(dates, lastPurchaseDate, effectivePeriod, typicalCycleQty, series.knownByDay, orderOffsets, asOf)
      : dates.map((date) => ({
          date,
          knownQty: clampQty(series.knownByDay.get(date) ?? 0),
          projectedQty: 0,
          totalQty: clampQty(series.knownByDay.get(date) ?? 0),
        }));
    // Keep yesterday's requests visible even if there is no forward prediction.
    if (forecastDays.every((day) => day.totalQty === 0) && yesterdayRequestedQty === 0 && todayRequestedQty === 0) continue;
    rows.push({
      customerId: series.customerId,
      customerCode: customer.code,
      customerName: customer.name,
      sku: series.sku,
      productName: series.productName,
      unit: series.unit,
      freshMeat: series.freshMeat,
      customerCadenceDays: customerPeriod === null ? null : Math.round(customerPeriod * 10) / 10,
      skuCadenceDays: skuPeriod === null ? null : Math.round(skuPeriod * 10) / 10,
      effectiveCadenceDays: effectivePeriod === null ? null : Math.round(effectivePeriod * 10) / 10,
      purchaseDays: purchases.length,
      confidence,
      customerUsualOrderOffsetMinutes: median(orderOffsets),
      customerOrderTimingSamples: orderOffsets.length,
      yesterdayRequestedQty,
      todayRequestedQty,
      days: forecastDays,
    });
  }

  rows.sort((a, b) => a.customerName.localeCompare(b.customerName, "th") || a.sku.localeCompare(b.sku, "en"));
  return { asOf: asOf.toISOString(), yesterdayDate, dates, historyDays: FORECAST_HISTORY_DAYS, rows };
}
