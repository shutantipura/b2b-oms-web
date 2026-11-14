"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import LotusLoading from "../../../components/LotusLoading";
import LotusBrand from "@/components/LotusBrand";
import { lineApiFetch } from "../../../lib/lineSession";
import { listEligibleMergeChoices } from "../../../lib/orderMergeChoices";
import { isGoogleMapsUrl, MAX_DELIVERY_LOCATIONS, type DeliveryLocation } from "../../../lib/deliveryLocations";

type Customer = {
  id: string;
  customerCode: string;
  customerName: string;
  deliveryAddress: string;
  deliveryLocations?: DeliveryLocation[];
  locationsVersion: string;
};

type CheckoutItem = {
  id: string;
  sku: string;
  productName: string;
  imageUrl?: string | null;
  unit: string;
  quantity: number;
  isPiece: boolean;
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
  const [locationEditIndex, setLocationEditIndex] = useState<number | null>(null);
  const [locationName, setLocationName] = useState("");
  const [locationLink, setLocationLink] = useState("");
  const [savingLocations, setSavingLocations] = useState(false);
  const [locationError, setLocationError] = useState("");
  const [idToken, setIdToken] = useState("");
  const [cart, setCart] = useState<Cart>({});
  const [pieceProductIds, setPieceProductIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [createdOrderNumber, setCreatedOrderNumber] = useState<number | null>(null);
  const [wasMerged, setWasMerged] = useState(false);
  const [createdDisplayNumber, setCreatedDisplayNumber] = useState<string | null>(null);
  const [mergeCandidates, setMergeCandidates] = useState<MergeCandidate[]>([]);
  const [selectedMergeOrderNumber, setSelectedMergeOrderNumber] = useState<number | null>(null);
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

        const savedPieceIds = localStorage.getItem(`b2b-cart-pieces-${customerCode}`);
        let pieceIds: string[] = [];
        try {
          const parsed = JSON.parse(savedPieceIds ?? "[]") as unknown;
          if (Array.isArray(parsed)) pieceIds = parsed.filter((x): x is string => typeof x === "string");
        } catch { pieceIds = []; }
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
            pieceProductIds: pieceIds,
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
        setPieceProductIds(pieceIds);
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
        const firstLocation = data.customer.deliveryLocations?.[0]?.url
          ?? data.customer.deliveryAddress ?? "";
        setDeliveryAddress(firstLocation);
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

  // Check eligible existing deliveries automatically for this date and location.
  // Candidates may become ineligible after this check; the submit RPC
  // always rechecks inside the same transaction as the merge.
  useEffect(() => {
    const controller = new AbortController();
    const initial = window.setTimeout(() => {
    if (!idToken || !customer || !deliveryDate || !deliveryAddress || fulfillmentMethod === "pickup") {
      setMergeCandidates([]);
      setLoadingMergeOptions(false);
      setMergeOptionsError("");
      return;
    }
    setLoadingMergeOptions(true);
    setMergeOptionsError("");
    setMergeCandidates([]);
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
            deliveryAddress,
            cart,
            pieceProductIds,
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

    }, 0);
    return () => {
      window.clearTimeout(initial);
      controller.abort();
    };
  }, [idToken, customer, deliveryDate, deliveryAddress, cart, pieceProductIds, mergeRefreshTick, fulfillmentMethod]);

  // Candidates are suggestions, never selected without customer consent.
  const eligibleMergeCandidates = useMemo(() =>
    fulfillmentMethod === "delivery"
      ? listEligibleMergeChoices(mergeCandidates, deliveryDate, deliveryAddress, currentSlots.map(s => s.value))
      : [],
    [mergeCandidates, deliveryDate, deliveryAddress, currentSlots, fulfillmentMethod]
  );
  const chosenMerge = eligibleMergeCandidates.find(c => c.orderNumber === selectedMergeOrderNumber) ?? null;
  const selectedDeliverySlot = chosenMerge?.deliverySlot ?? deliverySlot;
  const hasPieceOrders = items.some(item => item.isPiece);
  const estimatedTotal = useMemo(
    () => items.reduce((total, item) => total + item.estimatedSubtotal, 0),
    [items]
  );

  function changeDate(value: string) {
    setDeliveryDate(value);
    setSelectedMergeOrderNumber(null);
    mergeRequestIdRef.current = null;
    const option = deliveryOptions.find(item => item.date === value);
    setDeliverySlot(option?.slots[0]?.value ?? "");
  }


  function openLocationEditor(index: number) {
    if (!customer || submitting || savingLocations) return;
    const saved = customer.deliveryLocations ?? [];
    if (index < 0 || index > saved.length || index >= MAX_DELIVERY_LOCATIONS) return;
    setLocationEditIndex(index);
    setLocationName(saved[index]?.label ?? "จุดส่ง " + (index + 1));
    setLocationLink(saved[index]?.url ?? "");
    setLocationError("");
  }

  async function persistLocations(next: DeliveryLocation[], preferredUrl: string) {
    if (!customer || !idToken || savingLocations || submitting) return;
    setSavingLocations(true);
    setLocationError("");
    try {
      const response = await lineApiFetch("/api/line/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save-locations", idToken,
          customerCode: customer.customerCode,
          locations: next, expectedLocationsVersion: customer.locationsVersion,
        }),
      });
      const data = (await response.json()) as CheckoutResponse;
      if (!response.ok || !data.customer) throw new Error(data.error ?? "บันทึกจุดส่งไม่สำเร็จ");
      const locations = data.customer.deliveryLocations ?? [];
      setCustomer(data.customer);
      setDeliveryAddress(locations.find((item) => item.url === preferredUrl)?.url ?? locations[0]?.url ?? "");
      setSelectedMergeOrderNumber(null);
      mergeRequestIdRef.current = null;
      setLocationEditIndex(null);
      setMergeCandidates([]);
      setMergeRefreshTick((value) => value + 1);
      setMessage("");
    } catch (error) {
      setLocationError(error instanceof Error ? error.message : "บันทึกจุดส่งไม่สำเร็จ");
    } finally {
      setSavingLocations(false);
    }
  }

  async function saveLocation() {
    if (!customer || locationEditIndex === null) return;
    const name = locationName.trim();
    const url = locationLink.trim();
    if (!name || name.length > 60) {
      setLocationError("กรุณาระบุชื่อจุดส่ง ไม่เกิน 60 ตัวอักษร");
      return;
    }
    if (url.length > 2048 || !isGoogleMapsUrl(url)) {
      setLocationError("กรุณาวางลิงก์ Google Maps ที่ถูกต้อง เช่น https://maps.app.goo.gl/...");
      return;
    }
    const saved = customer.deliveryLocations ?? [];
    if (saved.some((item, index) => index !== locationEditIndex && item.url === url)) {
      setLocationError("ลิงก์นี้ถูกบันทึกไว้แล้ว");
      return;
    }
    const oldUrl = saved[locationEditIndex]?.url;
    const next = saved.slice();
    if (locationEditIndex === saved.length) next.push({ label: name, url });
    else next[locationEditIndex] = { label: name, url };
    const preferred = oldUrl === deliveryAddress || !deliveryAddress ? url : deliveryAddress;
    await persistLocations(next, preferred);
  }

  async function deleteLocation(index: number) {
    if (!customer || submitting || savingLocations) return;
    const saved = customer.deliveryLocations ?? [];
    if (!saved[index]) return;
    if (!window.confirm("ลบจุดส่ง " + saved[index].label + " หรือไม่? คำสั่งซื้อเดิมจะไม่เปลี่ยนแปลง")) return;
    const next = saved.filter((_, i) => i !== index);
    setLocationEditIndex(null);
    await persistLocations(next, saved[index].url === deliveryAddress ? next[0]?.url ?? "" : deliveryAddress);
  }

  function goShop() {
    if (!customer) {
      router.push("/miniapp?portal=customer");
      return;
    }
    router.push(`/miniapp/shop?customer=${encodeURIComponent(customer.customerCode)}`);
  }

  async function submitOrder() {
    if (!customer || !idToken || submitting || savingLocations) return;
    setMessage("");
    if (!deliveryDate) {
      setMessage(fulfillmentMethod === "pickup" ? "กรุณาเลือกวันที่รับสินค้าที่สาขา" : "กรุณาเลือกวันที่จัดส่ง");
      return;
    }
    if (!selectedDeliverySlot) {
      setMessage(fulfillmentMethod === "pickup" ? "กรุณาเลือกช่วงเวลารับสินค้า" : "กรุณาเลือกช่วงเวลาจัดส่ง");
      return;
    }
    if (fulfillmentMethod === "delivery" && (!isWebUrl(deliveryAddress.trim()) ||
      !(customer.deliveryLocations ?? [{ label: "จุดส่ง 1", url: customer.deliveryAddress }]).some(location => location.url === deliveryAddress))) {
      setMessage("กรุณาเพิ่มหรือเลือกจุดส่งด้วยลิงก์ Google Maps ก่อนยืนยันคำสั่งซื้อ");
      return;
    }

    // Independent orders remain available even when candidate lookup fails.
    if (fulfillmentMethod === "delivery" && selectedMergeOrderNumber !== null &&
        (loadingMergeOptions || mergeOptionsError || !chosenMerge)) {
      setMessage("ไม่สามารถยืนยันการรวมคำสั่งซื้อได้ กรุณาเลือกใหม่หรือสั่งซื้อแยก");
      return;
    }
    const confirmation = fulfillmentMethod === "pickup"
      ? `ยืนยันรับสินค้าที่สาขา ${prettyDate(deliveryDate)} เวลา ${deliverySlot} ยอดประมาณการ ฿${estimatedTotal.toFixed(2)}${hasPieceOrders ? " (ยังไม่รวมสินค้าสั่งเป็นชิ้น)" : ""} หรือไม่?\nหลังจากออกบิลแล้ว คำสั่งซื้อจะเข้าสู่ขั้นตอนชำระเงินโดยไม่ผ่านงานจัดส่ง`
      : chosenMerge
        ? `สร้างคำสั่งซื้อใหม่มูลค่าประมาณ ฿${estimatedTotal.toFixed(2)}${hasPieceOrders ? " (ยังไม่รวมสินค้าสั่งเป็นชิ้น)" : ""} เพื่อจัดส่งร่วมกับกลุ่ม #${chosenMerge.orderNumber} รอบ ${selectedDeliverySlot} ใช่หรือไม่?\nสินค้าใหม่จะผ่านการเช็คสต็อกและจัดสินค้าแยกต่างหาก แล้วออกบิลและจัดส่งรวมครั้งเดียว`
        : `ยืนยันคำสั่งซื้อยอดประมาณการ ฿${estimatedTotal.toFixed(2)}${hasPieceOrders ? " (ยังไม่รวมสินค้าสั่งเป็นชิ้น)" : ""} หรือไม่?`;
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
          pieceProductIds,
          deliveryDate,
          deliverySlot: selectedDeliverySlot,
          fulfillmentMethod,
          deliveryAddress: fulfillmentMethod === "pickup" ? "" : deliveryAddress.trim(),
          notes: notes.trim(),
          mergeIntoOrderNumber: chosenMerge?.orderNumber ?? null,
          requestId: chosenMerge ? mergeRequestIdRef.current : null,
        }),
      });
      const data = (await response.json()) as CheckoutResponse;
      if (!response.ok) {
        if (response.status === 409) {
          mergeRequestIdRef.current = null;
          setSelectedMergeOrderNumber(null);
          setMergeRefreshTick(tick => tick + 1);
        }
        if (data.deliveryOptions) {
          const freshOptions = data.deliveryOptions;
          setDeliveryOptions(freshOptions);
          const selectionStillAvailable = freshOptions.some(
            (option) => option.date === deliveryDate &&
              option.slots.some((slot) => slot.value === selectedDeliverySlot)
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
      localStorage.removeItem(`b2b-cart-pieces-${customer.customerCode}`);
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
                    <Image unoptimized fill
                      src={imageByProductId[item.id]}
                      alt={item.productName}
                      className="absolute inset-0 h-full w-full bg-white object-contain p-1.5"
                      onError={(event) => { event.currentTarget.style.display = "none"; }}
                    />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold leading-5">{item.productName}</p>
                  <p className="mt-1 text-[11px] text-[#91A298]">SKU {item.sku}</p>
                  <p className="mt-1 text-xs text-[#678575]">
                    {formatQuantity(item.quantity)} {item.isPiece ? "ชิ้น" : item.unit}
                    {" · "}฿{formatMoney(item.effectivePrice)} / {item.unit}
                  </p>
                  {item.isPiece && <p className="mt-1 text-[11px] font-semibold text-[#996917]">ราคาคิดตามน้ำหนักที่ชั่งจริง ไม่ใช่ต่อชิ้น</p>}
                  {(item.hasSpecialPrice && item.effectivePrice < item.normalPrice) && <span className="mt-2 inline-block rounded-md bg-[#FFF3D4] px-2 py-1 text-[10px] font-bold text-[#A47700]">ราคาพิเศษสำหรับคุณ</span>}
                </div>
                <strong className={`shrink-0 text-sm ${(item.hasSpecialPrice && item.effectivePrice < item.normalPrice) ? "text-[#DC2626]" : "text-[#009F9D]"}`}>{item.isPiece ? "รอชั่งจริง" : "฿" + formatMoney(item.estimatedSubtotal)}</strong>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-[#DCEDE5] bg-[#EDF9F5] px-4 py-4 sm:px-5">
            <div>
              <p className="text-sm font-bold text-[#3D6654]">ยอดรวมประมาณการ</p>
              <p className="mt-1 text-[11px] text-[#79988A]">
                {hasPieceOrders ? "ไม่รวมรายการสั่งเป็นชิ้น · คิดราคาจากน้ำหนักจริง" : "ยอดจริงขึ้นอยู่กับจำนวนที่หยิบได้"}
              </p>
            </div>
            <strong className="text-xl font-black text-[#008F8D]">{hasPieceOrders && estimatedTotal === 0 ? "รอชั่งน้ำหนัก" : `฿${formatMoney(estimatedTotal)}`}</strong>
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
                  setSelectedMergeOrderNumber(null);
                  mergeRequestIdRef.current = null;
                  setMergeCandidates([]);
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
           <label className="mt-4 block">
            <span className="text-xs font-bold text-[#537566]">{fulfillmentMethod === "pickup" ? "ช่วงเวลารับสินค้า" : "ช่วงเวลาจัดส่ง"}</span>
            <select value={selectedDeliverySlot} onChange={(event) => {
              setDeliverySlot(event.target.value);
              setSelectedMergeOrderNumber(null);
              mergeRequestIdRef.current = null;
            }} className={field}>
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

          <p className="mt-2 text-xs leading-5 text-[#82968D]">เลือก เพิ่ม เปลี่ยนชื่อ หรือลบจุดส่งได้ที่นี่ โดยข้อมูลจะอัปเดตถึงทีมงานทันที</p>
          <div className="mt-3 grid gap-2">
            {(customer.deliveryLocations ?? []).map((location, index) => (
              <div key={location.url} className="rounded-xl border border-[#D5E8E2] p-2">
                <button type="button" aria-pressed={deliveryAddress === location.url}
                  disabled={savingLocations}
                  onClick={() => {
                    setDeliveryAddress(location.url);
                    setSelectedMergeOrderNumber(null);
                    mergeRequestIdRef.current = null;
                    setMessage("");
                  }}
                  className={"flex min-h-14 w-full items-center justify-between gap-2 rounded-xl border-2 px-3 py-3 text-left text-sm font-bold transition " +
                    (deliveryAddress === location.url
                      ? "border-[#02B0AF] bg-[#E5F9F5] text-[#007A75]"
                      : "border-[#D5E8E2] bg-white text-[#57786E]")}>
                  <span className="min-w-0 truncate">📍 {location.label}</span>
                  <span className="shrink-0">{deliveryAddress === location.url ? "✓ เลือกแล้ว" : "เลือก"}</span>
                </button>
                <div className="mt-1 flex justify-end gap-1">
                  <button type="button" disabled={submitting || savingLocations} onClick={() => openLocationEditor(index)}
                    className="min-h-10 px-3 text-xs font-bold text-[#008F8D] disabled:opacity-40">✎ แก้ไข</button>
                  <button type="button" disabled={submitting || savingLocations} onClick={() => void deleteLocation(index)}
                    className="min-h-10 px-3 text-xs font-bold text-red-600 disabled:opacity-40">ลบ</button>
                </div>
              </div>
            ))}
          </div>
          {(customer.deliveryLocations ?? []).length < MAX_DELIVERY_LOCATIONS && locationEditIndex === null && (
            <button type="button" disabled={savingLocations || submitting}
              onClick={() => openLocationEditor((customer.deliveryLocations ?? []).length)}
              className="mt-3 min-h-12 w-full rounded-xl border-2 border-dashed border-[#02B0AF] px-3 text-sm font-bold text-[#008F8D] disabled:opacity-40">
              + เพิ่มจุดส่ง ({(customer.deliveryLocations ?? []).length}/{MAX_DELIVERY_LOCATIONS})
            </button>
          )}
          {locationEditIndex !== null && (
            <div className="mt-3 space-y-3 rounded-xl border border-[#B9E9E3] bg-[#F0FAF8] p-3">
              <h3 className="text-sm font-extrabold">{locationEditIndex === (customer.deliveryLocations ?? []).length ? "เพิ่มจุดส่ง" : "แก้ไขจุดส่ง"}</h3>
              <label className="block">
                <span className="text-xs font-bold text-[#537566]">ชื่อจุดส่ง</span>
                <input className={field} maxLength={60} value={locationName}
                  onChange={(event) => setLocationName(event.target.value)}
                  placeholder="เช่น หน้าร้าน หรือ คลังสินค้า" />
              </label>
              <label className="block">
                <span className="text-xs font-bold text-[#537566]">ลิงก์ Google Maps</span>
                <input className={field} type="url" inputMode="url" autoCapitalize="none"
                  value={locationLink} onChange={(event) => setLocationLink(event.target.value)}
                  placeholder="วาง https://maps.app.goo.gl/... หรือ https://www.google.com/maps/..." />
              </label>
              <div className="flex gap-2">
                <button type="button" disabled={savingLocations} onClick={() => void saveLocation()}
                  className="min-h-11 flex-1 rounded-xl bg-[#02B0AF] px-3 text-sm font-bold text-white disabled:opacity-40">
                  {savingLocations ? "กำลังบันทึก..." : "บันทึกจุดส่ง"}
                </button>
                <button type="button" disabled={savingLocations} onClick={() => { setLocationEditIndex(null); setLocationError(""); }}
                  className="min-h-11 rounded-xl border border-[#D5E8E2] bg-white px-4 text-sm font-bold text-[#537566]">ยกเลิก</button>
              </div>
            </div>
          )}
          {locationError && <p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-600">{locationError}</p>}
          {isWebUrl(deliveryAddress) ? (
            <a href={deliveryAddress} target="_blank" rel="noopener noreferrer"
              className="mt-4 inline-flex min-h-11 items-center rounded-xl border-2 border-[#B9E9E3] bg-[#EFFAF8] px-4 py-2 text-sm font-extrabold text-[#008F8D]">ดูจุดส่งที่เลือกใน Google Maps ↗</a>
          ) : (
            <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm font-semibold text-amber-800">ยังไม่มีจุดส่ง กรุณาเพิ่มลิงก์ Google Maps ก่อนสั่งจัดส่ง</p>
          )}
        </section>}

        {fulfillmentMethod === "delivery" && (
          <section className="rounded-2xl border border-[#DFEAE4] bg-white p-4 shadow-sm sm:p-5">
            <h2 className="text-base font-extrabold">รวมคำสั่งซื้อ (ไม่บังคับ)</h2>
            <p className="mt-2 text-xs leading-5 text-[#82968D]">
              เลือกสร้างคำสั่งซื้อแยกได้เสมอ หากต้องการรวมกับออเดอร์เดิม ให้เลือกเองด้านล่าง
            </p>
            <div className="mt-3 space-y-2">
              <label className={"flex min-h-14 items-center gap-3 rounded-xl border-2 px-3 py-3 text-sm font-bold " +
                (chosenMerge === null ? "border-[#02B0AF] bg-[#E5F9F5] text-[#007A75]" : "border-[#D5E8E2] bg-white text-[#57786E]")}>
                <input type="radio" name="merge-choice" checked={chosenMerge === null}
                  onChange={() => { setSelectedMergeOrderNumber(null); mergeRequestIdRef.current = null; }}
                  className="h-5 w-5 accent-[#008F8D]" />
                สร้างคำสั่งซื้อแยก (ค่าเริ่มต้น)
              </label>
              {eligibleMergeCandidates.map(candidate => (
                <label key={candidate.orderNumber} className={"flex min-h-16 items-start gap-3 rounded-xl border-2 px-3 py-3 text-sm " +
                  (chosenMerge?.orderNumber === candidate.orderNumber ? "border-[#02B0AF] bg-[#E5F9F5]" : "border-[#D5E8E2] bg-white")}>
                  <input type="radio" name="merge-choice" checked={chosenMerge?.orderNumber === candidate.orderNumber}
                    onChange={() => {
                      setSelectedMergeOrderNumber(candidate.orderNumber);
                      mergeRequestIdRef.current = null;
                      setMessage("");
                    }}
                    className="mt-1 h-5 w-5 accent-[#008F8D]" />
                  <span className="min-w-0">
                    <span className="block font-extrabold text-[#17453F]">รวมกับคำสั่งซื้อ #{candidate.orderNumber}</span>
                    <span className="mt-1 block text-xs text-[#57786E]">เวลา {candidate.deliverySlot} · {mergeStatusLabel(candidate.status)}</span>
                  </span>
                </label>
              ))}
            </div>
            {loadingMergeOptions && <p className="mt-3 text-xs text-[#718F83]">กำลังตรวจสอบคำสั่งซื้อเดิม...</p>}
            {mergeOptionsError && (
              <div role="alert" className="mt-3 flex items-center justify-between gap-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-800">
                <span>ตรวจสอบคำสั่งซื้อเดิมไม่ได้ แต่ยังสั่งซื้อแยกได้ตามปกติ</span>
                <button type="button" className="shrink-0 rounded-lg border border-amber-300 px-3 py-2 font-bold"
                  onClick={() => setMergeRefreshTick(tick => tick + 1)}>ลองใหม่</button>
              </div>
            )}
            {!loadingMergeOptions && !mergeOptionsError && eligibleMergeCandidates.length === 0 && (
              <p className="mt-3 text-xs text-[#718F83]">ไม่มีคำสั่งซื้อเดิมที่รวมได้สำหรับวันและจุดส่งนี้</p>
            )}
            {chosenMerge && <p role="status" className="mt-3 rounded-xl bg-[#F0FAF8] p-3 text-xs font-bold leading-5 text-[#006F6A]">
              หากรวม เวลาจัดส่งจะเปลี่ยนเป็น {chosenMerge.deliverySlot} ตามคำสั่งซื้อเดิม
              และจะออกบิล จัดส่ง และชำระเงินร่วมกันหลังจากหยิบสินค้าทุกออเดอร์ครบ
            </p>}
          </section>
        )}

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
            disabled={submitting || savingLocations || locationEditIndex !== null || (selectedMergeOrderNumber !== null && loadingMergeOptions) || !deliveryDate || !selectedDeliverySlot || items.length === 0 || (fulfillmentMethod === "delivery" && !deliveryAddress)}
            className="miniapp-bottom-cta flex min-h-16 w-full items-center justify-between gap-2 rounded-2xl bg-[#02B0AF] px-3 py-3 text-left text-white shadow-lg shadow-[#007E61]/15 disabled:cursor-not-allowed disabled:opacity-40 sm:gap-3 sm:px-5"
          >
            <span>
              <span className="block text-[13px] font-extrabold leading-5 sm:text-sm">{submitting ? "กำลังส่งคำสั่งซื้อ..." : chosenMerge ? "ยืนยันการจัดส่งร่วมกัน" : "ยืนยันคำสั่งซื้อ"}</span>
              <span className="mt-1 hidden text-[11px] leading-4 text-white/80 min-[390px]:block">{submitting ? "กรุณารอสักครู่" : chosenMerge ? "สร้างคำสั่งซื้อย่อย →" : "ส่งรายการให้ทีมงานตรวจสอบ →"}</span>
            </span>
            <span className="miniapp-cta-price text-right text-[clamp(15px,4.9vw,21px)] font-black">{hasPieceOrders && estimatedTotal === 0 ? "รอชั่งน้ำหนัก" : `~฿${formatMoney(estimatedTotal)}`}</span>
          </button>
        </div>
      </div>
    </main>
  );
}
