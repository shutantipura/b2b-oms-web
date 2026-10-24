"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "../../../../lib/supabase";
import DeliverySchedule from "../../../../components/DeliverySchedule";
import TaskFilePicker from "../../../../components/TaskFilePicker";

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

function formatStatus(status: string) {
  const labels: Record<string, string> = {
    awaiting_confirmation: "รอยืนยันคำสั่งซื้อ",
    awaiting_picking: "รอจัดสินค้า",
    picking: "กำลังจัดสินค้า",
    awaiting_billing: "รอออกบิล",
    ready_for_delivery: "พร้อมจัดส่ง",
    out_for_delivery: "กำลังจัดส่ง",
    awaiting_payment: "รอการชำระเงิน",
    payment_submitted: "ส่งหลักฐานการชำระเงินแล้ว",
    completed: "เสร็จสิ้น",
    cancelled: "ยกเลิก",
  };

  return labels[status] ?? status;
}

function formatAmount(value: number | string | null) {
  const number = Number(value ?? 0);

  return new Intl.NumberFormat("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(number) ? number : 0);
}

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
        "ไม่สามารถโหลดคำสั่งซื้อได้: " +
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
        "ไม่สามารถโหลดไฟล์การชำระเงินได้: " +
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
          "ใบเสร็จ"
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

    setExistingSlip(
      Boolean(slip)
    );

    setLoading(false);
  }

  useEffect(() => {
    if (
      !Number.isNaN(
        orderNumber
      )
    ) {
      void loadOrder();
    }
  }, [orderNumber]);

  async function submitPaymentSlip(slipFile: File) {
    setMessage("");

    if (!order) {
      return;
    }

    if (
      order.status !==
      "awaiting_payment"
    ) {
      setMessage(
        `คำสั่งซื้อนี้อยู่ในสถานะ "${formatStatus(
          order.status
        )}" จึงไม่สามารถอัปโหลดสลิปใหม่ได้ สามารถอัปโหลดได้เฉพาะเมื่ออยู่ในสถานะรอการชำระเงินเท่านั้น`
      );

      return;
    }

    setSubmitting(true);

    setMessage(
      "กำลังอัปโหลดสลิปการชำระเงิน..."
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
        "อัปโหลดสลิปการชำระเงินไม่สำเร็จ: " +
          uploadError.message
      );

      setSubmitting(false);
      return;
    }

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
        .remove([
          storagePath,
        ]);

      setMessage(
        "อัปโหลดไฟล์สำเร็จ แต่ไม่สามารถบันทึกการส่งหลักฐานการชำระเงินได้: " +
          submitError.message
      );

      setSubmitting(false);
      return;
    }

    setMessage(
      "บันทึกสลิปและปิดคำสั่งซื้อเรียบร้อยแล้ว"
    );

    router.push(
      "/tasks"
    );

    router.refresh();
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-100 p-8">
        กำลังโหลดข้อมูลการชำระเงิน...
      </main>
    );
  }

  if (!order) {
    return (
      <main className="min-h-screen bg-gray-100 p-8">
        <p>
          ไม่พบคำสั่งซื้อ
        </p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-100 p-4 md:p-8">
      <div className="max-w-4xl mx-auto">
        <Link
          href="/"
          className="text-gray-500"
        >
          ← กลับ
        </Link>

        <div className="mt-4 mb-8">
          <p className="text-sm text-gray-500">
            การชำระเงิน
          </p>

          <h1 className="mt-1 text-2xl font-extrabold leading-tight text-[#17453F] md:text-3xl">
              {order.customers?.customer_name ?? "ไม่ทราบชื่อร้าน"}
            </h1>
            <p className="mt-1 text-xs font-semibold text-[#82958F]">
              คำสั่งซื้อ #{order.order_number}
            </p>
            <DeliverySchedule date={order.delivery_date} slot={order.delivery_slot} delivered />

          <p className="text-sm text-gray-500 mt-2">
            สถานะ:{" "}
            {formatStatus(
              order.status
            )}
          </p>
        </div>

        <section className="bg-white border rounded-2xl p-6 mb-6">
          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <p className="text-sm text-gray-500">
                ยอดที่ต้องชำระ
              </p>

              <p className="text-3xl font-bold mt-1">
                ฿
                {formatAmount(
                  order.final_amount
                )}
              </p>
            </div>

            <div>
              <p className="text-sm text-gray-500">
                เบอร์โทรศัพท์ลูกค้า
              </p>

              {order.customers
                ?.phone ? (
                <a
                  href={`tel:${order.customers.phone}`}
                  className="text-lg font-medium underline"
                >
                  {
                    order.customers
                      .phone
                  }
                </a>
              ) : (
                <p>
                  —
                </p>
              )}
            </div>
          </div>
        </section>

        <div className="grid md:grid-cols-2 gap-6 mb-6">
          <section className="bg-white border rounded-2xl p-6">
            <h2 className="font-bold text-lg">
              ใบเสร็จ / ใบแจ้งหนี้
            </h2>

            <p className="text-sm text-gray-500 mt-1 mb-4">
              ไฟล์ที่อัปโหลดในขั้นตอนออกบิล
            </p>

            {billUrl ? (
              <a
                href={
                  billUrl
                }
                target="_blank"
                rel="noreferrer"
                className="inline-block bg-white border rounded-lg px-5 py-3 font-semibold"
              >
                เปิด{" "}
                {billName ??
                  "ใบเสร็จ"}
              </a>
            ) : (
              <p className="text-red-600">
                ไม่พบไฟล์ใบเสร็จ
              </p>
            )}
          </section>

          <section className="bg-white border rounded-2xl p-6">
            <h2 className="font-bold text-lg">
              QR สำหรับชำระเงิน
            </h2>

            <p className="text-sm text-gray-500 mt-1 mb-4">
              QR ที่อัปโหลดในขั้นตอนออกบิล
            </p>

            {qrUrl ? (
              <img
                src={
                  qrUrl
                }
                alt="QR สำหรับชำระเงิน"
                className="max-w-full max-h-80 object-contain border rounded-lg"
              />
            ) : (
              <p className="text-red-600">
                ไม่พบ QR สำหรับชำระเงิน
              </p>
            )}
          </section>
        </div>

        <section className="bg-white border rounded-2xl p-6">
          <h2 className="font-bold text-lg">
            สลิปการชำระเงิน
          </h2>

          <p className="text-sm text-gray-500 mt-1 mb-5">
            พนักงานสามารถอัปโหลดสลิปแทนลูกค้าได้
          </p>

          {existingSlip ? (
            <div className="font-semibold text-[#008F8D]">
              ✓ บันทึกสลิปการชำระเงินเรียบร้อยแล้ว
            </div>
          ) : (
            <TaskFilePicker
              label="สลิปการชำระเงิน"
              chooseLabel="ถ่ายหรือเลือกสลิปการชำระเงิน"
              replaceLabel="เลือกสลิปใหม่"
              accept="image/*,application/pdf,.pdf"
              uploaded={false}
              uploading={submitting}
              disabled={order.status !== "awaiting_payment"}
              onSelect={submitPaymentSlip}
            />
          )}
        </section>

        {message && (
          <div className="mt-6 bg-white border rounded-lg p-4">
            {message}
          </div>
        )}

      </div>
    </main>
  );
}
