/**
 * Two calendar days of forecast inventory at the NEXT delivery, with daily
 * replenishment. No batch/expiry tracking or perfect FIFO is assumed.
 * This cannot imply a specific stockout or spoilage probability.
 */
export const TARGET_STOCK_DAYS = 2;
export type SharedPurchaseInput = {
  sku: string;
  productName: string;
  b2bTodayMeanKg: number;
  b2bTomorrowMeanKg: number;
  b2bDayAfterMeanKg: number;
  b2bConfirmedTomorrowKg: number;
  b2cTodayMeanKg: number | null;
  b2cTomorrowMeanKg: number | null;
  b2cDayAfterMeanKg: number | null;
  morningOnHandKg: number | null;
};

export type SharedPurchaseDraft = SharedPurchaseInput & {
  orderKg: number | null;
  expectedDemandTomorrowKg: number | null;
  targetStockKg: number | null;
  usableStockTomorrowKg: number | null;
  missing: ("b2c_history" | "morning_stock")[];
};

export function sharedPurchaseDraft(input: SharedPurchaseInput): SharedPurchaseDraft {
  const missing: SharedPurchaseDraft["missing"] = [];
  if (input.b2cTodayMeanKg === null || input.b2cTomorrowMeanKg === null || input.b2cDayAfterMeanKg === null) missing.push("b2c_history");
  if (input.morningOnHandKg === null) missing.push("morning_stock");
  const valid = [input.b2bTodayMeanKg, input.b2bTomorrowMeanKg, input.b2bDayAfterMeanKg, input.b2bConfirmedTomorrowKg,
    input.b2cTodayMeanKg, input.b2cTomorrowMeanKg, input.b2cDayAfterMeanKg, input.morningOnHandKg]
    .every((value) => value === null || Number.isFinite(value) && value >= 0);
  if (!valid || missing.length) return { ...input, orderKg: null, expectedDemandTomorrowKg: null, targetStockKg: null, usableStockTomorrowKg: null, missing };

  // Approximate remaining on-hand inventory after today's expected sales.
  // This assumes the morning count precedes the day's demand; the system does
  // not yet know whether counted goods have already been picked or sold.
  const stockTomorrow = Math.max(0, input.morningOnHandKg! - input.b2bTodayMeanKg - input.b2cTodayMeanKg!);
  // Demand by delivery date is already the forecast, so 2 DOH means adding
  // tomorrow plus the following day's demand, not 2 * a flat average.
  const tomorrow = Math.max(input.b2bTomorrowMeanKg, input.b2bConfirmedTomorrowKg) + input.b2cTomorrowMeanKg!;
  const dayAfter = input.b2bDayAfterMeanKg + input.b2cDayAfterMeanKg!;
  const target = tomorrow + dayAfter;
  return { ...input,
    usableStockTomorrowKg: Math.round(stockTomorrow * 10) / 10,
    expectedDemandTomorrowKg: Math.round(tomorrow * 10) / 10,
    targetStockKg: Math.round(target * 10) / 10,
    orderKg: Math.max(0, Math.ceil(Math.max(0, target - stockTomorrow) * 10 - 1e-8)) / 10,
    missing,
  };
}
