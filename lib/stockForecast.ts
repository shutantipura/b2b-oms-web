/** Standalone helpers keep the forecasting model runnable in Node unit tests. */
export function bangkokDateKey(value: Date | string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(value));
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function normalizeDemandUnit(unit: string) {
  if (/^(kg|kgs|kilogram|กก\.?|กิโลกรัม)$/i.test(unit.trim())) return "กก.";
  return unit.trim() || "ไม่ระบุ";
}

export const FORECAST_HISTORY_DAYS = 90;
export const FORECAST_DAYS = 3;
const MIN_ORDER_TIMING_SAMPLES = 3;
const MAX_ORDER_TIMING_SAMPLES = 12;
const HAZARD_PRIOR_WEIGHT = 3;
const MAX_AGGREGATE_STATES = 4096;

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
  /** Product-master selling unit, distinct from the customer's order unit. */
  masterUnit?: string | null;
  category: string | null;
  requestedQty: number | null;
  confirmedQty?: number | null;
  actualQty?: number | null;
  actualPieceQty?: number | null;
  piecePricePerKg?: number | null;
  updatedAt?: string | null;
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
  /** Probability of additional requested demand; known orders are always exact. */
  projectedProbability?: number;
  /** Quantity of one possible additional order, conditional on it occurring. */
  possibleQty?: number;
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
  /** P(this unit | this customer requests this SKU), based on recent requested orders. */
  conditionalUnitShare: number;
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
  /** Original unit is preserved in OMS; only the demand estimate is normalised. */
  weightConversions: Record<string, PieceWeightConversion>;
  originalPieceDemand: Record<string, { yesterday: number; today: number }>;
  missingWeightConversions: string[];
};

export type PieceWeightConversion = {
  kgPerPiece: number;
  sampleCount: number;
  source: "measured" | "legacy_estimate";
  confidence: "medium" | "low";
};

/** Converts to kg only where the SKU has a defensible, as-of-time weight estimate. */
export function normaliseForecastQuantity(
  sku: string, unit: string, requestedQty: number, conversions: Record<string, PieceWeightConversion>
) {
  const originalUnit = normalizeDemandUnit(unit);
  const conversion = conversions[sku];
  return conversion && originalUnit === "ชิ้น"
    ? { unit: "กก.", quantity: clampQty(requestedQty * conversion.kgPerPiece) }
    : { unit: originalUnit, quantity: requestedQty };
}

export type ProductForecastRow = {
  sku: string;
  productName: string;
  freshMeat: boolean;
  customerCount: number;
  /** A single physical SKU card; values with different units are never added. */
  units: ProductForecastUnitRow[];
};

export type ProductForecastUnitRow = {
  unit: string;
  yesterdayRequestedQty: number;
  todayRequestedQty: number;
  customers: ForecastRow[];
  days: ForecastDay[];
};

/**
 * Mode of the *sum* of independent customer demands. Summing customer modes
 * is mathematically wrong: ten 40%-likely 1kg requests have individual modes
 * of zero, while their total mode is 4kg.
 *
 * Convolve at the stored 0.001-unit precision, rounding only the resulting
 * aggregate to one decimal. Rounding each customer's 0.05kg basket first would
 * distort the most likely total. Bound states for unusually broad baskets.
 */
export function mostLikelyAggregateQty(candidates: { probability: number; quantity: number }[]) {
  let states = new Map<number, number>([[0, 1]]);
  for (const candidate of candidates) {
    const probability = Math.min(1, Math.max(0, candidate.probability));
    const quantity = Math.max(0, Math.round(candidate.quantity * 1000));
    if (!quantity || probability <= 0) continue;
    const next = new Map<number, number>();
    for (const [total, mass] of states) {
      next.set(total, (next.get(total) ?? 0) + mass * (1 - probability));
      next.set(total + quantity, (next.get(total + quantity) ?? 0) + mass * probability);
    }
    if (next.size <= MAX_AGGREGATE_STATES) {
      states = next;
    } else {
      // Retain the most likely totals, then renormalise. This bound prevents
      // rare, highly variable demand from exhausting memory in a serverless run.
      const top = [...next.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_AGGREGATE_STATES);
      const retainedMass = top.reduce((sum, [, mass]) => sum + mass, 0);
      states = new Map(top.map(([total, mass]) => [total, mass / retainedMass]));
    }
  }
  let bestTotal = 0;
  let bestMass = -1;
  for (const [total, mass] of states) {
    if (mass > bestMass + 1e-12 || (Math.abs(mass - bestMass) <= 1e-12 && total < bestTotal)) {
      bestTotal = total;
      bestMass = mass;
    }
  }
  return Math.round(bestTotal / 100) / 10;
}

/** Demand totals sum original requested quantities across customers, keeping each unit separate. */
export function aggregateForecastByProduct(rows: ForecastRow[], dates: string[]): ProductForecastRow[] {
  const products = new Map<string, ProductForecastRow>();
  const candidatesByUnitDate = new Map<string, Map<string, { probability: number; quantity: number }[]>>();
  for (const row of rows) {
    let product = products.get(row.sku);
    if (!product) {
      product = {
        sku: row.sku,
        productName: row.productName,
        freshMeat: row.freshMeat,
        customerCount: 0,
        units: [],
      };
      products.set(row.sku, product);
    }
    let unitRow = product.units.find((entry) => entry.unit === row.unit);
    if (!unitRow) {
      unitRow = {
        unit: row.unit,
        yesterdayRequestedQty: 0,
        todayRequestedQty: 0,
        customers: [],
        days: dates.map((date) => ({ date, knownQty: 0, projectedQty: 0, totalQty: 0 })),
      };
      product.units.push(unitRow);
    }
    unitRow.customers.push(row);
    product.freshMeat ||= row.freshMeat;
    unitRow.yesterdayRequestedQty += row.yesterdayRequestedQty ?? 0;
    unitRow.todayRequestedQty += row.todayRequestedQty ?? 0;
    for (const day of row.days) {
      const aggregateDay = unitRow.days.find((candidate) => candidate.date === day.date);
      if (!aggregateDay) continue;
      aggregateDay.knownQty += day.knownQty;
      aggregateDay.projectedQty += day.projectedQty;
      if (day.projectedProbability !== undefined && day.possibleQty !== undefined) {
        const key = JSON.stringify([row.sku, row.unit]);
        let days = candidatesByUnitDate.get(key);
        if (!days) {
          days = new Map();
          candidatesByUnitDate.set(key, days);
        }
        const candidates = days.get(day.date) ?? [];
        candidates.push({ probability: day.projectedProbability, quantity: day.possibleQty });
        days.set(day.date, candidates);
      }
    }
  }
  for (const product of products.values()) {
    product.customerCount = new Set(product.units.flatMap((unit) => unit.customers.map((row) => row.customerId))).size;
    product.units.sort((a, b) => a.unit.localeCompare(b.unit, "th"));
    for (const unit of product.units) {
      unit.yesterdayRequestedQty = clampQty(unit.yesterdayRequestedQty);
      unit.todayRequestedQty = clampQty(unit.todayRequestedQty);
      unit.customers.sort((a, b) => a.customerName.localeCompare(b.customerName, "th") || a.customerCode.localeCompare(b.customerCode));
      for (const day of unit.days) {
        day.knownQty = clampQty(day.knownQty);
        const candidates = candidatesByUnitDate.get(JSON.stringify([product.sku, unit.unit]))?.get(day.date);
        if (candidates) day.projectedQty = mostLikelyAggregateQty(candidates);
        day.projectedQty = clampQty(day.projectedQty);
        day.totalQty = clampQty(day.knownQty + day.projectedQty);
      }
    }
  }
  // Sort by the largest tomorrow demand in a *single* unit; kg and pieces are incomparable.
  return [...products.values()].sort((a, b) =>
    Math.max(0, ...b.units.map((unit) => unit.days[1]?.totalQty ?? 0)) -
    Math.max(0, ...a.units.map((unit) => unit.days[1]?.totalQty ?? 0)) ||
    a.sku.localeCompare(b.sku, "en")
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

/** A typical requested basket should resemble an actual basket, not the mean of outliers. */
export function recencyWeightedMedian(numbers: number[]) {
  if (!numbers.length) return null;
  const recent = numbers.slice(-8);
  const ranked = recent.map((value, i) => ({ value, weight: i + 1 })).sort((a, b) => a.value - b.value);
  const midpoint = recent.length * (recent.length + 1) / 4;
  let accumulated = 0;
  for (const entry of ranked) {
    accumulated += entry.weight;
    if (accumulated >= midpoint) return entry.value;
  }
  return ranked.at(-1)!.value;
}

/**
 * Weight per piece is a physical conversion factor, not an ordering preference.
 * A conventional median of the last seven measured lines keeps it responsive to
 * genuine size changes without giving a few unusually heavy recent carcasses
 * the disproportionate influence of the order-quantity recency weighting.
 */
function typicalKgPerPiece(ratiosChronological: number[]) {
  const recent = ratiosChronological.slice(-7).sort((a, b) => a - b);
  if (!recent.length) return null;
  const middle = Math.floor(recent.length / 2);
  return recent.length % 2 ? recent[middle] : (recent[middle - 1] + recent[middle]) / 2;
}

function purchaseIntervals(dateKeys: string[]) {
  const days = [...new Set(dateKeys)].sort();
  return days.slice(1).map((date, index) => Math.max(1, daysBetween(days[index], date)));
}

function averageInterval(dateKeys: string[]) {
  return weightedAverage(purchaseIntervals(dateKeys));
}

function clampQty(qty: number) {
  return Math.round(Math.max(0, qty) * 1000) / 1000;
}

/** Probability of another delivery-day order, conditional on days since the last one. */
export function conditionalOrderProbability(age: number, periodicity: number) {
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

/**
 * Empirical probability of reordering at this age, given no reorder earlier.
 * Completed intervals shorter than age are no longer at risk. Shrink sparse
 * counts towards the existing smooth cadence curve rather than fitting noise.
 */
export function observedRepeatProbability(age: number, periodicity: number, intervals: number[]) {
  const prior = conditionalOrderProbability(age, periodicity);
  if (!intervals.length || age < 1) return prior;
  const atRisk = intervals.filter((gap) => gap >= age).length;
  const events = intervals.filter((gap) => gap === age).length;
  return (events + HAZARD_PRIOR_WEIGHT * prior) / (atRisk + HAZARD_PRIOR_WEIGHT);
}

/**
 * Bayes' rule after observing that the customer has NOT yet submitted an order.
 * Naively multiplying p by the remaining share overstates the negative signal:
 * if p=0.8 and 80% usually order early, 20% may still order later, but the
 * observation of no early order also makes a no-order day more likely.
 */
export function probabilityAfterNoOrderYet(prior: number, remainingShare: number) {
  const p = Math.max(0, Math.min(1, prior));
  const remaining = Math.max(0, Math.min(1, remainingShare));
  const noArrivalLikelihood = 1 - p * (1 - remaining);
  if (noArrivalLikelihood <= 1e-12) return 0;
  return p * remaining / noArrivalLikelihood;
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
  asOf: Date,
  historicalIntervals: number[],
  customerOrderPlan?: ForecastDay[],
  skuEvidenceWeight = 1
): ForecastDay[] {
  // Track all possible days-since-last-purchase states. Resetting only after
  // a modal (>50%) event makes two-day forecasts artificially deterministic.
  let ageStates = new Map<number, number>([[Math.max(0, daysBetween(lastPurchaseDate, dates[0])), 1]]);
  const nextBookedDate = dates.find((date) => (known.get(date) ?? 0) > 0);
  return dates.map((date) => {
    const knownQty = known.get(date) ?? 0;
    if (knownQty > 0) {
      ageStates = new Map([[1, 1]]);
      return { date, knownQty: clampQty(knownQty), projectedQty: 0, totalQty: clampQty(knownQty), projectedProbability: 0, possibleQty: 0 };
    }
    // A future order already placed by this customer replaces the speculative
    // order in the preceding days; do not predict a second order before it.
    if (nextBookedDate && date < nextBookedDate) {
      ageStates = new Map([...ageStates].map(([age, probability]) => [age + 1, probability]));
      return { date, knownQty: 0, projectedQty: 0, totalQty: 0, projectedProbability: 0, possibleQty: 0 };
    }
    const parentProbability = customerOrderPlan?.find((day) => day.date === date)?.projectedProbability ?? 0;
    const remainingShare = customerOrderPlan ? 1 : remainingOrderWindowShare(asOf, date, historicalOrderOffsets);
    const nextStates = new Map<number, number>();
    let projectedProbability = 0;
    for (const [age, stateMass] of ageStates) {
      const priorProbability = observedRepeatProbability(age, periodicity, historicalIntervals);
      // SKU purchases are a subset of the customer's baskets. Neither a hard
      // customer-level cutoff nor multiplying two marginal probabilities is
      // appropriate; cap SKU demand by the chance of any customer basket.
      const eventProbability = customerOrderPlan
        ? Math.min(parentProbability, priorProbability) * skuEvidenceWeight
        : probabilityAfterNoOrderYet(priorProbability, remainingShare);
      projectedProbability += stateMass * eventProbability;
      nextStates.set(1, (nextStates.get(1) ?? 0) + stateMass * eventProbability);
      nextStates.set(age + 1, (nextStates.get(age + 1) ?? 0) + stateMass * (1 - eventProbability));
    }
    ageStates = nextStates;
    const projectedQty = mostLikelyOrderQty(projectedProbability, typicalQty);
    return { date, knownQty: 0, projectedQty, totalQty: projectedQty, projectedProbability, possibleQty: clampQty(typicalQty) };
  });
}

type Series = {
  customerId: string;
  sku: string;
  productName: string;
  freshMeat: boolean;
  /** The repeat-order clock belongs to the SKU, regardless of its order unit. */
  units: Map<string, UnitSeries>;
  knownSkuDays: Map<string, number>;
};

type UnitSeries = {
  unit: string;
  requestedByDay: Map<string, number>;
  knownByDay: Map<string, number>;
};

/**
 * Unit is a conditional choice AFTER an SKU-order event, not a second event.
 * Use only the last eight *delivery days*, weighted towards recent choices.
 * A small pseudocount prevents a single switching day from giving 100% odds.
 * If only one unit has ever been requested, it receives the entire share.
 */
function conditionalUnitShares(series: Series) {
  const dates = [...new Set([...series.units.values()].flatMap((unit) => [...unit.requestedByDay.keys()]))]
    .sort().slice(-8);
  const eligible = [...series.units.values()].filter((unit) => unit.requestedByDay.size > 0);
  const weights = new Map(eligible.map((unit) => [unit.unit, 0.5]));
  for (let index = 0; index < dates.length; index++) {
    const observed = eligible.filter((unit) => (unit.requestedByDay.get(dates[index]) ?? 0) > 0);
    for (const unit of observed) weights.set(unit.unit, (weights.get(unit.unit) ?? 0) + (index + 1) / observed.length);
  }
  const total = [...weights.values()].reduce((sum, weight) => sum + weight, 0);
  return new Map([...weights].map(([unit, weight]) => [unit, total ? weight / total : 0]));
}

/**
 * Estimate kg/pc from actual weighing of previously picked pieces. Prefer
 * recorded piece counts; older records with no count can only provide a weak
 * estimate when the full confirmed piece count was requested. Never use a
 * picking measurement written after the forecast's as-of timestamp (backtest
 * leakage), or assume that a stockout's picked kg equals requested kg.
 */
export function estimatePieceWeights(
  orders: ForecastOrderInput[], items: ForecastItemInput[], customers: ForecastCustomerInput[], asOf: Date
) {
  const validCustomers = new Set(customers.filter((customer) => !customer.isTest).map((customer) => customer.id));
  const validOrders = new Map(orders.filter((order) =>
    order.status !== "cancelled" && validCustomers.has(order.customerId) &&
    Number.isFinite(Date.parse(order.createdAt)) && Date.parse(order.createdAt) <= asOf.getTime()
  ).map((order) => [order.id, order]));
  const weightSkus = new Set(items.filter((item) => normalizeDemandUnit(item.masterUnit ?? item.unit) === "กก." ||
    normalizeDemandUnit(item.unit) === "กก.").map((item) => item.sku));
  const candidates = new Map<string, { ratio: number; at: number; measured: boolean }[]>();
  const needsWeight = new Set<string>();
  for (const item of items) {
    const order = validOrders.get(item.orderId);
    if (!order || normalizeDemandUnit(item.unit) !== "ชิ้น" || !weightSkus.has(item.sku)) continue;
    needsWeight.add(item.sku);
    const measuredAt = Date.parse(item.updatedAt ?? "");
    if (!Number.isFinite(measuredAt) || measuredAt > asOf.getTime() ||
        item.actualQty === null || item.actualQty === undefined || item.actualQty <= 0 ||
        item.piecePricePerKg === null || item.piecePricePerKg === undefined || item.piecePricePerKg <= 0) continue;
    const measured = item.actualPieceQty != null && item.actualPieceQty > 0;
    const legacy = item.actualPieceQty == null && item.confirmedQty != null && item.confirmedQty > 0 &&
      item.requestedQty === item.confirmedQty &&
      ["completed", "awaiting_payment", "awaiting_delivery", "awaiting_payment_verification"].includes(order.status);
    if (!measured && !legacy) continue;
    const count = measured ? item.actualPieceQty! : item.confirmedQty!;
    const ratio = item.actualQty / count;
    // Guard against unit-entry errors; no assumed generic kg/pc defaults.
    if (!Number.isFinite(ratio) || ratio < 0.03 || ratio > 30) continue;
    const history = candidates.get(item.sku) ?? [];
    history.push({ ratio, at: measuredAt, measured });
    candidates.set(item.sku, history);
  }
  const conversions: Record<string, PieceWeightConversion> = {};
  for (const sku of needsWeight) {
    const history = candidates.get(sku) ?? [];
    const measured = history.filter((sample) => sample.measured);
    const used = (measured.length ? measured : history).sort((a, b) => a.at - b.at);
    if (!used.length) continue;
    const kgPerPiece = typicalKgPerPiece(used.map((sample) => sample.ratio));
    if (kgPerPiece === null) continue;
    conversions[sku] = {
      kgPerPiece: Math.round(kgPerPiece * 1000) / 1000,
      sampleCount: used.length,
      source: measured.length ? "measured" : "legacy_estimate",
      confidence: measured.length >= 3 ? "medium" : "low",
    };
  }
  return { conversions, missing: [...needsWeight].filter((sku) => !conversions[sku]).sort() };
}

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
  const ordersWithDemand = new Set(items.filter((item) => item.requestedQty !== null && Number.isFinite(item.requestedQty) && item.requestedQty > 0).map((item) => item.orderId));
  const activeOrders = orders.filter((o) =>
    o.status !== "cancelled" &&
    customerById.has(o.customerId) &&
    ordersWithDemand.has(o.id) &&
    o.deliveryDate !== null &&
    o.deliveryDate >= historyStartDate &&
    o.deliveryDate <= dates[dates.length - 1] &&
    Number.isFinite(Date.parse(o.createdAt)) &&
    Date.parse(o.createdAt) <= asOf.getTime()
  );
  const orderById = new Map(activeOrders.map((o) => [o.id, o]));
  const { conversions: weightConversions, missing: missingWeightConversions } =
    estimatePieceWeights(activeOrders, items, customers, asOf);
  const originalPieceDemand: Record<string, { yesterday: number; today: number }> = {};
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
      // Grouped /x orders and top-up orders on the same delivery day represent
      // one customer ordering opportunity, not multiple timing observations.
      const existing = offsets.find((entry) => entry.deliveryDate === orderDay);
      if (existing) existing.offsetMinutes = Math.min(existing.offsetMinutes, offsetMinutes);
      else offsets.push({ deliveryDate: orderDay, offsetMinutes });
      customerOrderOffsets.set(order.customerId, offsets);
    }
  }
  const customerCadence = new Map([...orderDates].map(([customerId, days]) => [customerId, averageInterval(days)]));
  const customerIntervals = new Map([...orderDates].map(([customerId, days]) => [customerId, purchaseIntervals(days)]));
  const timingHistory = new Map([...customerOrderOffsets].map(([customerId, observations]) => [
    customerId,
    observations.sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate)).slice(-MAX_ORDER_TIMING_SAMPLES).map((o) => o.offsetMinutes),
  ]));

  // Forecast whether the customer will place *any* order on each delivery day.
  // This is a separate clock from the per-SKU cadence: ordering something
  // yesterday resets the customer's clock, even if it was a different SKU.
  const customerKnownOrderDays = new Map<string, Map<string, number>>();
  for (const order of activeOrders) {
    const deliveryDate = order.deliveryDate!;
    if (deliveryDate < today) continue;
    const known = customerKnownOrderDays.get(order.customerId) ?? new Map<string, number>();
    known.set(deliveryDate, 1);
    customerKnownOrderDays.set(order.customerId, known);
  }
  const customerOrderPlans = new Map<string, ForecastDay[]>();
  for (const customerId of customerById.keys()) {
    const lastDeliveryDate = [...new Set(orderDates.get(customerId) ?? [])].sort().at(-1);
    const cadence = customerCadence.get(customerId) ?? null;
    const known = customerKnownOrderDays.get(customerId) ?? new Map<string, number>();
    const orderOffsets = timingHistory.get(customerId) ?? [];
    const plan = lastDeliveryDate && cadence !== null
      ? dailyDemandForecast(dates, lastDeliveryDate, cadence, 1, known, orderOffsets, asOf, customerIntervals.get(customerId) ?? [])
      : dates.map((date) => ({ date, knownQty: known.get(date) ?? 0, projectedQty: 0, totalQty: known.get(date) ?? 0, projectedProbability: 0, possibleQty: 0 }));
    customerOrderPlans.set(customerId, plan);
  }

  const seriesByKey = new Map<string, Series>();
  for (const item of items) {
    const order = orderById.get(item.orderId);
    if (!order) continue;
    // Demand is the quantity originally requested at checkout. Stock checks,
    // picking, billing and stockouts must not reduce it.
    const quantity = item.requestedQty;
    if (quantity === null || !Number.isFinite(quantity) || quantity <= 0) continue;
    // Stock planning is in kg for weight-priced SKUs, even when customers
    // request pieces. The original requested pieces are retained for audit.
    const normalized = normaliseForecastQuantity(item.sku, item.unit, quantity, weightConversions);
    const unit = normalized.unit;
    const demandQty = normalized.quantity;
    if (unit === "กก." && normalizeDemandUnit(item.unit) === "ชิ้น") {
      const raw = originalPieceDemand[item.sku] ?? { yesterday: 0, today: 0 };
      if (order.deliveryDate === yesterdayDate) raw.yesterday += quantity;
      if (order.deliveryDate === today) raw.today += quantity;
      originalPieceDemand[item.sku] = raw;
    }
    const key = JSON.stringify([order.customerId, item.sku]);
    let series = seriesByKey.get(key);
    if (!series) {
      series = {
        customerId: order.customerId,
        sku: item.sku,
        productName: item.productName,
        freshMeat: isFreshMeat(item.category, item.productName),
        units: new Map(),
        knownSkuDays: new Map(),
      };
      seriesByKey.set(key, series);
    }
    series.freshMeat ||= isFreshMeat(item.category, item.productName);
    let unitSeries = series.units.get(unit);
    if (!unitSeries) {
      unitSeries = { unit, requestedByDay: new Map(), knownByDay: new Map() };
      series.units.set(unit, unitSeries);
    }
    const serviceDate = order.deliveryDate!;
    if (serviceDate <= today) {
      unitSeries.requestedByDay.set(serviceDate, (unitSeries.requestedByDay.get(serviceDate) ?? 0) + demandQty);
    }
    if (serviceDate < today || serviceDate > dates[dates.length - 1]) continue;
    unitSeries.knownByDay.set(serviceDate, (unitSeries.knownByDay.get(serviceDate) ?? 0) + demandQty);
    // Marker only: quantities cannot be summed across kg and pieces.
    series.knownSkuDays.set(serviceDate, 1);
  }

  const rows: ForecastRow[] = [];
  for (const series of seriesByKey.values()) {
    const customer = customerById.get(series.customerId)!;
    const orderOffsets = timingHistory.get(series.customerId) ?? [];
    const purchaseDates = [...new Set([...series.units.values()].flatMap((unit) => [...unit.requestedByDay.keys()]))].sort();
    const customerPeriod = customerCadence.get(series.customerId) ?? null;
    const skuObservedPeriod = averageInterval(purchaseDates);
    const purchaseFrequency = purchaseDates.length / Math.max(1, new Set(orderDates.get(series.customerId) ?? []).size);
    const baseline = customerPeriod !== null ? customerPeriod / Math.max(0.15, purchaseFrequency) : null;
    const skuPeriod = skuObservedPeriod === null ? baseline
      : purchaseDates.length < 4 && baseline !== null
        ? 0.75 * skuObservedPeriod + 0.25 * baseline
        : skuObservedPeriod;
    // Freshness is a stockholding constraint, not evidence that the customer
    // orders more frequently. Inventing 2-day meat orders distorts demand.
    const effectivePeriod = skuPeriod === null ? null : Math.max(1, skuPeriod);
    const confidence = purchaseDates.length >= 7 ? "high" : purchaseDates.length >= 4 ? "medium" : purchaseDates.length >= 2 ? "low" : "insufficient";
    const lastPurchaseDate = purchaseDates.at(-1);
    const customerPlan = customerOrderPlans.get(series.customerId);
    // One-off SKUs no longer vanish completely. Their repeat probability is
    // deliberately shrunk using the fraction of the customer's baskets that
    // actually contained that SKU; they won't create a confident 1-SKU order.
    const customerPurchaseDays = new Set(orderDates.get(series.customerId) ?? []).size;
    const skuEvidenceWeight = purchaseDates.length === 1
      ? Math.min(0.85, (purchaseDates.length + 0.5) / (customerPurchaseDays + 1))
      : 1;
    const skuEventDays = lastPurchaseDate && effectivePeriod !== null
      ? dailyDemandForecast(dates, lastPurchaseDate, effectivePeriod, 1, series.knownSkuDays, orderOffsets, asOf, purchaseIntervals(purchaseDates), customerPlan, skuEvidenceWeight)
      : dates.map((date) => ({
          date,
          knownQty: series.knownSkuDays.get(date) ?? 0,
          projectedQty: 0,
          totalQty: series.knownSkuDays.get(date) ?? 0,
          projectedProbability: 0,
          possibleQty: 0,
        }));
    const unitShares = conditionalUnitShares(series);
    for (const unitSeries of series.units.values()) {
      const yesterdayRequestedQty = clampQty(unitSeries.requestedByDay.get(yesterdayDate) ?? 0);
      const todayRequestedQty = clampQty(unitSeries.requestedByDay.get(today) ?? 0);
      const typicalRequestedQty = recencyWeightedMedian(
        [...unitSeries.requestedByDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, qty]) => qty)
      ) ?? 0;
      const unitShare = unitShares.get(unitSeries.unit) ?? 0;
      const forecastDays = skuEventDays.map((event) => {
        const knownQty = clampQty(unitSeries.knownByDay.get(event.date) ?? 0);
        // A known order in ANY unit settles this customer's SKU event for the
        // day. Otherwise, distribute one SKU probability across the units.
        const projectedProbability = event.knownQty > 0 ? 0 : (event.projectedProbability ?? 0) * unitShare;
        const projectedQty = mostLikelyOrderQty(projectedProbability, typicalRequestedQty);
        return {
          date: event.date, knownQty, projectedQty, totalQty: clampQty(knownQty + projectedQty),
          projectedProbability, possibleQty: clampQty(typicalRequestedQty),
        };
      });
      // Keep unlikely candidates for product-level convolution, but don't
      // display dormant historical units without any plausible demand.
      if (forecastDays.every((day) => day.totalQty === 0 && (day.projectedProbability ?? 0) < 0.01) &&
          yesterdayRequestedQty === 0 && todayRequestedQty === 0) continue;
      rows.push({
        customerId: series.customerId,
        customerCode: customer.code,
        customerName: customer.name,
        sku: series.sku,
        productName: series.productName,
        unit: unitSeries.unit,
        freshMeat: series.freshMeat,
        customerCadenceDays: customerPeriod === null ? null : Math.round(customerPeriod * 10) / 10,
        skuCadenceDays: skuPeriod === null ? null : Math.round(skuPeriod * 10) / 10,
        effectiveCadenceDays: effectivePeriod === null ? null : Math.round(effectivePeriod * 10) / 10,
        purchaseDays: purchaseDates.length,
        confidence,
        conditionalUnitShare: unitShare,
        customerUsualOrderOffsetMinutes: median(orderOffsets),
        customerOrderTimingSamples: orderOffsets.length,
        yesterdayRequestedQty,
        todayRequestedQty,
        days: forecastDays,
      });
    }
  }

  rows.sort((a, b) => a.customerName.localeCompare(b.customerName, "th") || a.sku.localeCompare(b.sku, "en"));
  return {
    asOf: asOf.toISOString(), yesterdayDate, dates, historyDays: FORECAST_HISTORY_DAYS, rows,
    weightConversions, originalPieceDemand, missingWeightConversions,
  };
}
