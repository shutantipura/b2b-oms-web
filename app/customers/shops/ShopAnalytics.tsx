"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Rate = { percent: number | null; measured: number; affected?: number; onTime?: number };
type Product = { productId: string; name: string; sku: string | null;
  unit: string; quantity: number; bills: number };
type Summary = {
  shop: { id: string; name: string; excludedTest: boolean };
  weeks: number; startDate: string; endDate: string; totalSales: number;
  completedBills: number; averageBill: number | null; billsPerWeek: number;
  buyingDays: number; averageGapDays: number | null; lastBilledAt: string | null;
  pendingOrders: number; activeWeeks: number; dot: Rate; shortPick: Rate; shortStock: Rate;
  weeklySales: { weekStart: string; sales: number; bills: number }[];
  topProducts: Product[];
};
const money = new Intl.NumberFormat("th-TH", { maximumFractionDigits: 2, minimumFractionDigits: 0 });
const decimal = new Intl.NumberFormat("th-TH", { maximumFractionDigits: 2 });
const dateFormatter = new Intl.DateTimeFormat("th-TH-u-ca-gregory", {
  timeZone: "Asia/Bangkok", day: "numeric", month: "short",
});
const dateTimeFormatter = new Intl.DateTimeFormat("th-TH-u-ca-gregory", {
  timeZone: "Asia/Bangkok", day: "numeric", month: "short", year: "numeric",
  hour: "2-digit", minute: "2-digit",
});
function baht(n: number | null) { return n === null ? "—" : "฿" + money.format(n); }
function pct(rate: Rate) { return rate.percent === null ? "—" : rate.percent.toFixed(1) + "%"; }
function Metric({ title, value, note, warning = false }: {
  title: string; value: string; note: string; warning?: boolean;
}) {
  return <div className="min-w-0 rounded-2xl border border-[#D8EAE3] bg-white p-3">
    <p className="text-xs font-bold text-[#66857B]">{title}</p>
    <p className={"mt-1 break-words text-xl font-black tabular-nums sm:text-2xl " +
      (warning ? "text-[#A9791A]" : "text-[#008F8D]")}>{value}</p>
    <p className="mt-1 text-[11px] leading-4 text-[#82998F]">{note}</p>
  </div>;
}

export default function ShopAnalytics({ shop, onClose }: {
  shop: { id: string; name: string }; onClose: () => void;
}) {
  const [weeks, setWeeks] = useState(4);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    async function load() {
      setLoading(true); setError(""); setSummary(null);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) throw new Error("กรุณาเข้าสู่ระบบใหม่");
        const url = "/api/customer-registry/shops/analytics?shopId=" +
          encodeURIComponent(shop.id) + "&weeks=" + weeks;
        const response = await fetch(url, { cache: "no-store", signal: controller.signal,
          headers: { Authorization: "Bearer " + session.access_token } });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "ไม่สามารถอ่านข้อมูลวิเคราะห์ได้");
        if (active) setSummary(data as Summary);
      } catch (err) {
        if (active && !controller.signal.aborted)
          setError(err instanceof Error ? err.message : "โหลดข้อมูลไม่สำเร็จ");
      } finally { if (active) setLoading(false); }
    }
    void load();
    return () => { active = false; controller.abort(); };
  }, [shop.id, weeks]);

  const highest = Math.max(0, ...(summary?.weeklySales.map(x => x.sales) ?? []));
  return <div className="fixed inset-0 z-[100] flex items-end justify-center bg-[#102C28]/60 p-0 sm:items-center sm:p-5"
    role="presentation">
    <section role="dialog" aria-modal="true" aria-labelledby="shop-analytics-heading"
      className="flex max-h-[94dvh] w-full max-w-4xl flex-col overflow-hidden rounded-t-3xl bg-[#F3F8F7] shadow-2xl sm:rounded-3xl">
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-[#DDEBE5] bg-white p-4 sm:p-5">
        <div className="min-w-0">
          <p className="text-xs font-extrabold text-[#02A4A2]">CUSTOMER ANALYTICS</p>
          <h2 id="shop-analytics-heading" className="mt-1 truncate text-xl font-black text-[#17453F]">
            วิเคราะห์ลูกค้า · {shop.name}
          </h2>
          <p className="mt-1 text-xs text-[#708E83]">ข้อมูลจริงจากคำสั่งซื้อของร้านนี้ใน OMS</p>
        </div>
        <button type="button" onClick={onClose} aria-label="ปิดการวิเคราะห์"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#EFF6F3] text-xl font-black text-[#17453F]">
          ×
        </button>
      </header>
      <div className="overflow-y-auto px-3 py-4 sm:px-5">
        <div className="mb-4 flex items-center justify-between gap-2">
          <p className="text-sm font-bold text-[#547A6E]">ช่วงเวลาวิเคราะห์</p>
          <div className="flex gap-1 rounded-xl bg-white p-1">
            {([4, 8, 12] as const).map(n => <button key={n} type="button"
              aria-pressed={weeks === n} onClick={() => setWeeks(n)}
              className={"min-h-9 rounded-lg px-3 text-xs font-black " +
                (weeks === n ? "bg-[#02B0AF] text-white" : "text-[#547A6E]")}>
              {n} สัปดาห์
            </button>)}
          </div>
        </div>
        {loading && <p role="status" className="rounded-2xl bg-white p-8 text-center text-sm text-[#66857B]">
          กำลังวิเคราะห์ข้อมูลลูกค้า...
        </p>}
        {error && <p role="alert" className="rounded-2xl border border-red-200 bg-white p-4 text-sm text-red-700">
          {error}
        </p>}
        {summary && <>
          {summary.shop.excludedTest && <p className="mb-3 rounded-xl bg-[#FFF2DB] p-3 text-sm text-[#916400]">
            ร้านทดสอบไม่ถูกนำมาคำนวณสถิติ
          </p>}
          <p className="mb-3 text-xs font-semibold text-[#66857B]">
            {summary.startDate} – {summary.endDate} · ตัดยอดขายตามวันที่ออกบิล
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Metric title="ยอดขายสำเร็จ" value={baht(summary.totalSales)}
              note="บิลที่เสร็จสมบูรณ์เท่านั้น" />
            <Metric title="จำนวนบิล" value={decimal.format(summary.completedBills)}
              note="ออเดอร์รวม /x นับเป็นหนึ่งบิล" />
            <Metric title="ยอดขายต่อบิล" value={baht(summary.averageBill)}
              note="ค่าเฉลี่ยบิลที่เสร็จสิ้น" />
            <Metric title="ความถี่ซื้อ" value={decimal.format(summary.billsPerWeek) + " บิล/สัปดาห์"}
              note={summary.buyingDays + " วันที่มีการสั่งซื้อ"} />
            <Metric title="ซื้อห่างกันเฉลี่ย" value={summary.averageGapDays === null ? "—" :
              decimal.format(summary.averageGapDays) + " วัน"}
              note="ระหว่างวันที่สั่งซื้อที่ต่างกัน" />
            <Metric title="ซื้อครั้งล่าสุด" value={summary.lastBilledAt ?
              dateTimeFormatter.format(new Date(summary.lastBilledAt)) : "—"}
              note={summary.activeWeeks + " จาก " + weeks + " สัปดาห์ที่มียอดซื้อ"} />
            <Metric title="ออเดอร์ค้างดำเนินการ" value={decimal.format(summary.pendingOrders)}
              note="ไม่รวมยกเลิกและที่เสร็จแล้ว" />
            <Metric title="DOT ส่งตรงเวลา" value={pct(summary.dot)}
              note={summary.dot.onTime + "/" + summary.dot.measured + " ออเดอร์ส่งจริง · จบก่อนสิ้นสุดช่วงส่ง"} />
            <Metric title="Short Pick" value={pct(summary.shortPick)}
              note={summary.shortPick.affected + "/" + summary.shortPick.measured + " ออเดอร์หยิบขาด"}
              warning={summary.shortPick.percent !== null && summary.shortPick.percent > 0} />
            <Metric title="Short Stock" value={pct(summary.shortStock)}
              note={summary.shortStock.affected + "/" + summary.shortStock.measured + " ออเดอร์เช็คสต็อกขาด"}
              warning={summary.shortStock.percent !== null && summary.shortStock.percent > 0} />
          </div>
          <section className="mt-4 rounded-2xl border border-[#D8EAE3] bg-white p-4">
            <h3 className="text-base font-black text-[#17453F]">ยอดขายรายสัปดาห์</h3>
            <p className="mt-1 text-xs text-[#81988E]">ยอดขายบิลเสร็จสิ้น (บาท) · เริ่มสัปดาห์วันจันทร์</p>
            <div className="mt-4 overflow-x-auto">
              <div className="flex min-w-max items-end gap-2">
                {summary.weeklySales.map(week => <div key={week.weekStart}
                  className="flex w-[68px] shrink-0 flex-col items-center">
                  <p className="mb-1 text-[10px] font-extrabold tabular-nums text-[#17453F]">
                    {money.format(week.sales)}
                  </p>
                  <div className="flex h-28 w-10 items-end rounded-t-lg bg-[#ECF6F2]">
                    <div className="w-full rounded-t-lg bg-[#02B0AF]"
                      style={{ height: highest > 0 && week.sales > 0 ?
                        Math.max(5, Math.round(week.sales / highest * 100)) + "%" : "0%" }} />
                  </div>
                  <p className="mt-1 text-[10px] font-semibold text-[#66857B]">
                    {dateFormatter.format(new Date(week.weekStart + "T12:00:00+07:00"))}
                  </p>
                  <p className="text-[10px] text-[#8B9F95]">{week.bills} บิล</p>
                </div>)}
              </div>
            </div>
          </section>
          <section className="mt-4 rounded-2xl border border-[#D8EAE3] bg-white p-4">
            <h3 className="text-base font-black text-[#17453F]">สินค้าหลักที่ลูกค้าซื้อ</h3>
            <p className="mt-1 text-xs text-[#81988E]">เรียงตามจำนวนบิลที่มีการซื้อจริง ไม่ใช่ยอดสั่งที่ยังไม่ได้หยิบ</p>
            {summary.topProducts.length ? <div className="mt-3 divide-y divide-[#E8F0EC]">
              {summary.topProducts.map((product, index) => <div key={product.productId + product.unit}
                className="flex items-center gap-3 py-3">
                <span className="w-5 shrink-0 text-center text-sm font-black text-[#02B0AF]">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-[#17453F]">{product.name}</p>
                  {product.sku && <p className="text-[11px] text-[#82988E]">รหัส {product.sku}</p>}
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-black tabular-nums text-[#008F8D]">
                    {decimal.format(product.quantity)} {product.unit}
                  </p>
                  <p className="text-[11px] text-[#82988E]">{product.bills} บิล</p>
                </div>
              </div>)}
            </div> : <p className="mt-4 text-sm text-[#82988E]">ยังไม่มีสินค้าที่ซื้อสำเร็จในช่วงนี้</p>}
          </section>
          <p className="mt-3 pb-2 text-xs leading-5 text-[#718A80]">
            วิธีนับ: ยอดขายอิงบิลที่เสร็จสมบูรณ์และเวลาออกบิล (นับออเดอร์ /x เพียงครั้งเดียว)
            · DOT วัดเวลาส่งถึงเทียบกับเวลาสิ้นสุดช่องจัดส่ง โดยไม่รวมรับที่ร้าน
            · Short Pick คือสัดส่วนออเดอร์ที่หยิบขาดจากยอดยืนยันหลังจบ Picking
            · Short Stock คือสัดส่วนออเดอร์ที่เช็คสต็อกยืนยันได้น้อยกว่าที่ลูกค้าสั่ง
            · ข้อมูลที่ยังไม่ถึงขั้นวัดหรือไม่มีข้อมูลจะไม่เข้าตัวหาร
          </p>
        </>}
      </div>
    </section>
  </div>;
}
