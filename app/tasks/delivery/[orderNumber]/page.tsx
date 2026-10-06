"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "../../../../lib/supabase";

type OrderDetails = {
  id: string;
  order_number: number;
  status: string;
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

export default function DeliveryPage() {
  const params = useParams();
  const router = useRouter();

  const orderNumber = Number(params.orderNumber);

  const [order, setOrder] =
    useState<OrderDetails | null>(null);

  const [deliveryPhoto, setDeliveryPhoto] =
    useState<File | null>(null);

  const [photoUploaded, setPhotoUploaded] =
    useState(false);

  const [loading, setLoading] =
    useState(true);

  const [uploading, setUploading] =
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
        status,
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

    const {
      data: existingProof,
      error: proofError,
    } = await supabase
      .from("order_files")
      .select("id")
      .eq("order_id", orderData.id)
      .eq("file_type", "delivery_proof")
      .eq("is_current", true)
      .maybeSingle();

    if (!proofError && existingProof) {
      setPhotoUploaded(true);
    }

    setLoading(false);
  }

  useEffect(() => {
    if (!Number.isNaN(orderNumber)) {
      loadOrder();
    }
  }, [orderNumber]);

  async function uploadDeliveryProof() {
    if (!deliveryPhoto) {
      setMessage(
        "Please choose a delivery proof photo first."
      );
      return;
    }

    setUploading(true);
    setMessage(
      "Uploading delivery proof..."
    );

    const extension =
      deliveryPhoto.name.split(".").pop() ||
      "jpg";

    const storagePath =
      `orders/${orderNumber}/delivery_proof/` +
      `${crypto.randomUUID()}.${extension}`;

    const { error: uploadError } =
      await supabase.storage
        .from("order-files")
        .upload(
          storagePath,
          deliveryPhoto,
          {
            upsert: false,
            contentType:
              deliveryPhoto.type ||
              "image/jpeg",
          }
        );

    if (uploadError) {
      setMessage(
        "Delivery proof upload failed: " +
          uploadError.message
      );
      setUploading(false);
      return;
    }

    const { error: registerError } =
      await supabase.rpc(
        "register_my_order_file",
        {
          p_order_number: orderNumber,
          p_file_type: "delivery_proof",
          p_storage_path: storagePath,
          p_original_filename:
            deliveryPhoto.name,
          p_mime_type:
            deliveryPhoto.type ||
            "image/jpeg",
        }
      );

    if (registerError) {
      setMessage(
        "Photo uploaded, but registration failed: " +
          registerError.message
      );
      setUploading(false);
      return;
    }

    setPhotoUploaded(true);
    setUploading(false);

    setMessage(
      "Delivery proof uploaded successfully."
    );
  }

  async function completeDelivery() {
    setMessage("");

    if (!photoUploaded) {
      setMessage(
        "Delivery proof is required before completing Delivery."
      );
      return;
    }

    setSubmitting(true);

    const { error } = await supabase.rpc(
      "complete_my_delivery",
      {
        p_order_number: orderNumber,
      }
    );

    if (error) {
      setMessage(
        "Could not complete Delivery: " +
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
        "Release this delivery so another staff member can work on it?"
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
        Loading delivery...
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
      <div className="max-w-4xl mx-auto">

        <Link
          href="/tasks"
          className="text-gray-500"
        >
          ← Back to Tasks
        </Link>

        <div className="flex justify-between items-start mt-4 mb-8">

          <div>
            <p className="text-sm text-gray-500">
              DELIVERY
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
            Delivery Information
          </h2>

          <div className="grid md:grid-cols-2 gap-5">

            <div>
              <p className="text-sm text-gray-500">
                Contact
              </p>

              <p className="font-medium">
                {order.customers
                  ?.contact_name ?? "—"}
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
                Delivery Slot
              </p>

              <p className="font-medium">
                {order.delivery_date ?? "—"}
                {" · "}
                {order.delivery_slot ?? "—"}
              </p>
            </div>

            <div>
              <p className="text-sm text-gray-500">
                Final Bill Amount
              </p>

              <p className="font-bold text-lg">
                ฿
                {Number(
                  order.final_amount ?? 0
                ).toFixed(2)}
              </p>
            </div>

          </div>

          <div className="mt-5">
            <p className="text-sm text-gray-500">
              Delivery Address
            </p>

            <p className="font-medium text-lg">
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

        <section className="bg-white border rounded-2xl p-6">

          <h2 className="font-bold text-lg">
            Proof of Delivery
          </h2>

          <p className="text-sm text-gray-500 mt-1 mb-5">
            Upload one photo showing that the order was delivered.
          </p>

          {photoUploaded ? (
            <div className="font-semibold">
              ✓ Delivery proof uploaded
            </div>
          ) : (
            <>
              <input
                type="file"
                accept="image/*"
                onChange={(event) =>
                  setDeliveryPhoto(
                    event.target.files?.[0] ??
                    null
                  )
                }
              />

              <button
                onClick={uploadDeliveryProof}
                disabled={uploading}
                className="block mt-4 bg-white border rounded-lg px-5 py-2"
              >
                {uploading
                  ? "UPLOADING..."
                  : "UPLOAD DELIVERY PROOF"}
              </button>
            </>
          )}

        </section>

        {message && (
          <div className="mt-6 bg-white border rounded-lg p-4">
            {message}
          </div>
        )}

        <div className="flex justify-end mt-6">

          <button
            onClick={completeDelivery}
            disabled={
              submitting ||
              !photoUploaded
            }
            className="bg-black text-white rounded-lg px-8 py-4 font-semibold disabled:opacity-30"
          >
            {submitting
              ? "COMPLETING..."
              : "DELIVERY COMPLETE"}
          </button>

        </div>

      </div>
    </main>
  );
}