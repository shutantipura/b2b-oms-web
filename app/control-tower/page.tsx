"use client";

import {
  useEffect,
  useMemo,
  useState,
} from "react";

import Link from "next/link";

import { supabase } from "../../lib/supabase";

// ======================================================
// TYPES
// ======================================================

type Order = {
  id: string;
  order_number: number;
  status: string;

  final_amount:
    | number
    | string
    | null;

  delivery_date:
    | string
    | null;

  delivery_slot:
    | string
    | null;

  customers: {
    customer_code: string;
    customer_name: string;
  } | null;
};

type KPIOrder = {
  order_id: string;
  order_number: number;

  customer_name:
    | string
    | null;

  status: string;

  confirmation_at:
    | string
    | null;

  confirmation_due_at:
    | string
    | null;

  confirmation_on_time:
    | boolean
    | null;

  picking_completed_at:
    | string
    | null;

  short_pick:
    | boolean
    | null;

  delivery_slot:
    | string
    | null;

  delivery_at:
    | string
    | null;

  delivery_due_at:
    | string
    | null;

  delivery_on_time:
    | boolean
    | null;

  payment_completed_at:
    | string
    | null;

  payment_due_at:
    | string
    | null;

  payment_on_time:
    | boolean
    | null;
};

type Staff = {
  id: string;
  staff_code: string;
  staff_name: string;
  account_type: string;
};

type ActiveClaim = {
  order_id: string;
  stage: string;
  staff_id: string;
};

type AttentionOrder = {
  order: KPIOrder;
  issues: string[];
  severity:
    | "urgent"
    | "warning";
};

// ======================================================
// HELPERS
// ======================================================

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

function prettyStage(
  stage: string
) {
  const names:
    Record<
      string,
      string
    > = {
    confirmation:
      "Confirmation",

    picking:
      "Picking",

    billing:
      "Billing",

    delivery:
      "Delivery",

    payment_verification:
      "Payment Verification",
  };

  return (
    names[stage] ??
    prettyStatus(stage)
  );
}

function minutesUntil(
  iso:
    | string
    | null
) {
  if (!iso) {
    return null;
  }

  const due =
    new Date(
      iso
    ).getTime();

  const now =
    Date.now();

  return Math.ceil(
    (due - now) /
      (
        1000 *
        60
      )
  );
}

function timeRemainingText(
  minutes:
    | number
    | null
) {
  if (
    minutes ===
    null
  ) {
    return "";
  }

  if (minutes < 0) {
    const overdue =
      Math.abs(
        minutes
      );

    if (
      overdue < 60
    ) {
      return `${overdue} min late`;
    }

    const hours =
      Math.floor(
        overdue /
          60
      );

    const mins =
      overdue %
      60;

    return `${hours}h ${mins}m late`;
  }

  if (
    minutes < 60
  ) {
    return `${minutes} min remaining`;
  }

  const hours =
    Math.floor(
      minutes /
        60
    );

  const mins =
    minutes %
    60;

  return `${hours}h ${mins}m remaining`;
}

// ======================================================
// PAGE
// ======================================================

export default function ControlTowerPage() {
  const today =
    getBangkokToday();

  const [
    orders,
    setOrders,
  ] =
    useState<Order[]>([]);

  const [
    kpiOrders,
    setKpiOrders,
  ] =
    useState<KPIOrder[]>(
      []
    );

  const [
    staff,
    setStaff,
  ] =
    useState<Staff[]>([]);

  const [
    claims,
    setClaims,
  ] =
    useState<
      ActiveClaim[]
    >([]);

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

  // ====================================================
  // LOAD DASHBOARD
  // ====================================================

  async function loadDashboard() {
    setLoading(true);
    setMessage("");

    // --------------------------------------------------
    // TODAY'S ORDERS
    // --------------------------------------------------

    const {
      data: orderData,
      error: orderError,
    } =
      await supabase
        .from("orders")
        .select(`
          id,
          order_number,
          status,
          final_amount,
          delivery_date,
          delivery_slot,
          customers (
            customer_code,
            customer_name
          )
        `)
        .eq(
          "delivery_date",
          today
        )
        .order(
          "order_number",
          {
            ascending:
              true,
          }
        );

    if (orderError) {
      setMessage(
        "Could not load today's orders: " +
          orderError.message
      );

      setLoading(false);
      return;
    }

    const loadedOrders =
      (orderData ??
        []) as unknown as Order[];

    setOrders(
      loadedOrders
    );

    // --------------------------------------------------
    // KPI / EXCEPTION DATA
    // --------------------------------------------------

    const {
      data: kpiData,
      error: kpiError,
    } =
      await supabase.rpc(
        "get_operational_kpi_orders",
        {
          p_delivery_date:
            today,
        }
      );

    if (kpiError) {
      setMessage(
        "Could not load operational alerts: " +
          kpiError.message
      );

      setLoading(false);
      return;
    }

    setKpiOrders(
      Array.isArray(
        kpiData
      )
        ? (
            kpiData as KPIOrder[]
          )
        : []
    );

    // --------------------------------------------------
    // STAFF
    // --------------------------------------------------

    const {
      data: staffData,
      error: staffError,
    } =
      await supabase
        .from("staff")
        .select(`
          id,
          staff_code,
          staff_name,
          account_type
        `)
        .order(
          "staff_code",
          {
            ascending:
              true,
          }
        );

    if (staffError) {
      setMessage(
        "Could not load staff: " +
          staffError.message
      );

      setLoading(false);
      return;
    }

    setStaff(
      (staffData ??
        []) as Staff[]
    );

    // --------------------------------------------------
    // ACTIVE TASK CLAIMS
    // --------------------------------------------------

    const {
      data: claimData,
      error: claimError,
    } =
      await supabase
        .from(
          "task_claims"
        )
        .select(`
          order_id,
          stage,
          staff_id
        `)
        .eq(
          "claim_status",
          "active"
        );

    if (claimError) {
      setMessage(
        "Could not load staff workload: " +
          claimError.message
      );

      setLoading(false);
      return;
    }

    setClaims(
      (claimData ??
        []) as ActiveClaim[]
    );

    setLoading(false);
  }

  useEffect(() => {
    loadDashboard();
  }, []);

  // ====================================================
  // TODAY'S BASIC COUNTS
  // ====================================================

  const activeOrders =
    useMemo(
      () =>
        orders.filter(
          (order) =>
            order.status !==
              "completed" &&
            order.status !==
              "cancelled"
        ),
      [orders]
    );

  const completedOrders =
    orders.filter(
      (order) =>
        order.status ===
        "completed"
    );

  // ====================================================
  // WORKFLOW COUNTS
  // ====================================================

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

    payment:
      activeOrders.filter(
        (order) =>
          order.status ===
            "awaiting_payment" ||
          order.status ===
            "payment_submitted"
      ).length,
  };

  // ====================================================
  // EXCEPTIONS
  // ====================================================

  const lateConfirmations =
    kpiOrders.filter(
      (order) =>
        order.status !==
          "completed" &&
        order.status !==
          "cancelled" &&
        order.confirmation_on_time ===
          false &&
        !order.confirmation_at
    );

  const lateDeliveries =
    kpiOrders.filter(
      (order) =>
        order.status !==
          "completed" &&
        order.status !==
          "cancelled" &&
        !order.delivery_at &&
        order.delivery_on_time ===
          false
    );

  const deliveryAtRisk =
    kpiOrders.filter(
      (order) => {
        if (
          order.status ===
            "completed" ||
          order.status ===
            "cancelled" ||
          order.delivery_at
        ) {
          return false;
        }

        const minutes =
          minutesUntil(
            order.delivery_due_at
          );

        return (
          minutes !==
            null &&
          minutes >= 0 &&
          minutes <= 60
        );
      }
    );

  const shortPicks =
    kpiOrders.filter(
      (order) =>
        order.status !==
          "completed" &&
        order.status !==
          "cancelled" &&
        order.short_pick ===
          true
    );

  const awaitingPayment =
    orders.filter(
      (order) =>
        order.status ===
        "awaiting_payment"
    );

  const overduePayments =
    kpiOrders.filter(
      (order) =>
        order.status !==
          "completed" &&
        order.status !==
          "cancelled" &&
        !order.payment_completed_at &&
        order.payment_on_time ===
          false
    );

  // ====================================================
  // ORDERS NEEDING ATTENTION
  // ====================================================

  const attentionOrders =
    useMemo(() => {
      const results:
        AttentionOrder[] =
        [];

      kpiOrders.forEach(
        (order) => {
          if (
            order.status ===
              "completed" ||
            order.status ===
              "cancelled"
          ) {
            return;
          }

          const issues:
            string[] =
            [];

          let severity:
            | "urgent"
            | "warning" =
            "warning";

          // Late confirmation
          if (
            order.confirmation_on_time ===
              false &&
            !order.confirmation_at
          ) {
            issues.push(
              "Confirmation overdue"
            );

            severity =
              "urgent";
          }

          // Delivery
          if (
            !order.delivery_at
          ) {
            const minutes =
              minutesUntil(
                order.delivery_due_at
              );

            if (
              order.delivery_on_time ===
              false
            ) {
              issues.push(
                `Delivery ${timeRemainingText(
                  minutes
                )}`
              );

              severity =
                "urgent";
            } else if (
              minutes !==
                null &&
              minutes >= 0 &&
              minutes <= 60
            ) {
              issues.push(
                `Delivery due in ${minutes} min`
              );
            }
          }

          // Short pick
          if (
            order.short_pick ===
            true
          ) {
            issues.push(
              "Short pick"
            );
          }

          // Payment
          if (
            !order.payment_completed_at &&
            order.payment_on_time ===
              false
          ) {
            issues.push(
              "Payment overdue"
            );

            severity =
              "urgent";
          } else if (
            order.status ===
            "awaiting_payment"
          ) {
            issues.push(
              "Awaiting payment"
            );
          }

          if (
            issues.length >
            0
          ) {
            results.push(
              {
                order,
                issues,
                severity,
              }
            );
          }
        }
      );

      return results.sort(
        (
          a,
          b
        ) => {
          if (
            a.severity ===
              "urgent" &&
            b.severity !==
              "urgent"
          ) {
            return -1;
          }

          if (
            b.severity ===
              "urgent" &&
            a.severity !==
              "urgent"
          ) {
            return 1;
          }

          return (
            a.order
              .order_number -
            b.order
              .order_number
          );
        }
      );
    }, [kpiOrders]);

  // ====================================================
  // STAFF WORKLOAD
  // ====================================================

  const todayOrderIds =
    new Set(
      orders.map(
        (order) =>
          order.id
      )
    );

  const todayClaims =
    claims.filter(
      (claim) =>
        todayOrderIds.has(
          claim.order_id
        )
    );

  const staffWorkload =
    staff.map(
      (person) => {
        const claim =
          todayClaims.find(
            (claim) =>
              claim.staff_id ===
              person.id
          );

        const order =
          claim
            ? orders.find(
                (order) =>
                  order.id ===
                  claim.order_id
              )
            : null;

        return {
          ...person,
          claim:
            claim ?? null,
          order:
            order ?? null,
        };
      }
    );

  // ====================================================
  // LOADING
  // ====================================================

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-100 p-8">
        Loading Control Tower...
      </main>
    );
  }

  // ====================================================
  // PAGE
  // ====================================================

  return (
    <main className="min-h-screen bg-gray-100 p-8">

      <div className="max-w-7xl mx-auto">

        {/* ============================================ */}
        {/* HEADER */}
        {/* ============================================ */}

        <div className="flex flex-col md:flex-row md:justify-between md:items-start gap-4 mb-8">

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
              What needs management attention right now.
            </p>

            <p className="text-sm text-gray-400 mt-1">
              Delivery date:{" "}
              {
                today
              }
            </p>

          </div>

          <div className="flex gap-3">

            <Link
              href="/tasks"
              className="bg-black text-white rounded-lg px-5 py-3 font-semibold"
            >
              OPEN TASKS
            </Link>

            <button
              onClick={
                loadDashboard
              }
              className="bg-white border rounded-lg px-5 py-3"
            >
              Refresh
            </button>

          </div>

        </div>

        {message && (
          <div className="bg-white border rounded-xl p-4 mb-6 text-red-600">
            {message}
          </div>
        )}

        {/* ============================================ */}
        {/* TODAY */}
        {/* ============================================ */}

        <section className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">

          <div className="bg-white border rounded-2xl p-5">

            <p className="text-sm text-gray-500">
              Today&apos;s Orders
            </p>

            <p className="text-3xl font-bold mt-2">
              {
                orders.filter(
                  (order) =>
                    order.status !==
                    "cancelled"
                ).length
              }
            </p>

          </div>

          <div className="bg-white border rounded-2xl p-5">

            <p className="text-sm text-gray-500">
              Completed
            </p>

            <p className="text-3xl font-bold mt-2">
              {
                completedOrders.length
              }
            </p>

          </div>

          <div className="bg-white border rounded-2xl p-5">

            <p className="text-sm text-gray-500">
              Open
            </p>

            <p className="text-3xl font-bold mt-2">
              {
                activeOrders.length
              }
            </p>

          </div>

          <div className="bg-white border rounded-2xl p-5">

            <p className="text-sm text-gray-500">
              Need Attention
            </p>

            <p className="text-3xl font-bold mt-2">
              {
                attentionOrders.length
              }
            </p>

          </div>

        </section>

        {/* ============================================ */}
        {/* URGENT / EXCEPTION CARDS */}
        {/* ============================================ */}

        <section className="mb-6">

          <h2 className="text-xl font-bold mb-4">
            Exceptions & Risks
          </h2>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">

            <div className="bg-white border rounded-2xl p-5">

              <p className="text-sm text-gray-500">
                Late Confirmations
              </p>

              <p className="text-3xl font-bold mt-2">
                {
                  lateConfirmations.length
                }
              </p>

              <p className="text-xs text-gray-400 mt-2">
                Over 30 minutes
              </p>

            </div>

            <div className="bg-white border rounded-2xl p-5">

              <p className="text-sm text-gray-500">
                Delivery At Risk
              </p>

              <p className="text-3xl font-bold mt-2">
                {
                  deliveryAtRisk.length
                }
              </p>

              <p className="text-xs text-gray-400 mt-2">
                ≤ 60 minutes remaining
              </p>

            </div>

            <div className="bg-white border rounded-2xl p-5">

              <p className="text-sm text-gray-500">
                Late Deliveries
              </p>

              <p className="text-3xl font-bold mt-2">
                {
                  lateDeliveries.length
                }
              </p>

              <p className="text-xs text-gray-400 mt-2">
                Past customer slot
              </p>

            </div>

            <div className="bg-white border rounded-2xl p-5">

              <p className="text-sm text-gray-500">
                Short Picks
              </p>

              <p className="text-3xl font-bold mt-2">
                {
                  shortPicks.length
                }
              </p>

              <p className="text-xs text-gray-400 mt-2">
                Beyond allowed tolerance
              </p>

            </div>

            <div className="bg-white border rounded-2xl p-5">

              <p className="text-sm text-gray-500">
                Awaiting Payment
              </p>

              <p className="text-3xl font-bold mt-2">
                {
                  awaitingPayment.length
                }
              </p>

              {overduePayments.length >
                0 && (
                <p className="text-xs font-semibold mt-2">
                  {
                    overduePayments.length
                  }{" "}
                  overdue after 21:00
                </p>
              )}

            </div>

          </div>

        </section>

        {/* ============================================ */}
        {/* ORDERS NEEDING ATTENTION */}
        {/* ============================================ */}

        <section className="bg-white border rounded-2xl overflow-hidden mb-6">

          <div className="p-6 border-b">

            <h2 className="text-xl font-bold">
              Orders Needing Attention
            </h2>

            <p className="text-sm text-gray-500 mt-1">
              Only operational exceptions and time-sensitive orders are shown here.
            </p>

          </div>

          {attentionOrders.length ===
          0 ? (

            <div className="p-8 text-center">

              <p className="font-semibold">
                ✓ No operational exceptions
              </p>

              <p className="text-gray-500 mt-1">
                Today&apos;s operation is currently on track.
              </p>

            </div>

          ) : (

            <div>

              {attentionOrders.map(
                ({
                  order,
                  issues,
                  severity,
                }) => (

                  <div
                    key={
                      order.order_id
                    }
                    className="p-5 border-b last:border-b-0 flex flex-col md:flex-row md:justify-between md:items-center gap-5"
                  >

                    <div>

                      <div className="flex flex-wrap items-center gap-3">

                        <p className="font-bold text-lg">
                          Order #
                          {
                            order.order_number
                          }
                        </p>

                        <span
                          className={
                            severity ===
                            "urgent"
                              ? "text-xs border rounded-full px-3 py-1 font-semibold"
                              : "text-xs bg-gray-100 rounded-full px-3 py-1 font-semibold"
                          }
                        >
                          {severity ===
                          "urgent"
                            ? "URGENT"
                            : "WATCH"}
                        </span>

                      </div>

                      <p className="text-gray-600 mt-1">
                        {
                          order.customer_name ??
                          "Unknown customer"
                        }
                      </p>

                      <p className="text-sm text-gray-400 mt-1">
                        {
                          prettyStatus(
                            order.status
                          )
                        }
                        {" · "}
                        {
                          order.delivery_slot ??
                          "No delivery slot"
                        }
                      </p>

                      <div className="flex flex-wrap gap-2 mt-3">

                        {issues.map(
                          (
                            issue
                          ) => (

                            <span
                              key={
                                issue
                              }
                              className="border rounded-full px-3 py-1 text-sm"
                            >
                              {
                                issue
                              }
                            </span>

                          )
                        )}

                      </div>

                    </div>

                    <Link
                      href={`/orders/${order.order_number}`}
                      className="bg-black text-white rounded-lg px-5 py-3 font-semibold text-center"
                    >
                      VIEW ORDER
                    </Link>

                  </div>

                )
              )}

            </div>

          )}

        </section>

        {/* ============================================ */}
        {/* WORKFLOW */}
        {/* ============================================ */}

        <section className="bg-white border rounded-2xl p-6 mb-6">

          <div className="flex justify-between items-center mb-5">

            <div>

              <h2 className="text-xl font-bold">
                Current Workflow
              </h2>

              <p className="text-sm text-gray-500 mt-1">
                Where today&apos;s open orders are sitting.
              </p>

            </div>

            <Link
              href="/tasks"
              className="underline font-semibold"
            >
              View Tasks →
            </Link>

          </div>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">

            <div className="border rounded-xl p-4">

              <p className="text-sm text-gray-500">
                Confirmation
              </p>

              <p className="text-3xl font-bold mt-2">
                {
                  stageCounts.confirmation
                }
              </p>

            </div>

            <div className="border rounded-xl p-4">

              <p className="text-sm text-gray-500">
                Picking
              </p>

              <p className="text-3xl font-bold mt-2">
                {
                  stageCounts.picking
                }
              </p>

            </div>

            <div className="border rounded-xl p-4">

              <p className="text-sm text-gray-500">
                Billing
              </p>

              <p className="text-3xl font-bold mt-2">
                {
                  stageCounts.billing
                }
              </p>

            </div>

            <div className="border rounded-xl p-4">

              <p className="text-sm text-gray-500">
                Delivery
              </p>

              <p className="text-3xl font-bold mt-2">
                {
                  stageCounts.delivery
                }
              </p>

            </div>

            <div className="border rounded-xl p-4">

              <p className="text-sm text-gray-500">
                Payment
              </p>

              <p className="text-3xl font-bold mt-2">
                {
                  stageCounts.payment
                }
              </p>

            </div>

          </div>

        </section>

        {/* ============================================ */}
        {/* STAFF WORKLOAD */}
        {/* ============================================ */}

        <section className="bg-white border rounded-2xl overflow-hidden">

          <div className="p-6 border-b">

            <h2 className="text-xl font-bold">
              Staff Workload
            </h2>

            <p className="text-sm text-gray-500 mt-1">
              Active task ownership for today&apos;s orders.
            </p>

          </div>

          <div className="overflow-x-auto">

            <table className="w-full">

              <thead className="bg-gray-50">

                <tr>

                  <th className="p-4 text-left">
                    Staff
                  </th>

                  <th className="p-4 text-left">
                    Account
                  </th>

                  <th className="p-4 text-left">
                    Current Work
                  </th>

                  <th className="p-4 text-left">
                    Customer
                  </th>

                  <th className="p-4 text-right">
                    Action
                  </th>

                </tr>

              </thead>

              <tbody>

                {staffWorkload.map(
                  (
                    person
                  ) => (

                    <tr
                      key={
                        person.id
                      }
                      className="border-t"
                    >

                      <td className="p-4">

                        <p className="font-semibold">
                          {
                            person.staff_name
                          }
                        </p>

                        <p className="text-xs text-gray-400">
                          {
                            person.staff_code
                          }
                        </p>

                      </td>

                      <td className="p-4">
                        {person.account_type ===
                        "manager"
                          ? "Manager"
                          : "Staff"}
                      </td>

                      <td className="p-4">

                        {person.claim &&
                        person.order ? (

                          <>

                            <p className="font-semibold">
                              {prettyStage(
                                person.claim
                                  .stage
                              )}
                            </p>

                            <p className="text-sm text-gray-500">
                              Order #
                              {
                                person.order
                                  .order_number
                              }
                            </p>

                          </>

                        ) : (

                          <span className="text-gray-400">
                            Free
                          </span>

                        )}

                      </td>

                      <td className="p-4">

                        {person.order
                          ?.customers
                          ?.customer_name ??
                          "—"}

                      </td>

                      <td className="p-4 text-right">

                        {person.order ? (

                          <Link
                            href={`/orders/${person.order.order_number}`}
                            className="underline font-semibold"
                          >
                            VIEW
                          </Link>

                        ) : (

                          <span className="text-gray-300">
                            —
                          </span>

                        )}

                      </td>

                    </tr>

                  )
                )}

              </tbody>

            </table>

          </div>

        </section>

      </div>

    </main>
  );
}