"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "../../lib/supabase";

type MasterPriceProduct = {
  product_id: string;
  sku: string;
  product_name: string;
  unit: string;
  normal_price: number | string;
  cost: number | string | null;
  is_active: boolean;
};

type AdjustmentResult = {
  success?: boolean;
  normal_price?: number | string;
  cost?: number | string | null;
};

function baht(value: number) {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// Work with decimal digits directly to round .005 upward consistently.
function parseCost(value: string): { valid: boolean; cost: number | null } {
  const text = value.replace(/[,฿]/g, "").trim();
  if (/^(?:n\/?a|#n\/a)$/i.test(text)) return { valid: true, cost: null };
  if (!/^[0-9]{1,10}(?:\.[0-9]+)?$/.test(text)) return { valid: false, cost: null };
  const [whole, decimals = ""] = text.split(".");
  const cents = Number(whole) * 100
    + Number((decimals + "00").slice(0, 2))
    + (decimals.length > 2 && decimals[2] >= "5" ? 1 : 0);
  const cost = cents / 100;
  return { valid: cost < 10_000_000_000, cost };
}

function grossProfitLabel(price: number | null, cost: number | null) {
  if (price === null || cost === null) return "กำไรขั้นต้น N/A · %GP N/A";
  const profit = price - cost;
  const margin = price > 0 ? (100 * profit / price).toFixed(1) + "%" : "N/A";
  return "กำไรขั้นต้น " + (profit < 0 ? "−" : "") + "฿" +
    baht(Math.abs(profit)) + " · %GP " + margin;
}

export default function ManualMasterPriceEditor({
  disabled = false,
  refreshToken = 0,
}: {
  disabled?: boolean;
  refreshToken?: number;
}) {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<MasterPriceProduct[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<MasterPriceProduct | null>(null);
  const [normalDraft, setNormalDraft] = useState("");
  const [costDraft, setCostDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [outOfStock, setOutOfStock] = useState<boolean | null>(null);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [availabilitySaving, setAvailabilitySaving] = useState(false);
  const selectedAvailabilityRef = useRef<string | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const searchRequest = useRef(0);
  const [lastRefreshToken, setLastRefreshToken] = useState(refreshToken);

  // Reset drafts in the render prompted by a new master-price revision.
  // This preserves the search query without introducing an effect render cycle.
  if (lastRefreshToken !== refreshToken) {
    setLastRefreshToken(refreshToken);
    setSelected(null);
    selectedAvailabilityRef.current = null;
    setOutOfStock(null);
    setNormalDraft("");
    setCostDraft("");
    setSuccessMessage("");
  }

  useEffect(() => {
    const term = query.trim();
    const requestId = ++searchRequest.current;
    let cancelled = false;
    const timeout = window.setTimeout(async () => {
      if (term.length < 2 || disabled) {
        setMatches([]);
        setSearching(false);
        return;
      }
      setSearching(true);
      setErrorMessage("");
      const { data, error } = await supabase.rpc("search_master_price_adjustments", {
        p_query: term,
      });
      if (cancelled || searchRequest.current !== requestId) return;
      if (error) {
        setMatches([]);
        setErrorMessage("ค้นหาสินค้าไม่สำเร็จ: " + error.message);
      } else {
        setMatches((data ?? []) as MasterPriceProduct[]);
      }
      setSearching(false);
    }, term.length < 2 || disabled ? 0 : 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [query, disabled, refreshToken]);

  function chooseProduct(product: MasterPriceProduct) {
    if (saving || availabilitySaving || disabled) return;
    selectedAvailabilityRef.current = product.product_id;
    setSelected(product);
    setNormalDraft(String(Number(product.normal_price)));
    setCostDraft(product.cost === null ? "N/A" : String(Number(product.cost)));
    setOutOfStock(null);
    setAvailabilityLoading(true);
    setErrorMessage("");
    setSuccessMessage("");
    void (async () => {
      const { data, error } = await supabase.from("products")
        .select("is_customer_out_of_stock")
        .eq("id", product.product_id).single();
      if (selectedAvailabilityRef.current !== product.product_id) return;
      setAvailabilityLoading(false);
      if (error || !data) setErrorMessage("ไม่สามารถตรวจสอบสถานะสินค้าได้ กรุณาเลือกสินค้าอีกครั้ง");
      else setOutOfStock(Boolean(data.is_customer_out_of_stock));
    })();
  }

  const oldPrice = selected ? Number(selected.normal_price) : null;
  const oldCost = selected && selected.cost !== null ? Number(selected.cost) : null;
  const normalText = normalDraft.trim();
  const validNormal = /^\d+(?:\.\d{1,2})?$/.test(normalText)
    && Number.isFinite(Number(normalText))
    && Number(normalText) < 10_000_000_000;
  const nextPrice = validNormal ? Number(normalText) : null;
  const parsedCost = parseCost(costDraft);
  const nextCost = parsedCost.valid ? parsedCost.cost : null;
  const normalChanged = selected !== null && nextPrice !== null && nextPrice !== oldPrice;
  const costChanged = selected !== null && parsedCost.valid && nextCost !== oldCost;
  const canSave = !disabled && !saving && selected !== null
    && validNormal && parsedCost.valid && (normalChanged || costChanged);
  const belowCost = nextPrice !== null && nextCost !== null && nextPrice < nextCost;

  async function saveAdjustment() {
    if (!selected || !canSave || nextPrice === null) return;
    const productId = selected.product_id;
    const nextCostLabel = nextCost === null ? "N/A" : "฿" + baht(nextCost);
    const oldCostLabel = oldCost === null ? "N/A" : "฿" + baht(oldCost);
    const confirmation =
      "ยืนยันการปรับราคาสินค้า?\n\n" +
      selected.product_name + "\nSKU: " + selected.sku + "\nหน่วย: " + selected.unit + "\n\n" +
      "ราคาปกติเดิม: ฿" + baht(oldPrice ?? 0) + "\n" +
      "ราคาปกติใหม่: ฿" + baht(nextPrice) + "\n" +
      "ต้นทุนเดิม: " + oldCostLabel + "\n" +
      "ต้นทุนใหม่: " + nextCostLabel + "\n\n" +
      grossProfitLabel(nextPrice, nextCost) +
      (belowCost ? "\n⚠ ราคาขายต่ำกว่าต้นทุน" : "") +
      "\n\nราคาปกติที่แก้ไขจะใช้กับคำสั่งซื้อใหม่ ไม่เปลี่ยนราคาในออเดอร์เก่า";
    if (!window.confirm(confirmation)) return;

    setSaving(true);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      const mode = !costChanged ? "keep" : nextCost === null ? "na" : "set";
      const { data, error } = await supabase.rpc("adjust_product_master_price", {
        p_product_id: productId,
        p_normal_price: normalChanged ? nextPrice : null,
        p_cost_mode: mode,
        p_cost_value: mode === "set" ? nextCost : null,
      });
      if (error) throw error;
      const result = data as AdjustmentResult | null;
      if (!result?.success || result.normal_price === undefined) {
        throw new Error("ระบบไม่ยืนยันการบันทึก กรุณารีเฟรชและตรวจสอบอีกครั้ง");
      }

      const updatedPrice = Number(result.normal_price);
      const updatedCost = result.cost === null || result.cost === undefined
        ? null : Number(result.cost);
      if (!Number.isFinite(updatedPrice) ||
          (updatedCost !== null && !Number.isFinite(updatedCost))) {
        throw new Error("ระบบส่งข้อมูลราคากลับมาไม่ถูกต้อง");
      }
      const updated: MasterPriceProduct = {
        ...selected,
        normal_price: updatedPrice,
        cost: updatedCost,
      };
      setSelected(updated);
      setMatches((current) => current.map((item) =>
        item.product_id === productId ? updated : item
      ));
      setNormalDraft(String(updatedPrice));
      setCostDraft(updatedCost === null ? "N/A" : String(updatedCost));
      setSuccessMessage("✓ บันทึกแล้ว — " + selected.sku +
        " · ราคาปกติ ฿" + baht(updatedPrice) +
        " · ต้นทุน " + (updatedCost === null ? "N/A" : "฿" + baht(updatedCost)));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "บันทึกไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  }

  async function toggleOutOfStock() {
    if (!selected || outOfStock === null || disabled || saving || availabilityLoading || availabilitySaving) return;
    const productId = selected.product_id;
    const nextState = !outOfStock;
    if (!window.confirm(
      (nextState ? "ยืนยันทำเครื่องหมายสินค้าหมดชั่วคราว?" : "ยืนยันเปิดให้ลูกค้าสั่งสินค้านี้อีกครั้ง?") +
      "\n" + selected.product_name + " (SKU " + selected.sku + ")" +
      "\nมีผลเฉพาะคำสั่งซื้อใหม่ ไม่แก้ไขออเดอร์เดิม"
    )) return;
    setAvailabilitySaving(true);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      const { data, error } = await supabase.rpc("set_product_customer_out_of_stock", {
        p_product_id: productId, p_out_of_stock: nextState,
      });
      if (error) throw error;
      const result = data as { success?: boolean; is_out_of_stock?: boolean } | null;
      if (!result?.success || typeof result.is_out_of_stock !== "boolean")
        throw new Error("ระบบไม่ยืนยันการเปลี่ยนสถานะสินค้า");
      if (selectedAvailabilityRef.current === productId) {
        setOutOfStock(result.is_out_of_stock);
        setSuccessMessage(result.is_out_of_stock
          ? "✓ ปิดรับคำสั่งซื้อใหม่สำหรับ SKU " + selected.sku + " แล้ว"
          : "✓ เปิดให้ลูกค้าสั่ง SKU " + selected.sku + " ได้อีกครั้งแล้ว");
      }
    } catch (error) {
      if (selectedAvailabilityRef.current === productId)
        setErrorMessage(error instanceof Error ? error.message : "เปลี่ยนสถานะสินค้าไม่สำเร็จ");
    } finally {
      setAvailabilitySaving(false);
    }
  }

  return (
    <div className="mb-6 rounded-2xl border border-[#BFDCD3] bg-[#F7FBF9] p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold text-[#17453F]">จัดการสถานะสินค้าหมดชั่วคราว / ราคาและต้นทุน</h3>
          <p className="mt-1 text-xs text-[#648278]">
            ค้นหาสินค้าแล้วเลือกกำหนดสถานะขายหรือปรับราคาและต้นทุน
          </p>
        </div>
        <span className="rounded-full bg-[#DDEFE7] px-3 py-1 text-xs font-semibold text-[#28604E]">
          Manager เท่านั้น
        </span>
      </div>

      <label htmlFor="manual-master-search" className="mt-4 block text-sm font-semibold text-[#285247]">
        ค้นหา SKU หรือชื่อสินค้า
      </label>
      <input
        id="manual-master-search"
        type="search"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setSuccessMessage("");
        }}
        placeholder="เช่น 000000035, 35 หรือชื่อสินค้า"
        disabled={disabled || saving}
        className="mt-2 w-full rounded-xl border border-[#BBD9D2] bg-white px-4 py-3 text-sm outline-none focus:border-[#02B0AF] focus:ring-2 focus:ring-[#02B0AF]/20 disabled:opacity-60"
      />
      <p className="mt-1 text-xs text-[#6F867D]">
        ค้นหาอย่างน้อย 2 ตัวอักษร · รวมสินค้าที่ไม่ได้แสดงให้ลูกค้า · แสดงสูงสุด 20 รายการ
      </p>

      {searching && <p className="mt-3 text-sm text-[#617B71]">กำลังค้นหา...</p>}
      {!searching && query.trim().length >= 2 && matches.length === 0 && !errorMessage && !disabled && (
        <p className="mt-3 text-sm text-[#617B71]">ไม่พบสินค้าที่ตรงกับคำค้นหา</p>
      )}
      {matches.length > 0 && (
        <div className="mt-3 max-h-64 divide-y overflow-y-auto rounded-xl border border-[#D7E9E2] bg-white">
          {matches.map((product) => (
            <button
              key={product.product_id}
              type="button"
              onClick={() => chooseProduct(product)}
              disabled={disabled || saving}
              aria-pressed={selected?.product_id === product.product_id}
              className={"flex w-full flex-col gap-1 px-4 py-3 text-left text-sm hover:bg-[#EFF8F4] disabled:opacity-60 sm:flex-row sm:items-center sm:justify-between " +
                (selected?.product_id === product.product_id ? "bg-[#E6F7F1]" : "")}
            >
              <span className="min-w-0">
                <strong className="block text-[#234D40]">{product.product_name}</strong>
                <span className="text-xs text-[#738B81]">
                  SKU {product.sku} · {product.unit}{!product.is_active ? " · ปิดใช้งาน" : ""}
                </span>
              </span>
              <span className="shrink-0 text-xs font-semibold text-[#426E61]">
                ปกติ ฿{baht(Number(product.normal_price))} · ต้นทุน{" "}
                {product.cost === null ? "N/A" : "฿" + baht(Number(product.cost))}
              </span>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <div className="mt-4 rounded-xl border border-[#BFDCD3] bg-white p-4">
          <div className="mb-4">
            <p className="font-bold text-[#17453F]">{selected.product_name}</p>
            <p className="text-xs text-[#6A857A]">SKU {selected.sku} · {selected.unit}</p>
            <p className="mt-2 text-xs text-[#6A857A]">
              ปัจจุบัน: ราคาปกติ ฿{baht(oldPrice ?? 0)} · ต้นทุน{" "}
              {oldCost === null ? "N/A" : "฿" + baht(oldCost)}
            </p>
            <p className={"mt-1 text-xs " +
              (oldPrice !== null && oldCost !== null && oldPrice < oldCost ? "font-semibold text-red-700" : "text-[#6A857A]")}>
              {grossProfitLabel(oldPrice, oldCost)}
            </p>
          </div>
          <div className="mb-5 rounded-xl border border-[#BFDCD3] bg-[#F4FAF7] p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-sm font-extrabold text-[#17453F]">สถานะขายใน Lotus’s B2B MINI App</p>
                <p className="mt-1 text-xs text-[#6A857A]">เปลี่ยนได้ทุกเมื่อ · ไม่กระทบสต็อกหน้าร้านหรือคำสั่งซื้อเดิม</p>
              </div>
              <span className={outOfStock === null
                ? "rounded-full bg-gray-100 px-3 py-1 text-xs font-bold text-gray-600"
                : outOfStock ? "rounded-full bg-red-100 px-3 py-1 text-xs font-bold text-red-700"
                  : "rounded-full bg-[#DDF5E9] px-3 py-1 text-xs font-bold text-[#087E68]"}>
                {availabilityLoading ? "กำลังตรวจสอบ..." : outOfStock === null ? "ไม่ทราบสถานะ" : outOfStock ? "สินค้าหมดชั่วคราว" : "พร้อมให้สั่งซื้อ"}
              </span>
            </div>
            <button type="button"
              disabled={disabled || saving || availabilityLoading || availabilitySaving || outOfStock === null}
              onClick={() => void toggleOutOfStock()}
              className={`mt-4 min-h-12 w-full rounded-xl px-4 py-3 text-sm font-extrabold disabled:cursor-not-allowed disabled:opacity-50 ${outOfStock ? "border border-[#A7DCD3] bg-[#E6F8F2] text-[#007E75]" : "bg-[#FFF0D6] text-[#986100]"}`}>
              {availabilitySaving ? "กำลังบันทึก..." : outOfStock ? "✓ เปิดให้สั่งซื้ออีกครั้ง" : "สินค้าหมดชั่วคราว — ปิดรับออเดอร์"}
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-bold text-[#315C4F]">
              ราคาปกติใหม่ (฿ / {selected.unit})
              <input
                type="text"
                inputMode="decimal"
                value={normalDraft}
                onChange={(event) => {
                  setNormalDraft(event.target.value);
                  setSuccessMessage("");
                }}
                disabled={disabled || saving}
                className="mt-1.5 w-full rounded-xl border border-[#BBD9D2] px-3 py-3 text-base font-semibold outline-none focus:border-[#02B0AF] disabled:opacity-60"
              />
            </label>
            <label className="block text-xs font-bold text-[#315C4F]">
              ต้นทุนใหม่ (฿ / {selected.unit})
              <input
                type="text"
                inputMode="decimal"
                value={costDraft}
                onChange={(event) => {
                  setCostDraft(event.target.value);
                  setSuccessMessage("");
                }}
                disabled={disabled || saving}
                className="mt-1.5 w-full rounded-xl border border-[#BBD9D2] px-3 py-3 text-base font-semibold outline-none focus:border-[#02B0AF] disabled:opacity-60"
              />
            </label>
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-[#738B81]">
              ต้นทุนเกิน 2 ทศนิยมจะถูกปัดเป็น 2 ตำแหน่ง · พิมพ์ N/A หากไม่มีต้นทุน
            </p>
            <button
              type="button"
              onClick={() => setCostDraft("N/A")}
              disabled={disabled || saving}
              className="rounded-lg border border-[#BBD9D2] px-3 py-2 text-xs font-semibold text-[#316857] disabled:opacity-60"
            >
              ตั้งต้นทุนเป็น N/A
            </button>
          </div>
          {(!validNormal || !parsedCost.valid) && (
            <p className="mt-2 text-xs font-semibold text-red-700">
              {!validNormal
                ? "ราคาปกติต้องเป็นตัวเลขไม่ติดลบ ทศนิยมไม่เกิน 2 ตำแหน่ง"
                : "ต้นทุนต้องเป็นตัวเลขไม่ติดลบ หรือ N/A"}
            </p>
          )}
          <p className={"mt-3 rounded-lg p-3 text-sm font-semibold " +
            (belowCost ? "bg-red-50 text-red-700" : "bg-[#EAF8F1] text-[#166450]")}>
            หลังปรับ: {grossProfitLabel(nextPrice, nextCost)}
            {belowCost ? " · ⚠ ราคาขายต่ำกว่าต้นทุน" : ""}
          </p>
          <button
            type="button"
            disabled={!canSave}
            onClick={() => void saveAdjustment()}
            className="mt-3 w-full rounded-xl bg-[#02B0AF] px-5 py-3 font-extrabold text-white disabled:cursor-not-allowed disabled:bg-[#D9E7E1] disabled:text-[#80988D]"
          >
            {saving ? "กำลังบันทึก..." : "ยืนยันการปรับราคาปกติ / ต้นทุน"}
          </button>
        </div>
      )}

      {disabled && (
        <p className="mt-3 text-xs font-semibold text-amber-700">
          ปิดการปรับรายสินค้าไว้ชั่วคราวระหว่างนำเข้าหรือรีเซ็ต Product Master
        </p>
      )}
      {errorMessage && (
        <p role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {errorMessage}
        </p>
      )}
      {successMessage && (
        <p role="status" className="mt-3 rounded-xl border border-green-200 bg-green-50 p-3 text-sm font-semibold text-green-700">
          {successMessage}
        </p>
      )}
    </div>
  );
}
