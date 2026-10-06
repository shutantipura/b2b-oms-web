"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "../../lib/supabase";

type Order = {
  id: string;
  order_number: number;
  status: string;
  final_amount: number | string | null;
  created_at: string;
  delivery_date: string | null;
  delivery_slot: string | null;

  customers: {
    customer_code: string;
    customer_name: string;
  } | null;
};

type Customer = {
  id: string;
  is_active: boolean;
};

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

function ageText(createdAt: string) {
  const created =
    new Date(createdAt).getTime();

  const now =
    new Date().getTime();

  const diffMs =
    now - created;

  const hours =
    Math.max(
      0,
      Math.floor(
        diffMs / (1000 * 60 * 60)
      )
    );

  if (hours < 1) {
    const minutes =
      Math.max(
        0,
        Math.floor(
          diffMs / (1000 * 60)
        )
      );

    return `${minutes} min`;
  }

  if (hours < 24) {
    return `${hours} hr`;
  }

  const days =
    Math.floor(hours / 24);

  return `${days} day${
    days === 1 ? "" : "s"
  }`;
}

function nextAction(status: string) {
  const actions:
    Record<string, string> = {
      awaiting_confirmation:
        "Confirm order",

      awaiting_picking:
        "Start picking",

      picking:
        "Complete picking",

      awaiting_billing:
        "Prepare bill & QR",

      ready_for_delivery:
        "Start delivery",

      out_for_delivery:
        "Complete delivery",

      awaiting_payment:
        "Waiting for payment",

      payment_submitted:
        "Verify payment",

      completed:
        "Completed",
    };

  return actions[status] ?? "Review order";
}

export default function ControlTowerPage() {
  const [orders, setOrders] =
    useState<Order[]>([]);

  const [customers, setCustomers] =
    useState<Customer[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [message, setMessage] =
    useState("");

  async function loadDashboard() {
    setLoading(true);
    setMessage("");

    const {
      data: orderData,
      error: orderError,
    } = await supabase
      .from("orders")
      .select(`
        id,
        order_number,
        status,
        final_amount,
        created_at,
        delivery_date,
        delivery_slot,
        customers (
          customer_code,
          customer_name
        )
      `)
      .order("created_at", {
        ascending: false,
      });

    if (orderError) {
      setMessage(
        "Could not load orders: " +
          orderError.message
      );

      setLoading(false);
      return;
    }

    setOrders(
      (orderData ?? []) as unknown as Order[]
    );

    const {
      data: customerData,
      error: customerError,
    } = await supabase
      .from("customers")
      .select(`
        id,
        is_active
      `);

    if (customerError) {
      setMessage(
        "Could not load customers: " +
          customerError.message
      );

      setLoading(false);
      return;
    }

    setCustomers(
      (customerData ?? []) as Customer[]
    );

    setLoading(false);
  }

  useEffect(() => {
    loadDashboard();
  }, []);

  const activeOrders =
    useMemo(
      () =>
        orders.filter(
          (order) =>
            order.status !==
            "completed"
        ),
      [orders]
    );

  const actionableStatuses =
    [
      "awaiting_confirmation",
      "awaiting_picking",
      "picking",
      "awaiting_billing",
      "ready_for_delivery",
      "out_for_delivery",
      "payment_submitted",
    ];

  const actionableOrders =
    activeOrders.filter(
      (order) =>
        actionableStatuses.includes(
          order.status
        )
    );

  const awaitingPayment =
    activeOrders.filter(
      (order) =>
        order.status ===
        "awaiting_payment"
    );

  const paymentSubmitted =
    activeOrders.filter(
      (order) =>
        order.status ===
        "payment_submitted"
    );

  const completedOrders =
    orders.filter(
      (order) =>
        order.status ===
        "completed"
    );

  const outstandingPayment =
    activeOrders
      .filter(
        (order) =>
          order.status ===
            "awaiting_payment" ||
          order.status ===
            "payment_submitted"
      )
      .reduce(
        (total, order) =>
          total +
          Number(
            order.final_amount ?? 0
          ),
        0
      );

  const completedValue =
    completedOrders.reduce(
      (total, order) =>
        total +
        Number(
          order.final_amount ?? 0
        ),
      0
    );

  const activeCustomers =
    customers.filter(
      (customer) =>
        customer.is_active
    ).length;

  const stageCounts = {
    confirmation:
      activeOrders.filter(
        (order) =>
          order.status ===
          "awaiting_confirmation"
      ).length,

    picking:
      activeOrders.filter(
        (order) =>
          order.status ===
            "awaiting_picking" ||
          order.status ===
            "picking"
      ).length,

    billing:
      activeOrders.filter(
        (order) =>
          order.status ===
          "awaiting_billing"
      ).length,

    delivery:
      activeOrders.filter(
        (order) =>
          order.status ===
            "ready_for_delivery" ||
          order.status ===
            "out_for_delivery"
      ).length,

    awaitingPayment:
      awaitingPayment.length,

    paymentVerification:
      paymentSubmitted.length,
  };

  const oldestOpenOrders =
    [...activeOrders]
      .sort(
        (a, b) =>
          new Date(
            a.created_at
          ).getTime() -
          new Date(
            b.created_at
          ).getTime()
      )
      .slice(0, 10);

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-100 p-8">
        Loading Control Tower...
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
              Control Tower
            </h1>

            <p className="text-gray-500 mt-1">
              Operational overview of B2B orders.
            </p>

          </div>

          <button
            onClick={loadDashboard}
            className="bg-white border rounded-lg px-5 py-2"
          >
            Refresh
          </button>

        </div>

        {message && (
          <div className="bg-white border rounded-lg p-4 mb-6 text-red-600">
            {message}
          </div>
        )}

        {/* TOP METRICS */}

        <section className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">

          <div className="bg-white border rounded-2xl p-5">

            <p className="text-sm text-gray-500">
              Open Orders
            </p>

            <p className="text-3xl font-bold mt-2">
              {activeOrders.length}
            </p>

          </div>

          <div className="bg-white border rounded-2xl p-5">

            <p className="text-sm text-gray-500">
              Staff Action Needed
            </p>

            <p className="text-3xl font-bold mt-2">
              {actionableOrders.length}
            </p>

          </div>

          <div className="bg-white border rounded-2xl p-5">

            <p className="text-sm text-gray-500">
              Awaiting Payment
            </p>

            <p className="text-3xl font-bold mt-2">
              {awaitingPayment.length}
            </p>

          </div>

          <div className="bg-white border rounded-2xl p-5">

            <p className="text-sm text-gray-500">
              Completed Orders
            </p>

            <p className="text-3xl font-bold mt-2">
              {completedOrders.length}
            </p>

          </div>

        </section>

        {/* WORKFLOW */}

        <section className="bg-white border rounded-2xl p-6 mb-6">

          <div className="flex justify-between items-center mb-5">

            <div>

              <h2 className="font-bold text-lg">
                Workflow
              </h2>

              <p className="text-sm text-gray-500 mt-1">
                Where active orders are currently sitting.
              </p>

            </div>

            <Link
              href="/tasks"
              className="bg-black text-white rounded-lg px-4 py-2 font-semibold"
            >
              OPEN TASKS
            </Link>

          </div>

          <div className="grid grid-cols-2 md:grid-cols-6 gap-4">

            <div className="border rounded-xl p-4">

              <p className="text-sm text-gray-500">
                Confirmation
              </p>

              <p className="text-3xl font-bold mt-2">
                {stageCounts.confirmation}
              </p>

            </div>

            <div className="border rounded-xl p-4">

              <p className="text-sm text-gray-500">
                Picking
              </p>

              <p className="text-3xl font-bold mt-2">
                {stageCounts.picking}
              </p>

            </div>

            <div className="border rounded-xl p-4">

              <p className="text-sm text-gray-500">
                Billing
              </p>

              <p className="text-3xl font-bold mt-2">
                {stageCounts.billing}
              </p>

            </div>

            <div className="border rounded-xl p-4">

              <p className="text-sm text-gray-500">
                Delivery
              </p>

              <p className="text-3xl font-bold mt-2">
                {stageCounts.delivery}
              </p>

            </div>

            <div className="border rounded-xl p-4">

              <p className="text-sm text-gray-500">
                Awaiting Payment
              </p>

              <p className="text-3xl font-bold mt-2">
                {
                  stageCounts.awaitingPayment
                }
              </p>

            </div>

            <div className="border rounded-xl p-4">

              <p className="text-sm text-gray-500">
                Verify Payment
              </p>

              <p className="text-3xl font-bold mt-2">
                {
                  stageCounts.paymentVerification
                }
              </p>

            </div>

          </div>

        </section>

        {/* FINANCIAL + CUSTOMER SUMMARY */}

        <section className="grid md:grid-cols-3 gap-4 mb-6">

          <div className="bg-white border rounded-2xl p-5">

            <p className="text-sm text-gray-500">
              Outstanding Payment
            </p>

            <p className="text-2xl font-bold mt-2">
              ฿
              {outstandingPayment.toLocaleString(
                undefined,
                {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                }
              )}
            </p>

            <p className="text-xs text-gray-500 mt-2">
              Awaiting payment + submitted payment
            </p>

          </div>

          <div className="bg-white border rounded-2xl p-5">

            <p className="text-sm text-gray-500">
              Completed Order Value
            </p>

            <p className="text-2xl font-bold mt-2">
              ฿
              {completedValue.toLocaleString(
                undefined,
                {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                }
              )}
            </p>

            <p className="text-xs text-gray-500 mt-2">
              All completed orders currently in the system
            </p>

          </div>

          <div className="bg-white border rounded-2xl p-5">

            <p className="text-sm text-gray-500">
              Active Customers
            </p>

            <p className="text-3xl font-bold mt-2">
              {activeCustomers}
            </p>

            <Link
              href="/customers"
              className="inline-block text-sm underline mt-2"
            >
              View customers
            </Link>

          </div>

        </section>

        {/* OPEN ORDERS */}

        <section className="bg-white border rounded-2xl overflow-hidden">

          <div className="p-6 border-b flex justify-between items-center">

            <div>

              <h2 className="font-bold text-lg">
                Open Orders
              </h2>

              <p className="text-sm text-gray-500 mt-1">
                Oldest open orders shown first.
              </p>

            </div>

            <Link
              href="/orders"
              className="bg-white border rounded-lg px-4 py-2 font-semibold"
            >
              ALL ORDERS
            </Link>

          </div>

          {oldestOpenOrders.length === 0 ? (

            <div className="p-8 text-gray-500">
              No open orders.
            </div>

          ) : (

            <div className="overflow-x-auto">

              <table className="w-full">

                <thead className="bg-gray-50">

                  <tr>

                    <th className="p-4 text-left">
                      Order
                    </th>

                    <th className="p-4 text-left">
                      Customer
                    </th>

                    <th className="p-4 text-left">
                      Status
                    </th>

                    <th className="p-4 text-left">
                      Next Action
                    </th>

                    <th className="p-4 text-left">
                      Delivery
                    </th>

                    <th className="p-4 text-left">
                      Age
                    </th>

                    <th className="p-4 text-right">
                      Amount
                    </th>

                    <th className="p-4 text-right">
                      Action
                    </th>

                  </tr>

                </thead>

                <tbody>

                  {oldestOpenOrders.map(
                    (order) => (

                      <tr
                        key={order.id}
                        className="border-t"
                      >

                        <td className="p-4">

                          <p className="font-semibold">
                            #{order.order_number}
                          </p>

                          <p className="text-xs text-gray-500">
                            {
                              order.customers
                                ?.customer_code ??
                              "—"
                            }
                          </p>

                        </td>

                        <td className="p-4">

                          {
                            order.customers
                              ?.customer_name ??
                            "Unknown customer"
                          }

                        </td>

                        <td className="p-4">

                          <span className="inline-block bg-gray-100 rounded-full px-3 py-1 text-sm font-medium">

                            {prettyStatus(
                              order.status
                            )}

                          </span>

                        </td>

                        <td className="p-4">

                          {nextAction(
                            order.status
                          )}

                        </td>

                        <td className="p-4">

                          <p>
                            {order.delivery_date ??
                              "—"}
                          </p>

                          <p className="text-sm text-gray-500">
                            {order.delivery_slot ??
                              ""}
                          </p>

                        </td>

                        <td className="p-4">

                          {ageText(
                            order.created_at
                          )}

                        </td>

                        <td className="p-4 text-right">

                          {order.final_amount !==
                          null
                            ? `฿${Number(
                                order.final_amount
                              ).toFixed(2)}`
                            : "—"}

                        </td>

                        <td className="p-4 text-right">

                          <Link
                            href={`/orders/${order.order_number}`}
                            className="inline-block bg-white border rounded-lg px-4 py-2 font-semibold"
                          >
                            VIEW
                          </Link>

                        </td>

                      </tr>

                    )
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