"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../lib/supabase";

type Order = {
  id: string;
  order_number: number;
  status: string;
  delivery_date: string | null;
  delivery_slot: string | null;
  customers: {
    customer_name: string;
  } | null;
};

type ActiveClaim = {
  order_id: string;
  stage: string;
  staff_id: string;
  staff_name: string;
};

type CurrentStaff = {
  id: string;
  staff_name: string;
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
  const [claims, setClaims] = useState<ActiveClaim[]>([]);
  const [currentStaff, setCurrentStaff] =
    useState<CurrentStaff | null>(null);

  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  async function loadData() {
    setLoading(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setMessage("You are not logged in.");
      setLoading(false);
      return;
    }

    const { data: staffData, error: staffError } =
      await supabase
        .from("staff")
        .select("id, staff_name")
        .eq("auth_user_id", user.id)
        .single();

    if (staffError) {
      setMessage(
        "Could not load your staff profile: " +
          staffError.message
      );
      setLoading(false);
      return;
    }

    setCurrentStaff(staffData);

    const { data: orderData, error: orderError } =
      await supabase
        .from("orders")
        .select(`
          id,
          order_number,
          status,
          delivery_date,
          delivery_slot,
          customers (
            customer_name
          )
        `)
        .not(
          "status",
          "in",
          '("completed","cancelled")'
        )
        .order("delivery_date", { ascending: true })
        .order("order_number", { ascending: true });

    if (orderError) {
      setMessage(orderError.message);
      setLoading(false);
      return;
    }

    setOrders(
      (orderData ?? []) as unknown as Order[]
    );

    const { data: claimData, error: claimError } =
      await supabase
        .from("task_claims")
        .select(`
          order_id,
          stage,
          staff_id
        `)
        .eq("claim_status", "active");

    if (claimError) {
      setMessage(claimError.message);
      setLoading(false);
      return;
    }

    const rawClaims = claimData ?? [];

    const staffIds = [
      ...new Set(
        rawClaims.map((claim) => claim.staff_id)
      ),
    ];

    let staffNameMap: Record<string, string> = {};

    if (staffIds.length > 0) {
      const { data: staffList, error: staffListError } =
        await supabase
          .from("staff")
          .select("id, staff_name")
          .in("id", staffIds);

      if (staffListError) {
        setMessage(staffListError.message);
        setLoading(false);
        return;
      }

      staffNameMap = Object.fromEntries(
        (staffList ?? []).map((staff) => [
          staff.id,
          staff.staff_name,
        ])
      );
    }

    const formattedClaims: ActiveClaim[] =
      rawClaims.map((claim) => ({
        order_id: claim.order_id,
        stage: claim.stage,
        staff_id: claim.staff_id,
        staff_name:
          staffNameMap[claim.staff_id] ??
          "Unknown staff",
      }));

    setClaims(formattedClaims);
    setLoading(false);
  }

  useEffect(() => {
    loadData();
  }, []);

  async function startWork(
    orderNumber: number,
    stage: string
  ) {
    setMessage(
      `Starting Order #${orderNumber}...`
    );

    const { error } = await supabase.rpc(
      "claim_my_task",
      {
        p_order_number: orderNumber,
        p_stage: stage,
      }
    );

    if (error) {
      setMessage(
        "Could not start work: " + error.message
      );

      await loadData();
      return;
    }

    setMessage(
      `Order #${orderNumber} successfully claimed.`
    );

    await loadData();
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
            onClick={loadData}
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
            const groupOrders = orders.filter(
              (order) =>
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
                      const claim = claims.find(
                        (claim) =>
                          claim.order_id === order.id &&
                          claim.stage === group.stage
                      );

                      const isMine =
                        claim &&
                        currentStaff &&
                        claim.staff_id ===
                          currentStaff.id;

                      return (
                        <div
                          key={order.order_number}
                          className="p-5 border-b last:border-b-0 flex justify-between items-center gap-6"
                        >
                          <div>
                            <div className="font-semibold text-lg">
                              Order #{order.order_number}
                            </div>

                            <div className="text-gray-600 mt-1">
                              {order.customers
                                ?.customer_name ??
                                "Unknown customer"}
                            </div>

                            <div className="text-sm text-gray-400 mt-1">
                              {order.delivery_date ??
                                "No date"}
                              {" · "}
                              {order.delivery_slot ??
                                "No slot"}
                            </div>

                            <div className="text-xs text-gray-400 mt-1">
                              {order.status}
                            </div>
                          </div>

                          <div>
                            {!claim ? (
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
                            ) : isMine ? (
                              <div className="text-right">
                                <div className="font-semibold">
                                  IN PROGRESS
                                </div>

                                <div className="text-sm text-gray-500 mb-3">
                                  You · {claim.staff_name}
                                </div>

                                {group.stage === "confirmation" && (
  <Link
    href={`/tasks/confirmation/${order.order_number}`}
    className="inline-block bg-black text-white rounded-lg px-5 py-2 font-semibold"
  >
    CONTINUE
  </Link>
)}

{group.stage === "picking" && (
  <Link
    href={`/tasks/picking/${order.order_number}`}
    className="inline-block bg-black text-white rounded-lg px-5 py-2 font-semibold"
  >
    CONTINUE
  </Link>
)}
                              </div>
                            ) : (
                              <div className="text-right">
                                <div className="font-semibold">
                                  IN PROGRESS
                                </div>

                                <div className="text-sm text-gray-500">
                                  {claim.staff_name}
                                </div>
                              </div>
                            )}
                          </div>
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