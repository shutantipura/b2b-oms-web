/**
 * Experimental fresh-meat purchasing decision layer.
 *
 * Demand remains a prediction. This module evaluates a hypothetical incoming
 * batch against the next replenishment day's demand and its three-day expiry.
 * It assumes ZERO older stock; do not use its output as an automatic PO.
 * Three-day customer events are sampled from forecast marginals, so the
 * probability estimates are model-based approximations, not calibrated SLAs.
 */
import {
  aggregateDemandDistribution,
  type DemandSizeOption,
  type ForecastDay,
  type ForecastRow,
  type StockForecast,
} from "./stockForecast.ts";

export const FRESH_MEAT_SHELF_LIFE_DAYS = 3;
export const MAX_SHORTAGE_PROBABILITY = 0.05;
export const STOCK_ORDER_SAMPLES = 8192;
const ORDER_STEP_KG = 0.1;

export type SkuEconomics = { price: number | null; cost: number | null };

export type StockOrderRecommendation = {
  sku: string;
  productName: string;
  unit: "กก.";
  deliveryDate: string;
  expectedDemandKg: number;
  originalP90Kg: number;
  recommendedOrderKg: number | null;
  shortageProbabilityPct: number | null;
  expiryProbabilityPct: number | null;
  expectedShortageKg: number | null;
  expectedExpiredKg: number | null;
  expectedFinancialLossBaht: number | null;
  sellingPriceBahtPerKg: number | null;
  costBahtPerKg: number | null;
  confidence: "limited" | "preliminary";
  status: "estimated" | "missing_price_or_cost" | "missing_three_day_forecast";
};

/**
 * Keep all official 10:00 demand figures unchanged. Forecasting an additional
 * delivery day can alter the model's lookahead (for example, when a customer
 * has already booked day 4). Only append the missing expiry day; never replace
 * the first three days in a frozen procurement snapshot.
 */
export function extendForecastForExpiry(base: StockForecast, extended: StockForecast): StockForecast {
  const finalDate = extended.dates[3];
  if (!finalDate) return base;
  const key = (row: ForecastRow) => JSON.stringify([row.customerId, row.sku, row.unit]);
  const extendedRows = new Map(extended.rows.map((row) => [key(row), row]));
  return {
    ...base,
    dates: [...base.dates.slice(0, 3), finalDate],
    rows: base.rows.map((row) => {
      const expiryDay = extendedRows.get(key(row))?.days[3];
      return expiryDay ? { ...row, days: [...row.days.slice(0, 3), expiryDay] } : row;
    }),
  };
}

function nonnegative(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function round(value: number, decimals = 3) {
  return Number(value.toFixed(decimals));
}

function ceilOrderQty(quantity: number) {
  return Math.max(0, Math.ceil((quantity - 1e-9) / ORDER_STEP_KG) * ORDER_STEP_KG);
}

function randomGenerator(seed: string) {
  let state = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    state ^= seed.charCodeAt(i);
    state = Math.imul(state, 16777619);
  }
  return () => {
    state += 0x6D2B79F5;
    let t = state;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function sampleAmount(day: ForecastDay, random: () => number) {
  const probability = Math.min(1, nonnegative(day.projectedProbability));
  if (random() >= probability) return 0;
  const options = (day.possibleSizes ?? []).filter((option: DemandSizeOption) =>
    Number.isFinite(option.quantity) && option.quantity > 0 && Number.isFinite(option.weight) && option.weight > 0
  );
  if (!options.length) return nonnegative(day.possibleQty);
  const weightSum = options.reduce((sum, option) => sum + option.weight, 0);
  let selected = random() * weightSum;
  for (const option of options) {
    selected -= option.weight;
    if (selected <= 0) return option.quantity;
  }
  return options.at(-1)!.quantity;
}

function lowerBound(sorted: number[], value: number) {
  let left = 0;
  let right = sorted.length;
  while (left < right) {
    const middle = (left + right) >>> 1;
    if (sorted[middle] < value) left = middle + 1;
    else right = middle;
  }
  return left;
}

function upperBound(sorted: number[], value: number) {
  let left = 0;
  let right = sorted.length;
  while (left < right) {
    const middle = (left + right) >>> 1;
    if (sorted[middle] <= value + 1e-9) left = middle + 1;
    else right = middle;
  }
  return left;
}

function prefixSums(values: number[]) {
  const sums = [0];
  for (const value of values) sums.push(sums.at(-1)! + value);
  return sums;
}

/**
 * A single new batch arriving tomorrow is sold strictly FIFO. With no older
 * inventory, later new arrivals cannot displace it; its remaining quantity
 * after three days is max(0, Q - total demand during those three days).
 * Shortage risk is measured until the NEXT daily replenishment opportunity.
 */
export function optimizeFreshMeatSku(
  sku: string,
  productName: string,
  rows: ForecastRow[],
  economics: SkuEconomics,
  deliveryDate: string,
  simulations = STOCK_ORDER_SAMPLES
): StockOrderRecommendation {
  const template = {
    sku, productName, unit: "กก." as const, deliveryDate,
    expectedDemandKg: round(rows.reduce((sum, row) => sum + nonnegative(row.days[1]?.totalQty), 0), 1),
    originalP90Kg: 0,
    recommendedOrderKg: null,
    shortageProbabilityPct: null,
    expiryProbabilityPct: null,
    expectedShortageKg: null,
    expectedExpiredKg: null,
    expectedFinancialLossBaht: null,
    sellingPriceBahtPerKg: economics.price,
    costBahtPerKg: economics.cost,
    confidence: (rows.some((row) => row.confidence === "low" || row.confidence === "insufficient") ? "limited" : "preliminary") as "limited" | "preliminary",
  };

  if (rows.some((row) => row.days.length < FRESH_MEAT_SHELF_LIFE_DAYS + 1)) {
    return { ...template, status: "missing_three_day_forecast" };
  }

  const firstDay = rows.map((row) => row.days[1]);
  const known = firstDay.reduce((sum, day) => sum + nonnegative(day.knownQty), 0);
  const possible = firstDay.map((day) => ({
    probability: nonnegative(day.projectedProbability),
    quantity: nonnegative(day.possibleQty),
    sizeOptions: day.possibleSizes,
  }));
  const originalP90Kg = ceilOrderQty(known + aggregateDemandDistribution(possible, 0.9).upper);
  const q95 = ceilOrderQty(known + aggregateDemandDistribution(possible, 1 - MAX_SHORTAGE_PROBABILITY).upper);

  // Seed does not use minute-by-minute asOf; identical inputs yield identical
  // simulations when staff refreshes the page.
  const random = randomGenerator(`${sku}:${deliveryDate}:fifo3:v1`);
  const dayOne = Array<number>(simulations);
  const threeDays = Array<number>(simulations);
  for (let sample = 0; sample < simulations; sample++) {
    let tomorrow = 0;
    let horizon = 0;
    for (const row of rows) {
      for (let dayIndex = 1; dayIndex <= FRESH_MEAT_SHELF_LIFE_DAYS; dayIndex++) {
        const day = row.days[dayIndex];
        const demand = nonnegative(day.knownQty) + sampleAmount(day, random);
        horizon += demand;
        if (dayIndex === 1) tomorrow += demand;
      }
    }
    dayOne[sample] = round(tomorrow);
    threeDays[sample] = round(horizon);
  }
  dayOne.sort((a, b) => a - b);
  threeDays.sort((a, b) => a - b);
  const oneSums = prefixSums(dayOne);
  const threeSums = prefixSums(threeDays);
  const count = dayOne.length;
  const maxTomorrow = dayOne.at(-1) ?? 0;

  const measure = (quantity: number) => {
    const oneCut = upperBound(dayOne, quantity);
    const expiredCut = lowerBound(threeDays, quantity);
    const shortageProbability = (count - oneCut) / count;
    const expiryProbability = expiredCut / count;
    const expectedShortage = Math.max(0, (oneSums[count] - oneSums[oneCut] - (count - oneCut) * quantity) / count);
    const expectedExpired = Math.max(0, (expiredCut * quantity - threeSums[expiredCut]) / count);
    return { shortageProbability, expiryProbability, expectedShortage, expectedExpired };
  };

  // Evaluate the loss at each probability-distribution kink. This is the
  // exact discrete optimum over our 0.1kg quantity grid for sampled scenarios.
  const candidates = new Set<number>([q95]);
  for (const amount of [...dayOne, ...threeDays]) {
    if (amount <= maxTomorrow + 1e-9 && amount >= q95 - 1e-9) candidates.add(ceilOrderQty(amount));
  }
  const validEconomics = economics.price !== null && Number.isFinite(economics.price) && economics.price > 0 &&
    economics.cost !== null && Number.isFinite(economics.cost) && economics.cost >= 0;
  const margin = validEconomics ? Math.max(0, economics.price! - economics.cost!) : 0;
  let selected = q95;
  let lowestLoss = Number.POSITIVE_INFINITY;
  for (const quantity of [...candidates].sort((a, b) => a - b)) {
    if (quantity < q95 - 1e-9) continue;
    const metrics = measure(quantity);
    if (metrics.shortageProbability > MAX_SHORTAGE_PROBABILITY + 1e-10) continue;
    const loss = validEconomics ? margin * metrics.expectedShortage + economics.cost! * metrics.expectedExpired : quantity;
    if (loss < lowestLoss - 1e-8) {
      lowestLoss = loss;
      selected = quantity;
    }
  }
  const metrics = measure(selected);
  return {
    ...template,
    originalP90Kg: round(originalP90Kg, 1),
    recommendedOrderKg: validEconomics ? round(selected, 1) : null,
    shortageProbabilityPct: round(metrics.shortageProbability * 100, 1),
    expiryProbabilityPct: round(metrics.expiryProbability * 100, 1),
    expectedShortageKg: round(metrics.expectedShortage),
    expectedExpiredKg: round(metrics.expectedExpired),
    expectedFinancialLossBaht: validEconomics ? round(lowestLoss, 2) : null,
    status: validEconomics ? "estimated" : "missing_price_or_cost",
  };
}

export function optimizeFreshMeatOrders(forecast: StockForecast, prices: Record<string, SkuEconomics>) {
  const bySku = new Map<string, ForecastRow[]>();
  for (const row of forecast.rows) {
    if (!row.freshMeat || row.unit !== "กก.") continue;
    const rows = bySku.get(row.sku) ?? [];
    rows.push(row);
    bySku.set(row.sku, rows);
  }
  return [...bySku].map(([sku, rows]) => optimizeFreshMeatSku(
    sku, rows[0].productName, rows, prices[sku] ?? { price: null, cost: null }, forecast.dates[1] ?? ""
  )).sort((a, b) => (b.recommendedOrderKg ?? 0) - (a.recommendedOrderKg ?? 0) || a.sku.localeCompare(b.sku));
}
