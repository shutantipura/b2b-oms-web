"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../lib/supabase";

type Order = {
  order_number: number;
  status: string;
  delivery_date: string | null;
  delivery_slot: string | null;
  customers: {
    customer_name: string;
  } | null;
};

const groups = [
  {
    title: "Order Confirmation",
    stage: "confirmation",
    statuses: ["awaiting_confirmation"],
  },
  {
    title: "Picking",
    stage: "picking",
    statuses: ["awaiting_picking", "picking"],
  },
  {
    title: "Billing",
    stage: "billing",
    statuses: ["awaiting_billing"],
  },
  {
    title: "Delivery",
    stage: "delivery",
    statuses: ["ready_for_delivery", "out_for_delivery"],
  },
  {
    title: "Payment Verification",
    stage: "payment_verification",
    statuses: ["payment_submitted"],
  },
];

export default function TasksPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  async function loadOrders() {
    setLoading(true);

    const { data, error } = await supabase
      .from("orders")
      .select(`
        order_number,
        status,
        delivery_date,
        delivery_slot,
        customers (
          customer_name
        )
      `)
      .not("status", "in", '("completed","cancelled")')
      .order("delivery_date", { ascending: true })
      .order("order_number", { ascending: true });

    if (error) {
      console.error(error);
      setMessage(error.message);
    } else {
      setOrders((data ?? []) as unknown as Order[]);
      setMessage("");
    }

    setLoading(false);
  }

  useEffect(() => {
    loadOrders();
  }, []);

  async function startWork(
    orderNumber: number,
    stage: string
  ) {
    setMessage(`Starting Order #${orderNumber}...`);

    const { data, error } = await supabase.rpc(
      "claim_my_task",
      {
        p_order_number: orderNumber,
        p_stage: stage,
      }
    );

    if (error) {
      setMessage(error.message);
      return;
    }

    console.log(data);

    setMessage(
      `Order #${orderNumber} successfully started.`
    );

    await loadOrders();
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-100 p-8">
        <p>Loading tasks...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <div>
            <Link
              href="/"
              className="text-sm text-gray-500"
            >
              ← Back
            </Link>

            <h1 className="text-3xl font-bold mt-2">
              Tasks
            </h1>

            <p className="text-gray-500 mt-1">
              Select an order to begin work.
            </p>
          </div>

          <button
            onClick={loadOrders}
            className="bg-white border rounded-lg px-4 py-2"
          >
            Refresh
          </button>
        </div>

        {message && (
          <div className="bg-white border rounded-lg p-4 mb-6">
            {message}
          </div>
        )}

        <div className="space-y-6">
          {groups.map((group) => {
            const groupOrders = orders.filter((order) =>
              group.statuses.includes(order.status)
            );

            return (
              <section
                key={group.stage}
                className="bg-white border rounded-2xl overflow-hidden"
              >
                <div className="p-5 border-b">
                  <div className="flex justify-between items-center">
                    <h2 className="text-xl font-bold">
                      {group.title}
                    </h2>

                    <span className="text-sm bg-gray-100 rounded-full px-3 py-1">
                      {groupOrders.length}
                    </span>
                  </div>
                </div>

                {groupOrders.length === 0 ? (
                  <div className="p-5 text-gray-400">
                    No orders waiting.
                  </div>
                ) : (
                  <div>
                    {groupOrders.map((order) => {
                      const alreadyStarted =
                        order.status === "picking" ||
                        order.status === "out_for_delivery";

                      return (
                        <div
                          key={order.order_number}
                          className="p-5 border-b last:border-b-0 flex justify-between items-center gap-6"
                        >
                          <div>
                            <div className="font-semibold">
                              Order #{order.order_number}
                            </div>

                            <div className="text-gray-600 mt-1">
                              {order.customers?.customer_name ??
                                "Unknown customer"}
                            </div>

                            <div className="text-sm text-gray-400 mt-1">
                              {order.delivery_date ?? "No date"}
                              {" · "}
                              {order.delivery_slot ?? "No slot"}
                            </div>

                            <div className="text-xs text-gray-400 mt-1">
                              {order.status}
                            </div>
                          </div>

                          {alreadyStarted ? (
                            <span className="px-4 py-2 rounded-lg bg-gray-100">
                              In Progress
                            </span>
                          ) : (
                            <button
                              onClick={() =>
                                startWork(
                                  order.order_number,
                                  group.stage
                                )
                              }
                              className="bg-black text-white rounded-lg px-5 py-3 font-semibold"
                            >
                              START WORK
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </main>
  );
}