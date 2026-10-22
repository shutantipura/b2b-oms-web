"use client";

import {
  useEffect,
  useMemo,
  useState,
} from "react";

import Link from "next/link";

import { supabase } from "../../lib/supabase";

type Order = {
  id: string;
  order_number: number;
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
  // Orders for the selected day always show the earliest delivery slot first.
  // Missing delivery slots go last. Within the same slot, older orders go first.
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
    date: string =
      selectedDate
  ) {
    setLoading(
      true
    );

    setMessage(
      ""
    );

    const {
      data,
      error,
    } =
      await supabase
        .from(
          "orders"
        )
        .select(`
          id,
          order_number,
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
        .eq(
          "delivery_date",
          date
        )
        .order(
          "order_number",
          {
            ascending:
              false,
          }
        );

    if (error) {
      setMessage(
        "ไม่สามารถโหลดคำสั่งซื้อได้: " +
          error.message
      );

      setOrders(
        []
      );

      setLoading(
        false
      );

      return;
    }

    setOrders(
      (data ??
        []) as unknown as Order[]
    );

    setLoading(
      false
    );
  }

  useEffect(() => {
    void loadManagerAccess();

    loadOrders(
      selectedDate
    );
  }, [
    selectedDate,
  ]);

  // =====================================================
  // COUNTS FOR SELECTED DATE
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

  // =====================================================
  // PAGE
  // =====================================================

  return (
    <main className="min-h-screen bg-gray-100 p-4 md:p-8">

      <div className="max-w-7xl mx-auto">

        {/* HEADER */}

        <div className="flex flex-col md:flex-row md:justify-between md:items-start gap-4 mb-8">

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
              ดูคำสั่งซื้อ B2B ตามวันที่จัดส่ง
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
            className="bg-white border rounded-lg px-5 py-2 disabled:opacity-50"
          >
            {loading
              ? "กำลังโหลด..."
              : "รีเฟรช"}
          </button>

        </div>

        {/* COMPACT DATE / SEARCH / STATUS FILTERS */}
        <section className="mb-4 min-w-0 overflow-hidden rounded-2xl border border-[#D6E8E3] bg-white p-4 shadow-[0_3px_12px_rgba(15,95,88,0.04)] sm:p-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-sm font-extrabold text-[#17453F]">ค้นหาและกรองคำสั่งซื้อ</h2>
            <span className="h-1.5 w-9 rounded-full bg-[#FDBC16]" aria-hidden="true" />
          </div>
          <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-[minmax(0,200px)_minmax(0,1fr)_minmax(0,210px)] md:items-end">
            <div className="min-w-0">
              <label htmlFor="orders-delivery-date" className="mb-1.5 block text-xs font-bold text-[#52786F]">
                วันที่จัดส่ง
              </label>
              <div className="flex min-w-0 items-center gap-2">
                <input
                  id="orders-delivery-date"
                  type="date"
                  value={selectedDate}
                  onChange={(event) => {
                    setSelectedDate(event.target.value);
                    setStatusFilter("all");
                  }}
                  style={{ minWidth: 0, maxWidth: "11.5rem", width: "100%", boxSizing: "border-box" }}
                  className="block h-11 flex-1 rounded-xl border border-[#C8DDD8] bg-white px-2 py-2 text-sm text-[#17453F]"
                />
                <button
                  type="button"
                  onClick={() => {
                    setSelectedDate(getBangkokToday());
                    setStatusFilter("all");
                  }}
                  className="h-11 shrink-0 rounded-xl border border-[#B9DDD6] bg-[#F0FAF7] px-3 text-xs font-extrabold text-[#008F8D]"
                >
                  วันนี้
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
                {prettyDate(
                  selectedDate
                )}
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
              ไม่พบคำสั่งซื้อสำหรับวันที่และตัวกรองที่เลือก
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
                    (
                      order,
                      index
                    ) => {

                      const urgent =
                        statusFilter !==
                          "completed" &&
                        isPending(
                          order
                        ) &&
                        index <
                          3;

                      return (
                        <tr
                          key={
                            order.id
                          }
                          className="border-t"
                        >

                          <td className="p-4">

                            <div className="flex items-center gap-2">

                              <div className="font-bold">
                                #
                                {
                                  order.order_number
                                }
                              </div>

                              {urgent && (

                                <span className="text-xs border rounded-full px-2 py-1">
                                  เร่งด่วน
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

                            <div className="text-sm text-gray-500">
                              {
                                order.delivery_date ??
                                "—"
                              }
                            </div>

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
            <p className="text-xs text-[#718D84]">{prettyDate(selectedDate)}</p>
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
