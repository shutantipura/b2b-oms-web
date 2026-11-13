"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import LotusLoading from "@/components/LotusLoading";
import { supabase } from "@/lib/supabase";
import {
  aggregateForecastByProduct,
  describeCustomerOrderTime,
  type ForecastDay,
  type ProductForecastUnitRow,
  type StockForecast,
} from "@/lib/stockForecast";

type Access = "loading" | "manager" | "denied" | "signed-out";
type SkuUnit = {
  key: string;
  sku: string;
  name: string;
  unit: ProductForecastUnitRow;
  unitName: string;
  freshMeat: boolean;
};

function amount(value: number) {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

function oneDay(day: ForecastDay | undefined, key: "knownQty" | "projectedQty" | "totalQty") {
  return amount(day?.[key] ?? 0);
}

const CONFIDENCE: Record<string, { label: string; color: string }> = {
  high: { label: "ข้อมูลเพียงพอ", color: "bg-[#E7F8EC] text-[#20754D]" },
  medium: { label: "ปานกลาง", color: "bg-[#E6F5FB] text-[#27718D]" },
  low: { label: "ประวัติน้อย", color: "bg-[#FFF4D7] text-[#966713]" },
  insufficient: { label: "ข้อมูลยังน้อย", color: "bg-[#F0F3F2] text-[#657A73]" },
};

/** Four compact historical/forecast figures below each SKU or customer forecast. */
function CustomerMiniMetric({ label, value, unit, forecast = false }: {
  label: string; value: number; unit: string; forecast?: boolean;
}) {
  return (
    <div className={`min-w-0 rounded-lg px-1.5 py-2 text-center sm:px-2 ${forecast ? "bg-[#F0F9F5]" : "bg-[#F3F6F5]"}`}>
      <p className="min-h-8 text-[10px] font-bold leading-4 text-[#54796E] sm:text-[11px]">{label}</p>
      <p className="mt-1 whitespace-nowrap text-[clamp(0.8rem,3.2vw,1.15rem)] font-black tabular-nums leading-6 text-[#21665B]">
        {amount(value)} <span className="text-[9px] font-bold">{unit}</span>
      </p>
    </div>
  );
}

export default function StockManagementPage() {
  const [access, setAccess] = useState<Access>("loading");
  const [forecast, setForecast] = useState<StockForecast | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [meatOnly, setMeatOnly] = useState(false);
  const [visibleLimit, setVisibleLimit] = useState(30);

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
      setAccess(!staffError && staff?.account_type === "manager" && staff.is_active === true
        ? "manager" : "denied");
    })();
    return () => { active = false; };
  }, []);

  const refresh = useCallback(async (background = false) => {
    if (!background) setLoading(true);
    try {
      const { data, error: sessionError } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (sessionError || !token) throw new Error("กรุณาเข้าสู่ระบบใหม่");
      // Dedicated B2B-only endpoint: never requires B2C imports or stock counts.
      const response = await fetch("/api/admin/stock-forecast?format=b2b-demand", {
        headers: { Authorization: "Bearer " + token }, cache: "no-store",
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(typeof body.error === "string" ? body.error : "ไม่สามารถโหลดคาดการณ์ B2B");
      }
      setForecast((await response.json()) as StockForecast);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "ไม่สามารถโหลดคาดการณ์ B2B");
    } finally {
      if (!background) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (access !== "manager") return;
    const first = window.setTimeout(() => void refresh(), 0);
    const poll = window.setInterval(() => void refresh(true), 60_000);
    return () => { window.clearTimeout(first); window.clearInterval(poll); };
  }, [access, refresh]);

  const products = useMemo((): SkuUnit[] => {
    if (!forecast) return [];
    return aggregateForecastByProduct(forecast.rows, forecast.dates)
      .flatMap((product) => product.units.map((unit) => ({
        key: product.sku + ":" + unit.unit,
        sku: product.sku,
        name: product.productName,
        unit,
        unitName: unit.unit,
        freshMeat: product.freshMeat,
      })))
      // Never mix kg and pieces in a combined total or implied quantity ranking.
      .sort((a, b) => a.unitName.localeCompare(b.unitName, "th") ||
        (b.unit.days[1]?.totalQty ?? 0) - (a.unit.days[1]?.totalQty ?? 0) ||
        a.sku.localeCompare(b.sku));
  }, [forecast]);

  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    return products.filter((product) =>
      (!meatOnly || product.freshMeat) &&
      (!term || [product.sku, product.name, product.unitName,
        ...product.unit.customers.flatMap((customer) => [customer.customerName, customer.customerCode])]
        .some((value) => value.toLocaleLowerCase().includes(term)))
    );
  }, [products, search, meatOnly]);
  const visibleProducts = filtered.slice(0, visibleLimit);
  const uniqueCustomers = forecast ? new Set(forecast.rows.map((row) => row.customerId)).size : 0;

  async function downloadForecast() {
    if (downloading) return;
    setDownloading(true);
    try {
      const { data, error: sessionError } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (sessionError || !token) throw new Error("กรุณาเข้าสู่ระบบใหม่");
      const response = await fetch("/api/admin/stock-forecast?format=b2b-demand-xlsx", {
        headers: { Authorization: "Bearer " + token }, cache: "no-store",
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(typeof body.error === "string" ? body.error : "ดาวน์โหลดข้อมูลไม่สำเร็จ");
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = "b2b_demand_" + (forecast?.dates[0] ?? "today") + ".xlsx";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "ดาวน์โหลดข้อมูลไม่สำเร็จ");
    } finally {
      setDownloading(false);
    }
  }

  if (access === "loading") return <LotusLoading message="กำลังตรวจสอบสิทธิ์คาดการณ์ B2B..." />;
  if (access !== "manager") {
    return (
      <main className="min-h-screen bg-[#F3F8F7] px-4 pb-24 pt-8">
        <section className="mx-auto max-w-lg rounded-2xl border border-[#D7EAE6] bg-white p-6 text-center">
          <h1 className="text-xl font-black text-[#17453F]">คาดการณ์ความต้องการ B2B</h1>
          <p className="mt-3 text-sm text-[#6E8982]">
            {access === "signed-out" ? "กรุณาเข้าสู่ระบบก่อนใช้งาน" : "เมนูนี้สำหรับผู้จัดการเท่านั้น"}
          </p>
          <Link href="/login" className="mt-5 inline-flex min-h-11 items-center rounded-xl bg-[#02B0AF] px-5 font-bold text-white">กลับหน้าหลัก</Link>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#F3F8F7] px-4 pb-28 pt-6 text-[#1D493E] sm:px-7 sm:pt-8">
      <div className="mx-auto max-w-5xl">
        <header className="rounded-[24px] border border-[#CDE9E3] bg-gradient-to-br from-[#E8FAF6] to-white p-5 shadow-sm sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-extrabold tracking-[0.13em] text-[#008B8B]">LOTUS’S B2B · OMS</p>
              <h1 className="mt-2 text-2xl font-black sm:text-3xl">คาดการณ์ความต้องการ B2B</h1>
              <p className="mt-2 text-sm leading-6 text-[#64847A]">
                จากคำสั่งซื้อของลูกค้าทุกรายใน OMS · แยกตามสินค้าและวันส่ง
              </p>
            </div>
            <span className="rounded-full border border-[#F7DB83] bg-[#FFF7DC] px-4 py-2 text-xs font-extrabold text-[#815B00]">
              Manager
            </span>
          </div>
          <div className="mt-4 rounded-xl border border-[#D5EAE4] bg-white/85 p-3 text-xs leading-6 text-[#476C63]">
            <strong className="text-[#007F7F]">B2B Demand Only</strong>
            {" · "}หน้านี้แสดงเพียงความต้องการที่ลูกค้าขอสั่งแล้วและคาดว่าจะสั่งเพิ่ม
            {" · "}ยังไม่รวม B2C, สต็อกคงเหลือ หรือคำแนะนำสั่งซัพพลายเออร์
          </div>
        </header>

        <section className="mt-4 rounded-[22px] border border-[#D1E7E2] bg-white p-4 shadow-sm sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-black">ความต้องการสินค้าใน 3 วัน</h2>
              <p className="mt-1 text-xs leading-5 text-[#6B8A80]">
                {forecast ? "อัปเดตล่าสุด " + new Date(forecast.asOf).toLocaleString("th-TH", {
                  timeZone: "Asia/Bangkok", day: "numeric", month: "short", year: "numeric",
                  hour: "2-digit", minute: "2-digit",
                }) : "กำลังโหลดข้อมูลล่าสุด"}
                {" · "}รีเฟรชอัตโนมัติทุก 1 นาที ไม่ผูกกับเวลา cut-off ซัพพลายเออร์
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={loading} onClick={() => void refresh()}
                className="min-h-11 rounded-xl border border-[#B7DDD5] bg-[#F1FAF7] px-4 text-sm font-extrabold text-[#007F7F] disabled:opacity-50">
                {loading ? "กำลังโหลด..." : "↻ อัปเดต"}
              </button>
              <button type="button" disabled={downloading || !forecast} onClick={() => void downloadForecast()}
                className="min-h-11 rounded-xl bg-[#02B0AF] px-4 text-sm font-extrabold text-white disabled:opacity-50">
                {downloading ? "กำลังจัดทำไฟล์..." : "↓ ดาวน์โหลด Excel"}
              </button>
            </div>
          </div>

          {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          {!forecast && loading && <p className="mt-4 text-sm text-[#68847B]">กำลังคำนวณความต้องการจาก OMS...</p>}

          {forecast && (
            <>
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
                <div className="rounded-xl bg-[#E9F8F4] p-3">
                  <p className="text-xs font-bold text-[#46796E]">SKU / หน่วย</p>
                  <p className="mt-1 text-2xl font-black text-[#007F7F]">{products.length.toLocaleString("th-TH")}</p>
                </div>
                <div className="rounded-xl bg-[#FFF5DB] p-3">
                  <p className="text-xs font-bold text-[#7A632D]">ลูกค้าที่มีข้อมูล</p>
                  <p className="mt-1 text-2xl font-black text-[#8E6A12]">{uniqueCustomers.toLocaleString("th-TH")}</p>
                </div>
                <div className="col-span-2 rounded-xl bg-[#F2F7F6] p-3 sm:col-span-1">
                  <p className="text-xs font-bold text-[#50776D]">วันที่คาดการณ์</p>
                  <p className="mt-1 text-sm font-black text-[#295A4E]">
                    {forecast.dates[0]} – {forecast.dates[2]}
                  </p>
                </div>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
                <input type="search" value={search} onChange={(event) => {
                  setSearch(event.target.value); setVisibleLimit(30);
                }} placeholder="ค้นหา SKU ชื่อสินค้า ชื่อลูกค้า หรือรหัสลูกค้า"
                  aria-label="ค้นหาสินค้าและลูกค้า B2B"
                  className="min-h-12 min-w-0 rounded-xl border border-[#CDE9E3] bg-white px-4 text-sm outline-none focus:border-[#02B0AF]" />
                <label className="flex min-h-12 items-center gap-2 rounded-xl border border-[#D9EAE6] px-3 text-sm font-bold text-[#416A60]">
                  <input type="checkbox" checked={meatOnly} onChange={(event) => {
                    setMeatOnly(event.target.checked); setVisibleLimit(30);
                  }} className="h-4 w-4 accent-[#02B0AF]" />
                  เนื้อสดเท่านั้น
                </label>
              </div>

              <p className="mt-3 text-xs leading-5 text-[#64857B]">
                แสดง {visibleProducts.length} จาก {filtered.length} SKU/หน่วย
                {" · "}เรียงจากความต้องการพรุ่งนี้สูงสุดภายในหน่วยเดียวกัน
                {" · "}กด “ดูที่มาจากลูกค้า” เพื่อดูทุกราย
              </p>

              <div className="mt-3 space-y-3">
                {visibleProducts.map((product) => {
                  const tomorrow = product.unit.days[1];
                  return (
                    <article key={product.key} className="overflow-hidden rounded-2xl border border-[#D5E9E3] bg-white shadow-sm">
                      <div className="p-4 sm:p-5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="text-base font-black leading-6">{product.name}</p>
                            <p className="mt-1 text-xs text-[#709085]">
                              SKU {product.sku} · {product.unitName} · {product.unit.customers.length} ลูกค้า
                            </p>
                          </div>
                          {product.freshMeat && <span className="rounded-full bg-[#E8F8F1] px-3 py-1 text-[11px] font-bold text-[#288063]">เนื้อสด</span>}
                        </div>

                        <div className="mt-4 rounded-xl border border-[#C8EAE3] bg-[#E7F8F4] p-4">
                          <p className="text-xs font-extrabold text-[#47766A]">
                            พรุ่งนี้ {tomorrow?.date ?? ""} · คาดความต้องการ B2B
                          </p>
                          <p className="mt-1 text-3xl font-black tabular-nums text-[#008B8B]">
                            {oneDay(tomorrow, "totalQty")}
                            <span className="ml-1 text-sm font-bold">{product.unitName}</span>
                          </p>
                          <p className="mt-2 text-xs leading-5 text-[#557D72]">
                            รับออเดอร์แล้ว <strong>{oneDay(tomorrow, "knownQty")}</strong>
                            {" + "}คาดว่าจะสั่งเพิ่ม <strong>{oneDay(tomorrow, "projectedQty")}</strong> {product.unitName}
                          </p>
                        </div>

                        <div className="mt-2 grid grid-cols-4 gap-1.5 sm:gap-2"
                          aria-label="ความต้องการ SKU เมื่อวาน วันนี้ คาดปิดวันนี้ และมะรืน">
                          <CustomerMiniMetric label={`เมื่อวาน ${forecast.yesterdayDate.slice(5)} สั่งแล้ว`}
                            value={product.unit.yesterdayRequestedQty} unit={product.unitName} />
                          <CustomerMiniMetric label={`วันนี้ ${forecast.dates[0].slice(5)} สั่งแล้ว`}
                            value={product.unit.todayRequestedQty} unit={product.unitName} />
                          <CustomerMiniMetric label="คาดปิดวันนี้"
                            value={product.unit.days[0]?.totalQty ?? 0} unit={product.unitName} forecast />
                          <CustomerMiniMetric label={`มะรืน ${forecast.dates[2].slice(5)} คาดรวม`}
                            value={product.unit.days[2]?.totalQty ?? 0} unit={product.unitName} forecast />
                        </div>

                        {forecast.missingWeightConversions.includes(product.sku) && (
                          <p className="mt-3 rounded-lg bg-[#FFF8E4] p-2.5 text-xs text-[#87631B]">
                            ไม่มีน้ำหนักต่อชิ้นที่เชื่อถือได้ · คงจำนวนชิ้นแยกจาก กก.
                          </p>
                        )}
                      </div>

                      <details className="group border-t border-[#DDEEE8]">
                        <summary className="cursor-pointer bg-[#F8FCFA] px-4 py-3 text-sm font-extrabold text-[#008B8B] sm:px-5">
                          ดูที่มาจากลูกค้าทุกราย ({product.unit.customers.length})
                        </summary>
                        <div className="space-y-2 p-3 sm:p-4">
                          {[...product.unit.customers].sort((a, b) =>
                            (b.days[1]?.totalQty ?? 0) - (a.days[1]?.totalQty ?? 0) ||
                            a.customerName.localeCompare(b.customerName, "th")).map((customer) => {
                            const day = customer.days[1];
                            const confidence = CONFIDENCE[customer.confidence] ?? CONFIDENCE.insufficient;
                            return (
                              <div key={customer.customerId + ":" + customer.unit}
                                className="rounded-xl border border-[#E1EEE9] bg-white p-3 sm:p-4">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                  <div className="min-w-0 flex-1">
                                    <p className="font-black text-[#17453F]">{customer.customerName}</p>
                                    <p className="mt-0.5 text-xs text-[#789389]">รหัส {customer.customerCode || "ไม่ระบุ"}</p>
                                  </div>
                                  <span className={"rounded-full px-2 py-1 text-[10px] font-bold " + confidence.color}>
                                    {confidence.label}
                                  </span>
                                </div>
                                <div className="mt-3 rounded-xl border border-[#CDE9E0] bg-[#E7F8F4] px-3 py-3">
                                  <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
                                    <div>
                                      <p className="text-xs font-extrabold text-[#46796E]">
                                        พรุ่งนี้ {forecast.dates[1].slice(5)} · คาดความต้องการ
                                      </p>
                                      <p className="mt-1 text-[27px] font-black leading-8 tabular-nums text-[#008B8B]">
                                        {oneDay(day, "totalQty")} <span className="text-sm font-bold">{product.unitName}</span>
                                      </p>
                                    </div>
                                    <p className="text-[11px] leading-5 text-[#507C70]">
                                      รับแล้ว <strong>{oneDay(day, "knownQty")}</strong>
                                      {" + "}คาดเพิ่ม <strong>{oneDay(day, "projectedQty")}</strong>
                                    </p>
                                  </div>
                                </div>
                                <div className="mt-2 grid grid-cols-4 gap-1.5 sm:gap-2" aria-label="ยอดสั่งจริง 2 วันล่าสุดและคาดการณ์อีก 2 ช่วง">
                                  <CustomerMiniMetric label={`เมื่อวาน ${forecast.yesterdayDate.slice(5)} สั่งแล้ว`}
                                    value={customer.yesterdayRequestedQty} unit={product.unitName} />
                                  <CustomerMiniMetric label={`วันนี้ ${forecast.dates[0].slice(5)} สั่งแล้ว`}
                                    value={customer.todayRequestedQty} unit={product.unitName} />
                                  <CustomerMiniMetric label="คาดปิดวันนี้"
                                    value={customer.days[0]?.totalQty ?? 0} unit={product.unitName} forecast />
                                  <CustomerMiniMetric label={`มะรืน ${forecast.dates[2].slice(5)} คาดรวม`}
                                    value={customer.days[2]?.totalQty ?? 0} unit={product.unitName} forecast />
                                </div>
                                <p className="mt-2 text-[11px] leading-5 text-[#739085]">
                                  รอบสั่ง SKU {customer.effectiveCadenceDays === null
                                    ? "ยังไม่ทราบ" : "ประมาณทุก " + amount(customer.effectiveCadenceDays) + " วัน"}
                                  {" · "}เวลาที่มักสั่ง: {describeCustomerOrderTime(
                                    customer.customerUsualOrderOffsetMinutes, customer.customerOrderTimingSamples
                                  )}
                                </p>
                              </div>
                            );
                          })}
                        </div>
                      </details>
                    </article>
                  );
                })}
              </div>

              {filtered.length === 0 && (
                <p className="mt-4 rounded-xl bg-[#F5FAF8] p-5 text-center text-sm text-[#6D8A81]">
                  ไม่พบสินค้า/ลูกค้าที่ตรงกับคำค้นหา หรือยังมีข้อมูล B2B ไม่เพียงพอ
                </p>
              )}
              {filtered.length > visibleLimit && (
                <button type="button" onClick={() => setVisibleLimit((limit) => limit + 30)}
                  className="mt-4 min-h-12 w-full rounded-xl border border-[#B8DDD5] bg-[#F2FBF8] font-extrabold text-[#008B8B]">
                  โหลดเพิ่มเติมอีก {Math.min(30, filtered.length - visibleLimit)} รายการ
                </button>
              )}

              <p className="mt-5 rounded-xl bg-[#FFF8E7] p-3 text-xs leading-6 text-[#82651E]">
                ยอดขอสั่งคือปริมาณที่ลูกค้าร้องขอใน OMS (ไม่นับออเดอร์ยกเลิก) จัดตามวันส่ง ไม่ใช่วันที่กดสั่ง
                {" · "}คาดรวม = รับออเดอร์แล้ว + ปริมาณที่คาดว่าจะมีการสั่งเพิ่ม
                {" · "}ตัวเลขรวมระดับ SKU คำนวณก่อนปัดเศษ จึงอาจต่างจากการบวกตัวเลขรายลูกค้าที่แสดง 1 ตำแหน่ง
                {" · "}หน่วย กก. และชิ้นจะไม่บวกรวมกัน
              </p>
            </>
          )}
        </section>

        <p className="mt-5 text-center text-xs leading-6 text-[#77928A]">
          ข้อมูลนี้ใช้วิเคราะห์ความต้องการ B2B เท่านั้น · ยังไม่ใช้คำนวณปริมาณซื้อเข้าหรือสั่งซัพพลายเออร์อัตโนมัติ
        </p>
      </div>
    </main>
  );
}
