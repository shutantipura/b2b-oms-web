/**
 * Directional shared-stock requirement, NOT a validated purchasing optimum.
 * There is no age-bucket inventory or calibrated retail tail-risk model yet.
 * This intentionally does not return a shortage or expiry probability.
 */
export type SharedPurchaseInput = {
  sku: string;
  productName: string;
  b2bTodayMeanKg: number;
  b2bTomorrowP90Kg: number;
  b2cTodayMeanKg: number | null;
  b2cTomorrowMeanKg: number | null;
  morningOnHandKg: number | null;
};

export type SharedPurchaseDraft = SharedPurchaseInput & {
  orderKg: number | null;
  expectedDemandTomorrowKg: number | null;
  usableStockTomorrowKg: number | null;
  missing: ("b2c_history" | "morning_stock")[];
};

export function sharedPurchaseDraft(input: SharedPurchaseInput): SharedPurchaseDraft {
  const missing: SharedPurchaseDraft["missing"] = [];
  if (input.b2cTodayMeanKg === null || input.b2cTomorrowMeanKg === null) missing.push("b2c_history");
  if (input.morningOnHandKg === null) missing.push("morning_stock");
  const valid = [input.b2bTodayMeanKg, input.b2bTomorrowP90Kg,
    input.b2cTodayMeanKg, input.b2cTomorrowMeanKg, input.morningOnHandKg]
    .every((value) => value === null || Number.isFinite(value) && value >= 0);
  if (!valid || missing.length) return { ...input, orderKg: null, expectedDemandTomorrowKg: null, usableStockTomorrowKg: null, missing };

  // Approximate remaining on-hand inventory after today's expected sales.
  // This assumes the morning count precedes the day's demand; the system does
  // not yet know whether counted goods have already been picked or sold.
  const stockTomorrow = Math.max(0, input.morningOnHandKg! - input.b2bTodayMeanKg - input.b2cTodayMeanKg!);
  const tomorrow = input.b2bTomorrowP90Kg + input.b2cTomorrowMeanKg!;
  return { ...input,
    usableStockTomorrowKg: Math.round(stockTomorrow * 10) / 10,
    expectedDemandTomorrowKg: Math.round(tomorrow * 10) / 10,
    orderKg: Math.max(0, Math.ceil(Math.max(0, tomorrow - stockTomorrow) * 10 - 1e-8)) / 10,
    missing,
  };
}
