"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import LotusLoading from "@/components/LotusLoading";
import { supabase } from "@/lib/supabase";
import { stockReportDates } from "@/lib/stockSalesReport";
import type { StockForecast } from "@/lib/stockForecast";

type Access = "loading" | "manager" | "denied" | "signed-out";

function qty(value: number) {
  return value.toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 3 });
}

const CONFIDENCE = {
  high: { label: "สูง", className: "bg-emerald-50 text-emerald-700" },
  medium: { label: "ปานกลาง", className: "bg-sky-50 text-sky-700" },
  low: { label: "ต่ำ", className: "bg-amber-50 text-amber-800" },
  insufficient: { label: "ข้อมูลน้อย", className: "bg-slate-100 text-slate-600" },
};

export default function StockManagementPage() {
  const [access, setAccess] = useState<Access>("loading");
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");
  const [dates] = useState<string[]>(() => stockReportDates());
  const [forecast, setForecast] = useState<StockForecast | null>(null);
  const [forecastLoading, setForecastLoading] = useState(false);
  const [forecastError, setForecastError] = useState("");
  const [forecastDownloading, setForecastDownloading] = useState(false);
  const [customerSearch, setCustomerSearch] = useState("");
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

  const visibleForecast = useMemo(() => {
    const filter = customerSearch.trim().toLocaleLowerCase();
    return (forecast?.rows ?? []).filter((row) =>
      (!meatOnly || row.freshMeat) &&
      (!filter || [row.customerName, row.customerCode, row.sku, row.productName]
        .some((part) => part.toLocaleLowerCase().includes(filter)))
    );
  }, [forecast, customerSearch, meatOnly]);

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
              <p className="text-xs font-extrabold tracking-wide text-[#008B8B]">ROLLING FORECAST · 3 DAYS</p>
              <h2 className="mt-1 text-2xl font-black text-[#17453F]">พยากรณ์ปริมาณขายล่วงหน้า 3 วัน</h2>
              <p className="mt-2 text-sm leading-6 text-[#648279]">
                จากรอบการสั่งของลูกค้าและสินค้า · อัปเดตอัตโนมัติทุก 1 นาที
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
            <div className="mt-5 grid grid-cols-3 gap-2">
              {forecast.dates.map((date, index) => {
                const kilos = forecast.rows
                  .filter((row) => row.unit === "กก." && row.freshMeat)
                  .reduce((sum, row) => sum + row.days[index].totalQty, 0);
                return (
                  <div key={date} className="rounded-xl border border-[#DDEEEA] bg-[#F3FAF8] p-3 text-center">
                    <p className="text-xs font-semibold text-[#648279]">{["วันนี้", "พรุ่งนี้", "มะรืน"][index]}</p>
                    <p className="mt-1 text-xs text-[#77918A]">{date}</p>
                    <p className="mt-2 text-xl font-black text-[#087E7D] sm:text-2xl">{qty(kilos)}</p>
                    <p className="mt-1 text-[11px] text-[#77918A]">กก. เนื้อสด</p>
                  </div>
                );
              })}
            </div>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <label htmlFor="stock-forecast-search" className="sr-only">ค้นหาลูกค้าหรือ SKU</label>
            <input
              id="stock-forecast-search"
              type="search"
              value={customerSearch}
              onChange={(event) => setCustomerSearch(event.target.value)}
              placeholder="ค้นหาลูกค้า รหัสสินค้า หรือชื่อสินค้า"
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
              <div className="mt-4 overflow-x-auto rounded-xl border border-[#DDEAE6]">
                <table className="w-full min-w-[830px] border-collapse text-left text-sm">
                  <thead className="bg-[#EAF8F5] text-[#205A51]">
                    <tr>
                      <th scope="col" className="px-3 py-3 font-bold">ลูกค้า / SKU</th>
                      <th scope="col" className="px-3 py-3 font-bold">รอบ / ความมั่นใจ</th>
                      {forecast.dates.map((date, index) => (
                        <th scope="col" key={date} className="px-3 py-3 text-right font-bold">
                          {["วันนี้", "พรุ่งนี้", "มะรืน"][index]}<br />
                          <span className="text-[11px] font-medium">{date}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E4EFEC]">
                    {visibleForecast.map((row) => (
                      <tr key={`${row.customerId}:${row.sku}:${row.unit}`} className="align-top hover:bg-[#FAFDFC]">
                        <td className="px-3 py-3">
                          <p className="font-extrabold text-[#17453F]">{row.customerName}</p>
                          <p className="mt-1 font-semibold text-[#008B8B]">{row.sku}</p>
                          <p className="mt-1 text-xs text-[#648279]">{row.productName} · {row.unit}</p>
                        </td>
                        <td className="px-3 py-3">
                          <p className="whitespace-nowrap text-xs font-semibold text-[#406E65]">
                            {row.effectiveCadenceDays !== null ? `ทุก ${qty(row.effectiveCadenceDays)} วัน` : "ยังไม่มีรอบที่เชื่อถือได้"}
                          </p>
                          {row.freshMeat && <p className="mt-1 text-[11px] font-bold text-[#A46B00]">เนื้อสด ≤ 2 วัน</p>}
                          <span className={`mt-2 inline-block rounded-full px-2 py-1 text-[11px] font-bold ${CONFIDENCE[row.confidence].className}`}>
                            {CONFIDENCE[row.confidence].label}
                          </span>
                        </td>
                        {row.days.map((day) => (
                          <td key={day.date} className="px-3 py-3 text-right">
                            <p className="text-base font-black text-[#087E7D]">{qty(day.totalQty)}</p>
                            <p className="mt-1 whitespace-nowrap text-[11px] text-[#79928B]">รับแล้ว {qty(day.knownQty)}</p>
                            <p className="whitespace-nowrap text-[11px] text-[#79928B]">คาดเพิ่ม {qty(day.projectedQty)}</p>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {visibleForecast.length === 0 && <p className="p-6 text-center text-sm text-[#648279]">ยังไม่มีข้อมูลที่ตรงกับตัวกรอง หรือยังมีประวัติไม่พอสำหรับคาดการณ์</p>}
              </div>
              <p className="mt-3 text-xs leading-5 text-[#6E8982]">
                {visibleForecast.length} รายการ · รับแล้ว = คำสั่งซื้อที่มีอยู่ · คาดเพิ่ม = ความต้องการเพิ่มเติมที่แบบจำลองประเมิน
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
            ระบบใช้ประวัติสูงสุด 90 วัน โดยจำแนกรอบซื้อแต่ละ SKU และรอบสั่งของลูกค้า · เนื้อสดไม่เกิน 2 วันโดยปรับปริมาณตามอัตราใช้เฉลี่ย
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
