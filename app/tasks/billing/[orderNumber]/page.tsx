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
  final_amount: number | string | null;

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
};

export default function BillingPage() {
  const params = useParams();
  const router = useRouter();

  const orderNumber = Number(params.orderNumber);

  const [order, setOrder] =
    useState<OrderDetails | null>(null);

  const [items, setItems] =
    useState<OrderItem[]>([]);

  const [cartPhotoUrl, setCartPhotoUrl] =
    useState<string | null>(null);

  const [billUploaded, setBillUploaded] =
    useState(false);

  const [qrUploaded, setQrUploaded] =
    useState(false);

  const [billFile, setBillFile] =
    useState<File | null>(null);

  const [qrFile, setQrFile] =
    useState<File | null>(null);

  const [finalAmount, setFinalAmount] =
    useState("");

  const [loading, setLoading] =
    useState(true);

  const [uploadingBill, setUploadingBill] =
    useState(false);

  const [uploadingQr, setUploadingQr] =
    useState(false);

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
        final_amount,
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

    if (orderData.final_amount !== null) {
      setFinalAmount(
        String(orderData.final_amount)
      );
    }

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

    setItems(
      (itemData ?? []) as unknown as OrderItem[]
    );

    const {
      data: fileData,
      error: fileError,
    } = await supabase
      .from("order_files")
      .select(`
        id,
        file_type,
        storage_path,
        original_filename
      `)
      .eq("order_id", orderData.id)
      .eq("is_current", true);

    if (fileError) {
      setMessage(
        "Could not load order files: " +
          fileError.message
      );

      setLoading(false);
      return;
    }

    const files =
      (fileData ?? []) as OrderFile[];

    const cartPhoto = files.find(
      (file) =>
        file.file_type === "cart_photo"
    );

    const bill = files.find(
      (file) =>
        file.file_type === "bill"
    );

    const qr = files.find(
      (file) =>
        file.file_type === "payment_qr"
    );

    setBillUploaded(Boolean(bill));
    setQrUploaded(Boolean(qr));

    if (cartPhoto) {
      const {
        data: signedData,
        error: signedError,
      } = await supabase.storage
        .from("order-files")
        .createSignedUrl(
          cartPhoto.storage_path,
          60 * 60
        );

      if (!signedError && signedData) {
        setCartPhotoUrl(
          signedData.signedUrl
        );
      }
    }

    setLoading(false);
  }

  useEffect(() => {
    if (!Number.isNaN(orderNumber)) {
      loadOrder();
    }
  }, [orderNumber]);

  async function uploadFile(
    file: File,
    fileType: "bill" | "payment_qr"
  ) {
    const extension =
      file.name.split(".").pop() || "jpg";

    const storagePath =
      `orders/${orderNumber}/${fileType}/` +
      `${crypto.randomUUID()}.${extension}`;

    const { error: uploadError } =
      await supabase.storage
        .from("order-files")
        .upload(
          storagePath,
          file,
          {
            upsert: false,
            contentType:
              file.type ||
              "image/jpeg",
          }
        );

    if (uploadError) {
      throw new Error(
        "File upload failed: " +
          uploadError.message
      );
    }

    const { error: registerError } =
      await supabase.rpc(
        "register_my_order_file",
        {
          p_order_number: orderNumber,
          p_file_type: fileType,
          p_storage_path: storagePath,
          p_original_filename:
            file.name,
          p_mime_type:
            file.type ||
            "image/jpeg",
        }
      );

    if (registerError) {
      throw new Error(
        "File uploaded, but registration failed: " +
          registerError.message
      );
    }
  }

  async function uploadBill() {
    if (!billFile) {
      setMessage(
        "Please choose a bill file first."
      );
      return;
    }

    try {
      setUploadingBill(true);
      setMessage("Uploading bill...");

      await uploadFile(
        billFile,
        "bill"
      );

      setBillUploaded(true);
      setMessage(
        "Bill uploaded successfully."
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Bill upload failed."
      );
    } finally {
      setUploadingBill(false);
    }
  }

  async function uploadQr() {
    if (!qrFile) {
      setMessage(
        "Please choose a Payment QR first."
      );
      return;
    }

    try {
      setUploadingQr(true);
      setMessage(
        "Uploading Payment QR..."
      );

      await uploadFile(
        qrFile,
        "payment_qr"
      );

      setQrUploaded(true);
      setMessage(
        "Payment QR uploaded successfully."
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Payment QR upload failed."
      );
    } finally {
      setUploadingQr(false);
    }
  }

  async function completeBilling() {
    setMessage("");

    const amount =
      Number(finalAmount);

    if (
      Number.isNaN(amount) ||
      amount <= 0
    ) {
      setMessage(
        "Please enter a valid final bill amount."
      );
      return;
    }

    if (!billUploaded) {
      setMessage(
        "The Bill must be uploaded before Billing can be completed."
      );
      return;
    }

    if (!qrUploaded) {
      setMessage(
        "The Payment QR must be uploaded before Billing can be completed."
      );
      return;
    }

    setSubmitting(true);

    const { error } = await supabase.rpc(
      "complete_my_billing",
      {
        p_order_number: orderNumber,
        p_final_amount: amount,
      }
    );

    if (error) {
      setMessage(
        "Could not complete Billing: " +
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

  const calculatedTotal =
    items.reduce(
      (sum, item) => {
        const actual =
          Number(item.actual_qty ?? 0);

        const price =
          Number(
            item.unit_price_snapshot ?? 0
          );

        return (
          sum +
          actual * price
        );
      },
      0
    );

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-100 p-8">
        Loading billing...
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
      <div className="max-w-6xl mx-auto">

        <Link
          href="/tasks"
          className="text-gray-500"
        >
          ← Back to Tasks
        </Link>

        <div className="flex justify-between items-start mt-4 mb-8">

          <div>
            <p className="text-sm text-gray-500">
              BILLING
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

          <h2 className="font-bold text-lg mb-4">
            Customer & Delivery
          </h2>

          <div className="grid md:grid-cols-2 gap-4">

            <div>
              <p className="text-sm text-gray-500">
                Contact
              </p>

              <p className="font-medium">
                {order.customers
                  ?.contact_name ??
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
                  className="underline font-medium"
                >
                  {order.customers.phone}
                </a>
              ) : (
                "—"
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
                {order.delivery_address ??
                  "—"}
              </p>
            </div>

          </div>

        </section>

        <section className="bg-white border rounded-2xl overflow-hidden mb-6">

          <div className="p-6 border-b">

            <h2 className="font-bold text-lg">
              Picked Items
            </h2>

            <p className="text-sm text-gray-500 mt-1">
              Review the picker&apos;s actual quantities before creating the external bill.
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

                  <th className="text-right p-4">
                    Actual Picked
                  </th>

                  <th className="text-right p-4">
                    Price
                  </th>

                  <th className="text-right p-4">
                    Reference
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
                        {
                          item.product_name_snapshot
                        }
                      </td>

                      <td className="p-4">
                        {item.products?.sku ??
                          "—"}
                      </td>

                      <td className="p-4 text-right">
                        {Number(
                          item.requested_qty
                        )}{" "}
                        {item.unit_snapshot}
                      </td>

                      <td className="p-4 text-right">
                        {Number(
                          item.confirmed_qty
                        )}{" "}
                        {item.unit_snapshot}
                      </td>

                      <td className="p-4 text-right font-semibold">
                        {actual}{" "}
                        {item.unit_snapshot}
                      </td>

                      <td className="p-4 text-right">
                        ฿
                        {price.toFixed(2)}
                      </td>

                      <td className="p-4 text-right">
                        ฿
                        {(
                          actual * price
                        ).toFixed(2)}
                      </td>

                    </tr>
                  );
                })}

              </tbody>

            </table>

          </div>

          <div className="p-5 border-t text-right">

            <span className="text-gray-500">
              Calculated reference total:
            </span>

            <span className="font-bold ml-3">
              ฿
              {calculatedTotal.toFixed(2)}
            </span>

          </div>

        </section>

        <section className="grid md:grid-cols-2 gap-6 mb-6">

          <div className="bg-white border rounded-2xl p-6">

            <h2 className="font-bold text-lg mb-4">
              Picker Cart Photo
            </h2>

            {cartPhotoUrl ? (
              <img
                src={cartPhotoUrl}
                alt="Completed cart"
                className="w-full max-h-96 object-contain rounded-lg border"
              />
            ) : (
              <p className="text-gray-500">
                No cart photo available.
              </p>
            )}

          </div>

          <div className="bg-white border rounded-2xl p-6">

            <h2 className="font-bold text-lg">
              Final Bill Amount
            </h2>

            <p className="text-sm text-gray-500 mt-1 mb-4">
              Enter the amount from the externally created bill.
            </p>

            <div className="flex items-center gap-3">

              <span className="text-2xl">
                ฿
              </span>

              <input
                type="number"
                min="0"
                step="0.01"
                value={finalAmount}
                onChange={(event) =>
                  setFinalAmount(
                    event.target.value
                  )
                }
                placeholder="0.00"
                className="w-full border rounded-lg px-4 py-3 text-xl"
              />

            </div>

          </div>

        </section>

        <section className="grid md:grid-cols-2 gap-6">

          <div className="bg-white border rounded-2xl p-6">

            <h2 className="font-bold text-lg">
              Bill
            </h2>

            <p className="text-sm text-gray-500 mt-1 mb-4">
              Upload the bill created outside the OMS.
            </p>

            {billUploaded ? (
              <div className="font-semibold">
                ✓ Bill uploaded
              </div>
            ) : (
              <>
                <input
                  type="file"
                  accept="image/*,.pdf"
                  onChange={(event) =>
                    setBillFile(
                      event.target
                        .files?.[0] ??
                        null
                    )
                  }
                />

                <button
                  onClick={uploadBill}
                  disabled={uploadingBill}
                  className="block mt-4 bg-white border rounded-lg px-5 py-2"
                >
                  {uploadingBill
                    ? "UPLOADING..."
                    : "UPLOAD BILL"}
                </button>
              </>
            )}

          </div>

          <div className="bg-white border rounded-2xl p-6">

            <h2 className="font-bold text-lg">
              Payment QR
            </h2>

            <p className="text-sm text-gray-500 mt-1 mb-4">
              Upload the payment QR that the customer will use later.
            </p>

            {qrUploaded ? (
              <div className="font-semibold">
                ✓ Payment QR uploaded
              </div>
            ) : (
              <>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(event) =>
                    setQrFile(
                      event.target
                        .files?.[0] ??
                        null
                    )
                  }
                />

                <button
                  onClick={uploadQr}
                  disabled={uploadingQr}
                  className="block mt-4 bg-white border rounded-lg px-5 py-2"
                >
                  {uploadingQr
                    ? "UPLOADING..."
                    : "UPLOAD PAYMENT QR"}
                </button>
              </>
            )}

          </div>

        </section>

        {message && (
          <div className="mt-6 bg-white border rounded-lg p-4">
            {message}
          </div>
        )}

        <div className="flex justify-end mt-6">

          <button
            onClick={completeBilling}
            disabled={
              submitting ||
              !billUploaded ||
              !qrUploaded
            }
            className="bg-black text-white rounded-lg px-8 py-4 font-semibold disabled:opacity-30"
          >
            {submitting
              ? "COMPLETING..."
              : "COMPLETE BILLING → DELIVERY"}
          </button>

        </div>

      </div>
    </main>
  );
}