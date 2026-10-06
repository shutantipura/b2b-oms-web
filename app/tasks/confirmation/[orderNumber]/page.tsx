"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "../../../../lib/supabase";

type OrderDetails = {
  id: string;
  order_number: number;
  delivery_date: string | null;
  delivery_slot: string | null;
  delivery_address: string | null;
  customer_notes: string | null;

  customers: {
    customer_name: string;
    contact_name: string | null;
    phone: string | null;
  } | null;
};

type OrderItem = {
  id: string;
  product_name_snapshot: string;
  requested_qty: number | string;
  confirmed_qty: number | string | null;
  unit_snapshot: string;

  products: {
    sku: string;
  } | null;
};

export default function ConfirmationPage() {
  const params = useParams();
  const router = useRouter();

  const orderNumber = Number(params.orderNumber);

  const [order, setOrder] =
    useState<OrderDetails | null>(null);

  const [items, setItems] =
    useState<OrderItem[]>([]);

  const [confirmed, setConfirmed] =
    useState<Record<string, string>>({});

  const [loading, setLoading] =
    useState(true);

  const [submitting, setSubmitting] =
    useState(false);

  const [message, setMessage] =
    useState("");

  async function loadOrder() {
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
        delivery_date,
        delivery_slot,
        delivery_address,
        customer_notes,
        customers (
          customer_name,
          contact_name,
          phone
        )
      `)
      .eq("order_number", orderNumber)
      .single();

    if (orderError) {
      setMessage(
        "Could not load order: " +
          orderError.message
      );
      setLoading(false);
      return;
    }

    setOrder(
      orderData as unknown as OrderDetails
    );

    const {
      data: itemData,
      error: itemError,
    } = await supabase
      .from("order_items")
      .select(`
        id,
        product_name_snapshot,
        requested_qty,
        confirmed_qty,
        unit_snapshot,
        products (
          sku
        )
      `)
      .eq("order_id", orderData.id)
      .order(
        "product_name_snapshot",
        { ascending: true }
      );

    if (itemError) {
      setMessage(
        "Could not load order items: " +
          itemError.message
      );
      setLoading(false);
      return;
    }

    const loadedItems =
      (itemData ?? []) as unknown as OrderItem[];

    setItems(loadedItems);

    const initialConfirmed:
      Record<string, string> = {};

    loadedItems.forEach((item) => {
      initialConfirmed[item.id] =
        String(
          item.confirmed_qty ??
          item.requested_qty
        );
    });

    setConfirmed(initialConfirmed);

    setLoading(false);
  }

  useEffect(() => {
    if (!Number.isNaN(orderNumber)) {
      loadOrder();
    }
  }, [orderNumber]);

  async function completeConfirmation() {
    setMessage("");

    const invalidItem =
      items.find((item) => {
        const requested =
          Number(item.requested_qty);

        const value =
          Number(confirmed[item.id]);

        return (
          Number.isNaN(value) ||
          value < 0 ||
          value > requested
        );
      });

    if (invalidItem) {
      setMessage(
        `${invalidItem.product_name_snapshot}: confirmed quantity must be between 0 and the requested quantity.`
      );
      return;
    }

    const missingSku =
      items.find(
        (item) => !item.products?.sku
      );

    if (missingSku) {
      setMessage(
        `SKU missing for ${missingSku.product_name_snapshot}.`
      );
      return;
    }

    const payload = items.map(
      (item) => ({
        sku: item.products!.sku,
        confirmed_qty:
          Number(confirmed[item.id]),
      })
    );

    setSubmitting(true);

    const { error } = await supabase.rpc(
      "complete_my_confirmation",
      {
        p_order_number: orderNumber,
        p_items: payload,
      }
    );

    if (error) {
      setMessage(
        "Could not complete confirmation: " +
          error.message
      );

      setSubmitting(false);
      return;
    }

    router.push("/tasks");
    router.refresh();
  }

  async function releaseTask() {
    const confirmedRelease =
      window.confirm(
        "Release this task so another staff member can work on it?"
      );

    if (!confirmedRelease) {
      return;
    }

    const { error } = await supabase.rpc(
      "release_my_task",
      {
        p_order_number: orderNumber,
      }
    );

    if (error) {
      setMessage(
        "Could not release task: " +
          error.message
      );
      return;
    }

    router.push("/tasks");
    router.refresh();
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-100 p-8">
        Loading order...
      </main>
    );
  }

  if (!order) {
    return (
      <main className="min-h-screen bg-gray-100 p-8">
        <p>Order not found.</p>

        <Link href="/tasks">
          ← Back to Tasks
        </Link>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-5xl mx-auto">

        <Link
          href="/tasks"
          className="text-gray-500"
        >
          ← Back to Tasks
        </Link>

        <div className="flex justify-between items-start mt-4 mb-8">

          <div>
            <p className="text-sm text-gray-500">
              ORDER CONFIRMATION
            </p>

            <h1 className="text-3xl font-bold mt-1">
              Order #{order.order_number}
            </h1>

            <p className="text-xl mt-2">
              {order.customers?.customer_name}
            </p>
          </div>

          <button
            onClick={releaseTask}
            className="bg-white border rounded-lg px-4 py-2"
          >
            Release Task
          </button>

        </div>

        <section className="bg-white border rounded-2xl p-6 mb-6">

          <h2 className="text-lg font-bold mb-4">
            Customer & Delivery
          </h2>

          <div className="grid md:grid-cols-2 gap-4">

            <div>
              <p className="text-sm text-gray-500">
                Contact
              </p>

              <p className="font-medium">
                {order.customers?.contact_name ??
                  "—"}
              </p>
            </div>

            <div>
              <p className="text-sm text-gray-500">
                Phone
              </p>

              {order.customers?.phone ? (
                <a
                  href={`tel:${order.customers.phone}`}
                  className="font-medium underline"
                >
                  {order.customers.phone}
                </a>
              ) : (
                <p>—</p>
              )}
            </div>

            <div>
              <p className="text-sm text-gray-500">
                Delivery
              </p>

              <p className="font-medium">
                {order.delivery_date ?? "—"}
                {" · "}
                {order.delivery_slot ?? "—"}
              </p>
            </div>

            <div>
              <p className="text-sm text-gray-500">
                Address
              </p>

              <p className="font-medium">
                {order.delivery_address ?? "—"}
              </p>
            </div>

          </div>

          {order.customer_notes && (
            <div className="mt-5">
              <p className="text-sm text-gray-500">
                Customer Notes
              </p>

              <p className="mt-1">
                {order.customer_notes}
              </p>
            </div>
          )}

        </section>

        <section className="bg-white border rounded-2xl overflow-hidden">

          <div className="p-6 border-b">

            <h2 className="text-lg font-bold">
              Confirm Quantities
            </h2>

            <p className="text-gray-500 text-sm mt-1">
              Confirmed quantity cannot exceed
              the customer's requested quantity.
            </p>

          </div>

          <div className="overflow-x-auto">

            <table className="w-full">

              <thead className="bg-gray-50">

                <tr>
                  <th className="text-left p-4">
                    Product
                  </th>

                  <th className="text-left p-4">
                    SKU
                  </th>

                  <th className="text-right p-4">
                    Requested
                  </th>

                  <th className="text-right p-4">
                    Confirmed
                  </th>
                </tr>

              </thead>

              <tbody>

                {items.map((item) => {
                  const requested =
                    Number(item.requested_qty);

                  const confirmedValue =
                    Number(
                      confirmed[item.id] ?? 0
                    );

                  const reduced =
                    confirmedValue <
                    requested;

                  return (
                    <tr
                      key={item.id}
                      className="border-t"
                    >

                      <td className="p-4">
                        <div className="font-medium">
                          {
                            item.product_name_snapshot
                          }
                        </div>

                        {reduced && (
                          <div className="text-sm text-red-600 mt-1">
                            Reduced from requested
                          </div>
                        )}
                      </td>

                      <td className="p-4">
                        {item.products?.sku ??
                          "—"}
                      </td>

                      <td className="p-4 text-right">
                        {requested}{" "}
                        {item.unit_snapshot}
                      </td>

                      <td className="p-4">

                        <div className="flex justify-end items-center gap-2">

                          <input
                            type="number"
                            min="0"
                            max={requested}
                            step="0.001"
                            value={
                              confirmed[item.id] ??
                              ""
                            }
                            onChange={(event) =>
                              setConfirmed({
                                ...confirmed,
                                [item.id]:
                                  event.target
                                    .value,
                              })
                            }
                            className="w-32 border rounded-lg px-3 py-2 text-right"
                          />

                          <span className="text-gray-500 w-10">
                            {
                              item.unit_snapshot
                            }
                          </span>

                        </div>

                      </td>

                    </tr>
                  );
                })}

              </tbody>

            </table>

          </div>

        </section>

        {message && (
          <div className="mt-6 border bg-white rounded-lg p-4 text-red-600">
            {message}
          </div>
        )}

        <div className="flex justify-end mt-6">

          <button
            onClick={completeConfirmation}
            disabled={submitting}
            className="bg-black text-white rounded-lg px-8 py-4 font-semibold disabled:opacity-50"
          >
            {submitting
              ? "COMPLETING..."
              : "COMPLETE CONFIRMATION"}
          </button>

        </div>

      </div>
    </main>
  );
}