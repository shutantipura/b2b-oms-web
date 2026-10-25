"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import Link from "next/link";

import { supabase } from "../../lib/supabase";

type Order = {
  id: string;
  order_number: number;
  group_root_order_id: string | null;
  group_sequence: number | null;
  status: string;
  created_at: string;
  delivery_date: string | null;
  delivery_slot: string | null;
  final_amount: number | string | null;

  customers: {
    customer_name: string;
    customer_code: string;
    phone: string | null;
  } | null;
};

type StatusFilter =
  | "all"
  | "pending"
  | "completed"
  | "cancelled";

// =====================================================
// DATE HELPERS
// =====================================================

function getBangkokToday() {
  const parts =
    new Intl.DateTimeFormat(
      "en-US",
      {
        timeZone:
          "Asia/Bangkok",
        year:
          "numeric",
        month:
          "2-digit",
        day:
          "2-digit",
      }
    ).formatToParts(
      new Date()
    );

  const year =
    parts.find(
      (part) =>
        part.type ===
        "year"
    )?.value;

  const month =
    parts.find(
      (part) =>
        part.type ===
        "month"
    )?.value;

  const day =
    parts.find(
      (part) =>
        part.type ===
        "day"
    )?.value;

  return `${year}-${month}-${day}`;
}

function getBangkokTomorrow() {
  const [year, month, day] = getBangkokToday().split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

function prettyDate(
  value: string
) {
  if (!value) {
    return "—";
  }

  const [
    year,
    month,
    day,
  ] =
    value
      .split("-")
      .map(Number);

  return new Intl.DateTimeFormat(
    "th-TH-u-ca-gregory",
    {
      weekday:
        "short",
      day:
        "numeric",
      month:
        "short",
      year:
        "numeric",
    }
  ).format(
    new Date(
      year,
      month - 1,
      day
    )
  );
}

// =====================================================
// DISPLAY HELPERS
// =====================================================

function prettyStatus(
  status: string
) {
  const names:
    Record<
      string,
      string
    > = {
    awaiting_confirmation:
      "รอยืนยันคำสั่งซื้อ",

    awaiting_picking:
      "รอจัดสินค้า",

    picking:
      "กำลังจัดสินค้า",

    awaiting_billing:
      "รอออกบิล",

    ready_for_delivery:
      "พร้อมจัดส่ง",

    out_for_delivery:
      "กำลังจัดส่ง",

    awaiting_payment:
      "รอชำระเงิน",

    payment_submitted:
      "ส่งหลักฐานการชำระเงินแล้ว",

    completed:
      "เสร็จสิ้น",

    cancelled:
      "ยกเลิก",
  };

  return (
    names[status] ??
    status
  );
}

function getSlotStart(
  slot: string | null
) {
  if (!slot) {
    return null;
  }

  const match =
    slot.match(
      /([0-2][0-9]:[0-5][0-9])/
    );

  return (
    match?.[1] ??
    null
  );
}

function compareDelivery(a: Order, b: Order) {
  // Across multiple dates, the earliest date must sort before the earliest time slot.
  if (a.delivery_date !== b.delivery_date) {
    if (!a.delivery_date) return 1;
    if (!b.delivery_date) return -1;
    return a.delivery_date.localeCompare(b.delivery_date);
  }

  const aStart = getSlotStart(a.delivery_slot);
  const bStart = getSlotStart(b.delivery_slot);

  if (!aStart && bStart) return 1;
  if (aStart && !bStart) return -1;

  const slotComparison = (aStart ?? "").localeCompare(bStart ?? "");
  if (slotComparison !== 0) return slotComparison;

  const creationComparison = new Date(a.created_at).getTime()
    - new Date(b.created_at).getTime();
  if (creationComparison !== 0) return creationComparison;
  return a.order_number - b.order_number;
}

function isPending(
  order: Order
) {
  return (
    order.status !==
      "completed" &&
    order.status !==
      "cancelled"
  );
}

type DeliveryUrgency = "overdue" | "at-risk" | "today" | "none";
type BangkokClock = { date: string; minutes: number };

// Match the operational urgency rules on the Tasks dashboard.
function getBangkokClock(): BangkokClock {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const part = (kind: string) =>
    parts.find((entry) => entry.type === kind)?.value ?? "";
  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    minutes: Number(part("hour")) * 60 + Number(part("minute")),
  };
}

function dateDayNumber(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const timestamp = Date.UTC(year, month - 1, day);
  return Number.isFinite(timestamp) ? timestamp / 86_400_000 : null;
}

function deliveryDaysAway(deliveryDate: string | null, today: string): number | null {
  if (!deliveryDate) return null;
  const target = dateDayNumber(deliveryDate);
  const baseline = dateDayNumber(today);
  return target === null || baseline === null ? null : Math.round(target - baseline);
}

function relativeDeliveryDay(deliveryDate: string | null, today: string): string {
  const days = deliveryDaysAway(deliveryDate, today);
  if (days === null) return "ไม่ระบุวันที่";
  if (days === -1) return "เมื่อวาน";
  if (days === 0) return "วันนี้";
  if (days === 1) return "พรุ่งนี้";
  return days < 0 ? `${Math.abs(days)} วันที่แล้ว` : `${days} วันข้างหน้า`;
}

function deliverySlotMinutes(slot: string | null): { start: number; end: number } | null {
  if (!slot) return null;
  const times = [...slot.matchAll(/([01]?\d|2[0-3]):([0-5]\d)/g)]
    .map((match) => Number(match[1]) * 60 + Number(match[2]));
  if (times.length < 2) return null;
  return { start: times[0], end: times[1] <= times[0] ? times[1] + 1440 : times[1] };
}

function deliveryUrgency(order: Order, now: BangkokClock): DeliveryUrgency {
  if (order.status === "completed" || order.status === "cancelled") return "none";

  const days = deliveryDaysAway(order.delivery_date, now.date);
  if (days === null) return "none";

  // Any pending order from a past delivery date remains overdue, including
  // those awaiting payment. A completed or cancelled order is never overdue.
  if (days < 0) return "overdue";

  // For today's payment-stage orders, do not flag a missed delivery window.
  if (order.status === "awaiting_payment" || order.status === "payment_submitted") {
    return days === 0 ? "today" : "none";
  }

  const slot = deliverySlotMinutes(order.delivery_slot);
  if (days === 0 && slot && now.minutes >= slot.end) return "overdue";

  // Warn staff within 2 hours before the delivery window begins.
  if (slot && days <= 1) {
    const minutesToStart = days * 1440 + slot.start - now.minutes;
    const minutesToEnd = days * 1440 + slot.end - now.minutes;
    if (minutesToStart <= 120 && minutesToEnd > 0) return "at-risk";
  }
  return days === 0 ? "today" : "none";
}

const urgencyRowStyle: Record<DeliveryUrgency, string> = {
  overdue: "bg-[#FFF7F7]",
  "at-risk": "bg-[#FFFAF3]",
  today: "bg-[#FFFDF2]",
  none: "bg-white",
};
const urgencyBorderStyle: Record<DeliveryUrgency, string> = {
  overdue: "border-l-[#DC2626]",
  "at-risk": "border-l-[#EA580C]",
  today: "border-l-[#EAB308]",
  none: "border-l-transparent",
};
const urgencyDateStyle: Record<DeliveryUrgency, string> = {
  overdue: "border-[#FECACA] bg-[#FEF2F2] text-[#B91C1C]",
  "at-risk": "border-[#FED7AA] bg-[#FFF1E6] text-[#C2410C]",
  today: "border-[#FDE68A] bg-[#FEF9C3] text-[#854D0E]",
  none: "border-[#DCEAE5] bg-[#F6FAF8] text-[#6C877E]",
};

// =====================================================
// PAGE
// =====================================================

export default function OrdersPage() {
  const [
    selectedDate,
    setSelectedDate,
  ] =
    useState(
      getBangkokToday()
    );

  const [allDates, setAllDates] = useState(false);
  const [clock, setClock] = useState(() => getBangkokClock());
  const loadRequestRef = useRef(0);

  const [
    orders,
    setOrders,
  ] =
    useState<Order[]>(
      []
    );

  const [
    loading,
    setLoading,
  ] =
    useState(true);

  const [
    message,
    setMessage,
  ] =
    useState("");

  const [
    isManager,
    setIsManager,
  ] =
    useState(false);

  const [
    managerActionOrder,
    setManagerActionOrder,
  ] =
    useState<number | null>(
      null
    );

  const [
    search,
    setSearch,
  ] =
    useState("");

  const [
    statusFilter,
    setStatusFilter,
  ] =
    useState<StatusFilter>(
      "all"
    );

  // =====================================================
  // MANAGER ACCESS
  // =====================================================

  async function loadManagerAccess() {
    const {
      data: { user },
    } =
      await supabase.auth.getUser();

    if (!user) {
      setIsManager(false);
      return;
    }

    const {
      data,
      error,
    } =
      await supabase
        .from("staff")
        .select("account_type")
        .eq(
          "auth_user_id",
          user.id
        )
        .eq(
          "is_active",
          true
        )
        .maybeSingle();

    if (error) {
      setIsManager(false);
      return;
    }

    setIsManager(
      data?.account_type ===
        "manager"
    );
  }

  async function cancelOrder(
    orderNumber: number
  ) {
    const reason =
      window.prompt(
        `ยกเลิกคำสั่งซื้อ #${orderNumber}\n\nกรุณาระบุเหตุผลในการยกเลิก`
      );

    if (reason === null) {
      return;
    }

    const trimmedReason =
      reason.trim();

    if (!trimmedReason) {
      setMessage(
        "กรุณาระบุเหตุผลในการยกเลิกคำสั่งซื้อ"
      );
      return;
    }

    const confirmed =
      window.confirm(
        `ยืนยันยกเลิกคำสั่งซื้อ #${orderNumber} หรือไม่?\n\nการดำเนินการนี้จะยกเลิกงานที่กำลังทำอยู่ของพนักงานด้วย`
      );

    if (!confirmed) {
      return;
    }

    setManagerActionOrder(
      orderNumber
    );
    setMessage("");

    const {
      error,
    } =
      await supabase.rpc(
        "manager_cancel_order",
        {
          p_order_number:
            orderNumber,
          p_reason:
            trimmedReason,
        }
      );

    if (error) {
      setMessage(
        "ไม่สามารถยกเลิกคำสั่งซื้อได้: " +
          error.message
      );
      setManagerActionOrder(
        null
      );
      return;
    }

    await loadOrders(
      selectedDate
    );

    setManagerActionOrder(
      null
    );
  }

  async function forceCompleteOrder(
    orderNumber: number
  ) {
    const confirmed =
      window.confirm(
        `ยืนยันบังคับให้คำสั่งซื้อ #${orderNumber} เสร็จสิ้นทันทีหรือไม่?\n\nระบบจะปิดงานที่กำลังดำเนินการอยู่และเปลี่ยนสถานะเป็นเสร็จสิ้น`
      );

    if (!confirmed) {
      return;
    }

    setManagerActionOrder(
      orderNumber
    );
    setMessage("");

    const {
      error,
    } =
      await supabase.rpc(
        "manager_force_complete_order",
        {
          p_order_number:
            orderNumber,
        }
      );

    if (error) {
      setMessage(
        "ไม่สามารถบังคับเสร็จสิ้นคำสั่งซื้อได้: " +
          error.message
      );
      setManagerActionOrder(
        null
      );
      return;
    }

    await loadOrders(
      selectedDate
    );

    setManagerActionOrder(
      null
    );
  }

  // =====================================================
  // LOAD ORDERS FOR SELECTED DELIVERY DATE
  // =====================================================

  async function loadOrders(
    date: string = selectedDate,
    includeAllDates: boolean = allDates
  ) {
    const requestId = ++loadRequestRef.current;
    setLoading(true);
    setMessage("");

    // Supabase queries can be capped by the project's maximum-row setting.
    // Load in stable pages so the “all dates” choice truly includes older orders.
    const pageSize = 500;
    const loaded: Order[] = [];
    let from = 0;

    while (true) {
      let query = supabase
        .from("orders")
        .select(`
          id,
          order_number,
          group_root_order_id,
          group_sequence,
          status,
          created_at,
          delivery_date,
          delivery_slot,
          final_amount,
          customers (
            customer_name,
            customer_code,
            phone
          )
        `)
        .order("order_number", { ascending: true })
        .range(from, from + pageSize - 1);

      if (!includeAllDates) {
        query = query.eq("delivery_date", date);
      }

      const { data, error } = await query;
      // Ignore an older request if the user has already switched date modes.
      if (requestId !== loadRequestRef.current) return;

      if (error) {
        setMessage("ไม่สามารถโหลดคำสั่งซื้อได้: " + error.message);
        setOrders([]);
        setLoading(false);
        return;
      }

      const page = (data ?? []) as unknown as Order[];
      loaded.push(...page);
      if (page.length < pageSize) break;
      from += pageSize;
    }

    if (requestId !== loadRequestRef.current) return;
    setOrders(loaded);
    setLoading(false);
  }

  useEffect(() => {
    void loadManagerAccess();
    void loadOrders(selectedDate, allDates);
    return () => {
      loadRequestRef.current += 1;
    };
  }, [selectedDate, allDates]);

  useEffect(() => {
    const interval = window.setInterval(() => setClock(getBangkokClock()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  // =====================================================
  // COUNTS FOR CURRENT DATE MODE
  // =====================================================

  const pendingCount =
    useMemo(
      () =>
        orders.filter(
          isPending
        ).length,
      [
        orders,
      ]
    );

  const completedCount =
    useMemo(
      () =>
        orders.filter(
          (
            order
          ) =>
            order.status ===
            "completed"
        ).length,
      [
        orders,
      ]
    );

  const cancelledCount =
    useMemo(
      () =>
        orders.filter(
          (
            order
          ) =>
            order.status ===
            "cancelled"
        ).length,
      [
        orders,
      ]
    );

  const totalCount =
    orders.length;

  // =====================================================
  // FILTER + FIXED EARLIEST-DELIVERY ORDER
  // =====================================================

  const filteredOrders = useMemo(() => {
    const query = search.trim().toLowerCase();

    return orders
      .filter((order) => {
        const matchesStatus = statusFilter === "all"
          || (statusFilter === "pending" && isPending(order))
          || (statusFilter === "completed" && order.status === "completed")
          || (statusFilter === "cancelled" && order.status === "cancelled");

        const matchesSearch = !query
          || String(order.order_number).includes(query)
          || (order.customers?.customer_name ?? "").toLowerCase().includes(query)
          || (order.customers?.customer_code ?? "").toLowerCase().includes(query)
          || (order.customers?.phone ?? "").toLowerCase().includes(query);

        return matchesStatus && matchesSearch;
      })
      .sort(compareDelivery);
  }, [orders, search, statusFilter]);

  const dateScopeLabel = allDates ? "ทุกวัน" : prettyDate(selectedDate);

  // =====================================================
  // PAGE
  // =====================================================

  return (
    <main className="min-h-screen bg-gray-100 p-4 md:p-8">

      <div className="max-w-7xl mx-auto">

        {/* HEADER */}

        <div className="mb-5 flex items-start justify-between gap-3">

          <div>

            <Link
              href="/login"
              className="text-gray-500"
            >
              ← กลับ
            </Link>

            <p className="oms-page-kicker">ORDERS / ORDER MANAGEMENT</p>
<h1 className="text-3xl font-bold mt-3">คำสั่งซื้อ</h1>

            <p className="text-gray-500 mt-1">
              ดูและจัดการคำสั่งซื้อ B2B ตามวันที่จัดส่ง
            </p>

          </div>

          <button
            type="button"
            onClick={() =>
              loadOrders(
                selectedDate
              )
            }
            disabled={
              loading
            }
            className="mt-1 inline-flex h-10 shrink-0 items-center justify-center whitespace-nowrap rounded-xl border border-[#B6DCD5] bg-white px-3 text-xs font-extrabold text-[#008F8D] shadow-sm transition hover:bg-[#F0FAF7] disabled:opacity-50 sm:px-4 sm:text-sm"
          >
            {loading
              ? "กำลังโหลด..."
              : "↻ รีเฟรช"}
          </button>

        </div>

        {/* COMPACT DATE / SEARCH / STATUS FILTERS */}
        <section className="mb-4 min-w-0 overflow-hidden rounded-2xl border border-[#D6E8E3] bg-white p-4 shadow-[0_3px_12px_rgba(15,95,88,0.04)] sm:p-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-sm font-extrabold text-[#17453F]">ค้นหาและกรองคำสั่งซื้อ</h2>
            <span className="h-1.5 w-9 rounded-full bg-[#FDBC16]" aria-hidden="true" />
          </div>
          <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-[minmax(0,350px)_minmax(0,1fr)] lg:grid-cols-[minmax(0,350px)_minmax(0,1fr)_minmax(0,190px)] md:items-end">
            <div className="min-w-0">
              <label htmlFor="orders-delivery-date" className="mb-1.5 block text-xs font-bold text-[#52786F]">
                วันที่จัดส่ง
              </label>
              <div className="flex min-w-0 flex-wrap items-center gap-1.5 sm:flex-nowrap">
                <input
                  id="orders-delivery-date"
                  type="date"
                  value={selectedDate}
                  onChange={(event) => {
                    if (!event.target.value) return;
                    setSelectedDate(event.target.value);
                    setAllDates(false);
                  }}
                  style={{ minWidth: 0, width: "134px", height: "44px", boxSizing: "border-box", paddingTop: 0, paddingBottom: 0, textAlign: "left" }}
                  className="block h-11 shrink-0 rounded-xl border border-[#C8DDD8] bg-white px-2 text-left text-[13px] leading-none text-[#17453F] [color-scheme:light]"
                  aria-label="เลือกวันที่จัดส่ง"
                />
                <button
                  type="button"
                  aria-pressed={!allDates && selectedDate === getBangkokToday()}
                  onClick={() => {
                    setSelectedDate(getBangkokToday());
                    setAllDates(false);
                  }}
                  className={`h-11 shrink-0 whitespace-nowrap rounded-xl border px-2 text-xs font-extrabold transition ${!allDates && selectedDate === getBangkokToday() ? "border-[#02B0AF] bg-[#E6F8F5] text-[#008F8D]" : "border-[#D5E8E2] bg-white text-[#52786F] hover:bg-[#F0FAF7]"}`}
                >
                  วันนี้
                </button>
                <button
                  type="button"
                  aria-pressed={!allDates && selectedDate === getBangkokTomorrow()}
                  onClick={() => {
                    setSelectedDate(getBangkokTomorrow());
                    setAllDates(false);
                  }}
                  className={`h-11 shrink-0 whitespace-nowrap rounded-xl border px-2 text-xs font-extrabold transition ${!allDates && selectedDate === getBangkokTomorrow() ? "border-[#02B0AF] bg-[#E6F8F5] text-[#008F8D]" : "border-[#D5E8E2] bg-white text-[#52786F] hover:bg-[#F0FAF7]"}`}
                >
                  พรุ่งนี้
                </button>
                <button
                  type="button"
                  aria-pressed={allDates}
                  onClick={() => setAllDates(true)}
                  className={`h-11 shrink-0 whitespace-nowrap rounded-xl border px-2 text-xs font-extrabold transition ${allDates ? "border-[#02B0AF] bg-[#E6F8F5] text-[#008F8D]" : "border-[#D5E8E2] bg-white text-[#52786F] hover:bg-[#F0FAF7]"}`}
                >
                  ทุกวัน
                </button>
              </div>
            </div>

            <div className="min-w-0">
              <label htmlFor="orders-number-search" className="mb-1.5 block text-xs font-bold text-[#52786F]">
                ค้นหาเลขคำสั่งซื้อ / ลูกค้า
              </label>
              <input
                id="orders-number-search"
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="เลขคำสั่งซื้อ ชื่อร้าน หรือรหัสลูกค้า"
                className="block h-11 w-full min-w-0 max-w-full rounded-xl border border-[#C8DDD8] bg-white px-3 py-2 text-sm text-[#17453F] placeholder:text-[#9AAFA8]"
              />
            </div>

            <div className="min-w-0">
              <label htmlFor="orders-status-filter" className="mb-1.5 block text-xs font-bold text-[#52786F]">
                สถานะคำสั่งซื้อ
              </label>
              <select
                id="orders-status-filter"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
                className="block h-11 w-full min-w-0 max-w-full rounded-xl border border-[#C8DDD8] bg-white px-3 py-2 text-sm text-[#17453F]"
              >
                <option value="all">ทุกสถานะ</option>
                <option value="pending">รอดำเนินการ</option>
                <option value="completed">เสร็จสิ้น</option>
                <option value="cancelled">ยกเลิก</option>
              </select>
            </div>
          </div>
        </section>

                {/* MESSAGE */}

        {message && (

          <div className="bg-white border rounded-lg p-4 mb-6 text-red-600">
            {message}
          </div>

        )}

        {/* ORDERS LIST: ALWAYS BEFORE STATISTICS */}

        <section className="bg-white border rounded-2xl overflow-hidden">

          <div className="p-5 border-b flex flex-col md:flex-row md:justify-between md:items-center gap-2">

            <div>

              <h2 className="font-bold text-lg">
                รายการคำสั่งซื้อ
              </h2>

              <p className="text-sm text-gray-500 mt-1">
                {dateScopeLabel}
              </p>

            </div>

            <span className="text-sm text-gray-500">
              {
                filteredOrders.length
              }{" "}
              รายการ · เร็วที่สุดก่อน
            </span>

          </div>

          {loading ? (

            <div className="p-8 text-gray-500">
              กำลังโหลดคำสั่งซื้อ...
            </div>

          ) : filteredOrders.length ===
            0 ? (

            <div className="p-8 text-gray-500">
              ไม่พบคำสั่งซื้อที่ตรงกับตัวกรองที่เลือก
            </div>

          ) : (

            <div className="overflow-x-auto">

              <table className="w-full">

                <thead className="bg-gray-50">

                  <tr>

                    <th className="text-left p-4">
                      คำสั่งซื้อ
                    </th>

                    <th className="text-left p-4">
                      ลูกค้า
                    </th>

                    <th className="text-left p-4">
                      การจัดส่ง
                    </th>

                    <th className="text-left p-4">
                      สถานะ
                    </th>

                    <th className="text-right p-4">
                      ยอดเงิน
                    </th>

                    <th className="text-right p-4">
                      การดำเนินการ
                    </th>

                  </tr>

                </thead>

                <tbody>

                  {filteredOrders.map(
                    (order) => {
                      const urgency = deliveryUrgency(order, clock);

                      return (
                        <tr
                          key={order.id}
                          className={`border-t border-[#E2EEEA] ${urgencyRowStyle[urgency]}`}
                        >

                          <td className={`border-l-4 p-4 ${urgencyBorderStyle[urgency]}`}>

                            <div className="flex items-center gap-2">

                              <div className="font-bold">
                                #
                                {
                                  order.group_root_order_id
                                    ? `${orders.find(parent=>parent.id===order.group_root_order_id)?.order_number ?? order.order_number}/${order.group_sequence ?? 1}`
                                    : order.order_number
                                }
                              </div>

                              {urgency === "overdue" && (
                                <span className="rounded-full border border-[#FECACA] bg-[#FEF2F2] px-2 py-1 text-[11px] font-extrabold text-[#B91C1C]">
                                  เกินกำหนด
                                </span>
                              )}
                              {urgency === "at-risk" && (
                                <span className="rounded-full border border-[#FED7AA] bg-[#FFF1E6] px-2 py-1 text-[11px] font-extrabold text-[#C2410C]">
                                  เสี่ยงล่าช้า
                                </span>
                              )}

                            </div>

                            <div className="text-sm text-gray-500">
                              {
                                order
                                  .customers
                                  ?.customer_code ??
                                "—"
                              }
                            </div>

                          </td>

                          <td className="p-4">

                            <div className="font-medium">
                              {
                                order
                                  .customers
                                  ?.customer_name ??
                                "ไม่ทราบชื่อลูกค้า"
                              }
                            </div>

                            <div className="text-sm text-gray-500">
                              {
                                order
                                  .customers
                                  ?.phone ??
                                ""
                              }
                            </div>

                          </td>

                          <td className="p-4">

                            <div className="font-medium">
                              {
                                order.delivery_slot ??
                                "—"
                              }
                            </div>

                            <span
                              title={order.delivery_date ?? undefined}
                              className={`mt-1 inline-flex rounded-lg border px-2 py-1 text-xs font-extrabold ${urgencyDateStyle[urgency]}`}
                            >
                              {relativeDeliveryDay(order.delivery_date, clock.date)}
                            </span>

                          </td>

                          <td className="p-4">

                            <span className="inline-block bg-gray-100 rounded-full px-3 py-1 text-sm font-medium">
                              {prettyStatus(
                                order.status
                              )}
                            </span>

                          </td>

                          <td className="p-4 text-right">

                            {order.final_amount !==
                            null
                              ? `฿${Number(
                                  order.final_amount
                                ).toLocaleString(
                                  "th-TH",
                                  {
                                    minimumFractionDigits:
                                      2,
                                    maximumFractionDigits:
                                      2,
                                  }
                                )}`
                              : "—"}

                          </td>

                          <td className="p-4">

                            <div className="flex justify-end gap-2">

                              <Link
                                href={`/orders/${order.order_number}`}
                                className="inline-block bg-white border rounded-lg px-4 py-2 font-semibold whitespace-nowrap"
                              >
                                ดูรายละเอียด
                              </Link>

                              {isManager &&
                                isPending(
                                  order
                                ) && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        void cancelOrder(
                                          order.order_number
                                        )
                                      }
                                      disabled={
                                        managerActionOrder ===
                                        order.order_number
                                      }
                                      className="inline-block bg-white border border-red-300 text-red-700 rounded-lg px-4 py-2 font-semibold whitespace-nowrap disabled:opacity-40"
                                    >
                                      ยกเลิกคำสั่งซื้อ
                                    </button>

                                    <button
                                      type="button"
                                      onClick={() =>
                                        void forceCompleteOrder(
                                          order.order_number
                                        )
                                      }
                                      disabled={
                                        managerActionOrder ===
                                        order.order_number
                                      }
                                      className="inline-block bg-black text-white rounded-lg px-4 py-2 font-semibold whitespace-nowrap disabled:opacity-40"
                                    >
                                      {managerActionOrder ===
                                      order.order_number
                                        ? "กำลังดำเนินการ..."
                                        : "บังคับเสร็จสิ้น"}
                                    </button>
                                  </>
                                )}

                              {order.status ===
                                "awaiting_payment" && (

                                <Link
                                  href={`/orders/${order.order_number}/payment`}
                                  className="inline-block bg-black text-white rounded-lg px-4 py-2 font-semibold whitespace-nowrap"
                                >
                                  อัปโหลดสลิป
                                </Link>

                              )}

                              {order.status ===
                                "payment_submitted" && (

                                <Link
                                  href="/tasks"
                                  className="inline-block bg-black text-white rounded-lg px-4 py-2 font-semibold whitespace-nowrap"
                                >
                                  งานตรวจสอบการชำระเงิน
                                </Link>

                              )}

                            </div>

                          </td>

                        </tr>
                      );
                    }
                  )}

                </tbody>

              </table>

            </div>

          )}

        </section>

        {/* ORDER STATISTICS — BELOW THE LIST */}
        <section className="mt-5 pb-2" aria-label="สถิติคำสั่งซื้อ">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-extrabold text-[#17453F]">ภาพรวมคำสั่งซื้อ</h2>
            <p className="text-xs text-[#718D84]">{dateScopeLabel}</p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "รอดำเนินการ", value: pendingCount, highlight: true },
              { label: "เสร็จสิ้น", value: completedCount, highlight: false },
              { label: "ยกเลิก", value: cancelledCount, highlight: false },
              { label: "ทั้งหมด", value: totalCount, highlight: false },
            ].map((stat) => (
              <div
                key={stat.label}
                className="rounded-2xl border border-[#D5E8E2] bg-white p-4 shadow-[0_3px_12px_rgba(15,95,88,0.04)]"
              >
                <div aria-hidden="true" className={stat.highlight ? "mb-3 h-1 w-8 rounded-full bg-[#FDBC16]" : "mb-3 h-1 w-8 rounded-full bg-[#A5E5DD]"} />
                <p className="text-xs font-bold text-[#718D84]">{stat.label}</p>
                <p className="mt-1 text-2xl font-black tabular-nums text-[#008F8D]">{stat.value}</p>
              </div>
            ))}
          </div>
        </section>

      </div>

    </main>
  );
}
