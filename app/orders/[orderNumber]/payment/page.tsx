"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "../../../../lib/supabase";

type OrderDetails = {
  id: string;
  order_number: number;
  status: string;
  final_amount: number | string | null;
  delivery_date: string | null;
  delivery_slot: string | null;

  customers: {
    customer_name: string;
    contact_name: string | null;
    phone: string | null;
  } | null;
};

type OrderFile = {
  id: string;
  file_type: string;
  storage_path: string;
  original_filename: string | null;
  mime_type: string | null;
};

export default function StaffPaymentPage() {
  const params = useParams();
  const router = useRouter();

  const orderNumber = Number(params.orderNumber);

  const [order, setOrder] =
    useState<OrderDetails | null>(null);

  const [billUrl, setBillUrl] =
    useState<string | null>(null);

  const [billName, setBillName] =
    useState<string | null>(null);

  const [qrUrl, setQrUrl] =
    useState<string | null>(null);

  const [existingSlip, setExistingSlip] =
    useState(false);

  const [slipFile, setSlipFile] =
    useState<File | null>(null);

  const [loading, setLoading] =
    useState(true);

  const [submitting, setSubmitting] =
    useState(false);

  const [message, setMessage] =
    useState("");

  async function createFileUrl(
    storagePath: string
  ) {
    const {
      data,
      error,
    } = await supabase.storage
      .from("order-files")
      .createSignedUrl(
        storagePath,
        60 * 60
      );

    if (error) {
      console.error(error);
      return null;
    }

    return data.signedUrl;
  }

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
        status,
        final_amount,
        delivery_date,
        delivery_slot,
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
      .eq("order_id", orderData.id)
      .eq("is_current", true)
      .in(
        "file_type",
        [
          "bill",
          "payment_qr",
          "payment_slip",
        ]
      );

    if (fileError) {
      setMessage(
        "Could not load payment files: " +
          fileError.message
      );

      setLoading(false);
      return;
    }

    const files =
      (fileData ?? []) as OrderFile[];

    const bill = files.find(
      (file) =>
        file.file_type === "bill"
    );

    const qr = files.find(
      (file) =>
        file.file_type === "payment_qr"
    );

    const slip = files.find(
      (file) =>
        file.file_type === "payment_slip"
    );

    if (bill) {
      setBillName(
        bill.original_filename ??
          "Bill"
      );

      const url =
        await createFileUrl(
          bill.storage_path
        );

      setBillUrl(url);
    }

    if (qr) {
      const url =
        await createFileUrl(
          qr.storage_path
        );

      setQrUrl(url);
    }

    setExistingSlip(Boolean(slip));

    setLoading(false);
  }

  useEffect(() => {
    if (!Number.isNaN(orderNumber)) {
      loadOrder();
    }
  }, [orderNumber]);

  async function submitPaymentSlip() {
    setMessage("");

    if (!order) {
      return;
    }

    if (
      order.status !==
      "awaiting_payment"
    ) {
      setMessage(
        `This order is currently ${order.status}. A new payment slip can only be submitted while the order is awaiting payment.`
      );
      return;
    }

    if (!slipFile) {
      setMessage(
        "Please choose a payment slip first."
      );
      return;
    }

    setSubmitting(true);
    setMessage(
      "Uploading payment slip..."
    );

    const extension =
      slipFile.name
        .split(".")
        .pop() || "jpg";

    const storagePath =
      `orders/${orderNumber}/payment_slip/` +
      `${crypto.randomUUID()}.${extension}`;

    const {
      error: uploadError,
    } = await supabase.storage
      .from("order-files")
      .upload(
        storagePath,
        slipFile,
        {
          upsert: false,
          contentType:
            slipFile.type ||
            "image/jpeg",
        }
      );

    if (uploadError) {
      setMessage(
        "Payment slip upload failed: " +
          uploadError.message
      );

      setSubmitting(false);
      return;
    }

    /*
      This existing Supabase function:
      - identifies the logged-in staff member
      - registers payment_slip in order_files
      - records who uploaded it
      - changes awaiting_payment → payment_submitted
      - writes the action to order_history
    */

    const {
      error: submitError,
    } = await supabase.rpc(
      "submit_payment_slip_as_staff",
      {
        p_order_number:
          orderNumber,

        p_storage_path:
          storagePath,

        p_original_filename:
          slipFile.name,

        p_mime_type:
          slipFile.type ||
          "image/jpeg",
      }
    );

    if (submitError) {
      // Avoid leaving an unused file in Storage
      await supabase.storage
        .from("order-files")
        .remove([storagePath]);

      setMessage(
        "The file uploaded, but payment submission failed: " +
          submitError.message
      );

      setSubmitting(false);
      return;
    }

    setMessage(
      "Payment slip submitted successfully."
    );

    router.push("/tasks");
    router.refresh();
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-100 p-8">
        Loading payment...
      </main>
    );
  }

  if (!order) {
    return (
      <main className="min-h-screen bg-gray-100 p-8">
        <p>Order not found.</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-4xl mx-auto">

        <Link
          href="/"
          className="text-gray-500"
        >
          ← Back
        </Link>

        <div className="mt-4 mb-8">

          <p className="text-sm text-gray-500">
            PAYMENT
          </p>

          <h1 className="text-3xl font-bold mt-1">
            Order #{order.order_number}
          </h1>

          <p className="text-xl mt-2">
            {order.customers?.customer_name}
          </p>

          <p className="text-sm text-gray-500 mt-2">
            Status: {order.status}
          </p>

        </div>

        <section className="bg-white border rounded-2xl p-6 mb-6">

          <div className="grid md:grid-cols-2 gap-6">

            <div>
              <p className="text-sm text-gray-500">
                Expected Payment
              </p>

              <p className="text-3xl font-bold mt-1">
                ฿
                {Number(
                  order.final_amount ?? 0
                ).toFixed(2)}
              </p>
            </div>

            <div>
              <p className="text-sm text-gray-500">
                Customer Phone
              </p>

              {order.customers?.phone ? (
                <a
                  href={`tel:${order.customers.phone}`}
                  className="text-lg font-medium underline"
                >
                  {order.customers.phone}
                </a>
              ) : (
                <p>—</p>
              )}
            </div>

          </div>

        </section>

        <div className="grid md:grid-cols-2 gap-6 mb-6">

          <section className="bg-white border rounded-2xl p-6">

            <h2 className="font-bold text-lg">
              Bill
            </h2>

            <p className="text-sm text-gray-500 mt-1 mb-4">
              Bill uploaded during Billing.
            </p>

            {billUrl ? (
              <a
                href={billUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-block bg-white border rounded-lg px-5 py-3 font-semibold"
              >
                OPEN {billName ?? "BILL"}
              </a>
            ) : (
              <p className="text-red-600">
                Bill not found.
              </p>
            )}

          </section>

          <section className="bg-white border rounded-2xl p-6">

            <h2 className="font-bold text-lg">
              Payment QR
            </h2>

            <p className="text-sm text-gray-500 mt-1 mb-4">
              QR uploaded during Billing.
            </p>

            {qrUrl ? (
              <img
                src={qrUrl}
                alt="Payment QR"
                className="max-w-full max-h-80 object-contain border rounded-lg"
              />
            ) : (
              <p className="text-red-600">
                Payment QR not found.
              </p>
            )}

          </section>

        </div>

        <section className="bg-white border rounded-2xl p-6">

          <h2 className="font-bold text-lg">
            Payment Slip
          </h2>

          <p className="text-sm text-gray-500 mt-1 mb-5">
            Staff may upload the customer&apos;s payment slip on their behalf.
          </p>

          {existingSlip ? (
            <div className="font-semibold">
              ✓ Payment slip already submitted
            </div>
          ) : (
            <>
              <input
                type="file"
                accept="image/*,.pdf"
                onChange={(event) =>
                  setSlipFile(
                    event.target
                      .files?.[0] ??
                      null
                  )
                }
              />

              {slipFile && (
                <p className="text-sm text-gray-500 mt-3">
                  Selected:{" "}
                  {slipFile.name}
                </p>
              )}
            </>
          )}

        </section>

        {message && (
          <div className="mt-6 bg-white border rounded-lg p-4">
            {message}
          </div>
        )}

        {!existingSlip && (
          <div className="flex justify-end mt-6">

            <button
              onClick={
                submitPaymentSlip
              }
              disabled={
                submitting ||
                !slipFile ||
                order.status !==
                  "awaiting_payment"
              }
              className="bg-black text-white rounded-lg px-8 py-4 font-semibold disabled:opacity-30"
            >
              {submitting
                ? "SUBMITTING..."
                : "SUBMIT PAYMENT SLIP"}
            </button>

          </div>
        )}

      </div>
    </main>
  );
}