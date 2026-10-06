"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "../../lib/supabase";

type Order = {
  id: string;
  order_number: number;
  status: string;
  delivery_date: string | null;
  delivery_slot: string | null;
  final_amount: number | string | null;

  customers: {
    customer_name: string;
    customer_code: string;
    phone: string | null;
  } | null;
};

const statusOptions = [
  "all",
  "awaiting_confirmation",
  "awaiting_picking",
  "picking",
  "awaiting_billing",
  "ready_for_delivery",
  "out_for_delivery",
  "awaiting_payment",
  "payment_submitted",
  "completed",
];

function prettyStatus(status: string) {
  return status
    .split("_")
    .map(
      (word) =>
        word.charAt(0).toUpperCase() +
        word.slice(1)
    )
    .join(" ");
}

export default function OrdersPage() {
  const [orders, setOrders] =
    useState<Order[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [message, setMessage] =
    useState("");

  const [search, setSearch] =
    useState("");

  const [statusFilter, setStatusFilter] =
    useState("all");

  async function loadOrders() {
    setLoading(true);
    setMessage("");

    const {
      data,
      error,
    } = await supabase
      .from("orders")
      .select(`
        id,
        order_number,
        status,
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
        { ascending: false }
      );

    if (error) {
      console.error(error);

      setMessage(
        "Could not load orders: " +
          error.message
      );

      setLoading(false);
      return;
    }

    setOrders(
      (data ?? []) as unknown as Order[]
    );

    setLoading(false);
  }

  useEffect(() => {
    loadOrders();
  }, []);

  const filteredOrders =
    useMemo(() => {
      const searchText =
        search.trim().toLowerCase();

      return orders.filter(
        (order) => {
          const matchesStatus =
            statusFilter === "all" ||
            order.status ===
              statusFilter;

          const matchesSearch =
            searchText === "" ||
            String(
              order.order_number
            ).includes(searchText) ||
            order.customers
              ?.customer_name
              ?.toLowerCase()
              .includes(searchText) ||
            order.customers
              ?.customer_code
              ?.toLowerCase()
              .includes(searchText);

          return (
            matchesStatus &&
            matchesSearch
          );
        }
      );
    }, [
      orders,
      search,
      statusFilter,
    ]);

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
              View all B2B orders and their current status.
            </p>
          </div>

          <button
            onClick={loadOrders}
            className="bg-white border rounded-lg px-5 py-2"
          >
            Refresh
          </button>

        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">

          <div className="bg-white border rounded-2xl p-5">

            <p className="text-sm text-gray-500">
              Active Orders
            </p>

            <p className="text-3xl font-bold mt-2">
              {activeCount}
            </p>

          </div>

          <div className="bg-white border rounded-2xl p-5">

            <p className="text-sm text-gray-500">
              Awaiting Payment
            </p>

            <p className="text-3xl font-bold mt-2">
              {awaitingPaymentCount}
            </p>

          </div>

          <div className="bg-white border rounded-2xl p-5">

            <p className="text-sm text-gray-500">
              Completed
            </p>

            <p className="text-3xl font-bold mt-2">
              {completedCount}
            </p>

          </div>

        </div>

        <section className="bg-white border rounded-2xl p-5 mb-6">

          <div className="grid md:grid-cols-2 gap-4">

            <div>
              <label className="block text-sm font-medium mb-2">
                Search
              </label>

              <input
                type="text"
                value={search}
                onChange={(event) =>
                  setSearch(
                    event.target.value
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
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(
                    event.target.value
                  )
                }
                className="w-full border rounded-lg px-4 py-3 bg-white"
              >

                {statusOptions.map(
                  (status) => (
                    <option
                      key={status}
                      value={status}
                    >
                      {status === "all"
                        ? "All Statuses"
                        : prettyStatus(
                            status
                          )}
                    </option>
                  )
                )}

              </select>
            </div>

          </div>

        </section>

        {message && (
          <div className="bg-white border rounded-lg p-4 mb-6 text-red-600">
            {message}
          </div>
        )}

        <section className="bg-white border rounded-2xl overflow-hidden">

          <div className="p-5 border-b flex justify-between items-center">

            <h2 className="font-bold text-lg">
              All Orders
            </h2>

            <span className="text-sm text-gray-500">
              {filteredOrders.length} orders
            </span>

          </div>

          {filteredOrders.length === 0 ? (

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
  {filteredOrders.map((order) => (
    <tr
      key={order.id}
      className="border-t"
    >
      {/* ORDER */}
      <td className="p-4">
        <div className="font-bold">
          #{order.order_number}
        </div>

        <div className="text-sm text-gray-500">
          {order.customers?.customer_code ?? "—"}
        </div>
      </td>

      {/* CUSTOMER */}
      <td className="p-4">
        <div className="font-medium">
          {order.customers?.customer_name ??
            "Unknown customer"}
        </div>

        <div className="text-sm text-gray-500">
          {order.customers?.phone ?? ""}
        </div>
      </td>

      {/* DELIVERY */}
      <td className="p-4">
        <div>
          {order.delivery_date ?? "—"}
        </div>

        <div className="text-sm text-gray-500">
          {order.delivery_slot ?? ""}
        </div>
      </td>

      {/* STATUS */}
      <td className="p-4">
        <span className="inline-block bg-gray-100 rounded-full px-3 py-1 text-sm font-medium">
          {prettyStatus(order.status)}
        </span>
      </td>

      {/* AMOUNT */}
      <td className="p-4 text-right">
        {order.final_amount !== null
          ? `฿${Number(
              order.final_amount
            ).toFixed(2)}`
          : "—"}
      </td>

      {/* ACTIONS */}
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