"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import LotusLoading from "../../../components/LotusLoading";
import LotusBrand from "@/components/LotusBrand";

type Customer = {
  id: string;
  customerCode: string;
  customerName: string;
};

type OrderItem = {
  id: string;
  productName: string;
  imageUrl?: string | null;
  unit: string;
  requested: number | null;
  confirmed: number | null;
  actual: number | null;
  estimatedSubtotal?: number | null;
  unitPrice?: number | null;
  priceIsCurrentEstimate?: boolean;
};

type Order = {
  id: string;
  orderNumber: number;
  displayNumber?: string;
  groupRootNumber?: number | null;
  groupSequence?: number | null;
  paymentRootOrderNumber?: number;
  status: string;
  createdAt: string;
  deliveryDate: string | null;
  deliverySlot: string | null;
  deliveryAddress: string | null;
  finalAmount: number | null;
  estimatedAmount?: number | null;
  items: OrderItem[];
};

type APIResponse = {
  customer?: Customer;
  customers?: Customer[];
  needsCustomerSelection?: boolean;
  mode?: "active" | "history";
  orders?: Order[];
  error?: string;
};

const TRACKING_STEPS = [
  "ได้รับคำสั่งซื้อ",
  "ยืนยันคำสั่งซื้อ",
  "กำลังเตรียมสินค้า",
  "กำลังจัดส่ง",
  "ชำระเงิน",
  "เสร็จสิ้น",
];

function currentStep(status: string) {
  switch (status) {
    case "awaiting_confirmation": return 0;
    case "awaiting_picking": return 1;
    case "picking":
    case "awaiting_billing":
    case "ready_for_delivery": return 2;
    case "out_for_delivery": return 3;
    case "awaiting_payment":
    case "payment_submitted": return 4;
    case "completed": return 5;
    default: return 0;
  }
}

function statusName(status: string) {
  const names: Record<string, string> = {
    awaiting_confirmation: "ได้รับคำสั่งซื้อ",
    awaiting_picking: "ยืนยันคำสั่งซื้อ",
    picking: "กำลังเตรียมสินค้า",
    awaiting_billing: "กำลังเตรียมสินค้า",
    ready_for_delivery: "กำลังเตรียมสินค้า",
    out_for_delivery: "กำลังจัดส่ง",
    awaiting_payment: "รอชำระเงิน",
    payment_submitted: "ส่งหลักฐานการชำระเงินแล้ว",
    completed: "เสร็จสิ้น",
    cancelled: "ยกเลิก",
  };
  return names[status] ?? status;
}

function formatDate(date: string | null) {
  if (!date) return "—";
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("th-TH-u-ca-gregory", {
    day: "numeric", month: "short", year: "numeric",
  }).format(new Date(year, month - 1, day));
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("th-TH-u-ca-gregory", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function quantityText(value: number | null, unit: string) {
  if (value === null) return "—";
  return `${new Intl.NumberFormat("th-TH", { maximumFractionDigits: 3 }).format(value)} ${unit}`;
}

function money(value: number) {
  return new Intl.NumberFormat("th-TH", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(value);
}

function badgeStyle(status: string) {
  if (status === "cancelled") return "border-red-200 bg-red-50 text-red-700";
  if (status === "completed") return "border-[#BCE6CF] bg-[#E7F8EE] text-[#14805D]";
  if (status === "awaiting_payment") return "border-[#F5D78D] bg-[#FFF6DA] text-[#946500]";
  if (status === "payment_submitted") return "border-[#C4DAF5] bg-[#EEF6FF] text-[#376C9C]";
  return "border-[#BCE9E4] bg-[#E8F8F6] text-[#008F8D]";
}

export default function CustomerOrdersPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"active" | "history">("active");
  const [customerCode, setCustomerCode] = useState("");
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [availableCustomers, setAvailableCustomers] = useState<Customer[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [idToken, setIdToken] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState("");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [expandedOrders, setExpandedOrders] = useState<Record<string, boolean>>({});

  const card = "overflow-hidden rounded-2xl border-2 border-[#A9DAD1] bg-white shadow-[0_5px_18px_rgba(0,120,115,0.12)]";

  function goCustomerHome() {
    const code = customer?.customerCode ?? customerCode;
    if (!code) {
      router.push("/miniapp?portal=customer");
      return;
    }
    router.push(`/miniapp?portal=customer&customer=${encodeURIComponent(code)}`);
  }

  async function loadOrders(
    token: string,
    selectedMode: "active" | "history",
    selectedCustomerCode: string,
    quiet = false
  ) {
    if (!quiet) setRefreshing(true);
    try {
      const response = await fetch("/api/line/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idToken: token,
          mode: selectedMode,
          customerCode: selectedCustomerCode || undefined,
        }),
      });
      const data = (await response.json()) as APIResponse;
      if (!response.ok) throw new Error(data.error ?? "ไม่สามารถโหลดคำสั่งซื้อได้");

      if (data.needsCustomerSelection) {
        setAvailableCustomers(data.customers ?? []);
        setCustomer(null);
        setOrders([]);
        setLastUpdated(new Date());
        return;
      }

      setCustomer(data.customer ?? null);
      setAvailableCustomers(data.customers ?? []);
      setOrders(data.orders ?? []);
      if (data.customer?.customerCode) setCustomerCode(data.customer.customerCode);
      setMessage("");
      setLastUpdated(new Date());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "ไม่สามารถโหลดคำสั่งซื้อได้");
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function initialize() {
      try {
        const params = new URLSearchParams(window.location.search);
        const requestedMode = params.get("view") === "history" ? "history" : "active";
        const requestedCustomer = (params.get("customer") ?? "").trim().toUpperCase();
        setMode(requestedMode);
        setCustomerCode(requestedCustomer);

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
        await loadOrders(token, requestedMode, requestedCustomer, true);
      } catch (error) {
        if (!cancelled) setMessage(error instanceof Error ? error.message : "ไม่สามารถเชื่อมต่อกับ LINE ได้");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void initialize();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!idToken || mode !== "active" || !customer) return;
    const interval = window.setInterval(() => {
      void loadOrders(idToken, mode, customer.customerCode, true);
    }, 30_000);
    return () => window.clearInterval(interval);
  }, [idToken, mode, customer?.customerCode]);

  async function chooseCustomer(selected: Customer) {
    setCustomerCode(selected.customerCode);
    await loadOrders(idToken, mode, selected.customerCode);
    window.history.replaceState({}, "", `/miniapp/orders?customer=${encodeURIComponent(selected.customerCode)}&view=${mode}`);
  }

  async function changeMode(nextMode: "active" | "history") {
    if (nextMode === mode) return;
    setMode(nextMode);
    // Clear the previous tab immediately; don't leave stale orders on screen.
    setOrders([]);
    setRefreshing(true);
    setMessage("");
    const code = customer?.customerCode ?? customerCode;
    window.history.replaceState({}, "", `/miniapp/orders?view=${nextMode}${code ? `&customer=${encodeURIComponent(code)}` : ""}`);
    if (idToken) await loadOrders(idToken, nextMode, code);
  }

  function toggleExpanded(id: string) {
    setExpandedOrders((previous) => ({ ...previous, [id]: !previous[id] }));
  }

  if (loading) {
    return <LotusLoading message="กำลังโหลดคำสั่งซื้อ..." />;
  }

  if (message && !customer) {
    return (
      <main className="min-h-screen bg-[#F7FAFA] p-5 text-[#173E31]">
        <div className="mx-auto max-w-md">
          <button type="button" onClick={goCustomerHome} className="font-bold text-[#008F8D]">‹ หน้าหลักลูกค้า</button>
          <div className={`${card} mt-5 p-6`}>
            <h1 className="text-xl font-extrabold">ไม่สามารถโหลดคำสั่งซื้อได้</h1>
            <p className="mt-3 text-sm text-red-600">{message}</p>
          </div>
        </div>
      </main>
    );
  }

  if (!customer && availableCustomers.length > 1) {
    return (
      <main className="min-h-screen bg-[#F7FAFA] p-5 text-[#173E31]">
        <div className="mx-auto max-w-md">
          <button type="button" onClick={() => router.push("/miniapp?portal=customer")} className="text-sm font-bold text-[#008F8D]">‹ หน้าลูกค้า</button>
          <h1 className="mt-5 text-2xl font-extrabold">เลือกบัญชีลูกค้า</h1>
          <p className="mt-1 mb-5 text-sm text-[#82968D]">เลือกบัญชีที่ต้องการดูคำสั่งซื้อ</p>
          <div className="space-y-3">
            {availableCustomers.map((option) => (
              <button key={option.id} type="button" onClick={() => void chooseCustomer(option)} className={`${card} w-full p-5 text-left transition hover:border-[#02B0AF]`}>
                <p className="font-extrabold">{option.customerName}</p>
                <p className="mt-1 text-xs text-[#82968D]">รหัสลูกค้า {option.customerCode}</p>
                <p className="mt-3 text-sm font-bold text-[#009F9D]">ดูคำสั่งซื้อ →</p>
              </button>
            ))}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#F7FAFA] pb-24 text-[#173E31]">
      <header className="sticky top-0 z-30 border-b border-[#E1EBE5] bg-white/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <button type="button" onClick={goCustomerHome} className="min-h-11 rounded-xl px-2 text-sm font-bold text-[#426559]">‹ หน้าแรก</button>
          <div className="text-center">
            <LotusBrand size="sm" align="center" />
            <p className="text-[10px] text-[#82968D]">คำสั่งซื้อของฉัน</p>
          </div>
          <button type="button" aria-label="รีเฟรชคำสั่งซื้อ" disabled={refreshing || !idToken} onClick={() => void loadOrders(idToken, mode, customer?.customerCode ?? customerCode)} className="grid h-11 w-11 place-items-center rounded-2xl border border-[#DDE9E2] bg-[#F6FBF8] text-xl text-[#008F8D] disabled:opacity-40">{refreshing ? "…" : "↻"}</button>
        </div>
      </header>

      <div className="mx-auto max-w-3xl space-y-4 px-3 pt-4 sm:px-5">
        <div className="px-1">
          <h1 className="text-xl font-extrabold sm:text-2xl">คำสั่งซื้อของฉัน</h1>
          <p className="mt-1 text-sm text-[#82968D]">ติดตามสถานะและดูรายการสินค้าที่สั่งซื้อ</p>
          {lastUpdated && <p className="mt-2 text-[11px] text-[#96AAA0]">อัปเดตล่าสุด {lastUpdated.toLocaleTimeString("th-TH-u-ca-gregory", { hour: "2-digit", minute: "2-digit" })}</p>}
        </div>

        <div className="grid grid-cols-2 gap-1 rounded-2xl bg-[#EAF5F2] p-1.5">
          <button type="button" onClick={() => void changeMode("active")} className={`min-h-12 rounded-xl px-3 text-sm font-extrabold transition ${mode === "active" ? "bg-white text-[#009F9D] shadow-sm" : "text-[#82988D]"}`}>กำลังดำเนินการ</button>
          <button type="button" onClick={() => void changeMode("history")} className={`min-h-12 rounded-xl px-3 text-sm font-extrabold transition ${mode === "history" ? "bg-white text-[#009F9D] shadow-sm" : "text-[#82988D]"}`}>ประวัติคำสั่งซื้อ</button>
        </div>

        {message && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{message}</div>}

        {refreshing && orders.length === 0 ? (
          <div className={`${card} flex items-center justify-center gap-3 px-5 py-12`}>
            <div className="h-7 w-7 animate-spin rounded-full border-[3px] border-[#C9E9E3] border-t-[#02B0AF]" />
            <p className="text-sm font-semibold text-[#66887A]">กำลังโหลด{mode === "active" ? "คำสั่งซื้อปัจจุบัน" : "ประวัติคำสั่งซื้อ"}...</p>
          </div>
        ) : orders.length === 0 ? (
          <div className={`${card} px-6 py-12 text-center`}>
            <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-[#E6F8F3] text-3xl">📋</div>
            <h2 className="mt-4 text-lg font-extrabold">{mode === "active" ? "ไม่มีคำสั่งซื้อที่กำลังดำเนินการ" : "ยังไม่มีประวัติคำสั่งซื้อ"}</h2>
            <p className="mt-2 text-sm text-[#82968D]">{mode === "active" ? "คำสั่งซื้อใหม่ของคุณจะแสดงที่นี่" : "คำสั่งซื้อที่เสร็จสิ้นหรือถูกยกเลิกจะแสดงที่นี่"}</p>
            {mode === "active" && customer && <button type="button" onClick={() => router.push(`/miniapp/shop?customer=${encodeURIComponent(customer.customerCode)}`)} className="mt-6 rounded-xl bg-[#02B0AF] px-6 py-3 text-sm font-bold text-white">เลือกซื้อสินค้า →</button>}
          </div>
        ) : (
          <div className="space-y-4">
            {orders.map((order) => {
              const step = currentStep(order.status);
              // History cards keep product details visible without another tap.
              const expanded = mode === "history" || Boolean(expandedOrders[order.id]);
              const cancelled = order.status === "cancelled";
              return (
                <section key={order.id} className={card}>
                  <div className="border-b border-[#EDF2EE] p-4 sm:p-5">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-[11px] font-semibold text-[#8BA096]">หมายเลขคำสั่งซื้อ</p>
                        <h2 className="mt-0.5 text-2xl font-black text-[#009F9D]">#{order.displayNumber ?? order.orderNumber}</h2>
                         {order.groupSequence && (
                           <p className="mt-1 text-xs font-bold text-[#47776A]">
                             จัดส่งร่วมกัน กลุ่ม #{order.groupRootNumber}
                             {order.groupSequence===1 ? " · ออกบิลและชำระเงินที่คำสั่งซื้อนี้" : " · ออกบิลรวมที่คำสั่งซื้อหลัก"}
                           </p>
                         )}
                        <p className="mt-1 text-xs text-[#94A69B]">สั่งเมื่อ {formatTimestamp(order.createdAt)}</p>
                      </div>
                      <span className={`max-w-[55%] rounded-full border px-3 py-1.5 text-center text-xs font-extrabold ${badgeStyle(order.status)}`}>{statusName(order.status)}</span>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl border border-[#D5EBE5] bg-[#F0FAF7] p-3">
                      <div>
                        <p className="text-[11px] text-[#80998B]">กำหนดจัดส่ง</p>
                        <p className="mt-1 text-xs font-bold">{formatDate(order.deliveryDate)}</p>
                        {order.deliverySlot && <p className="mt-0.5 text-[11px] text-[#728D7C]">{order.deliverySlot}</p>}
                      </div>
                      <div className="text-right">
                        {order.status === "awaiting_payment" && customer && (!order.groupSequence || order.groupSequence===1) ? (
                          <button type="button" onClick={() => router.push(`/miniapp/payment?customer=${encodeURIComponent(customer.customerCode)}&order=${order.paymentRootOrderNumber ?? order.orderNumber}`)} className="w-full rounded-xl bg-[#FDBC16] px-2 py-3 text-sm font-black text-[#5B4200] shadow-sm">ชำระเงินตอนนี้ →</button>
                        ) : (
                          <>
                            <p className="text-[11px] text-[#80998B]">{order.finalAmount !== null ? "ยอดสุทธิ" : "ยอดประมาณการ"}</p>
                            <p className="mt-1 text-lg font-black text-[#009F9D]">{order.finalAmount !== null ? `฿${money(order.finalAmount)}` : order.estimatedAmount !== null && order.estimatedAmount !== undefined ? `~฿${money(order.estimatedAmount)}` : "ยังไม่มีราคา"}</p>
                            {order.finalAmount === null && <p className="mt-1 text-[10px] leading-4 text-[#68877C]">* ยอดประมาณการ อาจเปลี่ยนหลังหยิบและออกบิล</p>}
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {mode === "active" && (cancelled ? (
                    <div className="border-b border-[#EDF2EE] p-4 sm:p-5">
                      <div className="rounded-xl border border-red-200 bg-red-50 p-3">
                        <p className="text-sm font-bold text-red-700">คำสั่งซื้อนี้ถูกยกเลิก</p>
                        <p className="mt-1 text-xs leading-5 text-red-600">คำสั่งซื้อนี้จะไม่ถูกดำเนินการต่อ และถูกเก็บไว้ในประวัติคำสั่งซื้อ</p>
                      </div>
                    </div>
                  ) : (
                    <div className="border-b border-[#EDF2EE] px-4 py-4 sm:px-5">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-bold text-[#4D7563]">ความคืบหน้าคำสั่งซื้อ</p>
                        <p className="text-xs font-bold text-[#009F9D]">{step + 1} / {TRACKING_STEPS.length}</p>
                      </div>
                      <div className="mt-3 grid grid-cols-6 gap-1">
                        {TRACKING_STEPS.map((label, index) => <div key={label} aria-label={label} className={`h-2 rounded-full ${index <= step ? "bg-[#02B0AF]" : "bg-[#E3EEE7]"}`} />)}
                      </div>
                      <p className="mt-2 text-sm font-extrabold text-[#008F8D]">{statusName(order.status)}</p>

                      {order.status === "payment_submitted" && customer && (!order.groupSequence || order.groupSequence===1) && (
                        <button type="button" onClick={() => router.push(`/miniapp/payment?customer=${encodeURIComponent(customer.customerCode)}&order=${order.paymentRootOrderNumber ?? order.orderNumber}`)} className="mt-4 min-h-12 w-full rounded-xl border-2 border-[#BDE5DF] bg-[#F3FBF8] px-4 py-3 text-sm font-bold text-[#008F8D]">ส่งหลักฐานแล้ว · ดูรายละเอียดการชำระเงิน</button>
                      )}
                    </div>
                  ))}

                  {mode === "history" ? (
                    <div className="flex min-h-12 items-center px-4 py-3 text-left text-sm font-extrabold text-[#426A57] sm:px-5">
                      รายการสินค้า ({order.items.length} รายการ)
                    </div>
                  ) : (
                    <button type="button" aria-expanded={expanded} onClick={() => toggleExpanded(order.id)} className="flex min-h-12 w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm font-extrabold text-[#426A57] sm:px-5">
                      <span>ดูรายละเอียดสินค้า ({order.items.length} รายการ)</span>
                      <span className="text-lg text-[#009F9D]">{expanded ? "⌃" : "⌄"}</span>
                    </button>
                  )}

                  {expanded && (
                    <div className="border-t border-[#EAF1EC] bg-[#FCFEFD] px-4 pb-4 pt-3 sm:px-5">
                      {mode === "active" && !cancelled && (
                        <div className="mb-4 rounded-xl bg-[#EDF8F5] p-3">
                          <p className="mb-3 text-xs font-bold text-[#4C7563]">ขั้นตอนการดำเนินการ</p>
                          <div className="space-y-2">
                            {TRACKING_STEPS.map((label, index) => (
                              <div key={label} className="flex items-center gap-3 text-xs">
                                <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full font-bold ${index <= step ? "bg-[#02B0AF] text-white" : "border border-[#DCE8DF] bg-white text-[#9AAC9F]"}`}>{index < step ? "✓" : index + 1}</span>
                                <span className={index <= step ? "font-bold text-[#285849]" : "text-[#9CAC9F]"}>{label}</span>
                                {index === step && <span className="ml-auto text-[10px] font-bold text-[#009F9D]">ปัจจุบัน</span>}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {order.items.length === 0 ? <p className="py-4 text-center text-xs text-[#82968D]">ไม่มีรายละเอียดสินค้า</p> : (
                        <div className="space-y-3">
                          {order.items.map((item) => (
                            <div key={item.id} className="rounded-xl border border-[#E4EEE7] bg-white p-3">
                              <div className="flex items-start gap-3">
                                <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl border border-[#E4EEE7] bg-[#F4F8F5]">
                                  <div className="absolute inset-0 grid place-items-center text-2xl text-[#92AA9D]">📦</div>
                                  {item.imageUrl && <img src={item.imageUrl} alt={item.productName} loading="lazy" decoding="async" className="absolute inset-0 h-full w-full bg-white object-contain p-1" onError={(event) => { event.currentTarget.style.display = "none"; }} />}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm font-bold">{item.productName}</p>
                                  {item.unitPrice !== null && item.unitPrice !== undefined && <p className="mt-1 text-xs font-semibold text-[#008F8D]">฿{money(item.unitPrice)} / {item.unit}</p>}
                                  {item.estimatedSubtotal !== null && item.estimatedSubtotal !== undefined && <p className="mt-1 text-sm font-extrabold text-[#009F9D]">รวมประมาณ ฿{money(item.estimatedSubtotal)}</p>}
                                  {item.priceIsCurrentEstimate && <p className="mt-1 text-[10px] text-[#82968D]">* ประเมินจากราคาปัจจุบัน</p>}
                                </div>
                              </div>
                              <div className="mt-3 grid grid-cols-3 divide-x divide-[#E6EEE8] text-center">
                                <div className="px-1"><p className="text-[10px] text-[#82968D]">สั่งซื้อ</p><p className="mt-1 text-xs font-bold">{quantityText(item.requested, item.unit)}</p></div>
                                <div className="px-1"><p className="text-[10px] text-[#82968D]">ยืนยัน</p><p className="mt-1 text-xs font-bold">{quantityText(item.confirmed, item.unit)}</p></div>
                                <div className="px-1"><p className="text-[10px] text-[#82968D]">หยิบจริง</p><p className="mt-1 text-xs font-bold">{quantityText(item.actual, item.unit)}</p></div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}

        {availableCustomers.length > 1 && customer && (
          <button type="button" onClick={() => router.push("/miniapp?portal=customer")} className="w-full py-3 text-center text-sm font-semibold text-[#5A8170] underline">เปลี่ยนบัญชีลูกค้า</button>
        )}
      </div>
    </main>
  );
}
