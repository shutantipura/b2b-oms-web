"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { supabase } from "../../lib/supabase";

type KPIOrder = {
  order_id: string;
  order_number: number;
  customer_name: string | null;
  status: string;
  delivery_slot: string | null;
  confirmation_on_time: boolean | null;
  picking_completed_at?: string | null;
  billing_completed_at?: string | null;
  delivery_on_time: boolean | null;
  short_pick: boolean | null;
  payment_on_time: boolean | null;
};

type HistoryRow = {
  order_id: string;
  to_status: string | null;
  created_at: string;
};

type CompletionTimes = {
  pickingAt?: string;
  billingAt?: string;
};

type EvaluatedOrder = KPIOrder & {
  pickOnTime: boolean | null;
  billOnTime: boolean | null;
};

type Metric = {
  name: string;
  description: string;
  count: number;
  total: number;
  isExceptionRate?: boolean;
};

const BANGKOK_OFFSET = "+07:00";
const PICK_LEAD_MINUTES = 40;
const BILL_LEAD_MINUTES = 20;

function getBangkokToday() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (kind: string) =>
    parts.find((entry) => entry.type === kind)?.value ?? "";
  return part("year") + "-" + part("month") + "-" + part("day");
}

function prettyDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("th-TH-u-ca-gregory", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(year, month - 1, day));
}

function formatPercent(count: number, total: number) {
  return total > 0 ? ((count / total) * 100).toFixed(1) + "%" : "—";
}

function deliveryStartTimestamp(date: string, slot: string | null): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !slot) return null;
  const match = slot.match(/([01]?\d|2[0-3]):([0-5]\d)/);
  if (!match) return null;
  const hour = match[1].padStart(2, "0");
  const timestamp = Date.parse(
    date + "T" + hour + ":" + match[2] + ":00" + BANGKOK_OFFSET
  );
  return Number.isFinite(timestamp) ? timestamp : null;
}

function judgeDeadline(
  completedAt: string | null | undefined,
  deadlineMs: number | null,
  stageNotYetComplete: boolean,
  nowMs: number
): boolean | null {
  if (deadlineMs === null) return null;
  if (completedAt) {
    const completionMs = Date.parse(completedAt);
    return Number.isFinite(completionMs) ? completionMs <= deadlineMs : null;
  }
  // Include incomplete tasks only once their deadline has passed.
  // Do not falsely mark an already completed stage with missing history as late.
  return stageNotYetComplete && nowMs > deadlineMs ? false : null;
}

function countTrue(values: Array<boolean | null | undefined>) {
  const measured = values.filter((value) => value !== null && value !== undefined);
  return {
    count: measured.filter((value) => value === true).length,
    total: measured.length,
  };
}

function kpiExceptions(order: EvaluatedOrder): string[] {
  const issues: string[] = [];
  if (order.confirmation_on_time === false) issues.push("Stock Check On Time");
  if (order.pickOnTime === false) issues.push("Pick On Time");
  if (order.billOnTime === false) issues.push("Bill On Time");
  if (order.delivery_on_time === false) issues.push("Delivery On Time");
  if (order.short_pick === true) issues.push("Short Pick Rate");
  if (order.payment_on_time === false) issues.push("Payment On Time");
  return issues;
}

export default function KPIPage() {
  const [selectedDate, setSelectedDate] = useState(getBangkokToday);
  const [orders, setOrders] = useState<KPIOrder[]>([]);
  const [completionTimes, setCompletionTimes] = useState<Record<string, CompletionTimes>>({});
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [nowMs, setNowMs] = useState(() => Date.now());
  const requestIdRef = useRef(0);

  async function loadKPI(date: string = selectedDate) {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setMessage("");

    const { data, error } = await supabase.rpc("get_operational_kpi_orders", {
      p_delivery_date: date,
    });
    if (requestId !== requestIdRef.current) return;

    if (error) {
      setMessage("ไม่สามารถโหลดข้อมูล KPI ได้: " + error.message);
      setOrders([]);
      setCompletionTimes({});
      setLoading(false);
      return;
    }

    const loaded = (Array.isArray(data) ? data : []) as KPIOrder[];
    const ids = loaded
      .filter((order) => order.status !== "cancelled")
      .map((order) => order.order_id);

    // Picking completion: use the timestamp exposed by the operational KPI RPC.
    // Billing completion: use the recorded transition to ready_for_delivery.
    // History also provides a fallback for older picking records.
    const groups = Array.from(
      { length: Math.ceil(ids.length / 100) },
      (_, index) => ids.slice(index * 100, (index + 1) * 100)
    );

    const historyResults = await Promise.all(
      groups.map((group) =>
        supabase
          .from("order_history")
          .select("order_id,to_status,created_at")
          .in("order_id", group)
          .in("to_status", ["awaiting_billing", "ready_for_delivery"])
          .order("created_at", { ascending: true })
      )
    );
    if (requestId !== requestIdRef.current) return;

    const completions: Record<string, CompletionTimes> = {};
    let historyUnavailable = false;
    for (const result of historyResults) {
      if (result.error) {
        historyUnavailable = true;
        console.error("KPI stage-history query:", result.error);
        continue;
      }
      for (const row of (result.data ?? []) as HistoryRow[]) {
        const times = completions[row.order_id] ?? {};
        // Rows are oldest to newest; latest successful stage completion wins.
        if (row.to_status === "awaiting_billing") times.pickingAt = row.created_at;
        if (row.to_status === "ready_for_delivery") times.billingAt = row.created_at;
        completions[row.order_id] = times;
      }
    }

    setOrders(loaded);
    setCompletionTimes(completions);
    if (historyUnavailable) {
      setMessage("บางรายการไม่สามารถอ่านประวัติการจบงานได้ ค่า Pick On Time และ Bill On Time อาจแสดงไม่ครบ");
    }
    setNowMs(Date.now());
    setLoading(false);
  }

  useEffect(() => {
    void loadKPI(selectedDate);
    return () => {
      requestIdRef.current += 1;
    };
  }, [selectedDate]);

  useEffect(() => {
    const interval = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  const evaluated = useMemo<EvaluatedOrder[]>(() => {
    return orders
      .filter((order) => order.status !== "cancelled")
      .map((order) => {
        const deliveryStart = deliveryStartTimestamp(selectedDate, order.delivery_slot);
        const pickDeadline = deliveryStart === null
          ? null
          : deliveryStart - PICK_LEAD_MINUTES * 60_000;
        const billDeadline = deliveryStart === null
          ? null
          : deliveryStart - BILL_LEAD_MINUTES * 60_000;

        const pickingStillOpen = [
          "awaiting_confirmation", "awaiting_picking", "picking",
        ].includes(order.status);
        const billingStillOpen = [
          "awaiting_confirmation", "awaiting_picking", "picking", "awaiting_billing",
        ].includes(order.status);
        const recorded = completionTimes[order.order_id];

        return {
          ...order,
          pickOnTime: judgeDeadline(
            order.picking_completed_at ?? recorded?.pickingAt,
            pickDeadline,
            pickingStillOpen,
            nowMs
          ),
          billOnTime: judgeDeadline(
            order.billing_completed_at ?? recorded?.billingAt,
            billDeadline,
            billingStillOpen,
            nowMs
          ),
        };
      });
  }, [orders, selectedDate, completionTimes, nowMs]);

  const metrics = useMemo<Metric[]>(() => {
    const confirmation = countTrue(evaluated.map((order) => order.confirmation_on_time));
    const picking = countTrue(evaluated.map((order) => order.pickOnTime));
    const billing = countTrue(evaluated.map((order) => order.billOnTime));
    const delivery = countTrue(evaluated.map((order) => order.delivery_on_time));
    const shortPicks = countTrue(evaluated.map((order) => order.short_pick));
    const payment = countTrue(evaluated.map((order) => order.payment_on_time));

    return [
      {
        name: "Stock Check On Time",
        description: "เช็คสต็อกเสร็จภายใน 30 นาทีหลังรับคำสั่งซื้อ",
        ...confirmation,
      },
      {
        name: "Pick On Time",
        description: "จัดสินค้าเสร็จก่อนเริ่มรอบจัดส่งอย่างน้อย 40 นาที",
        ...picking,
      },
      {
        name: "Bill On Time",
        description: "ออกบิลเสร็จก่อนเริ่มรอบจัดส่งอย่างน้อย 20 นาที",
        ...billing,
      },
      {
        name: "Delivery On Time",
        description: "จัดส่งภายในเวลาที่ลูกค้าเลือก",
        ...delivery,
      },
      {
        name: "Short Pick Rate",
        description: "สัดส่วนคำสั่งซื้อที่จัดสินค้าไม่ครบ",
        ...shortPicks,
        isExceptionRate: true,
      },
      {
        name: "Payment On Time",
        description: "ตรวจสอบการชำระเงินภายใน 21:00 น. ของวันจัดส่ง",
        ...payment,
      },
    ];
  }, [evaluated]);

  const exceptions = useMemo(
    () => evaluated
      .map((order) => ({ order, issues: kpiExceptions(order) }))
      .filter((item) => item.issues.length > 0)
      .sort((a, b) => a.order.order_number - b.order.order_number),
    [evaluated]
  );

  return (
    <main className="min-h-screen bg-[#F5F9F7] px-3 py-4 text-[#173E31] sm:px-6 sm:py-6">
      <div className="mx-auto max-w-5xl">
        <header className="mb-4 rounded-2xl border border-[#DCECE6] bg-white p-4 shadow-sm sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <Link href="/login" className="text-xs font-bold text-[#52786F] hover:text-[#008F8D]">
                ← กลับหน้าหลัก
              </Link>
              <p className="mt-3 text-[10px] font-extrabold uppercase tracking-wider text-[#008F8D]">
                KPI / LOTUS'S B2B
              </p>
              <h1 className="mt-1 text-xl font-extrabold sm:text-2xl">ตัวชี้วัดการปฏิบัติงาน</h1>
              <p className="mt-1 text-xs text-[#6C877E]">ประเมินผลตามวันที่ลูกค้าเลือกจัดส่ง</p>
            </div>
            <button
              type="button"
              onClick={() => void loadKPI(selectedDate)}
              disabled={loading}
              className="h-9 shrink-0 rounded-xl border border-[#BFDCD4] bg-white px-3 text-xs font-extrabold text-[#008F8D] disabled:opacity-50"
            >
              ↻ รีเฟรช
            </button>
          </div>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-3 border-t border-[#E6EFEB] pt-3">
            <div className="min-w-0">
              <label htmlFor="kpi-date" className="mb-1 block text-xs font-bold text-[#52786F]">
                วันที่จัดส่ง
              </label>
              <input
                id="kpi-date"
                type="date"
                value={selectedDate}
                onChange={(event) => { if (event.target.value) setSelectedDate(event.target.value); }}
                className="block h-10 min-w-0 max-w-full rounded-xl border border-[#C7DDD6] bg-white px-2 text-sm text-[#17453F] [color-scheme:light]"
              />
            </div>
            <div className="text-right">
              <p className="text-xs text-[#6C877E]">{prettyDate(selectedDate)}</p>
              <p className="text-sm font-extrabold text-[#008F8D]">
                {evaluated.length.toLocaleString("th-TH")} คำสั่งซื้อ
              </p>
            </div>
          </div>
        </header>

        {message && (
          <div role="alert" className="mb-3 rounded-xl border border-[#FDE3B0] bg-[#FFF9E9] px-3 py-2.5 text-xs font-bold text-[#92540E]">
            {message}
          </div>
        )}

        <section aria-label="สรุป KPI" className="mb-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-base font-extrabold">ภาพรวม KPI</h2>
            <span className="text-[11px] text-[#718D84]">ผ่านเกณฑ์ / รายการที่วัดได้</span>
          </div>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-3">
            {metrics.map((metric) => (
              <article
                key={metric.name}
                className="flex min-w-0 flex-col rounded-2xl border border-[#D9EAE3] bg-white p-3 shadow-[0_2px_9px_rgba(18,92,74,0.04)] sm:p-4"
              >
                <div className="mb-2 h-1 w-8 rounded-full bg-[#02B0AF]" aria-hidden="true" />
                <p className="min-h-9 text-xs font-extrabold leading-snug text-[#17453F] sm:text-sm">
                  {metric.name}
                </p>
                <p className="mt-1 text-2xl font-black tabular-nums text-[#008F8D] sm:text-3xl">
                  {loading ? "…" : formatPercent(metric.count, metric.total)}
                </p>
                <p className="mt-1 text-xs font-bold tabular-nums text-[#52786F]">
                  {metric.count} / {metric.total} รายการ
                </p>
                <p className="mt-2 flex-1 text-[11px] leading-4 text-[#80988D]">
                  {metric.description}
                </p>
                {metric.isExceptionRate && (
                  <p className="mt-2 text-[10px] font-bold text-[#A66D23]">ค่ายิ่งต่ำยิ่งดี</p>
                )}
              </article>
            ))}
          </div>
          <p className="mt-2 px-1 text-[11px] leading-4 text-[#718D84]">
            — หมายถึงยังไม่มีรายการที่วัดผลได้ งานที่ยังไม่ถึงกำหนดจะไม่ถูกนับเป็นงานล่าช้า
          </p>
        </section>

        <section className="overflow-hidden rounded-2xl border border-[#D9EAE3] bg-white shadow-sm">
          <div className="flex items-center justify-between gap-2 border-b border-[#E3EEE9] px-4 py-3">
            <div>
              <h2 className="text-base font-extrabold">คำสั่งซื้อที่ไม่ผ่าน KPI</h2>
              <p className="mt-0.5 text-[11px] text-[#718D84]">
                แสดงเฉพาะรายการที่พบปัญหาจากเกณฑ์ที่วัดได้
              </p>
            </div>
            <span className="shrink-0 rounded-lg bg-[#FFF1E8] px-2.5 py-1 text-xs font-extrabold text-[#C2410C]">
              {exceptions.length} รายการ
            </span>
          </div>

          {loading ? (
            <p className="p-5 text-sm text-[#718D84]">กำลังโหลดข้อมูล KPI...</p>
          ) : exceptions.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className="text-sm font-extrabold text-[#008F8D]">ไม่พบคำสั่งซื้อที่ไม่ผ่าน KPI</p>
              <p className="mt-1 text-xs text-[#80988D]">สำหรับวันที่จัดส่งที่เลือก</p>
            </div>
          ) : (
            <div className="divide-y divide-[#E7F0EB]">
              {exceptions.map(({ order, issues }) => (
                <div key={order.order_id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-extrabold text-[#17453F]">
                      {order.customer_name ?? "ไม่ทราบชื่อลูกค้า"}
                    </p>
                    <p className="mt-0.5 text-[11px] text-[#8AA097]">
                      เลขที่ #{order.order_number} · ส่ง {order.delivery_slot ?? "ไม่ระบุรอบ"}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {issues.map((issue) => (
                        <span
                          key={issue}
                          className="rounded-lg border border-[#FED7AA] bg-[#FFF7ED] px-2 py-1 text-[10px] font-bold text-[#C2410C]"
                        >
                          {issue}
                        </span>
                      ))}
                    </div>
                  </div>
                  <Link
                    href={"/orders/" + order.order_number}
                    className="shrink-0 rounded-xl border border-[#BBE1D9] bg-[#EAF8F5] px-3 py-2 text-xs font-extrabold text-[#008F8D]"
                  >
                    ดูรายละเอียด →
                  </Link>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
