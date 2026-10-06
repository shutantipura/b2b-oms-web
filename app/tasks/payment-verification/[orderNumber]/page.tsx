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

type DisplayFile = {
  url: string;
  name: string;
  mimeType: string | null;
};

export default function PaymentVerificationPage() {
  const params = useParams();
  const router = useRouter();

  const orderNumber = Number(params.orderNumber);

  const [order, setOrder] =
    useState<OrderDetails | null>(null);

  const [bill, setBill] =
    useState<DisplayFile | null>(null);

  const [slip, setSlip] =
    useState<DisplayFile | null>(null);

  const [loading, setLoading] =
    useState(true);

  const [submitting, setSubmitting] =
    useState(false);

  const [message, setMessage] =
    useState("");

  async function getDisplayFile(
    file: OrderFile
  ): Promise<DisplayFile | null> {
    const { data, error } =
      await supabase.storage
        .from("order-files")
        .createSignedUrl(
          file.storage_path,
          60 * 60
        );

    if (error) {
      console.error(error);
      return null;
    }

    return {
      url: data.signedUrl,
      name:
        file.original_filename ??
        file.file_type,
      mimeType: file.mime_type,
    };
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
        ["bill", "payment_slip"]
      );

    if (fileError) {
      setMessage(
        "Could not load files: " +
          fileError.message
      );

      setLoading(false);
      return;
    }

    const files =
      (fileData ?? []) as OrderFile[];

    const billFile =
      files.find(
        (file) =>
          file.file_type === "bill"
      );

    const slipFile =
      files.find(
        (file) =>
          file.file_type === "payment_slip"
      );

    if (billFile) {
      setBill(
        await getDisplayFile(billFile)
      );
    }

    if (slipFile) {
      setSlip(
        await getDisplayFile(slipFile)
      );
    }

    setLoading(false);
  }

  useEffect(() => {
    if (!Number.isNaN(orderNumber)) {
      loadOrder();
    }
  }, [orderNumber]);

  async function verifyPayment() {
    setMessage("");

    if (!order) {
      return;
    }

    if (
      order.status !==
      "payment_submitted"
    ) {
      setMessage(
        `This order is currently ${order.status}, not payment_submitted.`
      );
      return;
    }

    if (!slip) {
      setMessage(
        "A payment slip is required before payment can be verified."
      );
      return;
    }

    const confirmed =
      window.confirm(
        `Verify payment of ฿${Number(
          order.final_amount ?? 0
        ).toFixed(
          2
        )} and complete Order #${orderNumber}?`
      );

    if (!confirmed) {
      return;
    }

    setSubmitting(true);

    const { error } = await supabase.rpc(
      "verify_my_payment",
      {
        p_order_number:
          orderNumber,
      }
    );

    if (error) {
      setMessage(
        "Could not verify payment: " +
          error.message
      );

      setSubmitting(false);
      return;
    }

    router.push("/tasks");
    router.refresh();
  }

  async function releaseTask() {
    const confirmed =
      window.confirm(
        "Release this task so another staff member can verify the payment?"
      );

    if (!confirmed) {
      return;
    }

    const { error } =
      await supabase.rpc(
        "release_my_task",
        {
          p_order_number:
            orderNumber,
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

  function isImage(
    file: DisplayFile | null
  ) {
    return Boolean(
      file?.mimeType?.startsWith(
        "image/"
      )
    );
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-100 p-8">
        Loading payment verification...
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
              PAYMENT VERIFICATION
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

          <h2 className="font-bold text-lg mb-5">
            Payment Summary
          </h2>

          <div className="grid md:grid-cols-3 gap-6">

            <div>
              <p className="text-sm text-gray-500">
                Expected Amount
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
                Customer
              </p>

              <p className="font-medium text-lg">
                {order.customers
                  ?.customer_name}
              </p>

              <p className="text-sm text-gray-500">
                {order.customers
                  ?.contact_name ?? ""}
              </p>
            </div>

            <div>
              <p className="text-sm text-gray-500">
                Customer Phone
              </p>

              {order.customers?.phone ? (
                <a
                  href={`tel:${order.customers.phone}`}
                  className="font-medium text-lg underline"
                >
                  {order.customers.phone}
                </a>
              ) : (
                <p>—</p>
              )}
            </div>

          </div>

        </section>

        <div className="grid md:grid-cols-2 gap-6">

          <section className="bg-white border rounded-2xl p-6">

            <h2 className="font-bold text-lg">
              Bill
            </h2>

            <p className="text-sm text-gray-500 mt-1 mb-5">
              The bill uploaded during Billing.
            </p>

            {!bill ? (
              <p className="text-red-600">
                Bill not found.
              </p>
            ) : isImage(bill) ? (
              <>
                <img
                  src={bill.url}
                  alt="Bill"
                  className="w-full max-h-96 object-contain border rounded-lg"
                />

                <a
                  href={bill.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-block mt-4 underline"
                >
                  Open full bill
                </a>
              </>
            ) : (
              <a
                href={bill.url}
                target="_blank"
                rel="noreferrer"
                className="inline-block bg-white border rounded-lg px-5 py-3 font-semibold"
              >
                OPEN BILL
              </a>
            )}

          </section>

          <section className="bg-white border rounded-2xl p-6">

            <h2 className="font-bold text-lg">
              Payment Slip
            </h2>

            <p className="text-sm text-gray-500 mt-1 mb-5">
              Compare this slip against the expected amount before verifying payment.
            </p>

            {!slip ? (
              <p className="text-red-600">
                Payment slip not found.
              </p>
            ) : isImage(slip) ? (
              <>
                <img
                  src={slip.url}
                  alt="Payment Slip"
                  className="w-full max-h-96 object-contain border rounded-lg"
                />

                <a
                  href={slip.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-block mt-4 underline"
                >
                  Open full payment slip
                </a>
              </>
            ) : (
              <a
                href={slip.url}
                target="_blank"
                rel="noreferrer"
                className="inline-block bg-white border rounded-lg px-5 py-3 font-semibold"
              >
                OPEN PAYMENT SLIP
              </a>
            )}

          </section>

        </div>

        <section className="bg-white border rounded-2xl p-6 mt-6">

          <h2 className="font-bold text-lg">
            Verification
          </h2>

          <p className="text-gray-500 mt-1">
            Confirm that the payment was received for the correct amount.
          </p>

          <div className="mt-5 flex flex-col md:flex-row gap-3">

            {order.customers?.phone && (
              <a
                href={`tel:${order.customers.phone}`}
                className="text-center bg-white border rounded-lg px-5 py-3 font-semibold"
              >
                CALL CUSTOMER
              </a>
            )}

            <button
              onClick={verifyPayment}
              disabled={
                submitting ||
                !slip ||
                order.status !==
                  "payment_submitted"
              }
              className="bg-black text-white rounded-lg px-8 py-3 font-semibold disabled:opacity-30"
            >
              {submitting
                ? "VERIFYING..."
                : "PAYMENT VERIFIED → COMPLETE ORDER"}
            </button>

          </div>

          <p className="text-sm text-gray-500 mt-4">
            If there is a payment problem, call the customer before verifying.
          </p>

        </section>

        {message && (
          <div className="mt-6 bg-white border rounded-lg p-4 text-red-600">
            {message}
          </div>
        )}

      </div>
    </main>
  );
}