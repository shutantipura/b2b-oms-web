"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import LotusLoading from "../../../components/LotusLoading";
import LotusBrand from "@/components/LotusBrand";
import { lineApiFetch } from "../../../lib/lineSession";

type Customer = {
  id: string;
  customerCode: string;
  customerName: string;
  deliveryAddress: string;
};

type CheckoutItem = {
  id: string;
  sku: string;
  productName: string;
  imageUrl?: string | null;
  unit: string;
  quantity: number;
  normalPrice: number;
  effectivePrice: number;
  hasSpecialPrice: boolean;
  estimatedSubtotal: number;
};

type DeliveryOption = {
  date: string;
  slots: { value: string; label: string }[];
};

type MergeCandidate = {
  orderNumber: number;
  deliveryDate: string;
  deliverySlot: string;
  status: string;
  deliveryAddress?: string;
};

function mergeStatusLabel(status: string) {
  switch (status) {
    case "awaiting_confirmation": return "รอเช็คสต็อก";
    case "awaiting_picking": return "รอจัดสินค้า";
    case "picking": return "กำลังจัดสินค้า";
    case "awaiting_billing": return "รอออกบิล";
    default: return "ยังไม่เริ่มออกบิล";
  }
}

type CheckoutResponse = {
  customer?: Customer;
  items?: CheckoutItem[];
  deliveryOptions?: DeliveryOption[];
  success?: boolean;
  orderNumber?: number;
  merged?: boolean;
  grouped?: boolean;
  displayNumber?: string;
  mergeCandidates?: MergeCandidate[];
  error?: string;
};

type Cart = Record<string, number>;

const BRAND = "#02B0AF";
const formatMoney = (value: number) =>
  new Intl.NumberFormat("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);

const formatQuantity = (value: number) =>
  new Intl.NumberFormat("th-TH", {
    maximumFractionDigits: 3,
  }).format(value);

function isWebUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function prettyDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("th-TH-u-ca-gregory", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(year, month - 1, day));
}

export default function MiniAppCheckoutPage() {
  const router = useRouter();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [items, setItems] = useState<CheckoutItem[]>([]);
  const [imageByProductId, setImageByProductId] = useState<Record<string, string>>({});
  const [deliveryOptions, setDeliveryOptions] = useState<DeliveryOption[]>([]);
  const [fulfillmentMethod, setFulfillmentMethod] = useState<"delivery" | "pickup">("delivery");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [deliverySlot, setDeliverySlot] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [idToken, setIdToken] = useState("");
  const [cart, setCart] = useState<Cart>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [createdOrderNumber, setCreatedOrderNumber] = useState<number | null>(null);
  const [wasMerged, setWasMerged] = useState(false);
  const [createdDisplayNumber, setCreatedDisplayNumber] = useState<string | null>(null);
  const [mergeCandidates, setMergeCandidates] = useState<MergeCandidate[]>([]);
  const [mergeIntoOrderNumber, setMergeIntoOrderNumber] = useState<number | null>(null);
  // When a same-day order exists, customers MUST explicitly choose to merge
  // or keep separate. Otherwise the old checkout silently created another order.
  const [mergeDecisionMade, setMergeDecisionMade] = useState(false);
  const [loadingMergeOptions, setLoadingMergeOptions] = useState(false);
  const [mergeOptionsError, setMergeOptionsError] = useState("");
  const [mergeRefreshTick, setMergeRefreshTick] = useState(0);
  const mergeRequestIdRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      try {
        const customerCode = (
          new URLSearchParams(window.location.search).get("customer") ?? ""
        ).trim().toUpperCase();
        if (!customerCode) throw new Error("ไม่ได้เลือกลูกค้า");

        const stored = localStorage.getItem(`b2b-cart-${customerCode}`);
        if (!stored) throw new Error("ตะกร้าสินค้าว่าง");

        let loadedCart: Cart;
        try {
          loadedCart = JSON.parse(stored) as Cart;
        } catch {
          throw new Error("ไม่สามารถอ่านข้อมูลตะกร้าสินค้าได้");
        }

        if (!Object.values(loadedCart).some((quantity) => Number(quantity) > 0)) {
          throw new Error("ตะกร้าสินค้าว่าง");
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

        const response = await lineApiFetch("/api/line/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "load",
            idToken: token,
            customerCode,
            cart: loadedCart,
          }),
        });
        const data = (await response.json()) as CheckoutResponse;
        if (!response.ok) {
          throw new Error(data.error ?? "ไม่สามารถโหลดหน้าตรวจสอบคำสั่งซื้อได้");
        }
        if (!data.customer) throw new Error("ไม่สามารถโหลดข้อมูลลูกค้าได้");
        if (cancelled) return;

        setIdToken(token);
        setCart(loadedCart);
        setCustomer(data.customer);
        setItems(data.items ?? []);

        // Reuse the catalogue's existing product-image mapping.
        // Image failure must never prevent a customer from checking out.
        try {
          const catalogResponse = await lineApiFetch("/api/line/catalog", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              idToken: token,
              customerCode,
              search: "",
              category: "",
              offset: 0,
              limit: 30,
              includeContext: true,
              cartProductIds: Object.keys(loadedCart).filter(
                (id) => Number(loadedCart[id]) > 0
              ),
            }),
          });
          if (catalogResponse.ok) {
            const catalogData = (await catalogResponse.json()) as {
              cartProducts?: { id: string; imageUrl: string | null; category: string | null }[];
            };
            if (!cancelled) {
              setImageByProductId(
                Object.fromEntries(
                  (catalogData.cartProducts ?? [])
                    .filter((product) => Boolean(product.imageUrl) && product.category?.trim() !== "สุราและยาสูบ")
                    .map((product) => [product.id, product.imageUrl as string])
                )
              );
            }
          }
        } catch (imageError) {
          console.warn("Product images unavailable:", imageError);
        }

        const options = data.deliveryOptions ?? [];
        setDeliveryOptions(options);
        setDeliveryAddress(data.customer.deliveryAddress ?? "");
        if (options[0]) {
          setDeliveryDate(options[0].date);
          setDeliverySlot(options[0].slots[0]?.value ?? "");
        }
      } catch (error) {
        if (cancelled) return;
        console.error("Checkout initialization:", error);
        setMessage(error instanceof Error ? error.message : "ไม่สามารถโหลดหน้าตรวจสอบคำสั่งซื้อได้");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void initialize();
    return () => { cancelled = true; };
  }, []);

  const currentSlots = useMemo(
    () => deliveryOptions.find((option) => option.date === deliveryDate)?.slots ?? [],
    [deliveryOptions, deliveryDate]
  );

  // Prompt for combining deliveries when the selected date already has
  // an order in Confirmation, Picking or awaiting Billing which has never
  // had its Billing task claimed.
  // Candidates may become ineligible after this check; the submit RPC
  // always rechecks inside the same transaction as the merge.
  useEffect(() => {
    if (!idToken || !customer || !deliveryDate || fulfillmentMethod === "pickup") {
      setMergeCandidates([]);
      setMergeIntoOrderNumber(null);
      setMergeDecisionMade(false);
      setLoadingMergeOptions(false);
      setMergeOptionsError("");
      return;
    }
    const controller = new AbortController();
    setLoadingMergeOptions(true);
    setMergeOptionsError("");
    setMergeCandidates([]);
    setMergeIntoOrderNumber(null);
    setMergeDecisionMade(false);
    mergeRequestIdRef.current = null;

    void (async () => {
      try {
        const response = await lineApiFetch("/api/line/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            action: "merge-options",
            idToken,
            customerCode: customer.customerCode,
            deliveryDate,
            cart,
          }),
        });
        const data = (await response.json()) as CheckoutResponse;
        if (!response.ok) throw new Error(data.error ?? "ไม่สามารถตรวจสอบคำสั่งซื้อเดิมได้");
        if (!controller.signal.aborted) setMergeCandidates(data.mergeCandidates ?? []);
      } catch (error) {
        if (!controller.signal.aborted) {
          setMergeOptionsError(error instanceof Error ? error.message : "ไม่สามารถตรวจสอบคำสั่งซื้อเดิมได้");
        }
      } finally {
        if (!controller.signal.aborted) setLoadingMergeOptions(false);
      }
    })();

    return () => controller.abort();
  }, [idToken, customer, deliveryDate, cart, mergeRefreshTick, fulfillmentMethod]);

  // Only offer the same primary delivery slot when that slot is still
  // selectable because its start time has not passed.
  const selectableMergeCandidates = useMemo(
    () => mergeCandidates.filter((candidate) =>
      fulfillmentMethod === "delivery" &&
      currentSlots.some((slot) => slot.value === candidate.deliverySlot)),
    [mergeCandidates, currentSlots, fulfillmentMethod]
  );

  const estimatedTotal = useMemo(
    () => items.reduce((total, item) => total + item.estimatedSubtotal, 0),
    [items]
  );

  function changeDate(value: string) {
    setDeliveryDate(value);
    setMergeIntoOrderNumber(null);
    setMergeDecisionMade(false);
    const option = deliveryOptions.find((item) => item.date === value);
    setDeliverySlot(option?.slots[0]?.value ?? "");
  }

  function chooseMerge(candidate: MergeCandidate | null) {
    setMergeIntoOrderNumber(candidate?.orderNumber ?? null);
    setMergeDecisionMade(true);
    mergeRequestIdRef.current = null;
    if (candidate) {
      // One delivery means we retain the PRIMARY order's time slot.
      setDeliverySlot(candidate.deliverySlot);
    }
  }

  function goShop() {
    if (!customer) {
      router.push("/miniapp?portal=customer");
      return;
    }
    router.push(`/miniapp/shop?customer=${encodeURIComponent(customer.customerCode)}`);
  }

  async function submitOrder() {
    if (!customer || !idToken || submitting) return;
    setMessage("");
    if (!deliveryDate) {
      setMessage(fulfillmentMethod === "pickup" ? "กรุณาเลือกวันที่รับสินค้าที่สาขา" : "กรุณาเลือกวันที่จัดส่ง");
      return;
    }
    if (!deliverySlot) {
      setMessage(fulfillmentMethod === "pickup" ? "กรุณาเลือกช่วงเวลารับสินค้า" : "กรุณาเลือกช่วงเวลาจัดส่ง");
      return;
    }
    if (fulfillmentMethod === "delivery" && !isWebUrl(deliveryAddress.trim())) {
      setMessage("ยังไม่ได้ตั้งค่าลิงก์ Google Maps สำหรับลูกค้ารายนี้ กรุณาติดต่อผู้จัดการ");
      return;
    }

    if (fulfillmentMethod === "delivery" && loadingMergeOptions) {
      setMessage("กำลังตรวจสอบคำสั่งซื้อเดิม กรุณาลองอีกครั้ง");
      return;
    }
    if (fulfillmentMethod === "delivery" && mergeOptionsError) {
      setMessage("ไม่สามารถตรวจสอบคำสั่งซื้อเดิมได้ กรุณากดลองใหม่ก่อนยืนยันคำสั่งซื้อ");
      return;
    }
    if (fulfillmentMethod === "delivery" && selectableMergeCandidates.length > 0 && !mergeDecisionMade) {
      setMessage("กรุณาเลือกว่าจะรวมคำสั่งซื้อกับคำสั่งซื้อเดิมหรือแยกจัดส่ง");
      return;
    }
    const chosenMerge = selectableMergeCandidates.find((candidate) => candidate.orderNumber === mergeIntoOrderNumber);
    if (mergeIntoOrderNumber && !chosenMerge) {
      setMessage("คำสั่งซื้อเดิมไม่สามารถรวมกับช่วงเวลาที่เลือกได้");
      return;
    }

    const confirmation = fulfillmentMethod === "pickup"
      ? `ยืนยันรับสินค้าที่สาขา ${prettyDate(deliveryDate)} เวลา ${deliverySlot} ยอดประมาณการ ฿${estimatedTotal.toFixed(2)} หรือไม่?\nหลังจากออกบิลแล้ว คำสั่งซื้อจะเข้าสู่ขั้นตอนชำระเงินโดยไม่ผ่านงานจัดส่ง`
      : chosenMerge
        ? `สร้างคำสั่งซื้อใหม่มูลค่าประมาณ ฿${estimatedTotal.toFixed(2)} เพื่อจัดส่งร่วมกับกลุ่ม #${chosenMerge.orderNumber} ใช่หรือไม่?\nสินค้าใหม่จะผ่านการเช็คสต็อกและจัดสินค้าแยกต่างหาก แล้วออกบิลและจัดส่งรวมครั้งเดียว`
        : `ยืนยันคำสั่งซื้อยอดประมาณการ ฿${estimatedTotal.toFixed(2)} หรือไม่?`;
    if (!window.confirm(confirmation)) return;
    if (chosenMerge && !mergeRequestIdRef.current) mergeRequestIdRef.current = crypto.randomUUID();
    setSubmitting(true);

    try {
      const response = await lineApiFetch("/api/line/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "submit",
          idToken,
          customerCode: customer.customerCode,
          cart,
          deliveryDate,
          deliverySlot,
          fulfillmentMethod,
          deliveryAddress: fulfillmentMethod === "pickup" ? "" : deliveryAddress.trim(),
          notes: notes.trim(),
          mergeIntoOrderNumber: chosenMerge?.orderNumber ?? null,
          requestId: chosenMerge ? mergeRequestIdRef.current : null,
        }),
      });
      const data = (await response.json()) as CheckoutResponse;
      if (!response.ok) {
        if (data.deliveryOptions) {
          const freshOptions = data.deliveryOptions;
          setDeliveryOptions(freshOptions);
          const selectionStillAvailable = freshOptions.some(
            (option) => option.date === deliveryDate &&
              option.slots.some((slot) => slot.value === deliverySlot)
          );
          if (!selectionStillAvailable) {
            const firstAvailable = freshOptions.find((option) => option.slots.length > 0);
            setDeliveryDate(firstAvailable?.date ?? "");
            setDeliverySlot(firstAvailable?.slots[0]?.value ?? "");
          }
        }
        throw new Error(data.error ?? "ไม่สามารถส่งคำสั่งซื้อได้");
      }
      if (!data.orderNumber) {
        throw new Error("ส่งคำสั่งซื้อสำเร็จ แต่ไม่สามารถอ่านหมายเลขคำสั่งซื้อได้");
      }

      // Preserve the existing behavior: clear the basket only after success.
      localStorage.removeItem(`b2b-cart-${customer.customerCode}`);
      setWasMerged(Boolean(data.grouped));
      setCreatedDisplayNumber(data.displayNumber ?? String(data.orderNumber));
      setCreatedOrderNumber(data.orderNumber);
    } catch (error) {
      console.error("Submit order:", error);
      setMessage(error instanceof Error ? error.message : "ไม่สามารถส่งคำสั่งซื้อได้");
    } finally {
      setSubmitting(false);
    }
  }

  const card = "rounded-2xl border border-[#DFEAE4] bg-white shadow-[0_2px_12px_rgba(0,120,115,0.045)]";
  const field = "mt-2 min-h-12 w-full rounded-xl border-2 border-[#D9E8E1] bg-white px-4 py-3 text-sm font-semibold text-[#173E31] outline-none focus:border-[#02B0AF] focus:ring-4 focus:ring-[#02B0AF]/10";

  if (loading) {
    return <LotusLoading message="กำลังตรวจสอบรายการสินค้า..." />;
  }

  if (!customer) {
    return (
      <main className="min-h-screen bg-[#F7FAFA] p-5 text-[#173E31]">
        <div className="mx-auto max-w-md">
          <button type="button" onClick={() => router.push("/miniapp")} className="text-sm font-bold text-[#008F8D]">‹ หน้าแรก</button>
          <div className={`${card} mt-5 p-6`}>
            <h1 className="text-xl font-extrabold">ไม่สามารถดำเนินการสั่งซื้อได้</h1>
            <p className="mt-3 text-sm text-red-600">{message}</p>
            <button type="button" onClick={goShop} className="mt-5 rounded-xl bg-[#02B0AF] px-5 py-3 text-sm font-bold text-white">กลับหน้าสินค้า</button>
          </div>
        </div>
      </main>
    );
  }

  if (createdOrderNumber !== null) {
    return (
      <main className="min-h-screen bg-[#F7FAFA] px-4 py-8 text-[#173E31]">
        <div className="mx-auto max-w-md">
          <div className={`${card} p-6 text-center sm:p-8`}>
            <div className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-[#E1F8F1] text-5xl font-black text-[#009F9D]">✓</div>
            <h1 className="mt-5 text-2xl font-extrabold">{wasMerged ? "สร้างคำสั่งซื้อร่วมจัดส่งเรียบร้อยแล้ว!" : "ได้รับคำสั่งซื้อแล้ว!"}</h1>
            <p className="mt-2 text-sm leading-6 text-[#748C80]">
              {wasMerged
                ? "สร้างคำสั่งซื้อย่อยสำเร็จแล้ว ทีมงานจะเช็คสต็อกและจัดสินค้าแยกจากคำสั่งซื้อเดิม เมื่อทุกคำสั่งซื้อจัดครบแล้วจึงออกบิลรวมและจัดส่งพร้อมกัน"
                : "ทีมงานได้รับคำสั่งซื้อแล้ว และจะเช็คสต็อกก่อนจัดสินค้า"}
            </p>
            <div className="mt-6 rounded-2xl border border-[#BDEAE3] bg-[#EDFAF8] p-5">
              <p className="text-xs font-semibold text-[#668B81]">หมายเลขคำสั่งซื้อ</p>
              <p className="mt-1 text-4xl font-black text-[#008F8D]">#{createdDisplayNumber ?? createdOrderNumber}</p>
              <span className="mt-3 inline-block rounded-full bg-[#FFF2C9] px-3 py-1 text-xs font-bold text-[#906300]">
                {wasMerged ? "รอเช็คสต็อกคำสั่งซื้อย่อย" : "รอทีมงานเช็คสต็อก"}
              </span>
            </div>
            <p className="mt-5 text-xs leading-5 text-[#82968D]">จำนวนสินค้าและยอดสุทธิอาจเปลี่ยนแปลงหลังการเช็คสต็อกและการจัดสินค้า</p>
            <button type="button" onClick={() => router.push(`/miniapp/orders?customer=${encodeURIComponent(customer.customerCode)}&view=active`)} className="mt-6 min-h-12 w-full rounded-xl bg-[#02B0AF] px-5 py-3 font-extrabold text-white">ติดตามคำสั่งซื้อ →</button>
            <button type="button" onClick={goShop} className="mt-3 min-h-12 w-full rounded-xl border-2 border-[#BDE5DF] bg-white px-5 py-3 font-bold text-[#008F8D]">สั่งสินค้าเพิ่ม</button>
            <button type="button" onClick={() => router.push("/miniapp")} className="mt-4 px-3 py-2 text-sm font-semibold text-[#789186]">กลับหน้าหลัก</button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#F7FAFA] pb-32 text-[#173E31]">
      <header className="sticky top-0 z-30 border-b border-[#E1EBE5] bg-white/95 backdrop-blur-md">
        <div className="mx-auto grid max-w-3xl grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 px-2.5 py-2.5 sm:gap-3 sm:px-4 sm:py-3">
          <button type="button" onClick={goShop} className="min-h-11 shrink-0 whitespace-nowrap rounded-xl px-1.5 text-[13px] font-bold text-[#426559] sm:px-2 sm:text-sm">‹ กลับ</button>
          <div className="miniapp-nav-brand min-w-0 text-center">
            <LotusBrand size="sm" align="center" />
            <p className="whitespace-nowrap text-[10px] font-medium text-[#82968D]">ตรวจสอบคำสั่งซื้อ</p>
          </div>
          <span className="shrink-0 whitespace-nowrap rounded-full bg-[#E5F8F5] px-2 py-1.5 text-[10px] font-bold text-[#009F9D] sm:px-3 sm:py-2 sm:text-xs">ขั้นตอนสุดท้าย</span>
        </div>
      </header>

      <div className="mx-auto max-w-3xl space-y-4 px-3 pt-4 sm:px-5">
        <div className="px-1">
          <h1 className="text-xl font-extrabold sm:text-2xl">ตรวจสอบคำสั่งซื้อ</h1>
          <p className="mt-1 text-sm text-[#82968D]">ตรวจสอบรายการและเลือกวิธีรับสินค้า วันและเวลาก่อนยืนยัน</p>
        </div>

        {message && (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{message}</div>
        )}

        <section className={`${card} overflow-hidden`}>
          <div className="flex items-center justify-between border-b border-[#E8F0EA] px-4 py-4 sm:px-5">
            <h2 className="font-extrabold">🛒 รายการสินค้า</h2>
            <span className="rounded-full bg-[#E4F8F6] px-3 py-1 text-xs font-bold text-[#009F9D]">{items.length} รายการ</span>
          </div>
          <div className="divide-y divide-[#EEF3EF]">
            {items.map((item) => (
              <div key={item.id} className="flex items-start justify-between gap-3 px-4 py-4 sm:px-5">
                <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl border border-[#E8F0EA] bg-[#F5F9F7] sm:h-24 sm:w-24">
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-[#9DB1A6]">
                    <span className="text-2xl">📦</span>
                    <span className="mt-1 text-[9px]">ไม่มีรูปสินค้า</span>
                  </div>
                  {imageByProductId[item.id] && (
                    <img
                      src={imageByProductId[item.id]}
                      alt={item.productName}
                      loading="lazy"
                      decoding="async"
                      className="absolute inset-0 h-full w-full bg-white object-contain p-1.5"
                      onError={(event) => { event.currentTarget.style.display = "none"; }}
                    />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold leading-5">{item.productName}</p>
                  <p className="mt-1 text-[11px] text-[#91A298]">SKU {item.sku}</p>
                  <p className="mt-1 text-xs text-[#678575]">{formatQuantity(item.quantity)} {item.unit} × <span className={(item.hasSpecialPrice && item.effectivePrice < item.normalPrice) ? "font-bold text-[#DC2626]" : ""}>฿{formatMoney(item.effectivePrice)}</span></p>
                  {(item.hasSpecialPrice && item.effectivePrice < item.normalPrice) && <span className="mt-2 inline-block rounded-md bg-[#FFF3D4] px-2 py-1 text-[10px] font-bold text-[#A47700]">ราคาพิเศษสำหรับคุณ</span>}
                </div>
                <strong className={`shrink-0 text-sm ${(item.hasSpecialPrice && item.effectivePrice < item.normalPrice) ? "text-[#DC2626]" : "text-[#009F9D]"}`}>฿{formatMoney(item.estimatedSubtotal)}</strong>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-[#DCEDE5] bg-[#EDF9F5] px-4 py-4 sm:px-5">
            <div>
              <p className="text-sm font-bold text-[#3D6654]">ยอดรวมประมาณการ</p>
              <p className="mt-1 text-[11px] text-[#79988A]">ยอดจริงขึ้นอยู่กับจำนวนที่หยิบได้</p>
            </div>
            <strong className="text-xl font-black text-[#008F8D]">฿{formatMoney(estimatedTotal)}</strong>
          </div>
        </section>

        <section className={`${card} p-4 sm:p-5`}>
          <h2 className="text-base font-extrabold">วิธีรับสินค้า</h2>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {([
              { value: "delivery", icon: "🚚", label: "จัดส่งถึงร้าน" },
              { value: "pickup", icon: "🏬", label: "รับที่สาขา" },
            ] as const).map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={fulfillmentMethod === option.value}
                onClick={() => {
                  setFulfillmentMethod(option.value);
                  setMessage("");
                  setMergeCandidates([]);
                  setMergeIntoOrderNumber(null);
                  setMergeDecisionMade(false);
                }}
                className={`min-h-16 rounded-xl border-2 px-2 py-3 text-sm font-extrabold transition ${fulfillmentMethod === option.value
                  ? "border-[#02B0AF] bg-[#E3F9F4] text-[#007C78]"
                  : "border-[#D5E8E2] bg-white text-[#668479]"}`}
              >
                <span aria-hidden="true" className="block text-xl">{option.icon}</span>
                {option.label}
              </button>
            ))}
          </div>
          {fulfillmentMethod === "pickup" && (
            <p className="mt-3 rounded-xl bg-[#FFF7E5] p-3 text-xs leading-5 text-[#8E6500]">
              กรุณาเลือกวันและเวลาที่จะมารับสินค้า หลังออกบิลระบบจะเข้าสู่ขั้นตอนชำระเงินทันที โดยไม่มีงานจัดส่ง
            </p>
          )}
        </section>

        <section className={`${card} p-4 sm:p-5`}>
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#E4F8F6] text-lg">{fulfillmentMethod === "pickup" ? "🏬" : "🚚"}</span>
            <h2 className="text-base font-extrabold">{fulfillmentMethod === "pickup" ? "วันและเวลารับสินค้า" : "วันและเวลาจัดส่ง"}</h2>
          </div>
          <label className="mt-4 block">
            <span className="text-xs font-bold text-[#537566]">{fulfillmentMethod === "pickup" ? "วันที่รับสินค้า" : "วันที่จัดส่ง"}</span>
            <select value={deliveryDate} onChange={(event) => changeDate(event.target.value)} className={field}>
              {deliveryOptions.length === 0 && <option value="">ไม่มีวันที่จัดส่งให้เลือก</option>}
              {deliveryOptions.map((option) => <option key={option.date} value={option.date}>{prettyDate(option.date)}</option>)}
            </select>
          </label>
          {fulfillmentMethod === "delivery" && loadingMergeOptions && (
            <p className="mt-3 text-xs text-[#718F83]">กำลังตรวจสอบคำสั่งซื้อที่จัดส่งวันเดียวกัน...</p>
          )}
          {fulfillmentMethod === "delivery" && mergeOptionsError && (
            <div role="alert" className="mt-3 flex items-center justify-between gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
              <span>ยังตรวจสอบคำสั่งซื้อเดิมไม่ได้ กรุณาลองใหม่ก่อนยืนยันเพื่อป้องกันการสั่งซ้ำ</span>
              <button type="button" className="shrink-0 rounded-lg border border-amber-300 px-3 py-2 font-bold" onClick={() => setMergeRefreshTick((tick) => tick + 1)}>ลองใหม่</button>
            </div>
          )}
          {fulfillmentMethod === "delivery" && selectableMergeCandidates.length > 0 && !loadingMergeOptions && (
            <fieldset className="mt-4 rounded-2xl border-2 border-[#B8EAE5] bg-[#F0FAF8] p-4">
              <legend className="px-2 text-sm font-extrabold text-[#006F6A]">มีคำสั่งซื้อเดิมในวันเดียวกัน</legend>
              <p className="mb-3 text-sm leading-6 font-semibold text-[#17453F]">
                ต้องการให้คำสั่งซื้อใหม่นี้จัดส่งพร้อมกับคำสั่งซื้อเดิมหรือไม่?
              </p>
              <p className="mb-3 text-xs leading-5 text-[#4D6F65]">
                หากเลือกจัดส่งพร้อมกัน ระบบจะสร้างคำสั่งซื้อย่อยแยกต่างหาก (เช่น #50/2)
                ทุกคำสั่งซื้อย่อยต้องหยิบเสร็จก่อนเริ่มออกบิลรวม โดยไม่กระทบรูปและจำนวนที่จัดไว้แล้ว
              </p>
              {!mergeDecisionMade && (
                <p role="status" className="mb-3 rounded-lg bg-[#FFF3D4] px-3 py-2 text-xs font-extrabold text-[#8A6000]">
                  กรุณาเลือกอย่างใดอย่างหนึ่งก่อนยืนยันคำสั่งซื้อ
                </p>
              )}
              {selectableMergeCandidates.map((candidate) => (
                <label key={candidate.orderNumber} className="mt-2 flex cursor-pointer items-center gap-3 rounded-xl border border-[#B8EAE5] bg-white p-3 text-sm font-bold">
                  <input
                    type="radio"
                    name="merge-choice"
                    checked={mergeIntoOrderNumber === candidate.orderNumber}
                    onChange={() => chooseMerge(candidate)}
                  />
                  <span>
                    จัดส่งร่วมกับกลุ่ม #{candidate.orderNumber}
                    <span className="mt-1 block text-xs font-normal text-[#678575]">
                      รอบจัดส่งเดิม {candidate.deliverySlot} · {mergeStatusLabel(candidate.status)}
                    </span>
                  </span>
                </label>
              ))}
              <label className="mt-3 flex cursor-pointer items-center gap-3 rounded-xl border border-[#D6E8E3] bg-white p-3 text-sm font-bold">
                <input type="radio" name="merge-choice" checked={mergeDecisionMade && mergeIntoOrderNumber === null} onChange={() => chooseMerge(null)} />
                <span>ไม่จัดส่งร่วม — สร้างคำสั่งซื้ออิสระ</span>
              </label>
            </fieldset>
          )}
          <label className="mt-4 block">
            <span className="text-xs font-bold text-[#537566]">{fulfillmentMethod === "pickup" ? "ช่วงเวลารับสินค้า" : "ช่วงเวลาจัดส่ง"}</span>
            <select value={deliverySlot} disabled={mergeIntoOrderNumber !== null} onChange={(event) => { setDeliverySlot(event.target.value); setMergeIntoOrderNumber(null); }} className={field}>
              {currentSlots.length === 0 && <option value="">ไม่มีช่วงเวลาที่ว่าง</option>}
              {currentSlots.map((slot) => <option key={slot.value} value={slot.value}>{slot.label}</option>)}
            </select>
          </label>
          {currentSlots.length === 0 && <p className="mt-3 text-xs font-medium text-red-600">ไม่มีช่วงเวลาที่ว่างสำหรับวันที่เลือก</p>}
          <p className="mt-3 text-[11px] leading-5 text-[#718F83]">
            สั่งซื้อได้ตลอด 24 ชั่วโมง · เลือกช่วงเวลา{fulfillmentMethod === "pickup" ? "รับสินค้า" : "จัดส่ง"}ที่ยังไม่เริ่ม (เวลาไทย)
          </p>
        </section>

        {fulfillmentMethod === "delivery" && <section className={`${card} p-4 sm:p-5`}>
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#E4F8F6] text-lg">📍</span>
            <h2 className="text-base font-extrabold">ตำแหน่งจัดส่ง</h2>
          </div>
          <p className="mt-2 text-xs leading-5 text-[#82968D]">ใช้ตำแหน่ง Google Maps ที่ทีมงานบันทึกไว้สำหรับลูกค้ารายนี้</p>
          {isWebUrl(deliveryAddress) ? (
            <a href={deliveryAddress} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex min-h-11 items-center rounded-xl border-2 border-[#B9E9E3] bg-[#EFFAF8] px-4 py-2 text-sm font-extrabold text-[#008F8D]">เปิดตำแหน่งใน Google Maps ↗</a>
          ) : (
            <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-600">ยังไม่ได้ตั้งค่าลิงก์ Google Maps กรุณาติดต่อผู้จัดการ</p>
          )}
        </section>}

        <section className={`${card} p-4 sm:p-5`}>
          <h2 className="text-base font-extrabold">📝 หมายเหตุถึงทีมงาน</h2>
          <p className="mt-1 text-xs text-[#82968D]">หากมีคำแนะนำเพิ่มเติม สามารถแจ้งได้ที่นี่ (ไม่บังคับ)</p>
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} placeholder={fulfillmentMethod === "pickup" ? "เช่น เบอร์ติดต่อเมื่อมารับสินค้า" : "เช่น จุดรับสินค้า หรือรายละเอียดการจัดส่ง"} className={`${field} resize-y font-normal`} />
        </section>

        <p className="px-2 text-center text-xs leading-5 text-[#81978B]">จำนวนสินค้าและยอดสุทธิอาจเปลี่ยนแปลงหลังการเช็คสต็อกและการจัดสินค้า</p>
      </div>

      <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-[#D8EAE0] bg-white/95 p-3 shadow-[0_-8px_30px_rgba(15,64,39,0.08)] backdrop-blur-lg">
        <div className="mx-auto max-w-3xl">
          <button
            type="button"
            onClick={() => void submitOrder()}
            disabled={submitting || loadingMergeOptions || !deliveryDate || !deliverySlot || items.length === 0}
            className="miniapp-bottom-cta flex min-h-16 w-full items-center justify-between gap-2 rounded-2xl bg-[#02B0AF] px-3 py-3 text-left text-white shadow-lg shadow-[#007E61]/15 disabled:cursor-not-allowed disabled:opacity-40 sm:gap-3 sm:px-5"
          >
            <span>
              <span className="block text-[13px] font-extrabold leading-5 sm:text-sm">{submitting ? "กำลังส่งคำสั่งซื้อ..." : mergeIntoOrderNumber ? "ยืนยันการจัดส่งร่วมกัน" : "ยืนยันคำสั่งซื้อ"}</span>
              <span className="mt-1 hidden text-[11px] leading-4 text-white/80 min-[390px]:block">{submitting ? "กรุณารอสักครู่" : mergeIntoOrderNumber ? "สร้างคำสั่งซื้อย่อย →" : "ส่งรายการให้ทีมงานตรวจสอบ →"}</span>
            </span>
            <span className="miniapp-cta-price text-right text-[clamp(15px,4.9vw,21px)] font-black">~฿{formatMoney(estimatedTotal)}</span>
          </button>
        </div>
      </div>
    </main>
  );
}
