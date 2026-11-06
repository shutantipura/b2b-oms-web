"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import LotusLoading from "@/components/LotusLoading";
import { supabase } from "@/lib/supabase";
import { stockReportDates } from "@/lib/stockSalesReport";
import { aggregateForecastByProduct, describeCustomerOrderTime, type ForecastDay, type StockForecast } from "@/lib/stockForecast";
import type { DemandBacktestReport } from "@/lib/stockForecastBacktest";

type Access = "loading" | "manager" | "denied" | "signed-out";

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
    { label: "สั่งเมื่อวาน", date: yesterdayDate, value: yesterdayRequestedQty, actual: true },
    { label: "สั่งวันนี้", date: days[0].date, value: todayRequestedQty, actual: true },
    { label: "คาดปิดวันนี้", date: days[0].date, value: days[0].totalQty, actual: false },
    { label: "คาดพรุ่งนี้", date: days[1].date, value: days[1].totalQty, actual: false },
    { label: "คาดมะรืน", date: days[2].date, value: days[2].totalQty, actual: false },
  ];
  return (
    <div className="grid grid-cols-5 gap-1 p-1.5 sm:gap-2 sm:p-2" aria-label="ความต้องการตามคำสั่งซื้อจริงและคาดการณ์ห้าช่วงเวลา">
      {periods.map((period) => (
        <div key={period.label} className={`min-w-0 rounded-lg px-0.5 py-2 text-center sm:rounded-xl sm:px-2 sm:py-3 ${period.actual ? "bg-[#F1F5F4]" : "bg-[#EAF8F5]"}`}>
          <p className="text-[9px] font-extrabold leading-3 text-[#355E57] sm:text-xs sm:leading-4">{period.label}</p>
          <p className="mt-0.5 text-[9px] text-[#77918A] sm:text-[10px]">{period.date.slice(5)}</p>
          <p className={`mt-1 break-words font-black tracking-tight tabular-nums sm:mt-2 ${compact ? "text-xs sm:text-base" : "text-[clamp(0.75rem,2.9vw,1.5rem)] sm:text-xl"} ${period.actual ? "text-[#315C54]" : "text-[#008B8B]"}`}>{forecastQty(period.value)}</p>
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
      const next = (await response.json()) as StockForecast;
      setForecast(next);
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

  const productForecast = useMemo(() =>
    forecast ? aggregateForecastByProduct(forecast.rows, forecast.dates) : [], [forecast]);

  const visibleForecast = useMemo(() => {
    const filter = productSearch.trim().toLocaleLowerCase();
    return productForecast.filter((row) =>
      (!meatOnly || row.freshMeat) &&
      (!filter || [row.sku, row.productName, row.unit]
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
      const response = await fetch("/api/admin/stock-forecast?format=xlsx", {
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
                ใช้ Requested Qty ตามวันส่ง/รับสินค้า · ประเมินทั้งรอบสั่งรวมของลูกค้าและรอบซื้อสินค้าแต่ละ SKU · หากลูกค้าเพิ่งสั่งเมื่อวาน โอกาสมีออเดอร์ใหม่วันนี้จะลดลง · พิจารณาช่วงเวลาสั่งประจำด้วย · อัปเดตทุก 1 นาที
              </p>
              {forecast && (
                <p className="mt-1 text-xs text-[#77918A]">
                  คำนวณล่าสุด {new Date(forecast.asOf).toLocaleTimeString("th-TH", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit" })} น. (เวลาไทย)
                </p>
              )}
            </div>
            <span className="rounded-full border border-[#F7DB83] bg-[#FFF7DC] px-3 py-2 text-xs font-extrabold text-[#815B00]">
              ทดลองคาดการณ์ · ยังไม่สั่งสต็อกอัตโนมัติ
            </span>
          </div>

          {forecast && (
            <div className="mt-5 rounded-xl border border-[#DDEEEA] p-2">
              <p className="px-2 pt-1 text-xs font-extrabold text-[#436F66]">สรุปเนื้อสดทั้งหมด (กก.)</p>
              <FivePeriodGrid
                yesterdayDate={forecast.yesterdayDate}
                yesterdayRequestedQty={productForecast.filter((row) => row.unit === "กก." && row.freshMeat).reduce((sum, row) => sum + row.yesterdayRequestedQty, 0)}
                todayRequestedQty={productForecast.filter((row) => row.unit === "กก." && row.freshMeat).reduce((sum, row) => sum + row.todayRequestedQty, 0)}
                days={forecast.dates.map((date, index) => {
                  const meat = productForecast.filter((row) => row.unit === "กก." && row.freshMeat);
                  return {
                    date,
                    knownQty: meat.reduce((sum, row) => sum + row.days[index].knownQty, 0),
                    projectedQty: meat.reduce((sum, row) => sum + row.days[index].projectedQty, 0),
                    totalQty: meat.reduce((sum, row) => sum + row.days[index].totalQty, 0),
                  };
                })}
              />
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

          {forecast && (
            <>
              <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
                   <h3 className="text-lg font-black text-[#17453F]">ความต้องการคาดการณ์รวมตามสินค้า (ทุกลูกค้า)</h3>
                <span className="rounded-full bg-[#EAF8F5] px-3 py-1 text-xs font-extrabold text-[#008B8B]">
                  {visibleForecast.length} SKU / หน่วย
                </span>
              </div>
              <div className="mt-3 space-y-3">
                {visibleForecast.map((product) => (
                  <article key={`${product.sku}:${product.unit}`} className="overflow-hidden rounded-2xl border border-[#CEE7E0] bg-white shadow-[0_2px_8px_rgba(18,96,89,0.04)]">
                    <div className="border-b border-[#E0EEEA] bg-[#F4FAF8] p-3 sm:p-4">
                      <h4 className="text-base font-black text-[#17453F] sm:text-lg">{product.productName}</h4>
                      <p className="mt-1 text-xs font-bold text-[#008B8B]">SKU {product.sku} · {product.unit} · {product.customerCount} ลูกค้า</p>
                      {product.freshMeat && <p className="mt-1 text-[11px] font-semibold text-[#A46B00]">เนื้อสด: คาดตามรอบสั่งจริง · อายุสินค้าใช้ในขั้นวางแผนสต็อก</p>}
                    </div>
                     <FivePeriodGrid yesterdayDate={forecast.yesterdayDate} yesterdayRequestedQty={product.yesterdayRequestedQty} todayRequestedQty={product.todayRequestedQty} days={product.days} />
                    <details className="group border-t border-[#E0EEEA]">
                      <summary className="cursor-pointer px-4 py-3 text-sm font-extrabold text-[#008B8B] marker:text-[#008B8B]">
                        ดูยอดแยกรายลูกค้า ({product.customerCount})
                      </summary>
                      <div className="space-y-2 border-t border-[#E0EEEA] bg-[#FCFEFD] p-3">
                        {product.customers.map((customer) => (
                          <div key={customer.customerId} className="rounded-xl border border-[#E1EEEA] bg-white p-3">
                            <p className="text-sm font-bold text-[#17453F]">{customer.customerName}</p>
                            <p className="mt-0.5 text-[11px] text-[#648279]">
                              {customer.customerCode} · {customer.effectiveCadenceDays !== null ? `ทุก ${qty(customer.effectiveCadenceDays)} วัน` : "ยังไม่ทราบรอบ"}
                              {" · "}<span className={CONFIDENCE[customer.confidence].className}>{CONFIDENCE[customer.confidence].label}</span>
                            </p>
                            <p className="mt-1 text-[11px] text-[#648279]">
                              เวลาที่มักสั่ง: {describeCustomerOrderTime(customer.customerUsualOrderOffsetMinutes, customer.customerOrderTimingSamples)}
                              {customer.customerOrderTimingSamples >= 3 && ` (จาก ${customer.customerOrderTimingSamples} ออเดอร์)`}
                            </p>
                            <p className="mt-1 text-[11px] text-[#648279]">
                              โอกาสสั่งเพิ่ม: {customer.days.map((day, index) => `${["วันนี้", "พรุ่งนี้", "มะรืน"][index]} ${Math.round((day.projectedProbability ?? 0) * 100)}%`).join(" · ")}
                            </p>
                             <FivePeriodGrid yesterdayDate={forecast.yesterdayDate} yesterdayRequestedQty={customer.yesterdayRequestedQty} todayRequestedQty={customer.todayRequestedQty} days={customer.days} compact />
                          </div>
                        ))}
                      </div>
                    </details>
                  </article>
                ))}
                {visibleForecast.length === 0 && <p className="rounded-xl border border-[#DDEAE6] p-6 text-center text-sm text-[#648279]">ยังไม่มีข้อมูลที่ตรงกับตัวกรอง หรือยังมีประวัติไม่พอสำหรับคาดการณ์</p>}
              </div>
              <p className="mt-3 text-xs leading-5 text-[#6E8982]">
                 ยอดสั่ง = ปริมาณที่ลูกค้าขอสั่งก่อนเช็คสต็อก/หยิบ/ออกบิล (ไม่นับออเดอร์ยกเลิก) ตามวันส่ง/รับสินค้า · คาดปิดวันนี้รวมยอดที่สั่งแล้ว จึงไม่นับซ้ำ · ค่ารายลูกค้าเลือกปริมาณเต็มเมื่อมีโอกาสเกิน 50% · ค่ารวมสินค้าเลือกปริมาณที่น่าจะเกิดขึ้นมากที่สุดจากการรวมความเป็นไปได้ของทุกลูกค้า จึงอาจไม่เท่าผลรวมค่ารายลูกค้า
              </p>
              <p className="mt-1 text-xs leading-5 text-[#6E8982]">สินค้าที่สั่งเป็นชิ้นจะแสดงหน่วยเป็นชิ้น แม้ตอนออกบิลจะคิดราคาตามน้ำหนัก · ยอดขายจริงย้อนหลัง 14 วันด้านล่างยังนับจำนวนหยิบ/ออกบิลตามเดิม</p>
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
            ระบบใช้ประวัติวันส่งย้อนหลังสูงสุด 90 วัน · เรียนรู้ความถี่การสั่งจากช่วงห่างจริงระหว่างวันส่ง และปรับเผื่อกรณีประวัติน้อย · การสั่ง SKU ใดก็ตามจะเริ่มนับรอบการสั่งรวมของลูกค้าใหม่ ส่วนรอบซื้อ SKU จะเริ่มใหม่เมื่อสั่งสินค้านั้น · เมื่อเลยช่วงเวลาที่มักกดสั่ง จะใช้ความน่าจะเป็นแบบมีเงื่อนไขว่าลูกค้ายังไม่สั่ง · ปริมาณต่อครั้งใช้ค่ากลางที่ทนต่อออเดอร์ใหญ่ผิดปกติ · เนื้อสดไม่ถูกสมมติให้ลูกค้าสั่งถี่ขึ้นเพียงเพราะสินค้าต้องสด
            · ลูกค้าที่มีประวัติน้อยยังไม่ควรใช้คาดการณ์นี้สั่งสินค้าโดยตรง
          </div>
        </section>

        <section className="mt-5 rounded-[22px] border border-[#CDE9E3] bg-white p-5 shadow-[0_4px_16px_rgba(18,96,89,0.05)] sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-extrabold tracking-wide text-[#008B8B]">WALK-FORWARD BACKTEST</p>
              <h2 className="mt-1 text-xl font-black text-[#17453F]">ตรวจสอบความแม่นยำย้อนหลัง</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-[#648279]">
                ย้อนเวลากลับไปคาดการณ์ ณ 16:00 น. ของวันก่อนส่ง แล้วเทียบกับปริมาณที่ลูกค้าขอสั่งจริงตามวันส่ง
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
                {" · "}เวลาอ้างอิง 16:00 น. วันก่อนส่ง (ประเทศไทย)
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
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="rounded-xl bg-[#FFF7DC] p-4 text-sm text-[#815B00]">ยังมีข้อมูลประวัติไม่พอสำหรับทดสอบย้อนหลังอย่างน้อย 7 วันก่อนรอบที่ประเมิน</p>
              )}
              <p className="text-xs leading-6 text-[#6E8982]">
                WAPE = ผลรวมความคลาดเคลื่อนสัมบูรณ์ราย SKU ÷ ยอดสั่งจริง (ยิ่งต่ำยิ่งดี) · คิดแยกตามหน่วย กก./ชิ้น ·
                Bias บวกหมายถึงคาดสูงเกินจริง และ Bias ลบหมายถึงคาดต่ำเกินจริง
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
