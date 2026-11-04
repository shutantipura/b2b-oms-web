"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import LotusLoading from "@/components/LotusLoading";
import { supabase } from "@/lib/supabase";
import { stockReportDates } from "@/lib/stockSalesReport";
import { aggregateForecastByProduct, type ForecastDay, type StockForecast } from "@/lib/stockForecast";

type Access = "loading" | "manager" | "denied" | "signed-out";

function qty(value: number) {
  return value.toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 3 });
}

function forecastQty(value: number) {
  return value.toLocaleString("th-TH", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

const CONFIDENCE = {
  high: { label: "สูง", className: "bg-emerald-50 text-emerald-700" },
  medium: { label: "ปานกลาง", className: "bg-sky-50 text-sky-700" },
  low: { label: "ต่ำ", className: "bg-amber-50 text-amber-800" },
  insufficient: { label: "ข้อมูลน้อย", className: "bg-slate-100 text-slate-600" },
};

function FivePeriodGrid({ yesterdayDate, yesterdayActualQty, todayActualQty, days, compact = false }: {
  yesterdayDate: string;
  yesterdayActualQty: number;
  todayActualQty: number;
  days: ForecastDay[];
  compact?: boolean;
}) {
  const periods = [
    { label: "เมื่อวาน", date: yesterdayDate, value: yesterdayActualQty, actual: true },
    { label: "จริงวันนี้", date: days[0].date, value: todayActualQty, actual: true },
    { label: "คาดปิดวันนี้", date: days[0].date, value: days[0].totalQty, actual: false },
    { label: "คาดพรุ่งนี้", date: days[1].date, value: days[1].totalQty, actual: false },
    { label: "คาดมะรืน", date: days[2].date, value: days[2].totalQty, actual: false },
  ];
  return (
    <div className="grid grid-cols-5 gap-1 p-1.5 sm:gap-2 sm:p-2" aria-label="ยอดขายจริงและคาดการณ์ห้าช่วงเวลา">
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
      link.download = `stock_forecast_${forecast?.dates[0] ?? "today"}.xlsx`;
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
              <p className="mt-2 text-sm text-[#6B8880]">รายงานปริมาณขาย เพื่อเตรียมวางแผนการสั่งสินค้าและสต็อก</p>
            </div>
            <span className="rounded-full border border-[#F7DB83] bg-[#FFF7DC] px-4 py-2 text-sm font-extrabold text-[#815B00]">
              Manager
            </span>
          </div>
        </header>

        <section className="mt-5 rounded-[22px] border border-[#CDE9E3] bg-white p-5 shadow-[0_4px_16px_rgba(18,96,89,0.05)] sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-extrabold tracking-wide text-[#008B8B]">ACTUAL SALES + ROLLING FORECAST</p>
              <h2 className="mt-1 text-2xl font-black text-[#17453F]">ยอดขายจริงและคาดการณ์ 3 วัน</h2>
              <p className="mt-2 text-sm leading-6 text-[#648279]">
                ใช้ปริมาณที่มีโอกาสเกิดขึ้นมากที่สุดของลูกค้าแต่ละราย ไม่เฉลี่ยด้วยความน่าจะเป็น · อัปเดตอัตโนมัติทุก 1 นาที
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
                yesterdayActualQty={productForecast.filter((row) => row.unit === "กก." && row.freshMeat).reduce((sum, row) => sum + row.yesterdayActualQty, 0)}
                todayActualQty={productForecast.filter((row) => row.unit === "กก." && row.freshMeat).reduce((sum, row) => sum + row.todayActualQty, 0)}
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
                <div>
                  <h3 className="text-lg font-black text-[#17453F]">ยอดคาดการณ์รวมตามสินค้า (ทุกลูกค้า)</h3>
                  <p className="mt-1 text-xs font-semibold text-[#648279]">เรียงตามยอดคาดการณ์พรุ่งนี้: มาก → น้อย</p>
                </div>
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
                      {product.freshMeat && <p className="mt-1 text-[11px] font-semibold text-[#A46B00]">เนื้อสด: รอบคาดการณ์ไม่เกิน 2 วัน</p>}
                    </div>
                    <FivePeriodGrid yesterdayDate={forecast.yesterdayDate} yesterdayActualQty={product.yesterdayActualQty} todayActualQty={product.todayActualQty} days={product.days} />
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
                            <FivePeriodGrid yesterdayDate={forecast.yesterdayDate} yesterdayActualQty={customer.yesterdayActualQty} todayActualQty={customer.todayActualQty} days={customer.days} compact />
                          </div>
                        ))}
                      </div>
                    </details>
                  </article>
                ))}
                {visibleForecast.length === 0 && <p className="rounded-xl border border-[#DDEAE6] p-6 text-center text-sm text-[#648279]">ยังไม่มีข้อมูลที่ตรงกับตัวกรอง หรือยังมีประวัติไม่พอสำหรับคาดการณ์</p>}
              </div>
              <p className="mt-3 text-xs leading-5 text-[#6E8982]">
                ยอดขายจริง = ปริมาณที่ปิด Billing แล้วตามวันส่ง/รับสินค้า · คาดปิดวันนี้รวมยอดจริงและคำสั่งซื้อวันนี้ไว้แล้ว จึงไม่นับซ้ำ · คาดเพิ่ม = ปริมาณเต็มเมื่อโอกาสสั่งมากกว่า 50%
              </p>
              {forecast.unmeasuredPieceOrders > 0 && (
                <p className="mt-2 rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-800">
                  มี {forecast.unmeasuredPieceOrders} รายการแบบขายชิ้นคิดราคาตามน้ำหนักที่ยังไม่มีข้อมูลเพียงพอแปลงเป็น กก. ระบบยังไม่รวมจำนวนเหล่านี้ไว้ในยอด กก.
                </p>
              )}
              <button
                type="button"
                disabled={forecastDownloading}
                onClick={() => void downloadForecast()}
                className="mt-5 flex min-h-12 w-full items-center justify-center rounded-xl bg-[#02B0AF] px-5 py-3 font-extrabold text-white disabled:opacity-60 sm:w-auto"
              >
                {forecastDownloading ? "กำลังเตรียม Excel..." : "↓ ดาวน์โหลด Excel คาดการณ์ 3 วัน"}
              </button>
            </>
          )}

          <div className="mt-5 rounded-xl border border-[#F5E4B4] bg-[#FFF9E8] p-4 text-xs leading-6 text-[#806A30]">
            ระบบใช้ประวัติสูงสุด 90 วัน โดยจำแนกรอบซื้อแต่ละ SKU และรอบสั่งของลูกค้า · ถ้าคาดว่าจะสั่งในวันหนึ่ง จะเริ่มนับรอบซื้อใหม่สำหรับวันถัดไป · เนื้อสดไม่เกิน 2 วันโดยปรับปริมาณตามอัตราใช้เฉลี่ย
            · ลูกค้าที่มีประวัติน้อยยังไม่ควรใช้คาดการณ์นี้สั่งสินค้าโดยตรง
          </div>
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
