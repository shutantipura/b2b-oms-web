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

  delivery_date:
    | string
    | null;

  delivery_slot:
    | string
    | null;

  final_amount:
    | number
    | string
    | null;

  customers: {
    customer_name: string;
    customer_code: string;
    phone: string | null;
  } | null;
};

type StatusFilter =
  | "active"
  | "completed";

type SortOption =
  | "delivery_soonest"
  | "delivery_latest"
  | "newest"
  | "oldest";

function prettyStatus(
  status: string
) {
  return status
    .split("_")
    .map(
      (word) =>
        word
          .charAt(0)
          .toUpperCase() +
        word.slice(1)
    )
    .join(" ");
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

  return match?.[1] ??
    null;
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

  const aMissing =
    !a.delivery_date ||
    !aStart;

  const bMissing =
    !b.delivery_date ||
    !bStart;

  if (
    aMissing &&
    !bMissing
  ) {
    return 1;
  }

  if (
    !aMissing &&
    bMissing
  ) {
    return -1;
  }

  if (
    aMissing &&
    bMissing
  ) {
    return (
      b.order_number -
      a.order_number
    );
  }

  const aKey =
    `${a.delivery_date}T${aStart}`;

  const bKey =
    `${b.delivery_date}T${bStart}`;

  const result =
    aKey.localeCompare(
      bKey
    );

  return direction ===
    "asc"
    ? result
    : -result;
}

export default function OrdersPage() {
  const [
    orders,
    setOrders,
  ] =
    useState<Order[]>([]);

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
      "active"
    );

  const [
    sortOption,
    setSortOption,
  ] =
    useState<SortOption>(
      "delivery_soonest"
    );

  // =====================================================
  // LOAD ORDERS
  // =====================================================

  async function loadOrders() {
    setLoading(true);
    setMessage("");

    const {
      data,
      error,
    } =
      await supabase
        .from("orders")
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
        .order(
          "order_number",
          {
            ascending:
              false,
          }
        );

    if (error) {
      setMessage(
        "Could not load orders: " +
          error.message
      );

      setLoading(false);
      return;
    }

    setOrders(
      (data ??
        []) as unknown as Order[]
    );

    setLoading(false);
  }

  useEffect(() => {
    loadOrders();
  }, []);

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
          (order) => {
            const matchesStatus =
              statusFilter ===
              "active"
                ? order.status !==
                    "completed" &&
                  order.status !==
                    "cancelled"
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
              order.customers
                ?.customer_name
                ?.toLowerCase()
                .includes(
                  searchText
                ) ||
              order.customers
                ?.customer_code
                ?.toLowerCase()
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
  // COUNTS
  // =====================================================

  const activeCount =
    orders.filter(
      (order) =>
        order.status !==
          "completed" &&
        order.status !==
          "cancelled"
    ).length;

  const awaitingPaymentCount =
    orders.filter(
      (order) =>
        order.status ===
        "awaiting_payment"
    ).length;

  const completedCount =
    orders.filter(
      (order) =>
        order.status ===
        "completed"
    ).length;

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-100 p-8">
        Loading orders...
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-100 p-8">

      <div className="max-w-7xl mx-auto">

        {/* HEADER */}

        <div className="flex justify-between items-start mb-8">

          <div>

            <Link
              href="/"
              className="text-gray-500"
            >
              ← Back
            </Link>

            <h1 className="text-3xl font-bold mt-3">
              Orders
            </h1>

            <p className="text-gray-500 mt-1">
              View active or completed B2B orders.
            </p>

          </div>

          <button
            onClick={
              loadOrders
            }
            className="bg-white border rounded-lg px-5 py-2"
          >
            Refresh
          </button>

        </div>

        {/* SUMMARY */}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">

          <div className="bg-white border rounded-2xl p-5">

            <p className="text-sm text-gray-500">
              Active Orders
            </p>

            <p className="text-3xl font-bold mt-2">
              {
                activeCount
              }
            </p>

          </div>

          <div className="bg-white border rounded-2xl p-5">

            <p className="text-sm text-gray-500">
              Awaiting Payment
            </p>

            <p className="text-3xl font-bold mt-2">
              {
                awaitingPaymentCount
              }
            </p>

          </div>

          <div className="bg-white border rounded-2xl p-5">

            <p className="text-sm text-gray-500">
              Completed
            </p>

            <p className="text-3xl font-bold mt-2">
              {
                completedCount
              }
            </p>

          </div>

        </div>

        {/* FILTERS */}

        <section className="bg-white border rounded-2xl p-5 mb-6">

          <div className="grid md:grid-cols-3 gap-4">

            <div>

              <label className="block text-sm font-medium mb-2">
                Search
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
                placeholder="Order number, customer name or customer code"
                className="w-full border rounded-lg px-4 py-3"
              />

            </div>

            <div>

              <label className="block text-sm font-medium mb-2">
                Status
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

                <option value="active">
                  Active
                </option>

                <option value="completed">
                  Completed
                </option>

              </select>

            </div>

            <div>

              <label className="block text-sm font-medium mb-2">
                Sort By
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
                  Delivery — Soonest First
                </option>

                <option value="delivery_latest">
                  Delivery — Latest First
                </option>

                <option value="newest">
                  Newest Order First
                </option>

                <option value="oldest">
                  Oldest Order First
                </option>

              </select>

            </div>

          </div>

        </section>

        {message && (
          <div className="bg-white border rounded-lg p-4 mb-6 text-red-600">
            {message}
          </div>
        )}

        {/* ORDERS */}

        <section className="bg-white border rounded-2xl overflow-hidden">

          <div className="p-5 border-b flex justify-between items-center">

            <div>

              <h2 className="font-bold text-lg">

                {statusFilter ===
                "active"
                  ? "Active Orders"
                  : "Completed Orders"}

              </h2>

              <p className="text-sm text-gray-500 mt-1">

                {sortOption ===
                "delivery_soonest"
                  ? "Soonest deliveries shown first."
                  : "Sorted by selected order."}

              </p>

            </div>

            <span className="text-sm text-gray-500">
              {
                filteredOrders.length
              }{" "}
              orders
            </span>

          </div>

          {filteredOrders.length ===
          0 ? (

            <div className="p-8 text-gray-500">
              No orders found.
            </div>

          ) : (

            <div className="overflow-x-auto">

              <table className="w-full">

                <thead className="bg-gray-50">

                  <tr>

                    <th className="text-left p-4">
                      Order
                    </th>

                    <th className="text-left p-4">
                      Customer
                    </th>

                    <th className="text-left p-4">
                      Delivery
                    </th>

                    <th className="text-left p-4">
                      Status
                    </th>

                    <th className="text-right p-4">
                      Amount
                    </th>

                    <th className="text-right p-4">
                      Action
                    </th>

                  </tr>

                </thead>

                <tbody>

                  {filteredOrders.map(
                    (
                      order,
                      index
                    ) => (

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

                          {statusFilter ===
                            "active" &&
                            sortOption ===
                              "delivery_soonest" &&
                            index <
                              3 && (

                              <span className="text-xs border rounded-full px-2 py-1">
                                PRIORITY
                              </span>

                            )}

                        </div>

                        <div className="text-sm text-gray-500">
                          {
                            order.customers
                              ?.customer_code ??
                            "—"
                          }
                        </div>

                      </td>

                      <td className="p-4">

                        <div className="font-medium">
                          {
                            order.customers
                              ?.customer_name ??
                            "Unknown customer"
                          }
                        </div>

                        <div className="text-sm text-gray-500">
                          {
                            order.customers
                              ?.phone ??
                            ""
                          }
                        </div>

                      </td>

                      <td className="p-4">

                        <div className="font-medium">
                          {
                            order.delivery_date ??
                            "—"
                          }
                        </div>

                        <div className="text-sm text-gray-500">
                          {
                            order.delivery_slot ??
                            ""
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
                            ).toFixed(
                              2
                            )}`
                          : "—"}

                      </td>

                      <td className="p-4">

                        <div className="flex justify-end gap-2">

                          <Link
                            href={`/orders/${order.order_number}`}
                            className="inline-block bg-white border rounded-lg px-4 py-2 font-semibold"
                          >
                            VIEW
                          </Link>

                          {order.status ===
                            "awaiting_payment" && (

                            <Link
                              href={`/orders/${order.order_number}/payment`}
                              className="inline-block bg-black text-white rounded-lg px-4 py-2 font-semibold"
                            >
                              UPLOAD SLIP
                            </Link>

                          )}

                          {order.status ===
                            "payment_submitted" && (

                            <Link
                              href="/tasks"
                              className="inline-block bg-black text-white rounded-lg px-4 py-2 font-semibold"
                            >
                              PAYMENT TASK
                            </Link>

                          )}

                        </div>

                      </td>

                    </tr>

                  ))}

                </tbody>

              </table>

            </div>

          )}

        </section>

      </div>

    </main>
  );
}