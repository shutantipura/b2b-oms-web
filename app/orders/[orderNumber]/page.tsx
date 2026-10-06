"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "../../../lib/supabase";

type OrderDetails = {
  id: string;
  order_number: number;
  status: string;
  order_source: string | null;
  delivery_date: string | null;
  delivery_slot: string | null;
  delivery_address: string | null;
  customer_notes: string | null;
  final_amount: number | string | null;
  created_at: string;

  customers: {
    customer_code: string;
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
  actual_qty: number | string | null;
  unit_snapshot: string;
  unit_price_snapshot: number | string;

  products: {
    sku: string;
  } | null;
};

type OrderFile = {
  id: string;
  file_type: string;
  storage_path: string;
  original_filename: string | null;
  mime_type: string | null;
};

type DisplayFile = OrderFile & {
  url: string | null;
};

type HistoryRow = {
  id: string;
  action: string;
  stage: string | null;
  from_status: string | null;
  to_status: string | null;
  note: string | null;
  performed_by_staff_id: string | null;
  performed_by_line_user_id: string | null;
  created_at: string;
};

type DisplayHistory = HistoryRow & {
  performed_by: string;
};

function prettyText(value: string | null) {
  if (!value) return "—";

  return value
    .split("_")
    .map(
      (word) =>
        word.charAt(0).toUpperCase() +
        word.slice(1)
    )
    .join(" ");
}

function fileLabel(type: string) {
  const labels: Record<string, string> = {
    cart_photo: "Cart Photo",
    bill: "Bill",
    payment_qr: "Payment QR",
    delivery_proof: "Delivery Proof",
    payment_slip: "Payment Slip",
  };

  return labels[type] ?? prettyText(type);
}

export default function OrderDetailsPage() {
  const params = useParams();

  const orderNumber = Number(params.orderNumber);

  const [order, setOrder] =
    useState<OrderDetails | null>(null);

  const [items, setItems] =
    useState<OrderItem[]>([]);

  const [files, setFiles] =
    useState<DisplayFile[]>([]);

  const [history, setHistory] =
    useState<DisplayHistory[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [message, setMessage] =
    useState("");

  async function loadOrder() {
    setLoading(true);
    setMessage("");

    // ------------------------------------------------
    // Order header
    // ------------------------------------------------

    const {
      data: orderData,
      error: orderError,
    } = await supabase
      .from("orders")
      .select(`
        id,
        order_number,
        status,
        order_source,
        delivery_date,
        delivery_slot,
        delivery_address,
        customer_notes,
        final_amount,
        created_at,
        customers (
          customer_code,
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

    const loadedOrder =
      orderData as unknown as OrderDetails;

    setOrder(loadedOrder);

    // ------------------------------------------------
    // Order items
    // ------------------------------------------------

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
        actual_qty,
        unit_snapshot,
        unit_price_snapshot,
        products (
          sku
        )
      `)
      .eq("order_id", loadedOrder.id)
      .order(
        "product_name_snapshot",
        { ascending: true }
      );

    if (itemError) {
      setMessage(
        "Could not load items: " +
          itemError.message
      );

      setLoading(false);
      return;
    }

    setItems(
      (itemData ?? []) as unknown as OrderItem[]
    );

    // ------------------------------------------------
    // Files
    // ------------------------------------------------

    const {
      data: fileData,
      error: fileError,
    } = await supabase
      .from("order_files")
      .select(`
        id,
        file_type,
        storage_path,
        original_filename,
        mime_type
      `)
      .eq("order_id", loadedOrder.id)
      .eq("is_current", true);

    if (fileError) {
      setMessage(
        "Could not load files: " +
          fileError.message
      );

      setLoading(false);
      return;
    }

    const rawFiles =
      (fileData ?? []) as OrderFile[];

    const displayFiles =
      await Promise.all(
        rawFiles.map(
          async (file): Promise<DisplayFile> => {
            const {
              data,
              error,
            } = await supabase.storage
              .from("order-files")
              .createSignedUrl(
                file.storage_path,
                60 * 60
              );

            return {
              ...file,
              url:
                error || !data
                  ? null
                  : data.signedUrl,
            };
          }
        )
      );

    setFiles(displayFiles);

    // ------------------------------------------------
    // Order history
    // ------------------------------------------------

    const {
      data: historyData,
      error: historyError,
    } = await supabase
      .from("order_history")
      .select(`
        id,
        action,
        stage,
        from_status,
        to_status,
        note,
        performed_by_staff_id,
        performed_by_line_user_id,
        created_at
      `)
      .eq("order_id", loadedOrder.id)
      .order(
        "created_at",
        { ascending: true }
      );

    if (historyError) {
      setMessage(
        "Could not load order history: " +
          historyError.message
      );

      setLoading(false);
      return;
    }

    const rawHistory =
      (historyData ?? []) as HistoryRow[];

    // Find all staff used in history

    const staffIds = Array.from(
      new Set(
        rawHistory
          .map(
            (row) =>
              row.performed_by_staff_id
          )
          .filter(
            (id): id is string =>
              Boolean(id)
          )
      )
    );

    const lineUserIds = Array.from(
      new Set(
        rawHistory
          .map(
            (row) =>
              row.performed_by_line_user_id
          )
          .filter(
            (id): id is string =>
              Boolean(id)
          )
      )
    );

    let staffMap:
      Record<string, string> = {};

    let lineMap:
      Record<string, string> = {};

    if (staffIds.length > 0) {
      const { data: staffData } =
        await supabase
          .from("staff")
          .select("id, staff_name")
          .in("id", staffIds);

      staffMap = Object.fromEntries(
        (staffData ?? []).map(
          (staff) => [
            staff.id,
            staff.staff_name,
          ]
        )
      );
    }

    if (lineUserIds.length > 0) {
      const { data: lineData } =
        await supabase
          .from("line_users")
          .select("id, display_name")
          .in("id", lineUserIds);

      lineMap = Object.fromEntries(
        (lineData ?? []).map(
          (user) => [
            user.id,
            user.display_name,
          ]
        )
      );
    }

    const displayHistory =
      rawHistory.map(
        (row): DisplayHistory => ({
          ...row,

          performed_by:
            (row.performed_by_staff_id
              ? staffMap[
                  row.performed_by_staff_id
                ]
              : null) ??
            (row.performed_by_line_user_id
              ? lineMap[
                  row.performed_by_line_user_id
                ]
              : null) ??
            "System",
        })
      );

    setHistory(displayHistory);

    setLoading(false);
  }

  useEffect(() => {
    if (!Number.isNaN(orderNumber)) {
      loadOrder();
    }
  }, [orderNumber]);

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-100 p-8">
        Loading order details...
      </main>
    );
  }

  if (!order) {
    return (
      <main className="min-h-screen bg-gray-100 p-8">
        Order not found.
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-100 p-8">

      <div className="max-w-7xl mx-auto">

        <Link
          href="/orders"
          className="text-gray-500"
        >
          ← Back to Orders
        </Link>

        <div className="flex justify-between items-start mt-4 mb-8">

          <div>

            <p className="text-sm text-gray-500">
              ORDER DETAILS
            </p>

            <h1 className="text-3xl font-bold mt-1">
              Order #{order.order_number}
            </h1>

            <p className="text-xl mt-2">
              {order.customers?.customer_name}
            </p>

          </div>

          <div className="text-right">

            <div className="inline-block bg-white border rounded-full px-4 py-2 font-medium">
              {prettyText(order.status)}
            </div>

            {order.final_amount !== null && (
              <p className="text-2xl font-bold mt-3">
                ฿
                {Number(
                  order.final_amount
                ).toFixed(2)}
              </p>
            )}

          </div>

        </div>

        {message && (
          <div className="bg-white border rounded-lg p-4 mb-6 text-red-600">
            {message}
          </div>
        )}

        {/* CUSTOMER */}

        <section className="bg-white border rounded-2xl p-6 mb-6">

          <h2 className="font-bold text-lg mb-5">
            Customer & Delivery
          </h2>

          <div className="grid md:grid-cols-3 gap-5">

            <div>
              <p className="text-sm text-gray-500">
                Customer
              </p>

              <p className="font-medium">
                {order.customers?.customer_name}
              </p>

              <p className="text-sm text-gray-500">
                {order.customers?.customer_code}
              </p>
            </div>

            <div>
              <p className="text-sm text-gray-500">
                Contact
              </p>

              <p className="font-medium">
                {order.customers?.contact_name ??
                  "—"}
              </p>

              <p>
                {order.customers?.phone ?? "—"}
              </p>
            </div>

            <div>
              <p className="text-sm text-gray-500">
                Delivery
              </p>

              <p className="font-medium">
                {order.delivery_date ?? "—"}
              </p>

              <p>
                {order.delivery_slot ?? "—"}
              </p>
            </div>

          </div>

          <div className="mt-5">

            <p className="text-sm text-gray-500">
              Address
            </p>

            <p>
              {order.delivery_address ?? "—"}
            </p>

          </div>

          {order.customer_notes && (
            <div className="mt-5">

              <p className="text-sm text-gray-500">
                Customer Notes
              </p>

              <p>
                {order.customer_notes}
              </p>

            </div>
          )}

        </section>

        {/* ITEMS */}

        <section className="bg-white border rounded-2xl overflow-hidden mb-6">

          <div className="p-6 border-b">

            <h2 className="font-bold text-lg">
              Order Items
            </h2>

            <p className="text-sm text-gray-500 mt-1">
              Requested → Confirmed → Actual Picked
            </p>

          </div>

          <div className="overflow-x-auto">

            <table className="w-full">

              <thead className="bg-gray-50">

                <tr>
                  <th className="p-4 text-left">
                    Product
                  </th>

                  <th className="p-4 text-left">
                    SKU
                  </th>

                  <th className="p-4 text-right">
                    Requested
                  </th>

                  <th className="p-4 text-right">
                    Confirmed
                  </th>

                  <th className="p-4 text-right">
                    Actual
                  </th>

                  <th className="p-4 text-right">
                    Price
                  </th>

                  <th className="p-4 text-right">
                    Amount
                  </th>
                </tr>

              </thead>

              <tbody>

                {items.map((item) => {

                  const actual =
                    Number(
                      item.actual_qty ?? 0
                    );

                  const price =
                    Number(
                      item.unit_price_snapshot
                    );

                  return (
                    <tr
                      key={item.id}
                      className="border-t"
                    >

                      <td className="p-4 font-medium">
                        {item.product_name_snapshot}
                      </td>

                      <td className="p-4">
                        {item.products?.sku ?? "—"}
                      </td>

                      <td className="p-4 text-right">
                        {Number(
                          item.requested_qty
                        )}{" "}
                        {item.unit_snapshot}
                      </td>

                      <td className="p-4 text-right">
                        {item.confirmed_qty !== null
                          ? Number(
                              item.confirmed_qty
                            )
                          : "—"}{" "}
                        {item.unit_snapshot}
                      </td>

                      <td className="p-4 text-right font-semibold">
                        {item.actual_qty !== null
                          ? Number(
                              item.actual_qty
                            )
                          : "—"}{" "}
                        {item.unit_snapshot}
                      </td>

                      <td className="p-4 text-right">
                        ฿{price.toFixed(2)}
                      </td>

                      <td className="p-4 text-right">
                        {item.actual_qty !== null
                          ? `฿${(
                              actual * price
                            ).toFixed(2)}`
                          : "—"}
                      </td>

                    </tr>
                  );
                })}

              </tbody>

            </table>

          </div>

        </section>

        {/* FILES */}

        <section className="bg-white border rounded-2xl p-6 mb-6">

          <h2 className="font-bold text-lg">
            Order Documents
          </h2>

          <p className="text-sm text-gray-500 mt-1 mb-5">
            Files collected during the order workflow.
          </p>

          {files.length === 0 ? (

            <p className="text-gray-500">
              No files recorded.
            </p>

          ) : (

            <div className="grid md:grid-cols-3 gap-5">

              {files.map((file) => (

                <div
                  key={file.id}
                  className="border rounded-xl p-4"
                >

                  <p className="font-semibold">
                    {fileLabel(
                      file.file_type
                    )}
                  </p>

                  <p className="text-sm text-gray-500 mt-1 mb-4 truncate">
                    {file.original_filename ??
                      "File"}
                  </p>

                  {file.url ? (

                    file.mime_type?.startsWith(
                      "image/"
                    ) ? (

                      <>
                        <img
                          src={file.url}
                          alt={fileLabel(
                            file.file_type
                          )}
                          className="w-full h-48 object-contain border rounded-lg"
                        />

                        <a
                          href={file.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-block mt-3 underline"
                        >
                          Open full image
                        </a>
                      </>

                    ) : (

                      <a
                        href={file.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-block border rounded-lg px-4 py-2 font-medium"
                      >
                        OPEN FILE
                      </a>

                    )

                  ) : (

                    <p className="text-red-600">
                      File unavailable
                    </p>

                  )}

                </div>

              ))}

            </div>

          )}

        </section>

        {/* HISTORY */}

        <section className="bg-white border rounded-2xl overflow-hidden">

          <div className="p-6 border-b">

            <h2 className="font-bold text-lg">
              Order History
            </h2>

            <p className="text-sm text-gray-500 mt-1">
              Complete audit trail for this order.
            </p>

          </div>

          {history.length === 0 ? (

            <div className="p-6 text-gray-500">
              No history recorded.
            </div>

          ) : (

            <div>

              {history.map((row) => (

                <div
                  key={row.id}
                  className="p-5 border-b last:border-b-0"
                >

                  <div className="flex flex-col md:flex-row md:justify-between gap-2">

                    <div>

                      <p className="font-semibold">
                        {prettyText(
                          row.action
                        )}
                      </p>

                      <p className="text-sm text-gray-500 mt-1">
                        {row.stage
                          ? `Stage: ${prettyText(
                              row.stage
                            )}`
                          : ""}
                      </p>

                    </div>

                    <div className="md:text-right">

                      <p className="font-medium">
                        {row.performed_by}
                      </p>

                      <p className="text-sm text-gray-500">
                        {new Date(
                          row.created_at
                        ).toLocaleString()}
                      </p>

                    </div>

                  </div>

                  {(row.from_status ||
                    row.to_status) && (
                    <p className="text-sm mt-3">
                      {prettyText(
                        row.from_status
                      )}
                      {" → "}
                      {prettyText(
                        row.to_status
                      )}
                    </p>
                  )}

                  {row.note && (
                    <p className="text-sm text-gray-600 mt-2">
                      {row.note}
                    </p>
                  )}

                </div>

              ))}

            </div>

          )}

        </section>

        {/* USEFUL ACTIONS */}

        <div className="flex gap-3 justify-end mt-6">

          {order.status ===
            "awaiting_payment" && (

            <Link
              href={`/orders/${order.order_number}/payment`}
              className="bg-black text-white rounded-lg px-6 py-3 font-semibold"
            >
              UPLOAD PAYMENT SLIP
            </Link>

          )}

          {order.status ===
            "payment_submitted" && (

            <Link
              href="/tasks"
              className="bg-black text-white rounded-lg px-6 py-3 font-semibold"
            >
              GO TO PAYMENT TASK
            </Link>

          )}

        </div>

      </div>

    </main>
  );
}