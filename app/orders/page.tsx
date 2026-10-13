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
  | "completed";

type SortOption =
  | "delivery_soonest"
  | "delivery_latest"
  | "newest"
  | "oldest";

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

function compareDelivery(
  a: Order,
  b: Order,
  direction:
    | "asc"
    | "desc"
) {
  const aStart =
    getSlotStart(
      a.delivery_slot
    );

  const bStart =
    getSlotStart(
      b.delivery_slot
    );

  if (
    !aStart &&
    bStart
  ) {
    return 1;
  }

  if (
    aStart &&
    !bStart
  ) {
    return -1;
  }

  if (
    !aStart &&
    !bStart
  ) {
    return (
      b.order_number -
      a.order_number
    );
  }

  const result =
    (aStart ?? "").localeCompare(
      bStart ?? ""
    );

  return direction ===
    "asc"
    ? result
    : -result;
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

  const [
    sortOption,
    setSortOption,
  ] =
    useState<SortOption>(
      "delivery_soonest"
    );

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
        .neq(
          "status",
          "cancelled"
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

  const totalCount =
    orders.length;

  // =====================================================
  // FILTER + SORT
  // =====================================================

  const filteredOrders =
    useMemo(() => {
      const searchText =
        search
          .trim()
          .toLowerCase();

      const filtered =
        orders.filter(
          (
            order
          ) => {
            const matchesStatus =
              statusFilter ===
              "all"
                ? true
                : statusFilter ===
                  "pending"
                ? isPending(
                    order
                  )
                : order.status ===
                  "completed";

            const matchesSearch =
              searchText ===
                "" ||
              String(
                order.order_number
              ).includes(
                searchText
              ) ||
              (
                order.customers
                  ?.customer_name ??
                ""
              )
                .toLowerCase()
                .includes(
                  searchText
                ) ||
              (
                order.customers
                  ?.customer_code ??
                ""
              )
                .toLowerCase()
                .includes(
                  searchText
                ) ||
              (
                order.customers
                  ?.phone ??
                ""
              )
                .toLowerCase()
                .includes(
                  searchText
                );

            return (
              matchesStatus &&
              matchesSearch
            );
          }
        );

      return [
        ...filtered,
      ].sort(
        (
          a,
          b
        ) => {
          if (
            sortOption ===
            "delivery_soonest"
          ) {
            return compareDelivery(
              a,
              b,
              "asc"
            );
          }

          if (
            sortOption ===
            "delivery_latest"
          ) {
            return compareDelivery(
              a,
              b,
              "desc"
            );
          }

          if (
            sortOption ===
            "newest"
          ) {
            return (
              new Date(
                b.created_at
              ).getTime() -
              new Date(
                a.created_at
              ).getTime()
            );
          }

          return (
            new Date(
              a.created_at
            ).getTime() -
            new Date(
              b.created_at
            ).getTime()
          );
        }
      );
    }, [
      orders,
      search,
      statusFilter,
      sortOption,
    ]);

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
              href="/"
              className="text-gray-500"
            >
              ← กลับ
            </Link>

            <h1 className="text-3xl font-bold mt-3">
              คำสั่งซื้อ
            </h1>

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

        {/* DATE FILTER */}

        <section className="bg-white border rounded-2xl p-5 mb-6">

          <div className="flex flex-col md:flex-row md:items-end gap-4">

            <div className="flex-1">

              <label className="block text-sm font-medium mb-2">
                วันที่จัดส่ง
              </label>

              <input
                type="date"
                value={
                  selectedDate
                }
                onChange={(
                  event
                ) => {
                  setSelectedDate(
                    event.target
                      .value
                  );

                  setStatusFilter(
                    "all"
                  );
                }}
                className="w-full border rounded-lg px-4 py-3 bg-white"
              />

            </div>

            <button
              type="button"
              onClick={() => {
                setSelectedDate(
                  getBangkokToday()
                );

                setStatusFilter(
                  "all"
                );
              }}
              className="bg-white border rounded-lg px-5 py-3 font-medium"
            >
              วันนี้
            </button>

          </div>

          <p className="text-sm text-gray-500 mt-3">
            {prettyDate(
              selectedDate
            )}
          </p>

        </section>

        {/* SUMMARY CARDS */}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">

          <button
            type="button"
            onClick={() =>
              setStatusFilter(
                "pending"
              )
            }
            className={`text-left bg-white border rounded-2xl p-5 transition ${
              statusFilter ===
              "pending"
                ? "ring-2 ring-black"
                : ""
            }`}
          >

            <p className="text-sm text-gray-500">
              รอดำเนินการ
            </p>

            <p className="text-3xl font-bold mt-2">
              {
                pendingCount
              }
            </p>

          </button>

          <button
            type="button"
            onClick={() =>
              setStatusFilter(
                "completed"
              )
            }
            className={`text-left bg-white border rounded-2xl p-5 transition ${
              statusFilter ===
              "completed"
                ? "ring-2 ring-black"
                : ""
            }`}
          >

            <p className="text-sm text-gray-500">
              เสร็จสิ้น
            </p>

            <p className="text-3xl font-bold mt-2">
              {
                completedCount
              }
            </p>

          </button>

          <button
            type="button"
            onClick={() =>
              setStatusFilter(
                "all"
              )
            }
            className={`text-left bg-white border rounded-2xl p-5 transition ${
              statusFilter ===
              "all"
                ? "ring-2 ring-black"
                : ""
            }`}
          >

            <p className="text-sm text-gray-500">
              ทั้งหมด
            </p>

            <p className="text-3xl font-bold mt-2">
              {
                totalCount
              }
            </p>

          </button>

        </div>

        {/* SEARCH / FILTER / SORT */}

        <section className="bg-white border rounded-2xl p-5 mb-6">

          <div className="grid md:grid-cols-3 gap-4">

            <div>

              <label className="block text-sm font-medium mb-2">
                ค้นหา
              </label>

              <input
                type="text"
                value={
                  search
                }
                onChange={(
                  event
                ) =>
                  setSearch(
                    event.target
                      .value
                  )
                }
                placeholder="เลขคำสั่งซื้อ ชื่อลูกค้า รหัสลูกค้า หรือเบอร์โทร"
                className="w-full border rounded-lg px-4 py-3"
              />

            </div>

            <div>

              <label className="block text-sm font-medium mb-2">
                สถานะ
              </label>

              <select
                value={
                  statusFilter
                }
                onChange={(
                  event
                ) =>
                  setStatusFilter(
                    event.target
                      .value as StatusFilter
                  )
                }
                className="w-full border rounded-lg px-4 py-3 bg-white"
              >

                <option value="all">
                  ทั้งหมด
                </option>

                <option value="pending">
                  รอดำเนินการ
                </option>

                <option value="completed">
                  เสร็จสิ้น
                </option>

              </select>

            </div>

            <div>

              <label className="block text-sm font-medium mb-2">
                เรียงตาม
              </label>

              <select
                value={
                  sortOption
                }
                onChange={(
                  event
                ) =>
                  setSortOption(
                    event.target
                      .value as SortOption
                  )
                }
                className="w-full border rounded-lg px-4 py-3 bg-white"
              >

                <option value="delivery_soonest">
                  เวลาจัดส่ง — เร็วที่สุดก่อน
                </option>

                <option value="delivery_latest">
                  เวลาจัดส่ง — ช้าที่สุดก่อน
                </option>

                <option value="newest">
                  คำสั่งซื้อล่าสุดก่อน
                </option>

                <option value="oldest">
                  คำสั่งซื้อเก่าสุดก่อน
                </option>

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

        {/* ORDERS LIST */}

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
              รายการ
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
                        sortOption ===
                          "delivery_soonest" &&
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

      </div>

    </main>
  );
}
