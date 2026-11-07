"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import LotusLoading from "@/components/LotusLoading";
import B2CSalesImportPanel from "@/components/B2CSalesImportPanel";
import { supabase } from "@/lib/supabase";
import { stockReportDates } from "@/lib/stockSalesReport";
import { aggregateForecastByProduct, describeCustomerOrderTime, STOCK_PLANNING_PERCENTILE, type ForecastDay, type StockForecast } from "@/lib/stockForecast";
import type { DemandBacktestReport } from "@/lib/stockForecastBacktest";
import { FRESH_MEAT_SHELF_LIFE_DAYS, MAX_SHORTAGE_PROBABILITY, type StockOrderRecommendation } from "@/lib/stockOrderOptimizer";
import { sharedPurchaseDraft, TARGET_STOCK_DAYS, type SharedPurchaseDraft } from "@/lib/sharedStockPurchaseDraft";
import { inventoryDiagnostics, inventoryFinancialExposure, type DemandPattern, type InventoryStatus, type SalesScope } from "@/lib/sharedStockDiagnostics";

type Access = "loading" | "manager" | "denied" | "signed-out";
const PLANNING_LABEL = `P${Math.round(STOCK_PLANNING_PERCENTILE * 100)}`;
const PLANNING_TARGET = Math.round(STOCK_PLANNING_PERCENTILE * 100);
type StockOrderPlansPayload = { noon: StockOrderRecommendation[]; live: StockOrderRecommendation[]; noonHorizonFrozen: boolean };
type SharedInputs = { sourcePeriod: { start: string; end: string } | null; sourceFormat: "daily" | "total" | null; sourceScope?: SalesScope; countDate: string; products: { sku: string; productName: string }[]; bySku: Record<string, { b2cDailyKg: number | null; b2cByDateKg?: Record<string, number | null>; onHandKg: number | null; countedAt: string | null; demandPattern?: DemandPattern | null; observedDays?: number; suspectedStockoutDays?: number; coefficientOfVariation?: number | null }> };
type SharedInputsPayload = { noon: SharedInputs; live: SharedInputs; noonFrozen: boolean };
type HistoricPurchasePlan = { date: string; capturedAt: string; late: boolean; available: boolean; readySkuCount: number | null; missingSkuCount: number | null; recommendedKg: number | null; scope: SalesScope };
const INVENTORY_STATUS: Record<InventoryStatus, { label: string; className: string }> = {
  missing: { label: "รอข้อมูล", className: "bg-amber-50 text-amber-800" },
  excess: { label: "สต็อกสูง", className: "bg-red-50 text-red-800" },
  cover_gap: { label: "ต้องเติมสต็อก", className: "bg-amber-50 text-amber-800" },
  censored: { label: "เคยสต็อกเป็น 0", className: "bg-orange-50 text-orange-800" },
  slow: { label: "ขายไม่สม่ำเสมอ", className: "bg-amber-50 text-amber-800" },
  volatile: { label: "ยอดขายแกว่ง", className: "bg-amber-50 text-amber-800" },
  normal: { label: "ปกติ", className: "bg-emerald-50 text-emerald-700" },
};

function qty(value: number) {
  return value.toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 3 });
}

function forecastQty(value: number) {
  return value.toLocaleString("th-TH", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function percent(value: number | null) {
  return value === null ? "N/A" : `${value.toLocaleString("th-TH", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

const CONFIDENCE = {
  high: { label: "สูง", className: "bg-emerald-50 text-emerald-700" },
  medium: { label: "ปานกลาง", className: "bg-sky-50 text-sky-700" },
  low: { label: "ต่ำ", className: "bg-amber-50 text-amber-800" },
  insufficient: { label: "ข้อมูลน้อย", className: "bg-slate-100 text-slate-600" },
};

function FivePeriodGrid({ yesterdayDate, yesterdayRequestedQty, todayRequestedQty, days, compact = false }: {
  yesterdayDate: string;
  yesterdayRequestedQty: number;
  todayRequestedQty: number;
  days: ForecastDay[];
  compact?: boolean;
}) {
  const periods = [
    { label: "ยอดวันส่งเมื่อวาน", date: yesterdayDate, value: yesterdayRequestedQty, actual: true },
    { label: "ยอดวันส่งวันนี้", date: days[0].date, value: todayRequestedQty, actual: true },
    { label: "คาดเฉลี่ยปิดวันนี้", date: days[0].date, value: days[0].totalQty, actual: false, known: days[0].knownQty, extra: days[0].projectedQty, planning: days[0].planningQty },
    { label: "คาดเฉลี่ยพรุ่งนี้", date: days[1].date, value: days[1].totalQty, actual: false, known: days[1].knownQty, extra: days[1].projectedQty, planning: days[1].planningQty },
    { label: "คาดเฉลี่ยมะรืน", date: days[2].date, value: days[2].totalQty, actual: false, known: days[2].knownQty, extra: days[2].projectedQty, planning: days[2].planningQty },
  ];
  return (
    <div className="grid grid-cols-5 gap-1 p-1.5 sm:gap-2 sm:p-2" aria-label="ความต้องการตามคำสั่งซื้อจริงและคาดการณ์ห้าช่วงเวลา">
      {periods.map((period) => (
        <div key={period.label} className={`min-w-0 rounded-lg px-0.5 py-2 text-center sm:rounded-xl sm:px-2 sm:py-3 ${period.actual ? "bg-[#F1F5F4]" : "bg-[#EAF8F5]"}`}>
          <p className="text-[9px] font-extrabold leading-3 text-[#355E57] sm:text-xs sm:leading-4">{period.label}</p>
          <p className="mt-0.5 text-[9px] text-[#77918A] sm:text-[10px]">{period.date.slice(5)}</p>
          <p className={`mt-1 break-words font-black tracking-tight tabular-nums sm:mt-2 ${compact ? "text-xs sm:text-base" : "text-[clamp(0.75rem,2.9vw,1.5rem)] sm:text-xl"} ${period.actual ? "text-[#315C54]" : "text-[#008B8B]"}`}>{forecastQty(period.value)}</p>
          {!period.actual && (
            <p className="mt-1 text-[8px] leading-3 text-[#567B72] sm:text-[10px] sm:leading-4">
              รับแล้ว {forecastQty(period.known ?? 0)}
              <br />
              คาดเพิ่ม {forecastQty(period.extra ?? 0)}
              <br />
              <span className="font-black text-[#9C6A00]">แผน {PLANNING_LABEL} {forecastQty(period.planning ?? period.value)}</span>
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

function TomorrowDemandSummary({ day, unit, compact = false }: {
  day: ForecastDay;
  unit: string;
  compact?: boolean;
}) {
  const figures = [
    { label: "รับออเดอร์แล้ว", value: day.knownQty, note: "ยอดที่ลูกค้าขอสั่งแล้ว", className: "bg-[#F1F5F4] text-[#315C54]" },
    { label: "คาดการณ์เฉลี่ย", value: day.totalQty, note: "รวมยอดที่คาดว่าจะสั่งเพิ่ม", className: "bg-[#EAF8F5] text-[#007F7F]" },
    { label: `แผน ${PLANNING_LABEL}`, value: day.planningQty ?? day.totalQty, note: "เผื่อความเสี่ยงขาดสินค้า", className: "bg-[#FFF1C5] text-[#805A00]" },
  ];
  return (
    <div className="grid grid-cols-3 gap-2" aria-label={`ความต้องการสำหรับวันส่ง ${day.date}`}>
      {figures.map((figure) => (
        <div key={figure.label} className={`min-w-0 rounded-xl px-2 py-3 text-center sm:px-3 ${figure.className}`}>
          <p className="text-[10px] font-extrabold leading-4 sm:text-xs">{figure.label}</p>
          <p className={`mt-1 break-words font-black tabular-nums ${compact ? "text-base sm:text-lg" : "text-xl sm:text-2xl"}`}>
            {forecastQty(figure.value)}
          </p>
          <p className="text-[10px] font-semibold">{unit}</p>
          {!compact && <p className="mt-1 hidden text-[10px] leading-4 opacity-80 sm:block">{figure.note}</p>}
        </div>
      ))}
    </div>
  );
}

function DemandHistoryDetails({ yesterdayDate, yesterdayRequestedQty, todayRequestedQty, days, compact = false }: {
  yesterdayDate: string;
  yesterdayRequestedQty: number;
  todayRequestedQty: number;
  days: ForecastDay[];
  compact?: boolean;
}) {
  return (
    <details className="mt-2 rounded-xl border border-[#E0EEEA] bg-white">
      <summary className="cursor-pointer px-3 py-2.5 text-xs font-bold text-[#008B8B]">
        ดูยอดเมื่อวาน วันนี้ และคาดการณ์ 3 วัน
      </summary>
      <div className="border-t border-[#E0EEEA]">
        <FivePeriodGrid yesterdayDate={yesterdayDate} yesterdayRequestedQty={yesterdayRequestedQty}
          todayRequestedQty={todayRequestedQty} days={days} compact={compact} />
      </div>
    </details>
  );
}

export default function StockManagementPage() {
  const [access, setAccess] = useState<Access>("loading");
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");
  const [dates] = useState<string[]>(() => stockReportDates());
  const [forecast, setForecast] = useState<StockForecast | null>(null);
  const [noonForecast, setNoonForecast] = useState<StockForecast | null>(null);
  const [stockOrderPlans, setStockOrderPlans] = useState<StockOrderPlansPayload | null>(null);
  const [sharedStockInputs, setSharedStockInputs] = useState<SharedInputsPayload | null>(null);
  const [officialPurchaseDrafts, setOfficialPurchaseDrafts] = useState<SharedPurchaseDraft[] | null>(null);
  const [snapshotStatus, setSnapshotStatus] = useState<"saved" | "preview" | "missing">("preview");
  const [snapshotCapturedAt, setSnapshotCapturedAt] = useState<string | null>(null);
  const [snapshotWasLate, setSnapshotWasLate] = useState(false);
  const [forecastView, setForecastView] = useState<"noon" | "live">("noon");
  const [pageView, setPageView] = useState<"simple" | "detailed">("simple");
  const [simpleSearch, setSimpleSearch] = useState("");
  const [forecastLoading, setForecastLoading] = useState(false);
  const [forecastError, setForecastError] = useState("");
  const [forecastDownloading, setForecastDownloading] = useState(false);
  const [productSearch, setProductSearch] = useState("");
  const [meatOnly, setMeatOnly] = useState(false);
  const [backtest, setBacktest] = useState<DemandBacktestReport | null>(null);
  const [backtestLoading, setBacktestLoading] = useState(false);
  const [backtestError, setBacktestError] = useState("");
  const [planHistory, setPlanHistory] = useState<HistoricPurchasePlan[] | null>(null);
  const [planHistoryBusy, setPlanHistoryBusy] = useState(false);
  const [planHistoryError, setPlanHistoryError] = useState("");
  const [skuEconomics, setSkuEconomics] = useState<Record<string, { price: number | null; cost: number | null }>>({});

  useEffect(() => {
    let active = true;
    void (async () => {
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (!active) return;
      if (authError || !auth.user) {
        setAccess("signed-out");
        return;
      }
      const { data: staff, error: staffError } = await supabase
        .from("staff")
        .select("account_type, is_active")
        .eq("auth_user_id", auth.user.id)
        .maybeSingle();
      if (!active) return;
      setAccess(!staffError && staff?.account_type === "manager" && staff.is_active === true ? "manager" : "denied");
    })();
    return () => { active = false; };
  }, []);

  const refreshForecast = useCallback(async (background = false) => {
    if (!background) setForecastLoading(true);
    try {
      const { data, error: authError } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (authError || !token) throw new Error("กรุณาเข้าสู่ระบบใหม่");
      const response = await fetch("/api/admin/stock-forecast", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!response.ok) {
        const problem = await response.json().catch(() => ({}));
        throw new Error(typeof problem.error === "string" ? problem.error : "คำนวณคาดการณ์ไม่สำเร็จ");
      }
      const next = (await response.json()) as StockForecast & { noonForecast?: StockForecast; stockOrderPlans?: StockOrderPlansPayload; sharedStockInputs?: SharedInputsPayload; officialPurchaseDrafts?: SharedPurchaseDraft[] | null; snapshotStatus?: "saved" | "preview" | "missing"; snapshotCapturedAt?: string | null; snapshotWasLate?: boolean };
      setForecast(next);
      setNoonForecast(next.noonForecast ?? null);
      setStockOrderPlans(next.stockOrderPlans ?? null);
      setSharedStockInputs(next.sharedStockInputs ?? null);
      setOfficialPurchaseDrafts(next.officialPurchaseDrafts ?? null);
      setSnapshotStatus(next.snapshotStatus ?? "preview");
      setSnapshotCapturedAt(next.snapshotCapturedAt ?? null);
      setSnapshotWasLate(next.snapshotWasLate === true);
      setForecastError("");
    } catch (caught) {
      setForecastError(caught instanceof Error ? caught.message : "คำนวณคาดการณ์ไม่สำเร็จ");
    } finally {
      setForecastLoading(false);
    }
  }, []);

  useEffect(() => {
    if (access !== "manager") return;
    const initial = window.setTimeout(() => void refreshForecast(), 0);
    const timer = window.setInterval(() => void refreshForecast(true), 60_000);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); };
  }, [access, refreshForecast]);

  const displayedForecast = forecastView === "noon" ? noonForecast ?? forecast : forecast;
  const displayedStockOrders = forecastView === "noon" ? stockOrderPlans?.noon ?? [] : stockOrderPlans?.live ?? [];
  const displayedSharedInputs = forecastView === "noon" ? sharedStockInputs?.noon : sharedStockInputs?.live;
  const stockOrderTotals = displayedStockOrders.reduce((total, row) => ({
    recommendedKg: total.recommendedKg + (row.recommendedOrderKg ?? 0),
    expiredKg: total.expiredKg + (row.expectedExpiredKg ?? 0),
    shortageKg: total.shortageKg + (row.expectedShortageKg ?? 0),
  }), { recommendedKg: 0, expiredKg: 0, shortageKg: 0 });
  const productForecast = useMemo(() =>
    displayedForecast ? aggregateForecastByProduct(displayedForecast.rows, displayedForecast.dates) : [], [displayedForecast]);
  const combinedMeatProducts = useMemo(() => {
    const meat = new Map<string, { sku: string; productName: string; b2bKg: number }>();
    for (const product of displayedSharedInputs?.products ?? []) meat.set(product.sku, { ...product, b2bKg: 0 });
    for (const product of productForecast.filter((row) => row.freshMeat)) {
      const b2bKg = product.units.filter((unit) => unit.unit === "กก.")
        .reduce((sum, unit) => sum + unit.days[1].totalQty, 0);
      meat.set(product.sku, { sku: product.sku, productName: product.productName, b2bKg });
    }
    return [...meat.values()].filter((product) => product.b2bKg > 0 || displayedSharedInputs?.bySku[product.sku]?.b2cDailyKg != null)
      .sort((a, b) => (b.b2bKg + (displayedSharedInputs?.bySku[b.sku]?.b2cDailyKg ?? 0)) - (a.b2bKg + (displayedSharedInputs?.bySku[a.sku]?.b2cDailyKg ?? 0)));
  }, [productForecast, displayedSharedInputs]);

  const purchaseDrafts = useMemo(() => {
    if (forecastView === "noon" && snapshotStatus === "saved" && officialPurchaseDrafts) return officialPurchaseDrafts;
    if (!displayedForecast || !displayedSharedInputs) return [];
    const forecastBySku = new Map(productForecast.map((product) => [product.sku, product]));
    return combinedMeatProducts.map((product) => {
      const original = forecastBySku.get(product.sku);
      const kgUnits = original?.units.filter((unit) => unit.unit === "กก.") ?? [];
      const b2bTodayMeanKg = kgUnits.reduce((sum, unit) => sum + (unit.days[0]?.totalQty ?? 0), 0);
      const b2bTomorrowMeanKg = kgUnits.reduce((sum, unit) => sum + (unit.days[1]?.totalQty ?? 0), 0);
      const b2bDayAfterMeanKg = kgUnits.reduce((sum, unit) => sum + (unit.days[2]?.totalQty ?? 0), 0);
      const b2bConfirmedTomorrowKg = kgUnits.reduce((sum, unit) => sum + (unit.days[1]?.knownQty ?? 0), 0);
      const retail = displayedSharedInputs.bySku[product.sku];
      return sharedPurchaseDraft({ sku: product.sku, productName: product.productName,
        b2bTodayMeanKg, b2bTomorrowMeanKg, b2bDayAfterMeanKg, b2bConfirmedTomorrowKg,
        b2cTodayMeanKg: retail?.b2cByDateKg?.[displayedForecast.dates[0]] ?? retail?.b2cDailyKg ?? null,
        b2cTomorrowMeanKg: retail?.b2cByDateKg?.[displayedForecast.dates[1]] ?? retail?.b2cDailyKg ?? null,
        b2cDayAfterMeanKg: retail?.b2cByDateKg?.[displayedForecast.dates[2]] ?? retail?.b2cDailyKg ?? null,
        morningOnHandKg: retail?.onHandKg ?? null,
      });
    }).sort((a, b) => (b.orderKg ?? -1) - (a.orderKg ?? -1));
  }, [displayedForecast, displayedSharedInputs, productForecast, combinedMeatProducts, forecastView, snapshotStatus, officialPurchaseDrafts]);
  const visiblePurchaseDrafts = useMemo(() => purchaseDrafts.filter((row) =>
    !simpleSearch.trim() || `${row.sku} ${row.productName}`.toLowerCase().includes(simpleSearch.trim().toLowerCase())), [purchaseDrafts, simpleSearch]);
  const purchaseWarnings = useMemo(() => purchaseDrafts.map((row) => {
    const retail = displayedSharedInputs?.bySku[row.sku];
    const diagnostic = inventoryDiagnostics({ usableStockTomorrowKg: row.usableStockTomorrowKg,
      expectedDemandTomorrowKg: row.expectedDemandTomorrowKg,
      dayAfterDemandKg: row.targetStockKg === null || row.expectedDemandTomorrowKg === null ? null : Math.max(0, row.targetStockKg - row.expectedDemandTomorrowKg),
      orderKg: row.orderKg, pattern: retail?.demandPattern ?? undefined, censoredDays: retail?.suspectedStockoutDays ?? 0 });
    return { ...row, ...diagnostic, retail };
  }), [purchaseDrafts, displayedSharedInputs]);
  const warningsBySku = useMemo(() => new Map(purchaseWarnings.map((row) => [row.sku, row])), [purchaseWarnings]);
  const flaggedPurchases = purchaseWarnings.filter((row) => row.status !== "normal" && row.status !== "missing");
  const financialWarnings = useMemo(() => flaggedPurchases.map((row) => {
    const values = skuEconomics[row.sku];
    return { ...row, ...inventoryFinancialExposure({ usableStockTomorrowKg: row.usableStockTomorrowKg,
      targetStockKg: row.targetStockKg, expectedDemandTomorrowKg: row.expectedDemandTomorrowKg,
      costBahtPerKg: values?.cost ?? null, priceBahtPerKg: values?.price ?? null }) };
  }).sort((a, b) => Math.max(b.excessInventoryValueBaht ?? 0, b.potentialUncoveredGrossProfitBaht ?? 0)
    - Math.max(a.excessInventoryValueBaht ?? 0, a.potentialUncoveredGrossProfitBaht ?? 0)), [flaggedPurchases, skuEconomics]);
  const readyDrafts = purchaseDrafts.filter((row) => row.orderKg !== null);
  const pendingDrafts = purchaseDrafts.length - readyDrafts.length;

  useEffect(() => {
    if (pageView !== "detailed" || access !== "manager") return;
    let live = true;
    void (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (!data.session?.access_token) return;
        const response = await fetch("/api/admin/stock-forecast?format=sku-economics", {
          headers: { Authorization: `Bearer ${data.session.access_token}` }, cache: "no-store",
        });
        if (!response.ok) return;
        const body = await response.json();
        if (live) setSkuEconomics(body.economics ?? {});
      } catch { /* Cost data can be missing; never replace missing economics with zero. */ }
    })();
    return () => { live = false; };
  }, [pageView, access]);

  const visibleForecast = useMemo(() => {
    const filter = productSearch.trim().toLocaleLowerCase();
    return productForecast.filter((row) =>
      (!meatOnly || row.freshMeat) &&
      (!filter || [row.sku, row.productName, ...row.units.map((unit) => unit.unit)]
        .some((part) => part.toLocaleLowerCase().includes(filter)))
    );
  }, [productForecast, productSearch, meatOnly]);

  async function loadPlanHistory() {
    if (access !== "manager" || planHistoryBusy) return;
    setPlanHistoryBusy(true); setPlanHistoryError("");
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session?.access_token) throw new Error("กรุณาเข้าสู่ระบบใหม่");
      const response = await fetch("/api/admin/stock-forecast?format=plan-history", {
        headers: { Authorization: `Bearer ${data.session.access_token}` }, cache: "no-store",
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "โหลดประวัติไม่ได้");
      setPlanHistory(body.history ?? []);
    } catch (caught) { setPlanHistoryError(caught instanceof Error ? caught.message : "โหลดประวัติไม่ได้"); }
    finally { setPlanHistoryBusy(false); }
  }

  async function downloadForecast() {
    if (access !== "manager" || forecastDownloading) return;
    setForecastDownloading(true);
    setForecastError("");
    try {
      const { data, error: authError } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (authError || !token) throw new Error("กรุณาเข้าสู่ระบบใหม่");
      const response = await fetch(`/api/admin/stock-forecast?format=${forecastView === "noon" ? "noon-xlsx" : "xlsx"}`, {
        headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
      });
      if (!response.ok) {
        const problem = await response.json().catch(() => ({}));
        throw new Error(typeof problem.error === "string" ? problem.error : "ดาวน์โหลดคาดการณ์ไม่สำเร็จ");
      }
      const fileUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = fileUrl;
      link.download = `demand_forecast_${forecast?.dates[0] ?? "today"}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(fileUrl), 30_000);
    } catch (caught) {
      setForecastError(caught instanceof Error ? caught.message : "ดาวน์โหลดคาดการณ์ไม่สำเร็จ");
    } finally {
      setForecastDownloading(false);
    }
  }

  async function runBacktest() {
    if (access !== "manager" || backtestLoading) return;
    setBacktestLoading(true);
    setBacktestError("");
    try {
      const { data, error: authError } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (authError || !token) throw new Error("กรุณาเข้าสู่ระบบใหม่");
      const response = await fetch("/api/admin/stock-forecast?format=backtest", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!response.ok) {
        const problem = await response.json().catch(() => ({}));
        throw new Error(typeof problem.error === "string" ? problem.error : "ทดสอบย้อนหลังไม่สำเร็จ");
      }
      setBacktest((await response.json()) as DemandBacktestReport);
    } catch (caught) {
      setBacktestError(caught instanceof Error ? caught.message : "ทดสอบย้อนหลังไม่สำเร็จ");
    } finally {
      setBacktestLoading(false);
    }
  }

  async function downloadReport() {
    if (access !== "manager" || downloading) return;
    setDownloading(true);
    setError("");
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (sessionError || !token) throw new Error("เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่");

      const response = await fetch("/api/admin/stock-sales", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(typeof body.error === "string" ? body.error : "ดาวน์โหลดรายงานไม่สำเร็จ");
      }
      const file = await response.blob();
      const url = URL.createObjectURL(file);
      const link = document.createElement("a");
      link.href = url;
      link.download = `stock_sales_${dates[0] ?? "start"}_${dates[dates.length - 1] ?? "end"}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "ดาวน์โหลดรายงานไม่สำเร็จ");
    } finally {
      setDownloading(false);
    }
  }

  if (access === "loading") return <LotusLoading message="กำลังตรวจสอบสิทธิ์จัดการสต็อก..." />;

  if (access !== "manager") {
    return (
      <main className="min-h-screen bg-[#F3F8F7] px-4 pb-28 pt-8">
        <section className="mx-auto max-w-lg rounded-2xl border border-[#D7EAE6] bg-white p-6 text-center shadow-sm">
          <h1 className="text-2xl font-black text-[#17453F]">จัดการสต็อก</h1>
          <p className="mt-3 text-sm text-[#6E8982]">
            {access === "signed-out" ? "กรุณาเข้าสู่ระบบก่อนใช้งาน" : "เมนูนี้สำหรับผู้จัดการเท่านั้น"}
          </p>
          <Link href="/login" className="mt-5 inline-flex min-h-11 items-center rounded-xl bg-[#02B0AF] px-5 font-bold text-white">
            กลับหน้าหลัก
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#F3F8F7] px-4 pb-28 pt-6 sm:px-7 sm:py-8">
      <div className="mx-auto max-w-5xl">
        <header className="rounded-[24px] border border-[#CDE9E3] bg-gradient-to-br from-[#E8FAF6] to-white p-5 sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-extrabold tracking-[0.13em] text-[#008B8B]">LOTUS’S B2B / OMS</p>
              <h1 className="mt-2 text-3xl font-black text-[#17453F]">จัดการสต็อก</h1>
              <p className="mt-2 text-sm text-[#6B8880]">วางแผนเติมสต็อกเนื้อสดร่วม B2B/B2C · ส่งคำสั่งซื้อให้ซัพพลายเออร์โดยผู้จัดการ</p>
            </div>
            <span className="rounded-full border border-[#F7DB83] bg-[#FFF7DC] px-4 py-2 text-sm font-extrabold text-[#815B00]">
              Manager
            </span>
          </div>
        </header>

        <div className="mt-4 grid grid-cols-2 gap-2 rounded-2xl border border-[#CDE9E3] bg-white p-2" role="group" aria-label="เลือกมุมมองการจัดการสต็อก">
          <button type="button" onClick={() => setPageView("simple")} aria-pressed={pageView === "simple"}
            className={`min-h-12 rounded-xl px-4 py-2 text-sm font-black ${pageView === "simple" ? "bg-[#02B0AF] text-white" : "text-[#476D65]"}`}>
            มุมมองใช้งาน · สั่งสต็อก
          </button>
          <button type="button" onClick={() => setPageView("detailed")} aria-pressed={pageView === "detailed"}
            className={`min-h-12 rounded-xl px-4 py-2 text-sm font-black ${pageView === "detailed" ? "bg-[#02B0AF] text-white" : "text-[#476D65]"}`}>
            รายละเอียด · ข้อมูลและโมเดล
          </button>
        </div>

        {pageView === "simple" && (
          <section className="mt-4 rounded-[22px] border border-[#CDE9E3] bg-white p-4 shadow-sm sm:p-6" aria-label="ปริมาณเติมสต็อกเบื้องต้น">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-extrabold text-[#008B8B]">DAILY PURCHASING · {TARGET_STOCK_DAYS.toFixed(1)} DOH</p>
                <h2 className="mt-1 text-2xl font-black text-[#17453F]">เติมสต็อกให้เพียงพอ {TARGET_STOCK_DAYS} วัน</h2>
                <p className="mt-1 text-sm text-[#66857A]">{displayedForecast?.dates[1] ?? "กำลังโหลดวันที่ส่ง"} · แผน 10:00 น.</p>
              </div>
              <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-extrabold text-amber-800">ตัวเลขทดลอง · รอตรวจสอบก่อนสั่งจริง</span>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#E9F8F4] p-3">
              <div>
                <p className="text-sm font-black text-[#17594E]">ข้อมูลที่ต้องมีวันนี้</p>
                <p className="mt-1 text-xs text-[#43766C]">พนักงานนับสต็อกตอนเช้า · ระบบอ่าน B2B จาก OMS และ B2C จากไฟล์ประวัติที่นำเข้าไว้</p>
              </div>
              <Link href="/stock-count" className="rounded-xl bg-[#02B0AF] px-4 py-3 text-sm font-black text-white">กรอก/ตรวจสต็อกเช้า</Link>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <div className="rounded-xl bg-[#F1F6F4] p-3 text-center"><p className="text-xs font-bold text-[#597A72]">SKU ที่คำนวณได้</p><p className="mt-1 text-xl font-black text-[#17453F]">{readyDrafts.length}</p></div>
              <div className="rounded-xl bg-[#FFF5DD] p-3 text-center"><p className="text-xs font-bold text-[#90702A]">รอข้อมูล</p><p className="mt-1 text-xl font-black text-[#835F12]">{pendingDrafts}</p></div>
              <div className="rounded-xl bg-[#E5F7F4] p-3 text-center"><p className="text-xs font-bold text-[#377B70]">รวมปริมาณที่คำนวณได้</p><p className="mt-1 text-xl font-black text-[#007F7F]">{forecastQty(readyDrafts.reduce((sum, row) => sum + (row.orderKg ?? 0), 0))} <span className="text-xs">กก.</span></p></div>
            </div>
            <p className="mt-3 rounded-lg bg-[#FFF4DC] px-3 py-3 text-xs leading-5 text-[#7B5A16]">
              <strong>นโยบาย {TARGET_STOCK_DAYS.toFixed(1)} DOH:</strong> เป้าหมายสต็อกเท่ากับยอดคาดขายรวม B2B+B2C ของวันส่งพรุ่งนี้และวันถัดไป หักสต็อกที่คาดว่าจะเหลือหลังขายวันนี้ · รวมออเดอร์ B2B ที่ยืนยันแล้ว · ไม่แยกสต็อกตามวันหมดอายุ และไม่สมมติว่ามี FIFO สมบูรณ์ · ผลลัพธ์ยังเป็นตัวเลขทดลอง ไม่รับรองว่าจะไม่มีสินค้าขาดหรือหมดอายุ กรุณาตรวจสอบก่อนสั่ง
            </p>
            {displayedSharedInputs?.sourceScope !== "b2c_only" && (
              <p role="status" className="mt-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs font-bold leading-5 text-red-800">
                ยังไม่ยืนยันว่าไฟล์ Power BI เป็นยอด B2C เท่านั้น · ปริมาณซื้อจะแสดง “รอข้อมูล” เพื่อป้องกันนับยอด B2B ซ้ำ · โปรดให้ IT ยืนยันประเภทข้อมูลแล้วเลือกในเมนูรายละเอียดก่อนนำเข้า
              </p>
            )}
            {flaggedPurchases.length > 0 && <p className="mt-2 rounded-lg bg-[#FFF8E8] p-3 text-xs font-semibold text-[#7D5C17]">
              มี {flaggedPurchases.length.toLocaleString()} SKU ที่ควรตรวจสอบ เช่น สต็อกสูง ยอดขายผันผวน หรือเคยพบสต็อกเช้าเป็นศูนย์ · ดูคำอธิบายทั้งหมดในมุมมองรายละเอียด
            </p>}
            {snapshotStatus !== "saved" && <p className="mt-2 rounded-lg bg-amber-50 p-3 text-xs font-semibold text-amber-800">ยังไม่มีแผน 10:00 ที่บันทึกถาวรสำหรับวันนี้ · ตัวเลขอาจเปลี่ยนจนกว่าจะมีการบันทึกแผน</p>}
            {forecastError && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-xs text-red-700">{forecastError}</p>}
            <input type="search" value={simpleSearch} onChange={(event) => setSimpleSearch(event.target.value)} placeholder="ค้นหา SKU หรือชื่อสินค้า" aria-label="ค้นหาสินค้าในแผนสั่งสต็อก"
              className="mt-4 min-h-12 w-full rounded-xl border border-[#CDE9E3] px-4 text-sm outline-none focus:border-[#02B0AF]" />
            <div className="mt-3 overflow-x-auto rounded-xl border border-[#DCEAE6]">
              <table className="w-full min-w-[700px] text-left text-xs sm:text-sm">
                <thead className="bg-[#EDF8F5] text-[#376A60]"><tr><th className="p-3">สินค้า / SKU</th><th className="p-3 text-right">เป้าหมาย 2 วัน</th><th className="p-3 text-right">สต็อกที่คาดว่าเหลือ</th><th className="p-3 text-right">ปริมาณเติม (ทดลอง)</th><th className="p-3 text-right">สถานะ</th></tr></thead>
                <tbody>{visiblePurchaseDrafts.map((row) => <tr key={row.sku} className="border-t border-[#E4EFEB]">
                  <td className="p-3"><strong>{row.productName}</strong><p className="text-[11px] text-[#78938A]">{row.sku}</p></td>
                  <td className="p-3 text-right tabular-nums">{row.targetStockKg === null ? "—" : forecastQty(row.targetStockKg)}</td>
                  <td className="p-3 text-right tabular-nums">{row.usableStockTomorrowKg === null ? "—" : forecastQty(row.usableStockTomorrowKg)}</td>
                  <td className="p-3 text-right font-black tabular-nums text-[#008B8B]">{row.orderKg === null ? <span className="text-xs text-amber-700">{row.missing.includes("b2c_history") ? "รอข้อมูล B2C" : "รอนับสต็อก"}</span> : <>{forecastQty(row.orderKg)} กก.</>}</td>
                  <td className="p-3 text-right"><span className={`inline-block whitespace-nowrap rounded-full px-2 py-1 text-[10px] font-bold ${INVENTORY_STATUS[warningsBySku.get(row.sku)?.status ?? "missing"].className}`}>{INVENTORY_STATUS[warningsBySku.get(row.sku)?.status ?? "missing"].label}</span></td>
                </tr>)}</tbody>
              </table>
            </div>
            {visiblePurchaseDrafts.length === 0 && <p className="p-4 text-center text-sm text-[#708A82]">ยังไม่มีสินค้าในเงื่อนไขที่เลือก</p>}
            <p className="mt-3 text-xs text-[#718B83]">SKU ที่ข้อมูลไม่ครบแสดง “รอข้อมูล” ไม่ถือว่าเป็น 0 กก. · ค่าตัวเลขทดลองยังไม่ควรนำไปสั่งซื้อโดยไม่ตรวจสอบ</p>
            <button type="button" onClick={() => setPageView("detailed")}
              className="mt-4 min-h-12 w-full rounded-xl border border-[#B8DAD2] px-4 text-sm font-bold text-[#008B8B]">ดูแหล่งข้อมูลและวิธีคำนวณในมุมมองรายละเอียด</button>
          </section>
        )}

        {pageView === "detailed" && <>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#CDE9E3] bg-white p-4">
          <p className="text-sm font-bold text-[#315C54]">สต็อกใช้ร่วมกันระหว่าง B2C และ B2B · ให้พนักงานนับจำนวนคงเหลือทุกเช้า</p>
          <Link href="/stock-count" className="rounded-xl bg-[#02B0AF] px-4 py-3 text-sm font-black text-white">บันทึกสต็อกเช้า →</Link>
        </div>
        <B2CSalesImportPanel />

        <section className="mt-5 rounded-[22px] border border-[#CDE9E3] bg-white p-4 sm:p-6" aria-label="สัญญาณเตือนความเสี่ยงสต็อก">
          <h2 className="text-lg font-black text-[#17453F]">ตรวจสอบความเสี่ยงจากข้อมูลที่มี</h2>
          <p className="mt-1 text-xs leading-5 text-[#66857C]">ระบบใช้ยอดขายรายวัน + สต็อกเช้าที่นับจริง และยังใช้เป้าหมาย 2 DOH ทุก SKU เหมือนเดิม สถานะนี้เป็นสัญญาณเตือนเพื่อให้ผู้จัดการตัดสินใจ ไม่ใช่ความน่าจะเป็นที่สินค้าจะหมดอายุหรือขาด</p>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <div className="rounded-xl bg-red-50 p-3 text-center"><p className="text-[11px] font-bold text-red-800">สต็อกเกิน 2.5 วัน</p><p className="mt-1 text-xl font-black text-red-800">{purchaseWarnings.filter((item) => item.status === "excess").length}</p></div>
            <div className="rounded-xl bg-amber-50 p-3 text-center"><p className="text-[11px] font-bold text-amber-800">ต้องเติมเพื่อครอบคลุมพรุ่งนี้</p><p className="mt-1 text-xl font-black text-amber-800">{purchaseWarnings.filter((item) => item.status === "cover_gap").length}</p></div>
            <div className="rounded-xl bg-[#E9F8F4] p-3 text-center"><p className="text-[11px] font-bold text-[#28766D]">สัญญาณเตือนทั้งหมด</p><p className="mt-1 text-xl font-black text-[#008B8B]">{flaggedPurchases.length}</p></div>
          </div>
          {displayedSharedInputs?.sourceScope !== "b2c_only" && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs font-bold leading-5 text-amber-800">แหล่งข้อมูล B2C ยังไม่ยืนยัน: รายงานรวมสาขาอาจมี B2B อยู่แล้ว จึงไม่นับซ้ำและยังไม่มีปริมาณสั่งซื้อที่พร้อมใช้สำหรับ SKU ดังกล่าว</p>}
          {displayedSharedInputs?.sourcePeriod && (() => {
            const age = Math.round((Date.parse(`${displayedSharedInputs.countDate}T00:00:00Z`) - Date.parse(`${displayedSharedInputs.sourcePeriod.end}T00:00:00Z`)) / 86400000);
            return age > 14 ? <p className="mt-2 rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-800">ข้อมูลยอดขาย B2C สิ้นสุดเมื่อ {displayedSharedInputs.sourcePeriod.end} ({age} วันที่ผ่านมา) · แบบจำลองใช้ได้แต่ไม่ทราบการเปลี่ยนแปลงล่าสุด ควรนำเข้ารอบใหม่เมื่อมีข้อมูล</p> : null;
          })()}
          <div className="mt-3 overflow-x-auto rounded-xl border border-[#E1EDE9]">
            <table className="w-full min-w-[950px] text-left text-xs">
              <thead className="bg-[#EDF8F5] text-[#3A6D62]"><tr><th className="p-2">SKU / สินค้า</th><th className="p-2">สัญญาณ</th><th className="p-2 text-right">DOH ก่อนสั่ง</th><th className="p-2 text-right">DOH หลังสั่ง</th><th className="p-2 text-right">ประวัติใช้ได้ (วัน)</th><th className="p-2 text-right">วันที่อาจขาดสต็อก</th><th className="p-2 text-right">มูลค่าสต็อกส่วนเกิน (฿)</th><th className="p-2 text-right">GP ที่เสี่ยงหากไม่เติม (฿)</th></tr></thead>
              <tbody>{financialWarnings.slice(0, 50).map((row) => <tr key={row.sku} className="border-t border-[#E6EFEC]">
                <td className="p-2"><strong>{row.productName}</strong><p className="text-[10px] text-[#7B928C]">{row.sku}</p></td>
                <td className="p-2"><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${INVENTORY_STATUS[row.status].className}`}>{INVENTORY_STATUS[row.status].label}</span></td>
                <td className="p-2 text-right tabular-nums">{row.preOrderDoh === null ? "—" : Number.isFinite(row.preOrderDoh) ? `${forecastQty(row.preOrderDoh)} วัน` : "ไม่มียอดขาย"}</td>
                <td className="p-2 text-right tabular-nums">{row.projectedDoh === null ? "—" : Number.isFinite(row.projectedDoh) ? `${forecastQty(row.projectedDoh)} วัน` : "ไม่มียอดขาย"}</td>
                <td className="p-2 text-right">{row.retail?.observedDays ?? "—"}</td>
                <td className="p-2 text-right">{row.retail?.suspectedStockoutDays ?? "—"}</td>
                <td className="p-2 text-right tabular-nums">{row.excessInventoryValueBaht === null ? "N/A" : row.excessInventoryValueBaht.toLocaleString("th-TH", { maximumFractionDigits: 2 })}</td>
                <td className="p-2 text-right tabular-nums">{row.potentialUncoveredGrossProfitBaht === null ? "N/A" : row.potentialUncoveredGrossProfitBaht.toLocaleString("th-TH", { maximumFractionDigits: 2 })}</td>
              </tr>)}</tbody>
            </table>
          </div>
          <p className="mt-3 text-xs leading-5 text-[#70877F]">คอลัมน์เงินบาทใช้ราคา/ต้นทุนจาก Master เพื่อจัดลำดับสิ่งที่ควรตรวจสอบ ไม่ใช่คาดการณ์ผลขาดทุนจริง · วันที่มีสต็อกเช้าเป็น 0 และยอดขายเป็น 0 จะไม่ถูกใช้เป็นหลักฐานว่าไม่มีความต้องการ (ถ้ามีประวัติการนับในวันนั้น) · DOH คำนวณจากยอดคาดขายสองวัน ไม่ใช่วันหมดอายุของสินค้าจริง · หากนับสต็อกหลังเริ่มขาย/หยิบสินค้า ต้องปรับการนับให้เกิดก่อนการเคลื่อนไหวของวัน มิฉะนั้นอาจหักยอดขายซ้ำ</p>
        </section>

        <section className="mt-5 rounded-[22px] border border-[#CDE9E3] bg-white p-4 sm:p-6" aria-label="ประวัติแผนสั่งซื้อ">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h2 className="text-lg font-black text-[#17453F]">ประวัติแผนซื้อ ณ 10:00 น.</h2><p className="mt-1 text-xs text-[#6A847D]">เก็บปริมาณที่ระบบเสนอไว้ในบันทึกถาวร เพื่อใช้ตรวจสอบและปรับนโยบายในอนาคต · ไม่ใช่ปริมาณที่ผู้จัดการสั่งซื้อจริง</p></div>
            <button type="button" onClick={() => void loadPlanHistory()} disabled={planHistoryBusy} className="min-h-11 rounded-xl bg-[#E6F8F4] px-4 text-sm font-black text-[#008B8B] disabled:opacity-50">{planHistoryBusy ? "กำลังโหลด..." : "ดูย้อนหลัง 14 วัน"}</button>
          </div>
          {planHistoryError && <p role="alert" className="mt-2 rounded-lg bg-red-50 p-3 text-xs text-red-700">{planHistoryError}</p>}
          {planHistory && <div className="mt-3 overflow-x-auto rounded-xl border border-[#DCEAE6]"><table className="w-full min-w-[520px] text-left text-xs">
            <thead className="bg-[#EDF8F5] text-[#416D65]"><tr><th className="p-2">วันที่แผน</th><th className="p-2 text-right">SKU คำนวณได้</th><th className="p-2 text-right">SKU ขาดข้อมูล</th><th className="p-2 text-right">รวมแนะนำสั่ง (กก.)</th><th className="p-2">หมายเหตุ</th></tr></thead>
            <tbody>{planHistory.map((day) => <tr key={day.date} className="border-t border-[#E3EEEA]"><td className="p-2">{day.date}</td><td className="p-2 text-right">{day.readySkuCount ?? "—"}</td><td className="p-2 text-right">{day.missingSkuCount ?? "—"}</td><td className="p-2 text-right font-bold">{day.recommendedKg === null ? "—" : forecastQty(day.recommendedKg)}</td><td className="p-2">{!day.available ? "แผนรุ่นก่อน ไม่มีข้อมูลซื้อ" : day.scope !== "b2c_only" ? "ยังไม่ยืนยันแหล่งข้อมูล B2C" : day.late ? "บันทึกหลัง 10:00" : "บันทึกตามเวลา"}</td></tr>)}</tbody>
          </table></div>}
        </section>

        <section className="mt-5 rounded-[22px] border border-[#CDE9E3] bg-white p-5 shadow-[0_4px_16px_rgba(18,96,89,0.05)] sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-extrabold tracking-wide text-[#008B8B]">REQUESTED DEMAND + ROLLING FORECAST</p>
              <h2 className="mt-1 text-2xl font-black text-[#17453F]">พยากรณ์ความต้องการสินค้า 3 วัน</h2>
              <p className="mt-2 text-sm leading-6 text-[#648279]">
                ใช้ Requested Qty ตามวันส่ง/รับสินค้า · เรียนรู้รอบสั่งสินค้าและช่วงเวลาของลูกค้า · ล็อกแผนเวลา 10:00 เพื่อให้พนักงานสั่งสต็อกทัน 12:00 · คาดการณ์สดอัปเดตทุก 1 นาที
              </p>
              {displayedForecast && (
                <p className="mt-1 text-xs text-[#77918A]">
                  เวลาอ้างอิง {new Date(displayedForecast.asOf).toLocaleTimeString("th-TH", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit" })} น. (เวลาไทย)
                </p>
              )}
            </div>
            <span className="rounded-full border border-[#F7DB83] bg-[#FFF7DC] px-3 py-2 text-xs font-extrabold text-[#815B00]">
              ทดลองคาดการณ์ · ยังไม่สั่งสต็อกอัตโนมัติ
            </span>
          </div>

          <div className="mt-5 flex flex-wrap gap-2" role="group" aria-label="เลือกมุมมองการคาดการณ์">
            <button type="button" aria-pressed={forecastView === "noon"} onClick={() => setForecastView("noon")}
              className={`min-h-11 rounded-xl border px-4 py-2 text-sm font-black ${forecastView === "noon" ? "border-[#CBA451] bg-[#FFF1C5] text-[#704D00]" : "border-[#CDE5DE] bg-white text-[#557A71]"}`}>
              แผน 10:00 น. · ใช้ตัดสินใจสั่ง
            </button>
            <button type="button" aria-pressed={forecastView === "live"} onClick={() => setForecastView("live")}
              className={`min-h-11 rounded-xl border px-4 py-2 text-sm font-black ${forecastView === "live" ? "border-[#02B0AF] bg-[#E5F8F5] text-[#008B8B]" : "border-[#CDE5DE] bg-white text-[#557A71]"}`}>
              ล่าสุด · Live
            </button>
          </div>
          <p className="mt-2 text-xs text-[#648279]">
            ทั้งสองมุมมองใช้โมเดลเดียวกัน ต่างกันที่เวลาอ้างอิง · ก่อน 10:00 ข้อมูลเหมือนกัน
            หลัง 10:00 แผนทางการจะไม่นับออเดอร์ที่เข้ามาทีหลัง
          </p>
          {forecastView === "noon" && (
            <p className={`mt-2 rounded-lg px-3 py-2 text-xs font-bold ${snapshotStatus === "saved" ? "bg-[#E5F8F5] text-[#006F6B]" : "bg-amber-50 text-amber-800"}`}>
              {snapshotStatus === "saved"
                ? `บันทึกแผน 10:00 ถาวรแล้ว${snapshotCapturedAt ? ` · จัดเก็บจริง ${new Date(snapshotCapturedAt).toLocaleTimeString("th-TH", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit" })} น.` : ""}${snapshotWasLate ? " · บันทึกช้ากว่าเวลาที่กำหนด" : ""}`
                : snapshotStatus === "preview" ? "ตัวอย่างแผนก่อน 10:00 · จะบันทึกแผนทางการเวลา 10:00 น." : "ยังไม่พบบันทึกแผน 10:00 ถาวร · กำลังแสดงแผนคำนวณย้อนหลังแทน (กรุณาตรวจสอบการบันทึกอัตโนมัติ)"}
            </p>
          )}
          {displayedForecast && (
            <div className="mt-5 rounded-xl border border-[#DDEEEA] p-2">
              <p className="px-2 py-2 text-sm font-black text-[#17453F]">เนื้อสดรวม · ส่งพรุ่งนี้ ({displayedForecast.dates[1]})</p>
              {(() => {
                const meat = productForecast.filter((row) => row.freshMeat).flatMap((row) => row.units.filter((unit) => unit.unit === "กก."));
                const days = displayedForecast.dates.map((date, index) => ({
                  date,
                  knownQty: meat.reduce((sum, row) => sum + row.days[index].knownQty, 0),
                  projectedQty: meat.reduce((sum, row) => sum + row.days[index].projectedQty, 0),
                  totalQty: meat.reduce((sum, row) => sum + row.days[index].totalQty, 0),
                  planningQty: meat.reduce((sum, row) => sum + (row.days[index].planningQty ?? row.days[index].totalQty), 0),
                }));
                return (
                  <>
                    <TomorrowDemandSummary day={days[1]} unit="กก." />
                    <DemandHistoryDetails yesterdayDate={displayedForecast.yesterdayDate}
                      yesterdayRequestedQty={meat.reduce((sum, unit) => sum + unit.yesterdayRequestedQty, 0)}
                      todayRequestedQty={meat.reduce((sum, unit) => sum + unit.todayRequestedQty, 0)} days={days} />
                  </>
                );
              })()}
              <p className="px-2 pb-1 pt-2 text-[10px] text-[#728E86]">แผน {PLANNING_LABEL} เนื้อสดรวมเป็นผลรวมแผนราย SKU ไม่ใช่ P90 ของยอดรวมทั้งหมวด</p>
            </div>
          )}

          {displayedForecast && displayedSharedInputs && (
            <section className="mt-5 rounded-2xl border border-[#B9DFD6] bg-[#F5FCFA] p-4" aria-label="ความต้องการร่วม B2B B2C">
              <h3 className="text-lg font-black text-[#17453F]">ความต้องการร่วม B2B + B2C · เนื้อสด</h3>
              <p className="mt-1 text-xs leading-5 text-[#557970]">
                B2B ใช้ค่าเฉลี่ยวันที่ส่งพรุ่งนี้ ({displayedForecast.dates[1]}) · B2C {displayedSharedInputs.sourceFormat === "daily" ? "ใช้ค่าเฉลี่ยตามวันในสัปดาห์จากยอดขายรายวัน (ปรับลดความผันผวนด้วยค่าเฉลี่ยรวม)" : "ใช้ยอดรวม 30 วัน ÷ 30"} · สต็อกคือยอดที่พนักงานนับวันนี้ ({displayedSharedInputs.countDate})
              </p>
              <p className="mt-2 text-xs font-bold text-[#487A70]">
                {displayedSharedInputs.sourcePeriod ? `ข้อมูล B2C: ${displayedSharedInputs.sourcePeriod.start} ถึง ${displayedSharedInputs.sourcePeriod.end}` : "ยังไม่มีข้อมูล B2C · กรุณานำเข้า Excel รายวัน"}
                {forecastView === "noon" && !sharedStockInputs?.noonFrozen ? " · แผนเดิมยังไม่ได้ล็อกข้อมูล B2C/สต็อกไว้ที่ 10:00" : ""}
              </p>
              <div className="mt-3 overflow-x-auto rounded-xl border border-[#D5EBE5] bg-white">
                <table className="w-full min-w-[640px] text-left text-xs">
                  <thead className="bg-[#E7F6F1] text-[#315C54]"><tr><th className="p-2">สินค้า / SKU</th><th className="p-2 text-right">B2B พรุ่งนี้</th><th className="p-2 text-right">B2C เฉลี่ยทุกวัน</th><th className="p-2 text-right">B2C พรุ่งนี้ (ตามวันสัปดาห์)</th><th className="p-2 text-right">รวมพรุ่งนี้</th><th className="p-2 text-right">สต็อกเช้า</th></tr></thead>
                  <tbody>{combinedMeatProducts.map((product) => {
                    const b2b = product.b2bKg;
                    const entry = displayedSharedInputs.bySku[product.sku];
                    const b2cTomorrow = entry?.b2cByDateKg?.[displayedForecast.dates[1]] ?? entry?.b2cDailyKg;
                    return <tr key={product.sku} className="border-t border-[#E2EDE9]">
                      <td className="p-2"><strong>{product.productName}</strong><p className="text-[10px] text-[#738D85]">{product.sku}</p></td>
                      <td className="p-2 text-right tabular-nums">{forecastQty(b2b)}</td>
                      <td className="p-2 text-right tabular-nums">{entry?.b2cDailyKg === null || entry?.b2cDailyKg === undefined ? "N/A" : forecastQty(entry.b2cDailyKg)}</td>
                      <td className="p-2 text-right tabular-nums">{b2cTomorrow == null ? "N/A" : forecastQty(b2cTomorrow)}</td>
                      <td className="p-2 text-right font-black tabular-nums text-[#008B8B]">{b2cTomorrow == null ? "N/A" : forecastQty(b2b + b2cTomorrow)}</td>
                      <td className="p-2 text-right tabular-nums">{entry?.onHandKg === null || entry?.onHandKg === undefined ? "ยังไม่นับ" : forecastQty(entry.onHandKg)}</td>
                    </tr>;
                  })}</tbody>
                </table>
              </div>
              <p className="mt-3 rounded-lg bg-[#FFF4DC] p-3 text-xs leading-5 text-[#805D18]">
                ใช้นโยบายสต็อกเป้าหมาย {TARGET_STOCK_DAYS} วันในมุมมองใช้งาน · ยังไม่คำนวณความเสี่ยงหมดอายุหรือการขาดสินค้าอย่างแม่นยำ: {displayedSharedInputs.sourceFormat === "daily" ? "ยอดขายรายวันช่วยประมาณความผันผวนได้ แต่ยอดขายที่ถูกจำกัดด้วยสินค้าขาดอาจต่ำกว่าความต้องการจริง" : "ข้อมูล B2C ยอดรวมยังไม่บอกความผันผวนรายวัน"} และเราไม่มีอายุสินค้าแยกล็อต · ไม่ตั้งสมมติฐานว่าพนักงานทำ FIFO สมบูรณ์
              </p>
            </section>
          )}

          {displayedForecast && stockOrderPlans && (
            <section className="mt-5 rounded-2xl border border-[#F3D58B] bg-[#FFFDF5] p-3 sm:p-4" aria-label="แผนปริมาณสั่งซื้อเนื้อสดจำลอง">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="text-lg font-black text-[#694C0C]">แบบจำลอง FIFO เดิมเฉพาะ B2B (เพื่อศึกษาเท่านั้น)</h3>
                  <p className="mt-1 text-xs text-[#826A38]">โอกาสขาดสินค้าไม่เกิน {MAX_SHORTAGE_PROBABILITY * 100}% ต่อ SKU ตามแบบจำลอง · FIFO · อายุ {FRESH_MEAT_SHELF_LIFE_DAYS} วัน</p>
                </div>
                <span className="rounded-full border border-[#E9C86C] bg-[#FFF1C5] px-3 py-1 text-xs font-black text-[#805A00]">ยังไม่ใช่คำสั่งซื้อจริง</span>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <div className="rounded-xl bg-white p-2 text-center sm:p-3">
                  <p className="text-[10px] font-bold leading-4 text-[#6D8177]">แนะนำสั่งรวม</p>
                  <p className="mt-1 text-lg font-black tabular-nums text-[#008B8B] sm:text-2xl">{forecastQty(stockOrderTotals.recommendedKg)}</p>
                  <p className="text-[10px] text-[#718C84]">กก.</p>
                </div>
                <div className="rounded-xl bg-white p-2 text-center sm:p-3">
                  <p className="text-[10px] font-bold leading-4 text-[#6D8177]">คาดว่าอาจขาด</p>
                  <p className="mt-1 text-lg font-black tabular-nums text-[#995D18] sm:text-2xl">{forecastQty(stockOrderTotals.shortageKg)}</p>
                  <p className="text-[10px] text-[#718C84]">กก. เฉลี่ย</p>
                </div>
                <div className="rounded-xl bg-white p-2 text-center sm:p-3">
                  <p className="text-[10px] font-bold leading-4 text-[#6D8177]">คาดว่าอาจหมดอายุ</p>
                  <p className="mt-1 text-lg font-black tabular-nums text-[#995D18] sm:text-2xl">{forecastQty(stockOrderTotals.expiredKg)}</p>
                  <p className="text-[10px] text-[#718C84]">กก. เฉลี่ย</p>
                </div>
              </div>
              <p className="mt-3 rounded-lg bg-[#FFF1D8] px-3 py-2 text-xs leading-5 text-[#795A20]">
                <strong>แบบจำลองเดิม ไม่ใช้สำหรับสั่งซื้อ:</strong> สมมติว่า FIFO สมบูรณ์และไม่มีสต็อกเก่า ซึ่งไม่ตรงกับการทำงานจริงของร้าน · ใช้ราคาและต้นทุนปกติจาก Master Price · ยังไม่รวมยอดขายหน้าร้านนอก OMS · ค่าความเสี่ยงทั้งหมดเป็นเพียงการทดลอง ไม่รับประกันความเสี่ยงจริง · แผนใช้งานปัจจุบันยึด {TARGET_STOCK_DAYS.toFixed(1)} DOH
                {forecastView === "noon" && !stockOrderPlans.noonHorizonFrozen && " · แผน 10:00 เดิมไม่ได้เก็บวันที่ 3 ของอายุสินค้า จึงประเมินวันนั้นย้อนหลังแทน"}
              </p>
              <details className="mt-3 overflow-hidden rounded-xl border border-[#EBD9AC] bg-white">
                <summary className="cursor-pointer px-3 py-3 text-sm font-black text-[#8A6509] marker:text-[#8A6509]">
                  ดูผลแยกสินค้า ({displayedStockOrders.length} SKU) · ปริมาณแนะนำและความเสี่ยง
                </summary>
                <div className="space-y-2 border-t border-[#EEE0C3] bg-[#FFFEFB] p-2 sm:p-3">
                  {displayedStockOrders.map((item) => (
                    <div key={item.sku} className="rounded-xl border border-[#E9E3D4] bg-white p-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-black text-[#17453F]">{item.productName}</p>
                          <p className="mt-0.5 text-[11px] text-[#688078]">SKU {item.sku} · ราคา {item.sellingPriceBahtPerKg?.toFixed(2) ?? "N/A"} ฿/กก. · ต้นทุน {item.costBahtPerKg?.toFixed(2) ?? "N/A"} ฿/กก.</p>
                          {item.expiryProbabilityPct !== null && item.expiryProbabilityPct >= 50 &&
                            <p className="mt-1 text-xs font-black text-red-700">⚠ เสี่ยงหมดอายุสูงภายใต้เงื่อนไขขาดสินค้าไม่เกิน 5%</p>}
                        </div>
                        <div className="rounded-lg bg-[#E9F8F4] px-3 py-2 text-right">
                          <p className="text-[10px] font-bold text-[#3B7770]">แนะนำสั่ง</p>
                          <p className="text-xl font-black tabular-nums text-[#008B8B]">{item.recommendedOrderKg === null ? "N/A" : forecastQty(item.recommendedOrderKg)} <span className="text-xs">กก.</span></p>
                        </div>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                        <p>คาดเฉลี่ย <strong>{forecastQty(item.expectedDemandKg)}</strong> กก.</p>
                        <p>แผน P90 <strong>{forecastQty(item.originalP90Kg)}</strong> กก.</p>
                        <p>เสี่ยงขาด <strong>{item.shortageProbabilityPct?.toFixed(1) ?? "N/A"}%</strong></p>
                        <p>เสี่ยงหมดอายุ <strong>{item.expiryProbabilityPct?.toFixed(1) ?? "N/A"}%</strong></p>
                        <p>ขาดเฉลี่ย <strong>{item.expectedShortageKg?.toFixed(2) ?? "N/A"}</strong> กก.</p>
                        <p>หมดอายุเฉลี่ย <strong>{item.expectedExpiredKg?.toFixed(2) ?? "N/A"}</strong> กก.</p>
                        <p>ผลเสียทางการเงิน <strong>{item.expectedFinancialLossBaht?.toFixed(2) ?? "N/A"}</strong> ฿</p>
                        <p className={item.confidence === "limited" ? "font-bold text-amber-700" : "text-[#58827A]"}>{item.confidence === "limited" ? "ประวัติน้อย · ความมั่นใจต่ำ" : "ประมาณการเบื้องต้น"}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            </section>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <label htmlFor="stock-forecast-search" className="sr-only">ค้นหาสินค้าหรือ SKU</label>
            <input
              id="stock-forecast-search"
              type="search"
              value={productSearch}
              onChange={(event) => setProductSearch(event.target.value)}
              placeholder="ค้นหารหัสสินค้า หรือชื่อสินค้า"
              className="min-h-12 min-w-[220px] flex-1 rounded-xl border border-[#CDE5DE] bg-white px-4 text-sm text-[#17453F] outline-none focus:border-[#02B0AF]"
            />
            <label className="flex min-h-12 items-center gap-2 rounded-xl border border-[#CDE5DE] px-3 text-sm font-bold text-[#356C64]">
              <input type="checkbox" checked={meatOnly} onChange={(event) => setMeatOnly(event.target.checked)} className="h-4 w-4 accent-[#02B0AF]" />
              เฉพาะเนื้อสด
            </label>
            <button
              type="button"
              disabled={forecastLoading}
              onClick={() => void refreshForecast()}
              className="min-h-12 rounded-xl border border-[#A8DAD3] bg-[#E6F8F5] px-4 text-sm font-extrabold text-[#008B8B] disabled:opacity-60"
            >
              {forecastLoading ? "กำลังอัปเดต..." : "↻ อัปเดตตอนนี้"}
            </button>
          </div>

          {forecastError && <p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">{forecastError}</p>}
          {forecastLoading && !forecast && <p role="status" className="py-9 text-center text-sm text-[#648279]">กำลังคำนวณจากข้อมูลคำสั่งซื้อ...</p>}

          {displayedForecast && (
            <>
              <div className="mt-5 rounded-2xl border border-[#F5D88F] bg-[#FFF9E8] p-4 text-sm leading-6 text-[#775817]">
                <p className="font-black">{forecastView === "noon" ? "แผน ณ 10:00 น. เพื่อวางแผนรองรับคำสั่งซื้อพรุ่งนี้" : "มุมมองล่าสุดตามคำสั่งซื้อ B2B ที่เข้ามา"}</p>
                <p className="mt-1"><strong>รับแล้ว</strong> = ยอดลูกค้าขอสั่งแล้ว · <strong>คาดการณ์เฉลี่ย</strong> = รับแล้ว + คาดว่าจะสั่งเพิ่ม · <strong>แผน {PLANNING_LABEL}</strong> = ระดับความต้องการเผื่อขาดสินค้า (ไม่ใช่ปริมาณสั่งซัพพลายเออร์)</p>
                <p className="mt-1 text-xs">{forecastView === "noon" ? "ก่อน 10:00 แสดงข้อมูลล่าสุด หลัง 10:00 ใช้บันทึกถาวรของวันนั้นหากมี · " : ""}{PLANNING_LABEL} เป็นแนวทางวางแผน ไม่ใช่คำสั่งซื้อจากซัพพลายเออร์ ระบบยังไม่ได้หักสต็อกที่มีอยู่หรือคิดเวลาที่สินค้าซัพพลายเออร์มาถึง</p>
              </div>
              <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
                   <h3 className="text-lg font-black text-[#17453F]">ความต้องการคาดการณ์รวมตามสินค้า (ทุกลูกค้า)</h3>
                <span className="rounded-full bg-[#EAF8F5] px-3 py-1 text-xs font-extrabold text-[#008B8B]">
                  {visibleForecast.length} SKU
                </span>
              </div>
              <div className="mt-3 space-y-3">
                {visibleForecast.map((product) => (
                  <article key={product.sku} className="overflow-hidden rounded-2xl border border-[#CEE7E0] bg-white shadow-[0_2px_8px_rgba(18,96,89,0.04)]">
                    <div className="border-b border-[#E0EEEA] bg-[#F4FAF8] p-3 sm:p-4">
                      <h4 className="text-base font-black text-[#17453F] sm:text-lg">{product.productName}</h4>
                      <p className="mt-1 text-xs font-bold text-[#008B8B]">SKU {product.sku} · {product.customerCount} ลูกค้า · {product.units.length} หน่วยนับ</p>
                      {displayedForecast.weightConversions?.[product.sku] && (
                        <p className="mt-2 rounded-lg bg-[#E5F5F0] px-3 py-2 text-xs font-semibold leading-5 text-[#27675E]">
                          ชิ้น → กก. ≈ {displayedForecast.weightConversions[product.sku].kgPerPiece.toFixed(2)} กก./ชิ้น
                          {" · "}{displayedForecast.weightConversions[product.sku].source === "measured" ? "อ้างอิงน้ำหนักชั่งจริง" : "ประมาณจากข้อมูลหยิบเก่าที่ไม่มีจำนวนชิ้นจริง"}
                          {" "}({displayedForecast.weightConversions[product.sku].sampleCount} รายการ)
                          {displayedForecast.weightConversions[product.sku].confidence === "low" && " · ความเชื่อมั่นต่ำ"}
                          {(displayedForecast.originalPieceDemand?.[product.sku]?.today ?? 0) > 0 &&
                            ` · ยอดขอสั่งวันส่งวันนี้ ${qty(displayedForecast.originalPieceDemand[product.sku].today)} ชิ้น`}
                        </p>
                      )}
                      {displayedForecast.missingWeightConversions?.includes(product.sku) && (
                        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-bold leading-5 text-amber-800">
                          ยังไม่มีหลักฐานน้ำหนัก/ชิ้นเพียงพอ · ยอดชิ้นจะแสดงแยก ไม่สมมติว่ามีน้ำหนักเท่ากับ 1 กก.
                        </p>
                      )}
                      {product.freshMeat && <p className="mt-1 text-[11px] font-semibold text-[#A46B00]">เนื้อสด: คาดตามรอบสั่งจริง · อายุสินค้าใช้ในขั้นวางแผนสต็อก</p>}
                    </div>
                    {product.units.map((unit) => (
                      <div key={unit.unit} className="border-b border-[#DCECE7] last:border-b-0">
                        <p className="bg-[#F8FCFB] px-3 py-2 text-sm font-black text-[#007F7F] sm:px-4">หน่วย: {unit.unit}</p>
                        <div className="px-3 pt-3 sm:px-4">
                          <p className="mb-2 text-xs font-bold text-[#52796F]">ความต้องการวันส่งพรุ่งนี้ ({unit.days[1]?.date})</p>
                          <TomorrowDemandSummary day={unit.days[1]} unit={unit.unit} />
                          <DemandHistoryDetails yesterdayDate={displayedForecast.yesterdayDate}
                            yesterdayRequestedQty={unit.yesterdayRequestedQty} todayRequestedQty={unit.todayRequestedQty} days={unit.days} />
                        </div>
                        <details className="group border-t border-[#E0EEEA]">
                          <summary className="cursor-pointer px-4 py-3 text-sm font-extrabold text-[#008B8B] marker:text-[#008B8B]">
                            ดูยอดแยกรายลูกค้า ({unit.customers.length}) · {unit.unit}
                          </summary>
                          <div className="space-y-2 border-t border-[#E0EEEA] bg-[#FCFEFD] p-3">
                            {unit.customers.map((customer) => (
                              <div key={customer.customerId} className="rounded-xl border border-[#E1EEEA] bg-white p-3">
                                <p className="text-sm font-bold text-[#17453F]">{customer.customerName}</p>
                                <p className="mt-0.5 text-[11px] text-[#648279]">
                                  {customer.customerCode} · รอบสั่ง SKU (ทุกหน่วย) {customer.effectiveCadenceDays !== null ? `ทุก ${qty(customer.effectiveCadenceDays)} วัน` : "ยังไม่ทราบรอบ"}
                                  {" · "}<span className={CONFIDENCE[customer.confidence].className}>{CONFIDENCE[customer.confidence].label}</span>
                                </p>
                                <p className="mt-1 text-[11px] text-[#648279]">
                                  เวลาที่มักสั่ง: {describeCustomerOrderTime(customer.customerUsualOrderOffsetMinutes, customer.customerOrderTimingSamples)}
                                  {customer.customerOrderTimingSamples >= 3 && ` (จาก ${customer.customerOrderTimingSamples} ออเดอร์)`}
                                </p>
                                <p className="mt-1 text-[11px] text-[#648279]">
                                  หากสั่ง SKU นี้ โอกาสเลือกหน่วย {unit.unit}: {Math.round(customer.conditionalUnitShare * 100)}%
                                </p>
                                <p className="mt-1 text-[11px] text-[#648279]">
                                  โอกาสสั่งเพิ่มเป็น {unit.unit}: {customer.days.map((day, index) => `${["วันนี้", "พรุ่งนี้", "มะรืน"][index]} ${Math.round((day.projectedProbability ?? 0) * 100)}%`).join(" · ")}
                                </p>
                                <p className="mb-2 mt-3 text-[11px] font-bold text-[#52796F]">ความต้องการพรุ่งนี้</p>
                                <TomorrowDemandSummary day={customer.days[1]} unit={unit.unit} compact />
                                <DemandHistoryDetails yesterdayDate={displayedForecast.yesterdayDate}
                                  yesterdayRequestedQty={customer.yesterdayRequestedQty} todayRequestedQty={customer.todayRequestedQty} days={customer.days} compact />
                              </div>
                            ))}
                          </div>
                        </details>
                      </div>
                    ))}
                  </article>
                ))}
                {visibleForecast.length === 0 && <p className="rounded-xl border border-[#DDEAE6] p-6 text-center text-sm text-[#648279]">ยังไม่มีข้อมูลที่ตรงกับตัวกรอง หรือยังมีประวัติไม่พอสำหรับคาดการณ์</p>}
              </div>
              <p className="mt-3 text-xs leading-5 text-[#6E8982]">
                 ยอดสั่ง = ปริมาณที่ลูกค้าขอสั่งก่อนเช็คสต็อก/หยิบ/ออกบิล (ไม่นับออเดอร์ยกเลิก) โดยจัดตามวันส่ง/รับสินค้า ไม่ใช่วันที่ลูกค้ากดสั่ง · คาดเฉลี่ย = รับออเดอร์แล้ว + ผลรวมโอกาสสั่งเพิ่ม × ปริมาณเฉลี่ยที่คาดว่าจะสั่ง · แผน {PLANNING_LABEL} คือเปอร์เซ็นไทล์ประมาณ {PLANNING_TARGET}% ตามแบบจำลอง ไม่ได้รับประกันว่าจะครอบคลุมตามนั้นจริง · ไม่เอาแผนรายลูกค้ามาบวกแทนการคำนวณระดับสินค้า
              </p>
              <p className="mt-1 text-xs leading-5 text-[#6E8982]">สินค้าขายตามน้ำหนักที่ลูกค้าขอสั่งเป็นชิ้น จะเทียบเป็น กก. จากน้ำหนักชั่งจริงย้อนหลังของ SKU นั้นก่อนคำนวณรอบซื้อและปริมาณ · ค่าจากการแปลงเป็นน้ำหนักประมาณการ ไม่ใช่น้ำหนักรับประกัน · หากไม่มีข้อมูลแปลงที่เชื่อถือได้ จะคงยอดชิ้นแยกและแจ้งเตือน · ยอดขายจริงย้อนหลัง 14 วันด้านล่างยังนับจำนวนหยิบ/ออกบิลตามเดิม</p>
              <button
                type="button"
                disabled={forecastDownloading}
                onClick={() => void downloadForecast()}
                className="mt-5 flex min-h-12 w-full items-center justify-center rounded-xl bg-[#02B0AF] px-5 py-3 font-extrabold text-white disabled:opacity-60 sm:w-auto"
              >
                {forecastDownloading ? "กำลังเตรียม Excel..." : "↓ ดาวน์โหลด Excel ความต้องการ 3 วัน"}
              </button>
            </>
          )}

          <div className="mt-5 rounded-xl border border-[#F5E4B4] bg-[#FFF9E8] p-4 text-xs leading-6 text-[#806A30]">
            ระบบใช้ประวัติวันส่งย้อนหลังสูงสุด 90 วัน · เรียนรู้ความถี่การสั่งจากช่วงห่างจริงระหว่างวันส่ง และปรับเผื่อกรณีประวัติน้อย · การสั่ง SKU ใดก็ตามจะเริ่มนับรอบการสั่งรวมของลูกค้าใหม่ ส่วนรอบซื้อ SKU จะเริ่มใหม่เมื่อสั่งสินค้านั้น · เมื่อเลยช่วงเวลาที่มักกดสั่ง จะใช้ความน่าจะเป็นแบบมีเงื่อนไขว่าลูกค้ายังไม่สั่ง และปรับด้วยข้อมูลเวลาสั่งของลูกค้า B2B รายอื่นเพื่อไม่ให้มั่นใจเกินไปจากออเดอร์เพียงไม่กี่ครั้ง · หากลูกค้ามีประวัติสั่งเพิ่มหลังออเดอร์แรก จะประมาณความต้องการส่วนเพิ่มด้วย · ปริมาณต่อครั้งใช้ค่ากลางที่ทนต่อออเดอร์ใหญ่ผิดปกติ · น้ำหนัก/ชิ้นใช้ค่ากลางจากน้ำหนักชั่งจริงก่อนเวลาคาดการณ์ ไม่ใช้ข้อมูลอนาคตในการทดสอบย้อนหลัง · เนื้อสดไม่ถูกสมมติให้ลูกค้าสั่งถี่ขึ้นเพียงเพราะสินค้าต้องสด
            · ลูกค้าที่มีประวัติน้อยยังไม่ควรใช้คาดการณ์นี้สั่งสินค้าโดยตรง
          </div>
        </section>

        <section className="mt-5 rounded-[22px] border border-[#CDE9E3] bg-white p-5 shadow-[0_4px_16px_rgba(18,96,89,0.05)] sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-extrabold tracking-wide text-[#008B8B]">WALK-FORWARD BACKTEST</p>
              <h2 className="mt-1 text-xl font-black text-[#17453F]">ตรวจสอบความแม่นยำย้อนหลัง</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-[#648279]">
                ย้อนเวลากลับไปคาดการณ์ ณ 10:00 น. ของวันก่อนส่ง (เวลาจัดทำแผนให้พนักงาน ก่อนสั่งซัพพลายเออร์ 12:00 น.) แล้วเทียบกับปริมาณที่ลูกค้าขอสั่งจริงตามวันส่ง
                และเทียบกับการใช้เฉพาะยอดออเดอร์ที่รับไว้แล้ว โดยไม่ให้โมเดลเห็นคำสั่งซื้อในอนาคต
              </p>
            </div>
            <button
              type="button"
              disabled={backtestLoading}
              onClick={() => void runBacktest()}
              className="min-h-12 rounded-xl bg-[#02B0AF] px-5 py-3 text-sm font-extrabold text-white disabled:opacity-60"
            >
              {backtestLoading ? "กำลังทดสอบ..." : backtest ? "↻ ทดสอบใหม่" : "▶ ทดสอบย้อนหลัง"}
            </button>
          </div>
          {backtestError && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{backtestError}</p>}
          {backtest && (
            <div className="mt-5 space-y-5">
              <div className="rounded-xl border border-[#DDEEEA] bg-[#F4FAF8] p-3 text-sm text-[#315E54]">
                ตรวจสอบ <strong>{backtest.evaluatedDays} วันส่ง</strong> / <strong>{backtest.evaluatedSkuDays} SKU-วัน</strong>
                {" · "}เวลาอ้างอิง 10:00 น. วันก่อนส่ง (ประเทศไทย)
              </div>
              {backtest.byUnit.length ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  {backtest.byUnit.map((unit) => {
                    const improved = unit.modelWape !== null && unit.bookedOnlyWape !== null && unit.modelWape < unit.bookedOnlyWape;
                    return (
                      <div key={unit.unit} className="rounded-2xl border border-[#D7EAE5] p-4">
                        <h3 className="font-black text-[#17453F]">หน่วย {unit.unit}</h3>
                        <p className="mt-2 text-xs font-bold text-[#648279]">{unit.evaluatedSkuDays} SKU-วัน</p>
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          <div className="rounded-xl bg-[#EAF8F5] p-3">
                            <p className="text-xs font-bold text-[#356C64]">โมเดล (WAPE)</p>
                            <p className="mt-1 text-2xl font-black text-[#008B8B]">{percent(unit.modelWape)}</p>
                          </div>
                          <div className="rounded-xl bg-[#F2F5F4] p-3">
                            <p className="text-xs font-bold text-[#536E67]">เฉพาะที่สั่งแล้ว</p>
                            <p className="mt-1 text-2xl font-black text-[#315C54]">{percent(unit.bookedOnlyWape)}</p>
                          </div>
                        </div>
                        <p className={`mt-3 text-xs font-bold ${improved ? "text-emerald-700" : "text-amber-800"}`}>
                          {unit.modelWape === null || unit.bookedOnlyWape === null ? "ยอดสั่งจริงน้อยเกินกว่าจะสรุป WAPE"
                            : improved ? "โมเดลแม่นกว่ายอดสั่งที่ทราบแล้ว" : "โมเดลยังไม่ชนะการใช้เฉพาะยอดที่สั่งแล้ว"}
                        </p>
                        <p className="mt-1 text-xs text-[#648279]">
                          อคติคาดการณ์ (Bias): {percent(unit.modelBiasPct)} · จริง {qty(unit.actualQty)} {unit.unit} · คาด {qty(unit.forecastQty)} {unit.unit}
                        </p>
                        <div className="mt-3 rounded-xl border border-[#F3E0AA] bg-[#FFF9E8] p-3 text-xs leading-6 text-[#765613]">
                          <p className="font-black">ทดสอบแผน {PLANNING_LABEL}: ครอบคลุม {percent(unit.positiveDemandCoveragePct)} ของ SKU-วันที่ลูกค้าสั่งจริง ({unit.positiveDemandSkuDays} วัน)</p>
                          <p>ครอบคลุมทุก SKU-วัน {percent(unit.planningCoveragePct)} · เป้าหมาย {PLANNING_TARGET}%</p>
                          <p>ครอบคลุมปริมาณจริง {percent(unit.quantityCoveragePct)} · ยอดขอสั่งที่เกินแผน {qty(unit.underforecastQty)} {unit.unit}</p>
                          <p>สินค้า/หน่วยที่ไม่มีในแผน ณ cutoff: {unit.unmodelledSkuDays} SKU-วัน ({qty(unit.unmodelledQty)} {unit.unit})</p>
                          <p>ยอดแผนรวมที่ประเมิน {qty(unit.planningQty)} {unit.unit}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="rounded-xl bg-[#FFF7DC] p-4 text-sm text-[#815B00]">ยังมีข้อมูลประวัติไม่พอสำหรับทดสอบย้อนหลังอย่างน้อย 7 วันก่อนรอบที่ประเมิน</p>
              )}
              <p className="text-xs leading-6 text-[#6E8982]">
                WAPE = ผลรวมความคลาดเคลื่อนสัมบูรณ์ราย SKU ÷ ยอดสั่งจริง (ยิ่งต่ำยิ่งดี) · คิดแยกตามหน่วย กก./ชิ้น ·
                Bias บวกหมายถึงคาดสูงเกินจริง และ Bias ลบหมายถึงคาดต่ำเกินจริง · Coverage วันที่สั่งจริงไม่นับวันที่ไม่มีความต้องการ จึงสะท้อนความเสี่ยงขาดสินค้าชัดกว่า · ผลย้อนหลังอาศัยการจำลองจากข้อมูลปัจจุบัน ส่วนแผนจริงตั้งแต่เริ่มใช้ระบบจะถูกบันทึกถาวรทุกวันเวลา 10:00 น.
              </p>
              {backtest.days.length > 0 && (
                <details className="rounded-xl border border-[#DDEEEA]">
                  <summary className="cursor-pointer px-4 py-3 text-sm font-extrabold text-[#008B8B]">
                    ดูผลรายวันและหน่วย ({backtest.days.length} แถว)
                  </summary>
                  <div className="overflow-x-auto border-t border-[#DDEEEA]">
                    <table className="w-full min-w-[660px] text-left text-xs">
                      <thead className="bg-[#F3FAF8] text-[#436F66]">
                        <tr>
                          <th className="px-3 py-3">วันส่ง</th>
                          <th className="px-3 py-3">หน่วย</th>
                          <th className="px-3 py-3 text-right">สั่งจริง</th>
                          <th className="px-3 py-3 text-right">คาดการณ์</th>
                          <th className="px-3 py-3 text-right">แผน {PLANNING_LABEL}</th>
                          <th className="px-3 py-3 text-right">สั่งแล้ว ณ cutoff</th>
                          <th className="px-3 py-3 text-right">WAPE โมเดล</th>
                        </tr>
                      </thead>
                      <tbody>
                        {backtest.days.map((day) => (
                          <tr key={`${day.deliveryDate}:${day.unit}`} className="border-t border-[#E1EEEA] text-[#355E57]">
                            <td className="px-3 py-2.5">{day.deliveryDate}</td>
                            <td className="px-3 py-2.5">{day.unit}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums">{qty(day.actualQty)}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums">{qty(day.forecastQty)}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums">{qty(day.planningQty)}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums">{qty(day.bookedOnlyQty)}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums">{percent(day.wape)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}
              <div className="rounded-xl border border-[#F5E4B4] bg-[#FFF9E8] p-4 text-xs leading-6 text-[#806A30]">
                {backtest.limitations.map((limitation) => <p key={limitation}>• {limitation}</p>)}
              </div>
            </div>
          )}
        </section>

        <section className="mt-5 rounded-[22px] border border-[#D8E9E5] bg-white p-5 shadow-[0_4px_16px_rgba(18,96,89,0.05)] sm:p-7">
          <div className="flex items-start gap-3">
            <span aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#E6F8F5] text-2xl">📊</span>
            <div>
              <h2 className="text-xl font-black text-[#17453F]">ปริมาณขายย้อนหลัง 14 วัน</h2>
              <p className="mt-1 text-sm text-[#6B8880]">
                {dates.length ? `${dates[0]} – ${dates[dates.length - 1]}` : "14 วันล่าสุด"} (เวลาไทย)
              </p>
            </div>
          </div>

          <p className="mt-5 text-sm leading-7 text-[#466F67]">
            ดาวน์โหลด Excel โดยเรียงแถวตาม <strong>ลูกค้า → รหัสสินค้า → ชื่อสินค้า → หน่วยนับ</strong>
            และแสดงยอดขายแต่ละวันเป็นคอลัมน์ พร้อมยอดรวม 14 วันของสินค้าแต่ละรายการ
          </p>
          <div className="mt-4 rounded-xl bg-[#F3FAF8] p-4 text-sm leading-6 text-[#557C73]">
            <p><strong>วันที่ขาย:</strong> วันที่ปิดงาน Billing สำเร็จ</p>
            <p><strong>ปริมาณขาย:</strong> จำนวนที่หยิบจริง (สินค้าขายตามน้ำหนักจะแสดงเป็น กก.)</p>
            <p><strong>การนับ:</strong> ไม่นับออเดอร์ที่ยกเลิก และนับออเดอร์ที่แยก /1, /2 เพียงครั้งเดียว</p>
          </div>

          {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}

          <button
            type="button"
            disabled={downloading}
            onClick={() => void downloadReport()}
            className="mt-6 flex min-h-14 w-full items-center justify-center gap-3 rounded-2xl bg-[#02B0AF] px-5 py-3 text-base font-extrabold text-white shadow-[0_6px_16px_rgba(0,153,150,0.15)] transition hover:bg-[#009A9A] disabled:cursor-wait disabled:opacity-60 sm:w-auto"
          >
            <span aria-hidden="true">↓</span>
            {downloading ? "กำลังจัดทำไฟล์ Excel..." : "ดาวน์โหลด Excel ปริมาณขาย 14 วัน"}
          </button>
        </section>

        <p className="mt-5 text-center text-xs leading-5 text-[#79928B]">
          ระบบคาดการณ์เชื่อมต่อยอดนับสต็อกรายวันแล้ว แต่ยังไม่มีอายุสินค้าแยกล็อต · ยังไม่ส่งคำสั่งซื้อให้ซัพพลายเออร์อัตโนมัติ
        </p>
        </>}
      </div>
    </main>
  );
}
