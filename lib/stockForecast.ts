/** Standalone helpers keep the forecasting model runnable in Node unit tests. */
function bangkokDateKey(value: Date | string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(value));
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function normalizeSalesUnit(unit: string, soldByKilogram: boolean) {
  if (soldByKilogram || /^(kg|kgs|kilogram|กก\.?|กิโลกรัม)$/i.test(unit.trim())) return "กก.";
  return unit.trim() || "ไม่ระบุ";
}

export const FORECAST_HISTORY_DAYS = 90;
export const FORECAST_DAYS = 3;

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
  productId: string;
  sku: string;
  productName: string;
  unit: string;
  category: string | null;
  actualQty: number | null;
  confirmedQty: number | null;
  requestedQty: number | null;
  actualPieceQty: number | null;
  piecePricePerKg: number | null;
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
  yesterdayActualQty: number;
  todayActualQty: number;
  days: ForecastDay[];
};

export type StockForecast = {
  asOf: string;
  yesterdayDate: string;
  dates: string[];
  historyDays: number;
  unmeasuredPieceOrders: number;
  rows: ForecastRow[];
};

export type ProductForecastRow = {
  sku: string;
  productName: string;
  unit: string;
  freshMeat: boolean;
  customerCount: number;
  yesterdayActualQty: number;
  todayActualQty: number;
  customers: ForecastRow[];
  days: ForecastDay[];
};

/** The stock order quantity is the sum across customers, keeping each unit separate. */
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
        yesterdayActualQty: 0,
        todayActualQty: 0,
        customers: [],
        days: dates.map((date) => ({ date, knownQty: 0, projectedQty: 0, totalQty: 0 })),
      };
      products.set(key, product);
    }
    product.customers.push(row);
    product.freshMeat ||= row.freshMeat;
    product.yesterdayActualQty += row.yesterdayActualQty ?? 0;
    product.todayActualQty += row.todayActualQty ?? 0;
    for (const day of row.days) {
      const aggregateDay = product.days.find((candidate) => candidate.date === day.date);
      if (!aggregateDay) continue;
      aggregateDay.knownQty += day.knownQty;
      aggregateDay.projectedQty += day.projectedQty;
    }
  }
  for (const product of products.values()) {
    product.customerCount = new Set(product.customers.map((row) => row.customerId)).size;
    product.yesterdayActualQty = clampQty(product.yesterdayActualQty);
    product.todayActualQty = clampQty(product.todayActualQty);
    product.customers.sort((a, b) => a.customerName.localeCompare(b.customerName, "th") || a.customerCode.localeCompare(b.customerCode));
    for (const day of product.days) {
      day.knownQty = clampQty(day.knownQty);
      day.projectedQty = clampQty(day.projectedQty);
      day.totalQty = clampQty(day.knownQty + day.projectedQty);
    }
  }
  return [...products.values()].sort((a, b) => a.sku.localeCompare(b.sku, "en") || a.unit.localeCompare(b.unit, "th"));
}

function addDays(date: string, count: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + count * 86_400_000).toISOString().slice(0, 10);
}

function daysBetween(early: string, later: string) {
  return Math.round((Date.parse(`${later}T00:00:00Z`) - Date.parse(`${early}T00:00:00Z`)) / 86_400_000);
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
  known: Map<string, number>
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
    const projectedQty = mostLikelyOrderQty(conditionalOrderProbability(age, periodicity), typicalQty);
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
  soldByDay: Map<string, number>;
  knownByDay: Map<string, number>;
};

export function buildStockForecast(
  orders: ForecastOrderInput[],
  items: ForecastItemInput[],
  customers: ForecastCustomerInput[],
  billedRootIds: Set<string>,
  asOf = new Date()
): StockForecast {
  const today = bangkokDateKey(asOf);
  const yesterdayDate = addDays(today, -1);
  const dates = Array.from({ length: FORECAST_DAYS }, (_, i) => addDays(today, i));
  const customerById = new Map(customers.filter((c) => !c.isTest).map((c) => [c.id, c]));
  const activeOrders = orders.filter((o) => o.status !== "cancelled" && customerById.has(o.customerId));
  const orderById = new Map(activeOrders.map((o) => [o.id, o]));
  const orderDates = new Map<string, string[]>();
  for (const order of activeOrders) {
    const orderDay = bangkokDateKey(order.createdAt);
    if (orderDay > today) continue;
    const days = orderDates.get(order.customerId) ?? [];
    days.push(orderDay);
    orderDates.set(order.customerId, days);
  }
  const customerCadence = new Map([...orderDates].map(([customerId, days]) => [customerId, averageInterval(days)]));

  // Pending piece-priced-by-weight lines are pieces, not kg. Estimate conversion
  // only when actual kg-per-piece history exists; otherwise do not invent weight.
  const kgPerPiece = new Map<string, { kg: number; pieces: number }>();
  for (const item of items) {
    const order = orderById.get(item.orderId);
    if (!order || !billedRootIds.has(order.groupRootOrderId || order.id)) continue;
    if (item.piecePricePerKg === null || !(item.actualQty! > 0) || !(item.actualPieceQty! > 0)) continue;
    const previous = kgPerPiece.get(item.productId) ?? { kg: 0, pieces: 0 };
    previous.kg += item.actualQty!;
    previous.pieces += item.actualPieceQty!;
    kgPerPiece.set(item.productId, previous);
  }

  const seriesByKey = new Map<string, Series>();
  let unmeasuredPieceOrders = 0;
  for (const item of items) {
    const order = orderById.get(item.orderId);
    if (!order) continue;
    const isWeighted = item.piecePricePerKg !== null;
    const unit = normalizeSalesUnit(item.unit, isWeighted);
    const key = JSON.stringify([order.customerId, item.sku, unit]);
    let series = seriesByKey.get(key);
    if (!series) {
      series = {
        customerId: order.customerId,
        sku: item.sku,
        productName: item.productName,
        unit,
        freshMeat: isFreshMeat(item.category, item.productName),
        soldByDay: new Map(),
        knownByDay: new Map(),
      };
      seriesByKey.set(key, series);
    }
    const serviceDate = order.deliveryDate || bangkokDateKey(order.createdAt);
    const root = order.groupRootOrderId || order.id;
    const sold = billedRootIds.has(root) && item.actualQty !== null && item.actualQty > 0;
    if (sold && serviceDate <= today) {
      series.soldByDay.set(serviceDate, (series.soldByDay.get(serviceDate) ?? 0) + item.actualQty!);
    }
    if (serviceDate < today || serviceDate > dates[dates.length - 1]) continue;
    let quantity = item.actualQty;
    if (quantity === null) {
      const requested = item.confirmedQty ?? item.requestedQty;
      if (requested === null || requested <= 0) continue;
      if (isWeighted) {
        const ratio = kgPerPiece.get(item.productId);
        if (!ratio || ratio.pieces <= 0) {
          unmeasuredPieceOrders++;
          continue;
        }
        quantity = requested * ratio.kg / ratio.pieces;
      } else {
        quantity = requested;
      }
    }
    if (quantity > 0) series.knownByDay.set(serviceDate, (series.knownByDay.get(serviceDate) ?? 0) + quantity);
  }

  const rows: ForecastRow[] = [];
  for (const series of seriesByKey.values()) {
    const customer = customerById.get(series.customerId)!;
    const yesterdayActualQty = clampQty(series.soldByDay.get(yesterdayDate) ?? 0);
    const todayActualQty = clampQty(series.soldByDay.get(today) ?? 0);
    const purchases = [...series.soldByDay.entries()].sort(([a], [b]) => a.localeCompare(b));
    const customerPeriod = customerCadence.get(series.customerId) ?? null;
    const skuObservedPeriod = averageInterval(purchases.map(([date]) => date));
    const purchaseFrequency = purchases.length / Math.max(1, new Set(orderDates.get(series.customerId) ?? []).size);
    const baseline = customerPeriod !== null ? customerPeriod / Math.max(0.15, purchaseFrequency) : null;
    const skuPeriod = skuObservedPeriod === null ? null
      : purchases.length < 4 && baseline !== null
        ? 0.75 * skuObservedPeriod + 0.25 * baseline
        : skuObservedPeriod;
    const effectivePeriod = skuPeriod === null ? null : Math.max(1, series.freshMeat ? Math.min(2, skuPeriod) : skuPeriod);
    const typicalPurchasedQty = weightedAverage(purchases.map(([, qty]) => qty)) ?? 0;
    const typicalCycleQty = skuPeriod !== null && effectivePeriod !== null
      ? typicalPurchasedQty * effectivePeriod / skuPeriod
      : 0;
    const confidence = purchases.length >= 7 ? "high" : purchases.length >= 4 ? "medium" : purchases.length >= 2 ? "low" : "insufficient";
    const lastPurchaseDate = purchases.at(-1)?.[0];
    const forecastDays = lastPurchaseDate && effectivePeriod !== null
      ? dailyDemandForecast(dates, lastPurchaseDate, effectivePeriod, typicalCycleQty, series.knownByDay)
      : dates.map((date) => ({
          date,
          knownQty: clampQty(series.knownByDay.get(date) ?? 0),
          projectedQty: 0,
          totalQty: clampQty(series.knownByDay.get(date) ?? 0),
        }));
    // Keep yesterday's sales visible even if this SKU has no three-day forecast.
    if (forecastDays.every((day) => day.totalQty === 0) && yesterdayActualQty === 0 && todayActualQty === 0) continue;
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
      yesterdayActualQty,
      todayActualQty,
      days: forecastDays,
    });
  }

  rows.sort((a, b) => a.customerName.localeCompare(b.customerName, "th") || a.sku.localeCompare(b.sku, "en"));
  return { asOf: asOf.toISOString(), yesterdayDate, dates, historyDays: FORECAST_HISTORY_DAYS, unmeasuredPieceOrders, rows };
}
