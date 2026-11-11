"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import LotusBrand from "@/components/LotusBrand";
import LotusLoading from "@/components/LotusLoading";
import { summarizeOutstandingPayments, type PaymentReadyOrder } from "@/lib/customerPayNow";
import { lineApiFetch } from "@/lib/lineSession";

type PendingPaymentsResponse = {
  pendingPayments?: PaymentReadyOrder[];
  error?: string;
};

function formatMoney(amount: number) {
  return amount.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function ArrowRightIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14m-6-6 6 6-6 6" />
    </svg>
  );
}

async function fetchPendingPayments(idToken: string, customerCode: string) {
  // The existing server endpoint checks this LINE identity's customer access.
  const response = await lineApiFetch("/api/line/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      idToken,
      customerCode,
      mode: "active",
      summaryOnly: true,
    }),
  });
  const result = (await response.json()) as PendingPaymentsResponse;
  if (!response.ok) {
    throw new Error(result.error ?? "ไม่สามารถโหลดบิลที่รอชำระเงินได้");
  }
  return result.pendingPayments ?? [];
}

export default function MiniAppPendingPaymentsPage() {
  const router = useRouter();
  const [customerCode, setCustomerCode] = useState("");
  const [idToken, setIdToken] = useState("");
  const [orders, setOrders] = useState<PaymentReadyOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      try {
        const params = new URLSearchParams(window.location.search);
        const code = (params.get("customer") ?? "").trim().toUpperCase();
        if (!code) throw new Error("ไม่พบรหัสลูกค้า");

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
        setCustomerCode(code);
        setIdToken(token);
        const payable = await fetchPendingPayments(token, code);
        if (cancelled) return;
        setOrders(payable);
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "ไม่สามารถโหลดรายการชำระเงินได้");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void initialize();
    return () => { cancelled = true; };
  }, []);

  async function refreshBills() {
    if (!customerCode || !idToken || refreshing) return;
    setRefreshing(true);
    setError("");
    try {
      setOrders(await fetchPendingPayments(idToken, customerCode));
    } catch (caught) {
      setOrders([]);
      setError(caught instanceof Error ? caught.message : "ไม่สามารถรีเฟรชบิลได้");
    } finally {
      setRefreshing(false);
    }
  }

  function openPayment(orderNumber: number) {
    router.push(`/miniapp/payment?customer=${encodeURIComponent(customerCode)}&order=${orderNumber}&from=payments`);
  }

  if (loading) return <LotusLoading message="กำลังโหลดบิลที่รอชำระเงิน..." />;

  const summary = summarizeOutstandingPayments(orders);

  return (
    <main className="min-h-screen bg-[#F6FAF8] pb-16 text-[#173E31]">
      <header className="border-b border-[#DCECE6] bg-white px-4 py-4">
        <div className="mx-auto max-w-xl">
          <LotusBrand size="sm" align="center" />
        </div>
      </header>

      <div className="mx-auto max-w-xl space-y-4 px-4 pt-5">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => router.push(`/miniapp?portal=customer&customer=${encodeURIComponent(customerCode)}`)}
            className="min-h-11 rounded-xl px-2 font-bold text-[#008F8D]"
          >
            ← กลับหน้าหลัก
          </button>
          <button
            type="button"
            disabled={!idToken || refreshing}
            onClick={() => void refreshBills()}
            className="min-h-11 rounded-xl border border-[#BCE1D7] bg-white px-4 text-sm font-bold text-[#008F8D] disabled:opacity-50"
          >
            {refreshing ? "กำลังรีเฟรช..." : "รีเฟรชบิล"}
          </button>
        </div>

        <div>
          <p className="text-xs font-bold text-[#77958A]">การชำระเงิน</p>
          <h1 className="mt-1 text-2xl font-black">เลือกบิลที่ต้องการชำระ</h1>
          <p className="mt-1 text-sm text-[#718D82]">เลือกชำระและส่งสลิปทีละคำสั่งซื้อ</p>
        </div>

        {orders.length > 0 && (
          <div className="rounded-2xl border border-[#E9C55F] bg-[#FFF0B4] px-5 py-4">
            <p className="text-sm font-bold text-[#65500B]">ยอดค้างชำระรวม · {summary.count} บิล</p>
            {summary.totalAmount === null ? (
              <p className="mt-1 text-sm font-bold text-[#65500B]">บางบิลยังไม่มีจำนวนเงิน กรุณาตรวจสอบแต่ละบิล</p>
            ) : (
              <p className="mt-1 text-[32px] font-black leading-tight tabular-nums text-[#173E31]">฿{formatMoney(summary.totalAmount)}</p>
            )}
          </div>
        )}

        {error && (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
            {error}
          </div>
        )}

        {orders.length === 0 && !error ? (
          <div className="rounded-2xl border border-[#D6E8E2] bg-white px-5 py-8 text-center text-[#627F73]">
            ไม่มีคำสั่งซื้อที่รอชำระเงินแล้ว
          </div>
        ) : (
          <div className="space-y-3">
            {orders.map((order) => (
              <button
                type="button"
                key={order.orderNumber}
                onClick={() => openPayment(order.orderNumber)}
                className="flex w-full items-center justify-between gap-4 rounded-2xl border-2 border-[#D6E8E2] bg-white px-4 py-5 text-left shadow-[0_4px_14px_rgba(0,83,78,0.06)] transition hover:border-[#02B0AF] active:scale-[0.99]"
                aria-label={`เลือกชำระคำสั่งซื้อ ${order.orderNumber}`}
              >
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-[#718D82]">คำสั่งซื้อ #{order.orderNumber}</span>
                  <span className="mt-1 block text-[26px] font-black tabular-nums text-[#173E31]">
                    {order.finalAmount === null ? "ตรวจสอบยอด" : `฿${formatMoney(order.finalAmount)}`}
                  </span>
                  <span className="mt-1 block text-xs font-bold text-[#008F8D]">ชำระเงิน / อัปโหลดสลิป</span>
                </span>
                <span aria-hidden="true" className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[#02B0AF] text-white">
                  <ArrowRightIcon />
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
