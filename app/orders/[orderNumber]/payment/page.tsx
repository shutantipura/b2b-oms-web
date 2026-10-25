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
  billing_account_suspended: boolean;
  billing_no_cv: boolean;
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
    awaiting_confirmation: "รอเช็คสต็อก",
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
  const [slipUrl, setSlipUrl] = useState<string | null>(null);

  // File selection is local-only. Uploading and closing an order require
  // an explicit review action followed by final confirmation.
  const [selectedSlip, setSelectedSlip] = useState<File | null>(null);
  const [selectedSlipUrl, setSelectedSlipUrl] = useState<string | null>(null);
  const [confirmSubmitOpen, setConfirmSubmitOpen] = useState(false);

  useEffect(() => {
    if (!selectedSlip) {
      setSelectedSlipUrl(null);
      return;
    }
    const previewUrl = URL.createObjectURL(selectedSlip);
    setSelectedSlipUrl(previewUrl);
    return () => URL.revokeObjectURL(previewUrl);
  }, [selectedSlip]);

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
    setOrder(null);
    setBillUrl(null);
    setQrUrl(null);
    setBillName(null);
    setExistingSlip(false);
    setSlipUrl(null);
    setSelectedSlip(null);
    setConfirmSubmitOpen(false);

    const {
      data: orderData,
      error: orderError,
    } = await supabase
      .from("orders")
      .select(`
        id,
        order_number,
        status,
        billing_account_suspended,
        billing_no_cv,
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

    setExistingSlip(Boolean(slip));
    if (slip) setSlipUrl(await createFileUrl(slip.storage_path));

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

  async function submitPaymentSlip() {
    // File picker events must never invoke the upload/close-order mutation.
    const slipFile = selectedSlip;
    if (!slipFile || !confirmSubmitOpen || submitting) return;
    setConfirmSubmitOpen(false);
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
      "บันทึกสลิปโดยพนักงานและปิดคำสั่งซื้อเรียบร้อยแล้ว"
    );

    router.push(
      "/tasks"
    );

    router.refresh();
  }

  async function releasePaymentTask() {
    if (!window.confirm("ปล่อยงานตรวจสอบการชำระเงินให้พนักงานคนอื่นรับต่อหรือไม่?")) return;
    setSubmitting(true);
    const { error } = await supabase.rpc("release_my_task", {
      p_order_number: orderNumber,
    });
    if (error) {
      setMessage("ไม่สามารถปล่อยงานได้: " + error.message);
      setSubmitting(false);
      return;
    }
    router.push("/tasks");
    router.refresh();
  }

  async function verifyPayment() {
    if (!order || order.status !== "payment_submitted" || !existingSlip) return;
    if (!window.confirm("ตรวจสอบยอดและหลักฐานการชำระเงินแล้ว ยืนยันปิดคำสั่งซื้อนี้หรือไม่?")) return;
    setSubmitting(true);
    setMessage("กำลังยืนยันการชำระเงิน...");
    const { error } = await supabase.rpc("verify_my_payment", {
      p_order_number: orderNumber,
    });
    if (error) {
      setMessage("ไม่สามารถยืนยันการชำระเงินได้: " + error.message);
      setSubmitting(false);
      return;
    }
    router.push("/tasks");
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
              {order.billing_no_cv ? "รูปพักบิล (POS)" : "ใบเสร็จ / ใบแจ้งหนี้"}
            </h2>

            <p className="text-sm text-gray-500 mt-1 mb-4">
              {order.billing_account_suspended ? "CV Card: รูปบิลไม่บังคับ" : "ไฟล์ที่อัปโหลดในขั้นตอนออกบิล"}
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
              <p className={order.billing_account_suspended ? "text-gray-500" : "text-red-600"}>
                {order.billing_account_suspended ? "CV Card: ไม่จำเป็นต้องแนบรูปบิล" : "ไม่พบไฟล์ใบเสร็จ"}
              </p>
            )}
          </section>

          <section className="bg-white border rounded-2xl p-6">
            <h2 className="font-bold text-lg">
              {order.billing_account_suspended ? "CV Card ลูกค้า" : order.billing_no_cv ? "พักบิล — ไม่ใช้ QR" : "QR สำหรับชำระเงิน"}
            </h2>

            <p className="text-sm text-gray-500 mt-1 mb-4">
              {order.billing_account_suspended ? "ใช้รูป CV Card ที่บันทึกไว้ในข้อมูลลูกค้า" : order.billing_no_cv ? "ทีมงานแนบรูปพักบิลจาก POS แทน QR" : "QR ที่อัปโหลดในขั้นตอนออกบิล"}
            </p>

            {order.billing_no_cv ? (
              <p className="text-sm text-gray-500">พักบิล: ไม่จำเป็นต้องใช้ QR ชำระเงิน</p>
            ) : qrUrl ? (
              <img
                src={
                  qrUrl
                }
                alt={order.billing_account_suspended ? "CV Card ลูกค้า" : "QR สำหรับชำระเงิน"}
                className="max-w-full max-h-80 object-contain border rounded-lg"
              />
            ) : (
              <p className="text-red-600">
                {order.billing_account_suspended ? "ไม่พบรูป CV Card ของลูกค้า" : "ไม่พบ QR สำหรับชำระเงิน"}
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
            <div className="space-y-3">
              <p className="font-semibold text-[#008F8D]">✓ บันทึกสลิปการชำระเงินเรียบร้อยแล้ว</p>
              {slipUrl ? (
                <a href={slipUrl} target="_blank" rel="noreferrer"
                  className="inline-flex rounded-lg border px-4 py-2 font-semibold underline">
                  เปิดสลิปเพื่อตรวจสอบ
                </a>
              ) : (
                <p className="text-red-600">ไม่สามารถเปิดสลิปได้ กรุณาตรวจสอบไฟล์ก่อนยืนยัน</p>
              )}
            </div>
          ) : (
            <>
              <TaskFilePicker
                label="สลิปการชำระเงิน"
                chooseLabel="ถ่ายหรือเลือกสลิปการชำระเงิน"
                replaceLabel="เปลี่ยนรูปสลิป"
                accept="image/*,application/pdf,.pdf"
                uploaded={false}
                uploading={submitting}
                disabled={order.status !== "awaiting_payment"}
                fileName={selectedSlip?.name ?? null}
                selectionHint="เลือกไฟล์เพื่อดูตัวอย่างก่อน ยังไม่ส่งสลิปจนกว่าจะกดยืนยัน"
                onSelect={(file) => {
                  setSelectedSlip(file);
                  setConfirmSubmitOpen(false);
                  setMessage("");
                }}
              />
              {selectedSlip && (
                <div className="mt-5 rounded-2xl border-2 border-[#9DDBD2] bg-[#F5FCFA] p-4">
                  <p className="text-base font-extrabold text-[#17453F]">ตรวจสอบสลิปก่อนยืนยัน</p>
                  <p className="mt-1 text-xs text-[#64877C]">รูปหรือไฟล์นี้ยังไม่ได้อัปโหลด</p>
                  {selectedSlipUrl && (
                    selectedSlip.type.startsWith("image/") ? (
                      <img
                        src={selectedSlipUrl}
                        alt="ตัวอย่างสลิปการชำระเงินที่ยังไม่ได้ส่ง"
                        className="mx-auto mt-4 max-h-80 w-full rounded-xl border border-[#DAEBE4] bg-white object-contain"
                      />
                    ) : (
                      <a
                        href={selectedSlipUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-4 block rounded-xl border border-[#CAE5DE] bg-white px-4 py-3 text-center text-sm font-bold text-[#008F8D]"
                      >
                        เปิดดูไฟล์ PDF ก่อนยืนยัน
                      </a>
                    )
                  )}
                  <p className="mt-4 text-xs leading-5 text-[#8E6000]">
                    เมื่อลงทะเบียนสลิปสำเร็จ ระบบจะปิดคำสั่งซื้อนี้ทันที กรุณาตรวจสอบรูปให้ถูกต้องก่อนยืนยัน
                  </p>
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => { setSelectedSlip(null); setConfirmSubmitOpen(false); }}
                      disabled={submitting}
                      className="min-h-12 rounded-xl border border-[#BFDCD4] bg-white px-3 py-3 text-sm font-extrabold text-[#527B6F] disabled:opacity-50"
                    >
                      ยกเลิก
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmSubmitOpen(true)}
                      disabled={submitting || order.status !== "awaiting_payment"}
                      className="min-h-12 rounded-xl bg-[#02B0AF] px-3 py-3 text-sm font-extrabold text-white disabled:opacity-50"
                    >
                      ยืนยันส่งสลิป
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </section>

        {order.status === "payment_submitted" && (
          <section className="mt-6 rounded-2xl border-2 border-[#00BCB4] bg-white p-6">
            <h2 className="text-lg font-extrabold text-[#17453F]">ตรวจสอบการชำระเงิน</h2>
            <p className="mt-2 text-sm text-gray-600">
              ตรวจสอบว่าสลิปตรงกับยอดบิล ฿{formatAmount(order.final_amount)} และได้รับเงินจริงแล้ว
              จากนั้นยืนยันเพื่อปิดคำสั่งซื้อ (ต้องรับงานตรวจสอบการชำระเงินก่อน)
            </p>
            <button type="button" onClick={() => void verifyPayment()}
              disabled={submitting || !existingSlip || !slipUrl}
              className="mt-4 rounded-xl bg-[#00BCB4] px-5 py-3 font-extrabold text-[#173F3C] disabled:cursor-not-allowed disabled:opacity-50">
              {submitting ? "กำลังตรวจสอบ..." : "ยืนยันการชำระเงินและปิดออเดอร์"}
            </button>
            <button type="button" onClick={() => void releasePaymentTask()} disabled={submitting}
              className="ml-3 mt-4 rounded-xl border border-gray-300 px-4 py-3 text-sm font-semibold disabled:opacity-50">
              ปล่อยงาน
            </button>
          </section>
        )}

        {message && (
          <div className="mt-6 bg-white border rounded-lg p-4" role="status">
            {message}
          </div>
        )}

      </div>

      {confirmSubmitOpen && selectedSlip && order.status === "awaiting_payment" && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-[#092E27]/65 p-4">
          <section
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="payment-slip-confirm-title"
            aria-describedby="payment-slip-confirm-description"
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
          >
            <h2 id="payment-slip-confirm-title" className="text-xl font-extrabold text-[#17453F]">
              ยืนยันส่งหลักฐานการชำระเงิน?
            </h2>
            <p id="payment-slip-confirm-description" className="mt-3 text-sm leading-6 text-[#526F66]">
              ยืนยันส่งไฟล์ <span className="break-all font-bold">{selectedSlip.name}</span> สำหรับคำสั่งซื้อ #{orderNumber} ใช่หรือไม่?
              <span className="mt-2 block font-bold text-[#9A6500]">
                เมื่อยืนยันแล้ว ระบบจะบันทึกสลิปและปิดคำสั่งซื้อนี้ทันที
              </span>
            </p>
            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row">
              <button
                type="button"
                onClick={() => setConfirmSubmitOpen(false)}
                disabled={submitting}
                className="min-h-12 flex-1 rounded-xl border border-[#CFE3DB] px-4 py-3 text-sm font-extrabold text-[#456F61] disabled:opacity-50"
              >
                กลับไปตรวจสอบรูป
              </button>
              <button
                type="button"
                onClick={() => void submitPaymentSlip()}
                disabled={submitting}
                className="min-h-12 flex-1 rounded-xl bg-[#02B0AF] px-4 py-3 text-sm font-extrabold text-white disabled:opacity-50"
              >
                {submitting ? "กำลังส่ง..." : "ยืนยันส่งและปิดคำสั่งซื้อ"}
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
