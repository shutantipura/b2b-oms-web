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
  stock_check_shortage: boolean | null;
  short_stock: boolean | null;
  payment_on_time: boolean | null;
};

type KPIStage = "confirmation" | "picking" | "billing" | "delivery" | "payment_verification";

type HistoryRow = {
  order_id: string;
  to_status: string | null;
  created_at: string;
  stage: string | null;
  performed_by_staff_id: string | null;
};

type TaskClaimRow = {
  order_id: string;
  stage: string;
  staff_id: string;
};

type StaffRow = {
  id: string;
  staff_name: string;
  account_type: string;
};

type InvolvedStaff = {
  id: string;
  name: string;
  isManager: boolean;
};

type PeopleByOrder = Record<string, Partial<Record<KPIStage, InvolvedStaff[]>>>;

type KPIIssue = {
  label: string;
  stage: KPIStage;
  additionalStage?: KPIStage;
  reason?: string;
};

const KPI_STAGES: KPIStage[] = [
  "confirmation", "picking", "billing", "delivery", "payment_verification",
];

function isKPIStage(stage: string | null): stage is KPIStage {
  return stage !== null && KPI_STAGES.some((value) => value === stage);
}

type CompletionTimes = {
  pickingAt?: string;
  billingAt?: string;
};

type EvaluatedOrder = KPIOrder & {
  pickOnTime: boolean | null;
  billOnTime: boolean | null;
};

type Metric = {
  group: "on_times" | "stock";
  name: string;
  description: string;
  count: number;
  total: number;
  isExceptionRate?: boolean;
};

type CancelledKPIOrder = {
  order_id: string;
  order_number: number;
  customer_name: string | null;
  delivery_slot: string | null;
  cancellation_reason: string | null;
  cancelled_by_staff_id: string | null;
};

type CancellationSummary = {
  delivery_date: string;
  total_orders: number;
  cancelled_count: number;
  cancelled_orders: CancelledKPIOrder[];
};

type FinancialSummary = {
  bill_date: string;
  total_sales_value: number;
  total_bills: number;
  average_sales_per_bill: number | null;
  gross_profit_percent: number | null;
  cost_complete_bills: number;
  missing_cost_lines: number;
  changed_after_bill_lines: number;
  unsnapshotted_cost_lines: number;
  suspicious_cost_lines: number;
  cost_basis: string;
};

const MONEY_FORMAT = new Intl.NumberFormat("th-TH", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
function formatBaht(value: number | null | undefined) {
  return value == null ? "—" : "฿" + MONEY_FORMAT.format(Number(value));
}

const BANGKOK_OFFSET = "+07:00";
const PICK_LEAD_MINUTES = 30;
const BILL_LEAD_MINUTES = 30;

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

function kpiExceptions(order: EvaluatedOrder): KPIIssue[] {
  const issues: KPIIssue[] = [];
  if (order.confirmation_on_time === false) issues.push({ label: "Stock Check On Time", stage: "confirmation" });
  if (order.pickOnTime === false) issues.push({ label: "Pick On Time", stage: "picking" });
  if (order.billOnTime === false) issues.push({ label: "Bill On Time", stage: "billing" });
  if (order.delivery_on_time === false) issues.push({ label: "Delivery On Time", stage: "delivery" });
  if (order.short_stock === true) {
    const fromStockCheck = order.stock_check_shortage === true;
    const fromPicking = order.short_pick === true;
    issues.push({
      label: "Short Stock Rate",
      stage: fromStockCheck ? "confirmation" : "picking",
      additionalStage: fromStockCheck && fromPicking ? "picking" : undefined,
      reason: [
        ...(fromStockCheck ? ["เช็คสต็อกยืนยันไม่ครบตามที่สั่ง"] : []),
        ...(fromPicking ? ["หยิบจริงไม่ครบตามที่ยืนยัน"] : []),
      ].join(" · "),
    });
  }
  if (order.short_pick === true) issues.push({ label: "Short Pick Rate", stage: "picking" });
  if (order.payment_on_time === false) issues.push({ label: "Payment On Time", stage: "payment_verification" });
  return issues;
}


function RateMetricCard({ metric, loading }: { metric: Metric; loading: boolean }) {
  return (
    <article className="flex min-w-0 flex-col rounded-2xl border border-[#D9EAE3] bg-white p-3 shadow-[0_2px_9px_rgba(18,92,74,0.04)] sm:p-4">
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
  );
}

function FinanceMetricCard({
  name, value, detail, description, caution = false,
}: {
  name: string;
  value: string;
  detail: string;
  description: string;
  caution?: boolean;
}) {
  return (
    <article className="flex min-w-0 flex-col rounded-2xl border border-[#D9EAE3] bg-white p-3 shadow-[0_2px_9px_rgba(18,92,74,0.04)] sm:p-4">
      <div className="mb-2 h-1 w-8 rounded-full bg-[#02B0AF]" aria-hidden="true" />
      <p className="min-h-9 text-xs font-extrabold leading-snug text-[#17453F] sm:text-sm">
        {name}
      </p>
      <p className="mt-1 break-words text-xl font-black tabular-nums tracking-tight text-[#008F8D] sm:text-2xl">
        {value}
      </p>
      <p className={`mt-1 text-[11px] font-bold leading-4 ${caution ? "text-[#A66D23]" : "text-[#52786F]"}`}>
        {detail}
      </p>
      <p className="mt-2 flex-1 text-[11px] leading-4 text-[#80988D]">
        {description}
      </p>
    </article>
  );
}

export default function KPIPage() {
  const [selectedDate, setSelectedDate] = useState(getBangkokToday);
  const [orders, setOrders] = useState<KPIOrder[]>([]);
  const [financialSummary, setFinancialSummary] = useState<FinancialSummary | null>(null);
  const [financialError, setFinancialError] = useState<string | null>(null);
  const [cancellationSummary, setCancellationSummary] = useState<CancellationSummary | null>(null);
  const [cancellationError, setCancellationError] = useState<string | null>(null);
  const [staffById, setStaffById] = useState<Record<string, InvolvedStaff>>({});
  const [completionTimes, setCompletionTimes] = useState<Record<string, CompletionTimes>>({});
  const [involvedByOrder, setInvolvedByOrder] = useState<PeopleByOrder>({});
  const [staffUnavailable, setStaffUnavailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [nowMs, setNowMs] = useState(() => Date.now());
  const requestIdRef = useRef(0);

  async function loadKPI(date: string = selectedDate) {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setMessage("");

    // Operational KPIs use delivery date; Financials use Bangkok bill date but ONLY completed orders.
    const [operationalResult, financialResult, cancellationResult] = await Promise.all([
      supabase.rpc("get_operational_kpi_orders", { p_delivery_date: date }),
      supabase.rpc("get_financial_kpi_summary", { p_bill_date: date }),
      supabase.rpc("get_cancellation_kpi_summary", { p_delivery_date: date }),
    ]);
    if (requestId !== requestIdRef.current) return;

    const { data, error } = operationalResult;
    setFinancialSummary(financialResult.error ? null : financialResult.data as FinancialSummary);
    setFinancialError(financialResult.error?.message ?? null);
    const cancellationData = cancellationResult.error ? null : cancellationResult.data as CancellationSummary | null;
    setCancellationSummary(cancellationData ? {
      ...cancellationData,
      cancelled_orders: Array.isArray(cancellationData.cancelled_orders) ? cancellationData.cancelled_orders : [],
    } : null);
    setCancellationError(cancellationResult.error?.message ?? null);

    if (error) {
      setMessage("ไม่สามารถโหลดข้อมูล KPI ได้: " + error.message);
      setOrders([]);
      setCompletionTimes({});
      setInvolvedByOrder({});
      setStaffById({});
      setStaffUnavailable(false);
      setLoading(false);
      return;
    }

    const loaded = (Array.isArray(data) ? data : []) as KPIOrder[];
    const ids = loaded
      .filter((order) => order.status !== "cancelled")
      .map((order) => order.order_id);

    // Reuse recorded task activity for both KPI completion times and the people
    // involved in each failed stage. Claims capture released/taken-over work;
    // history also captures staff actions that do not create a claim.
    const groups = Array.from(
      { length: Math.ceil(ids.length / 25) },
      (_, index) => ids.slice(index * 25, (index + 1) * 25)
    );
    const [historyResults, claimResults] = await Promise.all([
      Promise.all(
        groups.map((group) =>
          supabase
            .from("order_history")
            .select("order_id,to_status,created_at,stage,performed_by_staff_id")
            .in("order_id", group)
            .order("created_at", { ascending: true })
        )
      ),
      Promise.all(
        groups.map((group) =>
          supabase
            .from("task_claims")
            .select("order_id,stage,staff_id")
            .in("order_id", group)
        )
      ),
    ]);
    if (requestId !== requestIdRef.current) return;

    const completions: Record<string, CompletionTimes> = {};
    const involvedIds: Record<string, Partial<Record<KPIStage, Set<string>>>> = {};
    const allStaffIds = new Set<string>();
    const addInvolved = (orderId: string, stage: string | null, staffId: string | null) => {
      if (!isKPIStage(stage) || !staffId) return;
      const stages = (involvedIds[orderId] ??= {});
      (stages[stage] ??= new Set<string>()).add(staffId);
      allStaffIds.add(staffId);
    };

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
        addInvolved(row.order_id, row.stage, row.performed_by_staff_id);
      }
    }

    let participantUnavailable = historyUnavailable;
    for (const result of claimResults) {
      if (result.error) {
        participantUnavailable = true;
        console.error("KPI task-claims query:", result.error);
        continue;
      }
      for (const claim of (result.data ?? []) as TaskClaimRow[]) {
        addInvolved(claim.order_id, claim.stage, claim.staff_id);
      }
    }

    // Include cancellation actors recorded in order_history even if they never
    // claimed an operational task. An actor means who canceled, not who caused it.
    for (const canceled of cancellationData?.cancelled_orders ?? []) {
      if (canceled.cancelled_by_staff_id) allStaffIds.add(canceled.cancelled_by_staff_id);
    }
    const staffIds = Array.from(allStaffIds);
    const staffGroups = Array.from(
      { length: Math.ceil(staffIds.length / 100) },
      (_, index) => staffIds.slice(index * 100, (index + 1) * 100)
    );
    const staffResults = await Promise.all(
      staffGroups.map((group) =>
        supabase.from("staff").select("id,staff_name,account_type").in("id", group)
      )
    );
    if (requestId !== requestIdRef.current) return;

    const staffMap = new Map<string, StaffRow>();
    for (const result of staffResults) {
      if (result.error) {
        participantUnavailable = true;
        console.error("KPI staff-name query:", result.error);
        continue;
      }
      for (const staff of (result.data ?? []) as StaffRow[]) {
        staffMap.set(staff.id, staff);
      }
    }

    const involved: PeopleByOrder = {};
    for (const [orderId, stages] of Object.entries(involvedIds)) {
      const people: Partial<Record<KPIStage, InvolvedStaff[]>> = {};
      for (const stage of KPI_STAGES) {
        const idsForStage = stages[stage];
        if (!idsForStage) continue;
        people[stage] = Array.from(idsForStage).map((id) => {
          const staff = staffMap.get(id);
          return {
            id,
            name: staff?.staff_name?.trim() || "ไม่พบชื่อพนักงาน",
            isManager: staff?.account_type === "manager",
          };
        }).sort((a, b) => a.name.localeCompare(b.name, "th"));
      }
      involved[orderId] = people;
    }

    setOrders(loaded);
    setCompletionTimes(completions);
    setInvolvedByOrder(involved);
    setStaffById(Object.fromEntries(Array.from(staffMap.values()).map((staff) => [
      staff.id, {
        id: staff.id,
        name: staff.staff_name?.trim() || "ไม่พบชื่อพนักงาน",
        isManager: staff.account_type === "manager",
      },
    ])));
    setStaffUnavailable(participantUnavailable);
    const warnings: string[] = [];
    if (historyUnavailable) {
      warnings.push("บางรายการไม่สามารถอ่านประวัติการจบงานได้ ค่า Pick On Time และ Bill On Time อาจแสดงไม่ครบ");
    }
    if (participantUnavailable) {
      warnings.push("บางรายการไม่สามารถโหลดรายชื่อผู้ปฏิบัติงานได้ครบ");
    }
    setMessage(warnings.join(" · "));
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
    // Compare Short Stock and Short Pick on exactly the same eligible orders.
    // Historical mixed-unit picks with missing piece counts remain N/A.
    const comparable = evaluated.filter((order) => order.short_pick !== null && order.short_stock !== null);
    const shortStocks = countTrue(comparable.map((order) => order.short_stock));
    const shortPicks = countTrue(comparable.map((order) => order.short_pick));
    const payment = countTrue(evaluated.map((order) => order.payment_on_time));

    return [
      {
        group: "on_times",
        name: "Stock Check On Time",
        description: "เช็คสต็อกเสร็จภายใน 30 นาทีหลังรับคำสั่งซื้อ",
        ...confirmation,
      },
      {
        group: "on_times",
        name: "Pick On Time",
        description: "จัดสินค้าเสร็จก่อนเริ่มรอบจัดส่งอย่างน้อย 30 นาที",
        ...picking,
      },
      {
        group: "on_times",
        name: "Bill On Time",
        description: "ออกบิลเสร็จก่อนเริ่มรอบจัดส่งอย่างน้อย 30 นาที",
        ...billing,
      },
      {
        group: "on_times",
        name: "Delivery On Time",
        description: "จัดส่งภายในเวลาที่ลูกค้าเลือก",
        ...delivery,
      },
      {
        group: "on_times",
        name: "Payment On Time",
        description: "ตรวจสอบการชำระเงินภายใน 21:00 น. ของวันจัดส่ง",
        ...payment,
      },
      {
        group: "stock",
        name: "Short Stock Rate",
        description: "สัดส่วนคำสั่งซื้อที่ยืนยันสต็อกไม่ครบตามสั่ง หรือเกิด Short Pick",
        ...shortStocks,
        isExceptionRate: true,
      },
      {
        group: "stock",
        name: "Short Pick Rate",
        description: "สัดส่วนคำสั่งซื้อที่จัดสินค้าไม่ครบตามจำนวนที่ยืนยัน",
        ...shortPicks,
        isExceptionRate: true,
      },
      {
        group: "stock",
        name: "Cancelled Orders Rate",
        description: "สัดส่วนคำสั่งซื้อที่ถูกยกเลิก จากคำสั่งซื้อทั้งหมดตามวันจัดส่ง · กลุ่ม /x นับหนึ่งครั้ง",
        count: cancellationSummary?.cancelled_count ?? 0,
        total: cancellationSummary?.total_orders ?? 0,
        isExceptionRate: true,
      },
    ];
  }, [evaluated, cancellationSummary]);

  const onTimeMetrics = metrics.filter((metric) => metric.group === "on_times");
  const stockMetrics = metrics.filter((metric) => metric.group === "stock");
  const cancelledOrders = cancellationSummary?.cancelled_orders ?? [];
  const billCount = financialSummary?.total_bills ?? 0;
  const numberOfBills = billCount.toLocaleString("th-TH");
  const financeDetail = financialSummary
    ? `${numberOfBills} บิลที่เสร็จสมบูรณ์ (ตามวันออกบิล)`
    : financialError ? "โหลดข้อมูลการเงินไม่สำเร็จ" : "—";
  const grossProfitDetail = !financialSummary
    ? financialError ? "โหลดข้อมูลการเงินไม่สำเร็จ" : "—"
    : billCount === 0
      ? "ยังไม่มีออร์เดอร์ที่เสร็จสมบูรณ์ในวันออกบิลที่เลือก"
      : financialSummary.missing_cost_lines > 0
        ? `ขาดต้นทุน ${financialSummary.missing_cost_lines} รายการ · ยังไม่แสดง GP%`
        : financialSummary.suspicious_cost_lines > 0
          ? `พบต้นทุนผิดปกติ ${financialSummary.suspicious_cost_lines} รายการ · ยังไม่แสดง GP%`
          : financialSummary.unsnapshotted_cost_lines > 0
            ? `บิลเก่า: ไม่มีต้นทุน ณ วันออกบิล ${financialSummary.unsnapshotted_cost_lines} รายการ · เป็นค่าประมาณ`
            : `ต้นทุน ณ วันออกบิลครบ ${financialSummary.cost_complete_bills} / ${numberOfBills} บิล`;
  const financeCards = [
    {
      name: "Total Sales Value",
      value: loading ? "…" : financialSummary ? formatBaht(financialSummary.total_sales_value) : "—",
      detail: financeDetail,
      description: "ยอดรวมจากยอดบิลสุดท้าย รวมการปรับยอดโดย Manager",
    },
    {
      name: "Total Bills",
      value: loading ? "…" : financialSummary ? numberOfBills : "—",
      detail: "นับ 1 ครั้งต่อบิล รวมบิลหลักของคำสั่งซื้อ /x",
      description: "นับเฉพาะคำสั่งซื้อสถานะ completed · ตามวันออกบิล (เวลาไทย)",
    },
    {
      name: "Average Sales / Bill",
      value: loading ? "…" : financialSummary ? formatBaht(financialSummary.average_sales_per_bill) : "—",
      detail: financeDetail,
      description: "Total Sales Value ÷ Total Bills",
    },
    {
      name: "Gross Profit %",
      value: loading ? "…" : financialSummary?.gross_profit_percent == null
        ? "—" : Number(financialSummary.gross_profit_percent).toFixed(2) + "%",
      detail: grossProfitDetail,
      description: "GP% ถ่วงน้ำหนักยอดขาย · บิลใหม่ใช้ต้นทุน ณ วันออกบิล · บิลเก่าอาจเป็นค่าประมาณ",
      caution: Boolean(financialError || (financialSummary && (
        financialSummary.missing_cost_lines > 0 || financialSummary.suspicious_cost_lines > 0 || financialSummary.unsnapshotted_cost_lines > 0
      ))),
    },
  ];

  const exceptions = useMemo(
    () => evaluated
      .map((order) => ({ order, issues: kpiExceptions(order) }))
      .filter((item) => item.issues.length > 0)
      .sort((a, b) => a.order.order_number - b.order.order_number),
    [evaluated]
  );
  const totalFailedOrders = exceptions.length + cancelledOrders.length;

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
              <p className="mt-1 text-xs text-[#6C877E]">Operational Timeliness และ Order Fulfilment ตามวันจัดส่ง · Sales &amp; Profitability ตามวันออกบิล</p>
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
                วันที่รายงาน
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
                {(cancellationSummary?.total_orders ?? evaluated.length).toLocaleString("th-TH")} คำสั่งซื้อ
              </p>
            </div>
          </div>
        </header>

        {message && (
          <div role="alert" className="mb-3 rounded-xl border border-[#FDE3B0] bg-[#FFF9E9] px-3 py-2.5 text-xs font-bold text-[#92540E]">
            {message}
          </div>
        )}

        <section aria-label="สรุป KPI แยกตามกลุ่ม" className="mb-5 space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-2 px-1">
            <div>
              <h2 className="text-base font-extrabold">ภาพรวม KPI</h2>
              <p className="mt-0.5 text-[11px] text-[#718D84]">12 ตัวชี้วัด · แบ่งเป็น 3 กลุ่ม</p>
            </div>
            <p className="text-[11px] text-[#718D84]">Operational Timeliness / Order Fulfilment ตามวันจัดส่ง · Sales &amp; Profitability ตามวันออกบิล</p>
          </div>

          <section aria-label="Operational Timeliness KPIs" className="rounded-2xl border border-[#D9EAE3] bg-[#F0F8F5] p-3 sm:p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="rounded-lg bg-[#D6F4EE] px-2 py-1 text-[11px] font-extrabold text-[#007D79]">01</span>
                <div>
                  <h3 className="text-base font-extrabold text-[#17453F]">Operational Timeliness</h3>
                  <p className="text-[11px] text-[#718D84]">ความตรงเวลาของงานทั้ง 5 ขั้นตอน</p>
                </div>
              </div>
              <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-[#52786F]">5 KPIs · ค่ายิ่งสูงยิ่งดี</span>
            </div>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
              {onTimeMetrics.map((metric) => (
                <RateMetricCard key={metric.name} metric={metric} loading={loading} />
              ))}
            </div>
          </section>

          <section aria-label="Order Fulfilment KPIs" className="rounded-2xl border border-[#D9EAE3] bg-[#F0F8F5] p-3 sm:p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="rounded-lg bg-[#D6F4EE] px-2 py-1 text-[11px] font-extrabold text-[#007D79]">02</span>
                <div>
                  <h3 className="text-base font-extrabold text-[#17453F]">Order Fulfilment</h3>
                  <p className="text-[11px] text-[#718D84]">สต็อกพร้อมขาย หยิบได้ครบ และลดการยกเลิกคำสั่งซื้อ</p>
                </div>
              </div>
              <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-[#A66D23]">3 KPIs · ค่ายิ่งต่ำยิ่งดี</span>
            </div>
            {cancellationError && (
              <p role="alert" className="mb-3 rounded-lg border border-[#FDE3B0] bg-[#FFF9E9] px-3 py-2 text-xs text-[#92540E]">
                ไม่สามารถโหลด Cancelled Orders Rate: {cancellationError}
              </p>
            )}
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {stockMetrics.map((metric) => (
                <div key={metric.name} className={metric.name === "Cancelled Orders Rate" ? "col-span-2 sm:col-span-1" : "min-w-0"}>
                  <RateMetricCard metric={metric} loading={loading} />
                </div>
              ))}
            </div>
            <p className="mt-2 px-1 text-[11px] leading-4 text-[#718D84]">
              Short Stock และ Short Pick ใช้ฐานคำสั่งซื้อที่วัดผลได้ชุดเดียวกัน · Cancelled Orders ใช้คำสั่งซื้อทั้งหมดตามวันจัดส่ง
            </p>
          </section>

          <section aria-label="Sales and Profitability KPIs" className="rounded-2xl border border-[#D9EAE3] bg-[#F0F8F5] p-3 sm:p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="rounded-lg bg-[#D6F4EE] px-2 py-1 text-[11px] font-extrabold text-[#007D79]">03</span>
                <div>
                  <h3 className="text-base font-extrabold text-[#17453F]">Sales &amp; Profitability</h3>
                  <p className="text-[11px] text-[#718D84]">เฉพาะออร์เดอร์ที่เสร็จสมบูรณ์ · แยกตามวันออกบิล (เวลาไทย)</p>
                </div>
              </div>
              <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-[#52786F]">4 KPIs · Completed เท่านั้น</span>
            </div>
            {financialError && (
              <p role="alert" className="mb-3 rounded-lg border border-[#FDE3B0] bg-[#FFF9E9] px-3 py-2 text-xs text-[#92540E]">
                ไม่สามารถโหลดข้อมูล Sales &amp; Profitability: {financialError}
              </p>
            )}
            <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
              {financeCards.map((card) => (
                <FinanceMetricCard key={card.name} {...card} />
              ))}
            </div>
            <p className="mt-2 px-1 text-[11px] leading-4 text-[#718D84]">
              นับเฉพาะออร์เดอร์ completed ที่ออกบิลในวันที่เลือก · งานค้างชำระ/รอจัดส่งไม่นับ · กลุ่ม /x นับเป็นบิลเดียวเมื่อทุกส่วนเสร็จสมบูรณ์
              · GP% ใช้ต้นทุนที่บันทึก ณ วันออกบิลสำหรับบิลใหม่ · บิลเก่าที่ไม่มีต้นทุนย้อนหลังแสดงเป็นประมาณการ
            </p>
          </section>

          <p className="px-1 text-[11px] leading-4 text-[#718D84]">
            — หมายถึงยังไม่มีรายการที่วัดผลได้ หรือมีข้อมูลต้นทุนไม่ครบ งานที่ยังไม่ถึงกำหนดจะไม่ถูกนับเป็นงานล่าช้า
          </p>
        </section>

        <section className="overflow-hidden rounded-2xl border border-[#D9EAE3] bg-white shadow-sm">
          <div className="flex items-center justify-between gap-2 border-b border-[#E3EEE9] px-4 py-3">
            <div>
              <h2 className="text-base font-extrabold">คำสั่งซื้อที่ไม่ผ่าน KPI</h2>
              <p className="mt-0.5 text-[11px] text-[#718D84]">
                แสดงรายชื่อผู้เกี่ยวข้องตามขั้นตอนงานที่ไม่ผ่าน KPI (อาจมีหลายคนหากส่งต่องาน)
              </p>
            </div>
            <span className="shrink-0 rounded-lg bg-[#FFF1E8] px-2.5 py-1 text-xs font-extrabold text-[#C2410C]">
              {totalFailedOrders} รายการ
            </span>
          </div>

          {loading ? (
            <p className="p-5 text-sm text-[#718D84]">กำลังโหลดข้อมูล KPI...</p>
          ) : totalFailedOrders === 0 ? (
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
                    <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                      {issues.map(({ label, stage, additionalStage, reason }) => {
                        // A Short Stock failure may come from stock checking, picking, or both.
                        const stages = additionalStage ? [stage, additionalStage] : [stage];
                        const allPeople = stages.flatMap(
                          (taskStage) => involvedByOrder[order.order_id]?.[taskStage] ?? []
                        );
                        const people = allPeople.filter(
                          (person, index) => allPeople.findIndex((entry) => entry.id === person.id) === index
                        );
                        return (
                          <div key={label} className="min-w-0 rounded-xl border border-[#FDE5CC] bg-[#FFFBF7] px-2.5 py-2">
                            <span className="inline-flex rounded-lg border border-[#FED7AA] bg-[#FFF7ED] px-2 py-1 text-[10px] font-bold text-[#C2410C]">
                              {label}
                            </span>
                            {reason && (
                              <p className="mt-1 text-[11px] font-bold leading-4 text-[#995C0A]">
                                {reason}
                              </p>
                            )}
                            <p className="mt-1 break-words text-[11px] leading-4 text-[#52786F]">
                              <span className="font-extrabold">ผู้เกี่ยวข้อง: </span>
                              {people.length > 0 ? people.map((person, index) => (
                                <span key={person.id}>
                                  {index > 0 ? " · " : ""}{person.name}
                                  {person.isManager && <span className="font-bold text-[#A66D23]"> (Manager)</span>}
                                </span>
                              )) : staffUnavailable ? "ข้อมูลรายชื่อไม่ครบ" : "ยังไม่พบผู้ปฏิบัติงาน"}
                            </p>
                          </div>
                        );
                      })}
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
              {cancelledOrders.map((order) => {
                const actor = order.cancelled_by_staff_id
                  ? staffById[order.cancelled_by_staff_id] : null;
                return (
                  <div key={"cancel-" + order.order_id} className="flex flex-wrap items-center justify-between gap-3 bg-[#FFFBF7] px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-extrabold text-[#17453F]">
                        {order.customer_name ?? "ไม่ทราบชื่อลูกค้า"}
                      </p>
                      <p className="mt-0.5 text-[11px] text-[#8AA097]">
                        เลขที่ #{order.order_number} · ส่ง {order.delivery_slot ?? "ไม่ระบุรอบ"}
                      </p>
                      <div className="mt-2 rounded-xl border border-[#FDE5CC] bg-white px-2.5 py-2">
                        <span className="inline-flex rounded-lg border border-[#FED7AA] bg-[#FFF7ED] px-2 py-1 text-[10px] font-bold text-[#C2410C]">
                          Cancelled Orders Rate
                        </span>
                        <p className="mt-1 break-words text-[11px] leading-4 text-[#995C0A]">
                          <span className="font-extrabold">เหตุผล: </span>{order.cancellation_reason?.trim() || "ไม่ได้ระบุ"}
                        </p>
                        <p className="mt-1 break-words text-[11px] leading-4 text-[#52786F]">
                          <span className="font-extrabold">ผู้ดำเนินการยกเลิก: </span>
                          {actor ? (<>{actor.name}{actor.isManager && " (Manager)"}</>)
                            : staffUnavailable ? "ข้อมูลรายชื่อไม่ครบ" : "ไม่พบผู้ดำเนินการ"}
                        </p>
                      </div>
                    </div>
                    <Link
                      href={"/orders/" + order.order_number}
                      className="shrink-0 rounded-xl border border-[#BBE1D9] bg-[#EAF8F5] px-3 py-2 text-xs font-extrabold text-[#008F8D]"
                    >
                      ดูรายละเอียด →
                    </Link>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
