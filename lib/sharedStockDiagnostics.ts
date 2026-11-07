/** Conservative diagnostics based only on recorded daily sales and morning stock counts.
 * These are operational signals, NOT stockout or spoilage probabilities.
 */
export type DemandPattern = "limited" | "slow" | "volatile" | "regular";

export type DailyDemandDiagnostics = {
  pattern: DemandPattern;
  sampleDays: number;
  sellingDays: number;
  suspectedCensoredDays: number;
  coefficientOfVariation: number | null;
  adjustedQuantities: (number | null)[];
};

export function analyseDailyDemand(
  dates: string[],
  quantities: (number | null)[],
  zeroMorningStockDates: ReadonlySet<string> = new Set(),
): DailyDemandDiagnostics {
  const suspectedCensoredDays = dates.filter((date, index) =>
    zeroMorningStockDates.has(date) && quantities[index] === 0).length;
  // A day with zero opening stock and zero sales provides no reliable evidence
  // that demand was zero. Do not let it depress weekday averages.
  const adjustedQuantities = quantities.map((quantity, index) =>
    zeroMorningStockDates.has(dates[index]) && quantity === 0 ? null : quantity);
  const observations = adjustedQuantities.filter((value): value is number =>
    typeof value === "number" && Number.isFinite(value) && value >= 0);
  const sampleDays = observations.length;
  const sellingDays = observations.filter((value) => value > 0).length;
  if (sampleDays < 21) return {
    pattern: "limited", sampleDays, sellingDays, suspectedCensoredDays,
    coefficientOfVariation: null, adjustedQuantities,
  };
  const mean = observations.reduce((sum, value) => sum + value, 0) / sampleDays;
  const variance = observations.reduce((sum, value) => sum + (value - mean) ** 2, 0) / sampleDays;
  const coefficientOfVariation = mean > 0 ? Math.sqrt(variance) / mean : 0;
  return {
    pattern: sellingDays / sampleDays < 0.35 ? "slow" : coefficientOfVariation >= 1.2 ? "volatile" : "regular",
    sampleDays, sellingDays, suspectedCensoredDays,
    coefficientOfVariation: Math.round(coefficientOfVariation * 100) / 100,
    adjustedQuantities,
  };
}

export type InventoryStatus = "missing" | "excess" | "cover_gap" | "censored" | "slow" | "volatile" | "normal";

/** DOH is a planning proxy only: we do not have batch ages or observed spoilage. */
export function inventoryDiagnostics(params: {
  usableStockTomorrowKg: number | null;
  expectedDemandTomorrowKg: number | null;
  dayAfterDemandKg: number | null;
  orderKg: number | null;
  pattern?: DemandPattern;
  censoredDays?: number;
}) {
  const { usableStockTomorrowKg: stock, expectedDemandTomorrowKg: tomorrow,
    dayAfterDemandKg: dayAfter, orderKg } = params;
  if (stock === null || tomorrow === null || dayAfter === null || orderKg === null) {
    return { status: "missing" as InventoryStatus, preOrderDoh: null, projectedDoh: null };
  }
  const dailyAverage = (tomorrow + dayAfter) / 2;
  const doh = (kg: number) => dailyAverage > 0 ? Math.round(kg / dailyAverage * 10) / 10 : kg > 0 ? Infinity : 0;
  const preOrderDoh = doh(stock);
  const projectedDoh = doh(stock + orderKg);
  const status: InventoryStatus = preOrderDoh > 2.5 ? "excess"
    : stock < tomorrow && orderKg > 0 ? "cover_gap"
      : (params.censoredDays ?? 0) > 0 ? "censored"
        : params.pattern === "slow" ? "slow"
          : params.pattern === "volatile" ? "volatile" : "normal";
  return { status, preOrderDoh, projectedDoh };
}

export type SalesScope = "unverified" | "b2c_only" | "all_store";
export function salesScopeIsUsable(scope: SalesScope) { return scope === "b2c_only"; }

/** Currency figures measure exposure, NOT a forecast of losses or expiry. */
export function inventoryFinancialExposure(params: {
  usableStockTomorrowKg: number | null;
  targetStockKg: number | null;
  expectedDemandTomorrowKg: number | null;
  costBahtPerKg: number | null;
  priceBahtPerKg: number | null;
}) {
  const { usableStockTomorrowKg: stock, targetStockKg: target,
    expectedDemandTomorrowKg: demand, costBahtPerKg: cost, priceBahtPerKg: price } = params;
  const excessInventoryValueBaht = stock !== null && target !== null && cost !== null && cost >= 0
    ? Math.round(Math.max(0, stock - target) * cost * 100) / 100 : null;
  const potentialUncoveredGrossProfitBaht = stock !== null && demand !== null && cost !== null && price !== null && price >= cost
    ? Math.round(Math.max(0, demand - stock) * (price - cost) * 100) / 100 : null;
  return { excessInventoryValueBaht, potentialUncoveredGrossProfitBaht };
}
