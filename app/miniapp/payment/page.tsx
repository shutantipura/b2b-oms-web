"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import LotusLoading from "../../../components/LotusLoading";

type DisplayFile = {
  fileType: string;
  name: string;
  mimeType: string | null;
  url: string;
};

type PaymentResponse = {
  customer?: {
    customerCode: string;
    customerName: string;
  };
  order?: {
    orderNumber: number;
    status: string;
    finalAmount: number | null;
    deliveryDate: string | null;
    deliverySlot: string | null;
  };
  files?: {
    bill: DisplayFile | null;
    paymentQr: DisplayFile | null;
    deliveryProof: DisplayFile | null;
    paymentSlip: DisplayFile | null;
  };
  success?: boolean;
  error?: string;
};

type Notice = { kind: "success" | "error"; text: string };

const cardClass =
  "overflow-hidden rounded-[22px] border border-[#D6E8E2] bg-white shadow-[0_5px_18px_rgba(0,105,100,0.07)]";

function isImage(file: DisplayFile | null | undefined) {
  if (!file) return false;
  if (file.mimeType?.startsWith("image/")) return true;
  return /\.(png|jpe?g|webp|gif|heic|heif)(?:$|[?#])/i.test(file.name) ||
    /\.(png|jpe?g|webp|gif|heic|heif)(?:$|[?#])/i.test(file.url);
}

function money(amount: number) {
  return amount.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function deliveryDateText(value: string | null) {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return value;
  return new Intl.DateTimeFormat("th-TH-u-ca-gregory", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(year, month - 1, day));
}

function ArrowLeftIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg width="27" height="27" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 16V3m0 0L7 8m5-5 5 5" />
      <path d="M4 16.5v2A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5v-2" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m5 12 4.5 4.5L19 7" />
    </svg>
  );
}

export default function MiniAppPaymentPage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [customerCode, setCustomerCode] = useState("");
  const [idToken, setIdToken] = useState("");
  const [data, setData] = useState<PaymentResponse | null>(null);
  const [slipFile, setSlipFile] = useState<File | null>(null);
  const [slipPreview, setSlipPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);

  async function loadPayment(token: string, code: string, orderNumber: number) {
    // Keep the existing API contract: JSON POST loads the bill, QR, proof and slip.
    const response = await fetch("/api/line/payment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: token, customerCode: code, orderNumber }),
    });
    const result = (await response.json()) as PaymentResponse;
    if (!response.ok) {
      throw new Error(result.error ?? "ไม่สามารถโหลดข้อมูลการชำระเงินได้");
    }
    setData(result);
    return result;
  }

  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      try {
        const params = new URLSearchParams(window.location.search);
        const code = (params.get("customer") ?? "").trim().toUpperCase();
        const orderNumber = Number(params.get("order"));

        if (!code || !Number.isInteger(orderNumber) || orderNumber <= 0) {
          throw new Error("ไม่พบข้อมูลลูกค้าหรือหมายเลขคำสั่งซื้อ");
        }

        const liffModule = await import("@line/liff");
        const liff = liffModule.default;
        const liffId = process.env.NEXT_PUBLIC_LINE_LIFF_ID;
        if (!liffId) throw new Error("ไม่พบ LINE LIFF ID");

        await liff.init({ liffId, withLoginOnExternalBrowser: true });
        if (!liff.isLoggedIn()) {
          liff.login();
          return;
        }

        const token = liff.getIDToken();
        if (!token) throw new Error("ไม่สามารถอ่าน LINE ID token ได้");
        if (cancelled) return;

        setIdToken(token);
        setCustomerCode(code);
        await loadPayment(token, code, orderNumber);
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "ไม่สามารถโหลดข้อมูลการชำระเงินได้");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void initialize();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!slipFile || !slipFile.type.startsWith("image/")) {
      setSlipPreview(null);
      return;
    }
    const url = URL.createObjectURL(slipFile);
    setSlipPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [slipFile]);

  function clearSlip() {
    setSlipFile(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function goBack() {
    const code = data?.customer?.customerCode ?? customerCode;
    if (!code) {
      router.push("/miniapp?portal=customer");
      return;
    }
    const view = data?.order?.status === "completed" || data?.order?.status === "cancelled"
      ? "history"
      : "active";
    router.push(`/miniapp/orders?customer=${encodeURIComponent(code)}&view=${view}`);
  }

  async function refreshPayment() {
    if (!idToken || !customerCode || !data?.order || refreshing) return;
    setRefreshing(true);
    setNotice(null);
    try {
      await loadPayment(idToken, customerCode, data.order.orderNumber);
    } catch (caught) {
      setNotice({
        kind: "error",
        text: caught instanceof Error ? caught.message : "ไม่สามารถอัปเดตข้อมูลได้",
      });
    } finally {
      setRefreshing(false);
    }
  }

  async function submitSlip() {
    if (!data?.order || !slipFile || !idToken || !customerCode) {
      setNotice({ kind: "error", text: "กรุณาเลือกหลักฐานการชำระเงินก่อน" });
      return;
    }
    if (data.order.status !== "awaiting_payment") return;

    setSubmitting(true);
    setNotice(null);
    try {
      // Keep the existing API contract: multipart POST sends the uploaded slip.
      const formData = new FormData();
      formData.append("idToken", idToken);
      formData.append("customerCode", customerCode);
      formData.append("orderNumber", String(data.order.orderNumber));
      formData.append("file", slipFile);

      const response = await fetch("/api/line/payment", {
        method: "POST",
        body: formData,
      });
      const result = (await response.json()) as PaymentResponse;
      if (!response.ok) {
        throw new Error(result.error ?? "ไม่สามารถส่งหลักฐานการชำระเงินได้");
      }

      clearSlip();
      setNotice({ kind: "success", text: "ส่งหลักฐานการชำระเงินเรียบร้อยแล้ว" });
      try {
        const refreshed = await loadPayment(idToken, customerCode, data.order.orderNumber);
        if (refreshed.order?.status === "awaiting_payment") {
          // The upload was accepted even if the read endpoint is briefly stale.
          setData((previous) => previous?.order ? {
            ...previous,
            order: { ...previous.order, status: "payment_submitted" },
          } : previous);
        }
      } catch {
        // Upload succeeded. Avoid offering a second submission while status refresh fails.
        setData((previous) => previous?.order ? {
          ...previous,
          order: { ...previous.order, status: "payment_submitted" },
        } : previous);
        setNotice({
          kind: "success",
          text: "ส่งหลักฐานแล้ว แต่ยังอัปเดตสถานะไม่ได้ กรุณารีเฟรชอีกครั้งในภายหลัง",
        });
      }
    } catch (caught) {
      setNotice({
        kind: "error",
        text: caught instanceof Error ? caught.message : "ไม่สามารถส่งหลักฐานการชำระเงินได้",
      });
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <LotusLoading message="กำลังโหลดข้อมูลการชำระเงิน..." />;
  }

  if (!data?.order || !data.customer) {
    return (
      <main className="min-h-screen bg-[#F6FAF8] p-5 text-[#173E31]">
        <div className="mx-auto max-w-md pt-5">
          <button type="button" onClick={goBack} className="flex min-h-11 items-center gap-1 font-bold text-[#008F8D]">
            <ArrowLeftIcon /> กลับไปหน้าคำสั่งซื้อ
          </button>
          <div className={`${cardClass} mt-5 p-6`}>
            <h1 className="text-xl font-extrabold">ไม่สามารถเปิดข้อมูลการชำระเงินได้</h1>
            <p role="alert" className="mt-3 text-sm leading-6 text-red-600">{error || "ไม่พบรายละเอียดการชำระเงินของคำสั่งซื้อนี้"}</p>
          </div>
        </div>
      </main>
    );
  }

  const order = data.order;
  const files = data.files;
  const canSubmit = order.status === "awaiting_payment";
  const submitted = order.status === "payment_submitted";
  const completed = order.status === "completed";
  const cancelled = order.status === "cancelled";
  const dateText = deliveryDateText(order.deliveryDate);

  const statusLabel = cancelled ? "ยกเลิก" : completed ? "เสร็จสิ้น" : submitted ? "รอตรวจสอบสลิป" : canSubmit ? "รอชำระเงิน" : "กำลังดำเนินการ";
  const statusClass = cancelled
    ? "border-red-200 bg-red-50 text-red-700"
    : completed || submitted
      ? "border-[#BFE8DE] bg-[#E8F8F3] text-[#057D77]"
      : canSubmit
        ? "border-[#CDEBE5] bg-[#EDF9F6] text-[#008F8D]"
        : "border-[#DDE8E2] bg-[#F3F7F4] text-[#617A70]";

  return (
    <main className="min-h-screen bg-[#F6FAF8] pb-20 text-[#173E31]">
      <header className="sticky top-0 z-30 border-b border-[#E0EBE6] bg-white/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 py-3">
          <button type="button" onClick={goBack} aria-label="กลับไปหน้าคำสั่งซื้อ" className="grid h-11 w-11 place-items-center rounded-xl text-[#37665C] hover:bg-[#F0F8F5]">
            <ArrowLeftIcon />
          </button>
          <div className="text-center">
            <p className="text-xl font-black tracking-tight text-[#02B0AF]">Lotus<span className="text-[#FDBC16]">’s</span><span className="ml-1 text-base text-[#17453F]">B2B</span></p>
            <p className="text-[11px] font-semibold text-[#78958B]">รายละเอียดการชำระเงิน</p>
          </div>
          <button type="button" aria-label="รีเฟรชข้อมูลการชำระเงิน" disabled={refreshing || submitting} onClick={() => void refreshPayment()} className="grid h-11 w-11 place-items-center rounded-xl border border-[#E0EBE6] bg-[#F8FCFA] text-xl font-bold text-[#008F8D] disabled:opacity-40">
            <span aria-hidden="true" className={refreshing ? "inline-block animate-spin" : ""}>↻</span>
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-2xl space-y-4 px-3 pt-5 sm:px-5">
        <div className="px-1">
          <p className="text-xs font-bold tracking-wide text-[#7C978C]">การชำระเงิน</p>
          <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
            <h1 className="text-2xl font-black tracking-tight">คำสั่งซื้อ #{order.orderNumber}</h1>
            <span className={`rounded-full border px-3 py-1.5 text-xs font-extrabold ${statusClass}`}>{statusLabel}</span>
          </div>
          {(dateText || order.deliverySlot) && (
            <p className="mt-1 text-xs text-[#7B978B]">
              {dateText ? `กำหนดจัดส่ง ${dateText}` : ""}
              {dateText && order.deliverySlot ? " · " : ""}
              {order.deliverySlot ?? ""}
            </p>
          )}
        </div>

        {notice && (
          <div role="status" className={`rounded-2xl border px-4 py-3 text-sm font-semibold leading-6 ${notice.kind === "success" ? "border-[#BCE7D7] bg-[#ECF9F4] text-[#087B69]" : "border-red-200 bg-red-50 text-red-700"}`}>
            {notice.text}
          </div>
        )}

        <section className="overflow-hidden rounded-[22px] border-2 border-[#BDE5DE] bg-gradient-to-br from-[#ECFAF6] via-white to-white p-5 shadow-[0_5px_20px_rgba(0,105,100,0.07)] sm:p-6">
          <p className="text-sm font-bold text-[#55786A]">ยอดสุทธิที่ต้องชำระ</p>
          <div className="mt-2 break-words text-4xl font-black tracking-tight text-[#009F9D] sm:text-[42px]">
            {order.finalAmount === null ? "รอยอดสุทธิ" : `฿${money(order.finalAmount)}`}
          </div>
          <div className="mt-4 h-px bg-[#DDECE6]" />
          <p className="mt-3 text-xs leading-5 text-[#718F81]">
            {order.finalAmount === null
              ? "ทีมงานจะยืนยันยอดชำระหลังออกบิล กรุณาตรวจสอบยอดจากบิลก่อนโอนเงิน"
              : "ยอดชำระตามคำสั่งซื้อ โปรดตรวจสอบรายละเอียดในบิลที่ทีมงานแนบไว้"}
          </p>
          {canSubmit && (
            <a href="#upload-slip" className="mt-4 inline-flex min-h-10 items-center gap-1 rounded-xl bg-[#02B0AF] px-4 py-2 text-sm font-extrabold text-white shadow-sm">
              แนบสลิปการโอนเงิน <span aria-hidden="true">↓</span>
            </a>
          )}
        </section>

        {(submitted || completed) && (
          <section className={`${cardClass} border-[#B8E5D9] bg-[#F5FCF9] p-5`}>
            <div className="flex items-start gap-3">
              <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[#02B0AF] text-white"><CheckIcon /></div>
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-extrabold text-[#0A746F]">
                  {completed ? "คำสั่งซื้อเสร็จสิ้นแล้ว" : "ได้รับหลักฐานการชำระเงินแล้ว"}
                </h2>
                <p className="mt-1 text-sm leading-6 text-[#547A6C]">
                  {completed ? "ทีมงานได้ตรวจสอบการชำระเงินและปิดคำสั่งซื้อแล้ว" : "ทีมงานกำลังตรวจสอบสลิป คุณไม่จำเป็นต้องส่งซ้ำ"}
                </p>
                {files?.paymentSlip && (
                  <a href={files.paymentSlip.url} target="_blank" rel="noreferrer" className="mt-3 inline-flex min-h-10 items-center font-bold text-[#008F8D] underline underline-offset-4">
                    ดูสลิปที่ส่งไว้
                  </a>
                )}
              </div>
            </div>
          </section>
        )}

        {cancelled && (
          <section className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
            คำสั่งซื้อนี้ถูกยกเลิกแล้ว ไม่ต้องดำเนินการชำระเงิน
          </section>
        )}

        {!cancelled && (
          <section className={`${cardClass} p-5 sm:p-6`}>
            <div className="flex items-start gap-3">
              {canSubmit && <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#FFF2C5] text-sm font-black text-[#8E6400]">1</span>}
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-black">{canSubmit ? "สแกน QR เพื่อชำระเงิน" : "QR สำหรับชำระเงิน"}</h2>
                <p className="mt-1 text-xs leading-5 text-[#82998F]">รูป QR นี้จัดเตรียมและอัปโหลดโดยทีมงาน Lotus’s</p>
              </div>
            </div>

            {files?.paymentQr ? (
              <>
                <div className="mx-auto mt-5 w-full max-w-[340px] rounded-2xl border border-[#E4EEE9] bg-white p-3 shadow-sm">
                  <img src={files.paymentQr.url} alt="QR สำหรับชำระเงินที่ทีมงานอัปโหลด" loading="lazy" className="mx-auto max-h-[390px] w-full object-contain" />
                </div>
                <a href={files.paymentQr.url} target="_blank" rel="noreferrer" className="mt-4 flex min-h-12 w-full items-center justify-center rounded-xl border-2 border-[#BDE4DD] bg-[#F1FAF7] px-4 py-3 text-sm font-extrabold text-[#008F8D]">
                  เปิดรูป QR เต็มขนาด ↗
                </a>
                {canSubmit && (
                  <p className="mt-3 text-center text-xs leading-5 text-[#7A9285]">หลังชำระเงินแล้ว โปรดแนบสลิปในขั้นตอนถัดไป</p>
                )}
              </>
            ) : (
              <div className="mt-5 rounded-2xl border border-dashed border-[#C5DDD4] bg-[#F4FAF7] p-6 text-center">
                <p className="font-bold text-[#5D8072]">ยังไม่มีรูป QR สำหรับชำระเงิน</p>
                <p className="mt-2 text-xs leading-5 text-[#8AA096]">ทีมงานจะอัปโหลด QR หลังออกบิล คุณสามารถกดรีเฟรชเพื่อตรวจสอบอีกครั้ง</p>
              </div>
            )}
          </section>
        )}

        <section className={`${cardClass} p-5 sm:p-6`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-black">บิลค่าสินค้า</h2>
              <p className="mt-1 text-xs leading-5 text-[#82998F]">เอกสารยอดสุทธิที่ทีมงานอัปโหลด</p>
            </div>
            <span className="rounded-lg bg-[#ECF7F3] px-2.5 py-1 text-[11px] font-bold text-[#318078]">ใบแจ้งยอด</span>
          </div>

          {files?.bill ? (
            <>
              {isImage(files.bill) ? (
                <div className="mt-4 overflow-hidden rounded-xl border border-[#E2EBE6] bg-[#F8FAF9] p-2">
                  <img src={files.bill.url} alt="บิลค่าสินค้าจากทีมงาน" loading="lazy" className="mx-auto max-h-[450px] w-full object-contain" />
                </div>
              ) : (
                <div className="mt-4 rounded-xl border border-[#E2EBE6] bg-[#F8FAF9] p-4 text-sm font-semibold text-[#617F73]">{files.bill.name || "เอกสารบิลค่าสินค้า"}</div>
              )}
              <a href={files.bill.url} target="_blank" rel="noreferrer" className="mt-3 flex min-h-12 w-full items-center justify-center rounded-xl border border-[#DCEBE4] px-4 py-3 text-sm font-extrabold text-[#008F8D]">
                เปิดดูบิลเต็มขนาด ↗
              </a>
            </>
          ) : (
            <div className="mt-4 rounded-xl border border-dashed border-[#CFDFD6] bg-[#F8FBF9] px-4 py-6 text-center text-sm text-[#839A8E]">ทีมงานยังไม่ได้แนบบิล</div>
          )}
        </section>

        {canSubmit && (
          <section id="upload-slip" className={`${cardClass} scroll-mt-24 border-2 border-[#9DDBD2] p-5 sm:p-6`}>
            <div className="flex items-start gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#E0F6EF] text-sm font-black text-[#008F8D]">2</span>
              <div>
                <h2 className="text-lg font-black">แนบหลักฐานการชำระเงิน</h2>
                <p className="mt-1 text-xs leading-5 text-[#82998F]">หลังโอนเงินสำเร็จ โปรดอัปโหลดรูปสลิปหรือไฟล์ PDF</p>
              </div>
            </div>

            <input
              ref={inputRef}
              id="payment-slip-file"
              type="file"
              accept="image/*,application/pdf"
              onChange={(event) => {
                setSlipFile(event.currentTarget.files?.[0] ?? null);
                setNotice(null);
              }}
              className="sr-only"
              aria-label="เลือกไฟล์หลักฐานการชำระเงิน"
            />

            <label htmlFor="payment-slip-file" className="mt-5 flex min-h-[144px] cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-[#9BDCD1] bg-[#F5FCF9] px-4 py-5 text-center transition hover:bg-[#EBF9F4]">
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-white text-[#02B0AF] shadow-sm"><UploadIcon /></span>
              <span className="mt-3 text-sm font-extrabold text-[#007F7D]">{slipFile ? "เปลี่ยนไฟล์สลิป" : "แตะเพื่อเลือกรูปสลิป"}</span>
              <span className="mt-1 text-xs text-[#86A095]">รองรับรูปภาพและ PDF</span>
            </label>

            {slipFile && (
              <div className="mt-3 overflow-hidden rounded-xl border border-[#CDE5DC] bg-white p-3">
                <div className="flex items-start gap-3">
                  {slipPreview ? (
                    <img src={slipPreview} alt="ตัวอย่างสลิปที่เลือก" className="h-20 w-20 shrink-0 rounded-lg border border-[#E3ECE6] bg-[#F8FAF8] object-contain" />
                  ) : (
                    <div className="grid h-16 w-16 shrink-0 place-items-center rounded-lg bg-[#EDF7F3] text-xs font-black text-[#008F8D]">PDF</div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="break-all text-sm font-bold text-[#235548]">{slipFile.name}</p>
                    <p className="mt-1 text-xs text-[#82998F]">{(slipFile.size / 1024 / 1024).toFixed(2)} MB</p>
                    <button type="button" onClick={clearSlip} className="mt-2 min-h-8 text-xs font-bold text-red-600 underline underline-offset-2">นำไฟล์ออก</button>
                  </div>
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={() => void submitSlip()}
              disabled={submitting || !slipFile}
              className="mt-4 flex min-h-14 w-full items-center justify-center rounded-2xl bg-[#02B0AF] px-5 py-4 text-base font-black text-white shadow-[0_4px_12px_rgba(0,165,158,0.2)] transition active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-[#B9DAD3] disabled:shadow-none"
            >
              {submitting ? "กำลังส่งหลักฐาน..." : "ยืนยันและส่งสลิป"}
            </button>
            <p className="mt-3 text-center text-[11px] leading-5 text-[#82998F]">เมื่อส่งสลิปแล้ว ทีมงานจะตรวจสอบยอดชำระและอัปเดตสถานะคำสั่งซื้อ</p>
          </section>
        )}

        <details className={`${cardClass} group`}>
          <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-3 p-5 marker:content-none">
            <div>
              <h2 className="text-sm font-extrabold">หลักฐานการจัดส่ง</h2>
              <p className="mt-1 text-xs text-[#82998F]">รูปภาพจากทีมจัดส่ง</p>
            </div>
            <span className="text-xl font-bold text-[#008F8D] transition group-open:rotate-180">⌄</span>
          </summary>
          <div className="border-t border-[#E8F0EA] px-5 pb-5 pt-4">
            {files?.deliveryProof ? (
              <>
                {isImage(files.deliveryProof) && (
                  <img src={files.deliveryProof.url} alt="หลักฐานการจัดส่ง" loading="lazy" className="mx-auto max-h-[390px] w-full rounded-xl border border-[#E6EEE9] object-contain" />
                )}
                <a href={files.deliveryProof.url} target="_blank" rel="noreferrer" className="mt-3 block rounded-xl border border-[#D6E8E2] px-4 py-3 text-center text-sm font-bold text-[#008F8D]">เปิดหลักฐานการจัดส่ง ↗</a>
              </>
            ) : (
              <p className="text-sm text-[#8BA197]">ยังไม่มีหลักฐานการจัดส่ง</p>
            )}
          </div>
        </details>

        <button type="button" onClick={goBack} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl text-sm font-bold text-[#547D70]">
          <ArrowLeftIcon /> กลับไปหน้าคำสั่งซื้อ
        </button>
      </div>
    </main>
  );
}
