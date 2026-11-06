"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import LotusLoading from "@/components/LotusLoading";
import { supabase } from "@/lib/supabase";
import { stockReportDates } from "@/lib/stockSalesReport";
import { aggregateForecastByProduct, describeCustomerOrderTime, STOCK_PLANNING_PERCENTILE, type ForecastDay, type StockForecast } from "@/lib/stockForecast";
import type { DemandBacktestReport } from "@/lib/stockForecastBacktest";

type Access = "loading" | "manager" | "denied" | "signed-out";
const PLANNING_LABEL = `P${Math.round(STOCK_PLANNING_PERCENTILE * 100)}`;
const PLANNING_TARGET = Math.round(STOCK_PLANNING_PERCENTILE * 100);

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

export default function StockManagementPage() {
  const [access, setAccess] = useState<Access>("loading");
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");
  const [dates] = useState<string[]>(() => stockReportDates());
  const [forecast, setForecast] = useState<StockForecast | null>(null);
  const [noonForecast, setNoonForecast] = useState<StockForecast | null>(null);
  const [forecastView, setForecastView] = useState<"noon" | "live">("noon");
  const [forecastLoading, setForecastLoading] = useState(false);
  const [forecastError, setForecastError] = useState("");
  const [forecastDownloading, setForecastDownloading] = useState(false);
  const [productSearch, setProductSearch] = useState("");
  const [meatOnly, setMeatOnly] = useState(false);
  const [backtest, setBacktest] = useState<DemandBacktestReport | null>(null);
  const [backtestLoading, setBacktestLoading] = useState(false);
  const [backtestError, setBacktestError] = useState("");

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
      const next = (await response.json()) as StockForecast & { noonForecast?: StockForecast };
      setForecast(next);
      setNoonForecast(next.noonForecast ?? null);
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
  const productForecast = useMemo(() =>
    displayedForecast ? aggregateForecastByProduct(displayedForecast.rows, displayedForecast.dates) : [], [displayedForecast]);

  const visibleForecast = useMemo(() => {
    const filter = productSearch.trim().toLocaleLowerCase();
    return productForecast.filter((row) =>
      (!meatOnly || row.freshMeat) &&
      (!filter || [row.sku, row.productName, ...row.units.map((unit) => unit.unit)]
        .some((part) => part.toLocaleLowerCase().includes(filter)))
    );
  }, [productForecast, productSearch, meatOnly]);

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
              <p className="mt-2 text-sm text-[#6B8880]">พยากรณ์ความต้องการจากยอดสั่งของลูกค้า พร้อมรายงานยอดขายจริงแยกต่างหาก</p>
            </div>
            <span className="rounded-full border border-[#F7DB83] bg-[#FFF7DC] px-4 py-2 text-sm font-extrabold text-[#815B00]">
              Manager
            </span>
          </div>
        </header>

        <section className="mt-5 rounded-[22px] border border-[#CDE9E3] bg-white p-5 shadow-[0_4px_16px_rgba(18,96,89,0.05)] sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-extrabold tracking-wide text-[#008B8B]">REQUESTED DEMAND + ROLLING FORECAST</p>
              <h2 className="mt-1 text-2xl font-black text-[#17453F]">พยากรณ์ความต้องการสินค้า 3 วัน</h2>
              <p className="mt-2 text-sm leading-6 text-[#648279]">
                ใช้ Requested Qty ตามวันส่ง/รับสินค้า · เรียนรู้รอบสั่งสินค้าและช่วงเวลาของลูกค้า · มีทั้งแผนก่อนเที่ยงสำหรับสั่งสต็อก และคาดการณ์สด · อัปเดตทุก 1 นาที
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
              แผนสั่งสต็อกก่อน 12:00 น.
            </button>
            <button type="button" aria-pressed={forecastView === "live"} onClick={() => setForecastView("live")}
              className={`min-h-11 rounded-xl border px-4 py-2 text-sm font-black ${forecastView === "live" ? "border-[#02B0AF] bg-[#E5F8F5] text-[#008B8B]" : "border-[#CDE5DE] bg-white text-[#557A71]"}`}>
              คาดการณ์สด
            </button>
          </div>
          {displayedForecast && (
            <div className="mt-5 rounded-xl border border-[#DDEEEA] p-2">
              <p className="px-2 pt-1 text-xs font-extrabold text-[#436F66]">สรุปเนื้อสดทั้งหมด (กก. รวมชิ้นที่เทียบเป็นน้ำหนักได้)</p>
              <FivePeriodGrid
                yesterdayDate={displayedForecast.yesterdayDate}
                yesterdayRequestedQty={productForecast.filter((row) => row.freshMeat).flatMap((row) => row.units.filter((unit) => unit.unit === "กก.")).reduce((sum, unit) => sum + unit.yesterdayRequestedQty, 0)}
                todayRequestedQty={productForecast.filter((row) => row.freshMeat).flatMap((row) => row.units.filter((unit) => unit.unit === "กก.")).reduce((sum, unit) => sum + unit.todayRequestedQty, 0)}
                days={displayedForecast.dates.map((date, index) => {
                  const meat = productForecast.filter((row) => row.freshMeat).flatMap((row) => row.units.filter((unit) => unit.unit === "กก."));
                  return {
                    date,
                    knownQty: meat.reduce((sum, row) => sum + row.days[index].knownQty, 0),
                    projectedQty: meat.reduce((sum, row) => sum + row.days[index].projectedQty, 0),
                    totalQty: meat.reduce((sum, row) => sum + row.days[index].totalQty, 0),
                    planningQty: meat.reduce((sum, row) => sum + (row.days[index].planningQty ?? row.days[index].totalQty), 0),
                  };
                })}
              />
              <p className="px-2 pb-1 text-[10px] text-[#728E86]">{PLANNING_LABEL} ของเนื้อสดรวม = ผลรวมแผนราย SKU สำหรับดูภาพรวม ไม่ใช่ค่าเปอร์เซ็นไทล์ของยอดทุกสินค้าเมื่อรวมกัน</p>
            </div>
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
                <p className="font-black">{forecastView === "noon" ? "แผน ณ จุดตัด 12:00 น. สำหรับสั่งสินค้าให้รองรับ B2B พรุ่งนี้" : "ความต้องการ B2B ที่อัปเดตตามออเดอร์สด"}</p>
                <p className="mt-1">ตัวเลขหลักเป็น <strong>คาดการณ์เฉลี่ย</strong> จากยอดที่สั่งแล้วและความน่าจะเป็นที่จะสั่งเพิ่ม ส่วน <strong>แผน {PLANNING_LABEL}</strong> เผื่อทั้งโอกาสสั่งและความผันผวนของปริมาณต่อครั้ง โดยลดน้ำหนักข้อมูลสุดโต่งเมื่อมีตัวอย่างน้อย</p>
                <p className="mt-1 text-xs">{forecastView === "noon" ? "ก่อนเที่ยงจะแสดง ณ เวลาปัจจุบัน หลังเที่ยงจะจำลองจากออเดอร์ที่ส่งก่อน 12:00 น. (ยังไม่ใช่ snapshot เก็บถาวร) · " : ""}{PLANNING_LABEL} เป็นแนวทางวางแผน ไม่ใช่คำสั่งซื้อจากซัพพลายเออร์ ระบบยังไม่ได้หักสต็อกที่มีอยู่หรือคิดเวลาที่สินค้าซัพพลายเออร์มาถึง</p>
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
                        <div className="mx-2 mt-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#F2DFA8] bg-[#FFF9E8] px-3 py-2 text-xs text-[#765613] sm:mx-3">
                          <span className="font-bold">แผนรองรับความต้องการพรุ่งนี้ ({PLANNING_LABEL})</span>
                          <strong className="text-lg tabular-nums">{forecastQty(unit.days[1]?.planningQty ?? unit.days[1]?.totalQty ?? 0)} {unit.unit}</strong>
                        </div>
                        <FivePeriodGrid yesterdayDate={displayedForecast.yesterdayDate} yesterdayRequestedQty={unit.yesterdayRequestedQty} todayRequestedQty={unit.todayRequestedQty} days={unit.days} />
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
                                <FivePeriodGrid yesterdayDate={displayedForecast.yesterdayDate} yesterdayRequestedQty={customer.yesterdayRequestedQty} todayRequestedQty={customer.todayRequestedQty} days={customer.days} compact />
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
                ย้อนเวลากลับไปคาดการณ์ ณ 12:00 น. ของวันก่อนส่ง (เวลาปิดรับคำสั่งซื้อสต็อกของพนักงาน) แล้วเทียบกับปริมาณที่ลูกค้าขอสั่งจริงตามวันส่ง
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
                {" · "}เวลาอ้างอิง 12:00 น. วันก่อนส่ง (ประเทศไทย)
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
                Bias บวกหมายถึงคาดสูงเกินจริง และ Bias ลบหมายถึงคาดต่ำเกินจริง · Coverage วันที่สั่งจริงไม่นับวันที่ไม่มีความต้องการ จึงสะท้อนความเสี่ยงขาดสินค้าชัดกว่า · ผลย้อนหลังอาจมีจำนวนวันน้อย และยังไม่มี snapshot ณ เวลา 12:00 น. แบบถาวร
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
          ระบบคาดการณ์กำลังอยู่ในระยะทดลอง · ยังไม่เชื่อมต่อยอดสต็อกจริงหรือส่งคำสั่งซื้อให้ซัพพลายเออร์
        </p>
      </div>
    </main>
  );
}
