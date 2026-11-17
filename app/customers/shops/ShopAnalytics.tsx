"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Rate = { percent: number | null; measured: number; affected?: number; onTime?: number };
type Period = "week" | "month" | "all";
type Product = { productId: string; name: string; sku: string | null; unit: string;
  requestedQty: number; pickedQty: number; measuredLines: number; orderCount: number };
type Insight = { kind: "problem" | "opportunity" | "observation"; text: string };
type Summary = {
  shop: { id: string; name: string; excludedTest: boolean };
  period: Period; periodDays: number; startDate: string; endDate: string; totalSales: number;
  completedBills: number; averageBill: number | null; requestedOrders: number;
  ordersPerWeek: number; buyingDays: number; averageGapDays: number | null;
  lastBilledAt: string | null; pendingOrders: number; cancelledOrders: number;
  activeBuckets: number; dot: Rate; shortPick: Rate; shortStock: Rate;
  salesTrend: { startDate: string; sales: number; bills: number }[];
  demandProducts: Product[]; insights: Insight[];
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
  const [period, setPeriod] = useState<Period>("month");
  const [productSearch, setProductSearch] = useState("");
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
          encodeURIComponent(shop.id) + "&period=" + period;
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
  }, [shop.id, period]);

  const highest = Math.max(0, ...(summary?.salesTrend.map(x => x.sales) ?? []));
  const visibleProducts = summary?.demandProducts.filter(product =>
    [product.name, product.sku ?? ""].some(value =>
      value.toLocaleLowerCase().includes(productSearch.trim().toLocaleLowerCase()))) ?? [];
  const chartTitle = period === "week" ? "ยอดขายรายวัน"
    : period === "month" ? "ยอดขายรายสัปดาห์" : "ยอดขายรายเดือน";
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
        <div className="mb-4">
          <p className="mb-2 text-sm font-bold text-[#547A6E]">ช่วงเวลาวิเคราะห์</p>
          <div className="grid grid-cols-3 gap-1 rounded-xl bg-white p-1">
            {([
              ["week","1 สัปดาห์ล่าสุด"], ["month","1 เดือนล่าสุด"], ["all","ทั้งหมด"],
            ] as const).map(([key,label]) => <button key={key} type="button"
              aria-pressed={period === key} onClick={() => setPeriod(key)}
              className={"min-h-10 rounded-lg px-1 py-1 text-[11px] font-black sm:text-sm " +
                (period === key ? "bg-[#02B0AF] text-white" : "text-[#547A6E]")}>
              {label}
            </button>)}
          </div>
          <p className="mt-1 text-[11px] text-[#81988E]">
            1 สัปดาห์ = 7 วันล่าสุด · 1 เดือน = 30 วันล่าสุด · ทั้งหมด = ทุกออเดอร์ที่มีใน OMS
          </p>
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
            <Metric title="ความถี่สั่งซื้อ" value={decimal.format(summary.ordersPerWeek) + " ครั้ง/สัปดาห์"}
              note={summary.requestedOrders + " ออเดอร์ · " + summary.buyingDays + " วันที่สั่ง (รวมยกเลิก)"} />
            <Metric title="ซื้อห่างกันเฉลี่ย" value={summary.averageGapDays === null ? "—" :
              decimal.format(summary.averageGapDays) + " วัน"}
              note="ระหว่างวันที่สั่งซื้อที่ต่างกัน" />
            <Metric title="ซื้อครั้งล่าสุด" value={summary.lastBilledAt ?
              dateTimeFormatter.format(new Date(summary.lastBilledAt)) : "—"}
              note={summary.activeBuckets + " ช่วงเวลาที่มียอดขายจริง"} />
            <Metric title="ออเดอร์ค้างดำเนินการ" value={decimal.format(summary.pendingOrders)}
              note={summary.cancelledOrders + " ออเดอร์ยกเลิกในช่วงนี้"} />
            <Metric title="DOT ส่งตรงเวลา" value={pct(summary.dot)}
              note={summary.dot.onTime + "/" + summary.dot.measured + " ออเดอร์ส่งจริง · จบก่อนสิ้นสุดช่วงส่ง"} />
            <Metric title="Short Pick" value={pct(summary.shortPick)}
              note={summary.shortPick.affected + "/" + summary.shortPick.measured + " ออเดอร์หยิบขาด"}
              warning={summary.shortPick.percent !== null && summary.shortPick.percent > 0} />
            <Metric title="Short Stock" value={pct(summary.shortStock)}
              note={summary.shortStock.affected + "/" + summary.shortStock.measured + " ออเดอร์สต็อก/หยิบขาด"}
              warning={summary.shortStock.percent !== null && summary.shortStock.percent > 0} />
          </div>
          <section className="mt-4 rounded-2xl border border-[#D8EAE3] bg-white p-4">
            <h3 className="text-base font-black text-[#17453F]">สรุปปัญหาและโอกาสของลูกค้า</h3>
            <p className="mt-1 text-xs text-[#81988E]">วิเคราะห์จากคำสั่งซื้อและประวัติการทำงานจริง ไม่ใช่ความคิดเห็นของลูกค้าที่ให้โดยตรง</p>
            <ul className="mt-3 space-y-2">
              {summary.insights.map((insight,index) => <li key={index}
                className="flex gap-2 rounded-lg bg-[#F4F9F7] px-3 py-2.5 text-sm leading-5 text-[#295A4F]">
                <span className="shrink-0 font-black text-[#008F8D]" aria-hidden="true">•</span>
                <span>
                  <strong>{insight.kind === "problem" ? "ปัญหาที่พบ: "
                    : insight.kind === "opportunity" ? "โอกาส: " : "ข้อสังเกต: "}</strong>
                  {insight.text}
                </span>
              </li>)}
            </ul>
          </section>
          <section className="mt-4 rounded-2xl border border-[#D8EAE3] bg-white p-4">
            <h3 className="text-base font-black text-[#17453F]">{chartTitle}</h3>
            <p className="mt-1 text-xs text-[#81988E]">ยอดขายเฉพาะบิลที่เสร็จสมบูรณ์ (บาท) · วันที่ออกบิลตามเวลาไทย</p>
            <div className="mt-4 overflow-x-auto">
              <div className="flex min-w-max items-end gap-2">
                {summary.salesTrend.map(week => <div key={week.startDate}
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
                    {dateFormatter.format(new Date(week.startDate + "T12:00:00+07:00"))}
                  </p>
                  <p className="text-[10px] text-[#8B9F95]">{week.bills} บิล</p>
                </div>)}
              </div>
            </div>
          </section>
          <section className="mt-4 rounded-2xl border border-[#D8EAE3] bg-white p-4">
            <h3 className="text-base font-black text-[#17453F]">สินค้าทั้งหมดที่ลูกค้าเคยสั่ง</h3>
            <p className="mt-1 text-xs leading-4 text-[#81988E]">
              นับจำนวนที่ลูกค้าร้องขอ (Demand) รวมรายการรอหยิบ หยิบไม่ครบ และรายการยกเลิก
              · เรียงตามความถี่ที่สั่ง ไม่ใช่ยอดขาย
            </p>
            <p className="mt-2 text-xs font-semibold text-[#66857B]">
              {summary.demandProducts.length} สินค้า · {summary.requestedOrders} ออเดอร์ที่มีการสั่ง
            </p>
            <input type="search" aria-label="ค้นหาสินค้าที่ลูกค้าเคยสั่ง"
              value={productSearch} onChange={e=>setProductSearch(e.target.value)}
              placeholder="ค้นหาชื่อสินค้า หรือรหัสสินค้า"
              className="mt-3 min-h-10 w-full rounded-xl border border-[#CFE5DE] px-3 text-sm outline-none focus:border-[#02B0AF]" />
            {visibleProducts.length ? <div className="mt-2 divide-y divide-[#E8F0EC]">
              {visibleProducts.map((product, index) => <div key={product.productId + product.unit}
                className="flex items-start gap-2 py-2.5">
                <span className="w-5 shrink-0 text-center text-xs font-black text-[#02B0AF]">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold leading-5 text-[#17453F]">{product.name}</p>
                  {product.sku && <p className="text-[11px] text-[#82988E]">รหัส {product.sku}</p>}
                  <p className="mt-0.5 text-[11px] text-[#81988E]">
                    สั่งใน {product.orderCount} ออเดอร์
                    {product.measuredLines > 0 ? " · หยิบที่บันทึก " +
                      decimal.format(product.pickedQty) + " " + product.unit : " · ยังไม่มีบันทึกปริมาณหยิบ"}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-black tabular-nums text-[#008F8D]">
                    {decimal.format(product.requestedQty)} {product.unit}
                  </p>
                  <p className="text-[11px] text-[#82988E]">ยอดที่สั่ง</p>
                </div>
              </div>)}
            </div> : <p className="mt-4 text-sm text-[#82988E]">
              {productSearch ? "ไม่พบสินค้าที่ค้นหา" : "ยังไม่มีคำขอสินค้าในช่วงนี้"}
            </p>}
          </section>
          <p className="mt-3 pb-2 text-xs leading-5 text-[#718A80]">
            วิธีนับ: ยอดขายอิงบิลที่เสร็จสมบูรณ์และเวลาออกบิล (นับออเดอร์ /x เพียงครั้งเดียว)
            · DOT วัดเวลาส่งถึงเทียบกับเวลาสิ้นสุดช่องจัดส่ง โดยไม่รวมรับที่ร้าน
            · Short Pick คือสัดส่วนออเดอร์ที่หยิบขาดจากยอดยืนยันหลังจบ Picking
            · Short Stock รวมออเดอร์ที่เช็คสต็อกไม่ครบหรือหยิบขาดจากยอดยืนยัน
            · Demand ใช้ยอด requested_qty ตามหน่วยที่สั่ง รวมออเดอร์ยกเลิกและค้างอยู่
            · จำนวนหยิบคือส่วนที่บันทึกแล้ว ไม่ใช่การยืนยันว่าคำขอทั้งหมดถูกส่งมอบ
            · ข้อมูลที่ยังไม่ถึงขั้นวัดหรือไม่มีข้อมูลจะไม่เข้าตัวหาร
          </p>
        </>}
      </div>
    </section>
  </div>;
}
