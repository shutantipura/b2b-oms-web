"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type VisibilityFilter = "all" | "visible" | "hidden";
type ProductRow = {
  id: string;
  sku: string;
  product_name: string;
  category: string | null;
  unit: string | null;
  normal_price: number | string | null;
  is_customer_visible: boolean;
  sales_score: number | string | null;
  total_count: number | string;
};

const PAGE_SIZE = 30;

function formatMoney(value: number | string | null) {
  const number = Number(value);
  return value == null || !Number.isFinite(number)
    ? "—"
    : "฿" + number.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function VisibilityBadge({ visible }: { visible: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-extrabold ${visible
      ? "border-[#A5E1D4] bg-[#E0F7F1] text-[#007A73]"
      : "border-[#DCE4E1] bg-[#F3F5F4] text-[#63766E]"}`}>
      <span aria-hidden="true">{visible ? "●" : "○"}</span>
      {visible ? "แสดงอยู่" : "ซ่อนอยู่"}
    </span>
  );
}

export default function ManualVisibleProductsPage() {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<VisibilityFilter>("all");
  const [page, setPage] = useState(0);
  const [reload, setReload] = useState(0);
  const [rows, setRows] = useState<ProductRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setPage(0);
      setQuery(search.trim());
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [search]);

  const loadProducts = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    setError("");

    try {
      const { data, error: rpcError } = await supabase.rpc("search_products_for_visibility", {
        p_query: query,
        p_filter: filter,
        p_offset: page * PAGE_SIZE,
        p_limit: PAGE_SIZE,
      });
      if (id !== requestId.current) return;
      if (rpcError) throw rpcError;
      const products = (data ?? []) as ProductRow[];
      setRows(products);
      setTotal(products.length > 0 ? Number(products[0].total_count) || 0 : 0);
    } catch (e) {
      if (id !== requestId.current) return;
      setRows([]);
      setTotal(0);
      setError(e instanceof Error ? e.message : "ไม่สามารถโหลดรายการสินค้าได้");
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [filter, page, query, reload]);

  useEffect(() => {
    void loadProducts();
    return () => { requestId.current += 1; };
  }, [loadProducts]);

  async function updateVisibility(product: ProductRow) {
    if (saving) return;
    const next = !product.is_customer_visible;
    const action = next ? "แสดง" : "ซ่อน";
    if (!window.confirm(
      `ยืนยัน${action}สินค้านี้สำหรับลูกค้าทุกราย?\n\n` +
      `${product.product_name}\nSKU: ${product.sku}\n\n` +
      (next
        ? "สินค้านี้จะปรากฏในแคตตาล็อกที่ลูกค้าสั่งซื้อได้"
        : "สินค้านี้จะถูกซ่อนจากแคตตาล็อกลูกค้าทุกราย แต่ไม่ถูกลบจาก Product Master")
    )) return;

    setSaving(product.id);
    setNotice("");
    setError("");
    try {
      const { data, error: rpcError } = await supabase.rpc("set_product_customer_visibility", {
        p_product_id: product.id,
        p_visible: next,
      });
      if (rpcError) throw rpcError;
      if (!data?.success || data.is_customer_visible !== next) {
        throw new Error("ระบบไม่ได้ยืนยันการเปลี่ยนแปลง กรุณาลองอีกครั้ง");
      }
      setNotice(`✓ ${action}สินค้า SKU ${product.sku} เรียบร้อยแล้ว`);
      setReload((current) => current + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
    } finally {
      setSaving(null);
    }
  }

  const filters: { value: VisibilityFilter; title: string }[] = [
    { value: "all", title: "ทั้งหมด" },
    { value: "visible", title: "แสดงอยู่" },
    { value: "hidden", title: "ซ่อนอยู่" },
  ];

  return (
    <main className="min-h-screen bg-[#F3F8F7] px-3 pb-28 pt-5 text-[#21493F] sm:px-6 sm:py-8">
      <div className="mx-auto max-w-6xl space-y-5">
        <Link href="/catalog" className="inline-flex min-h-11 items-center rounded-xl border border-[#D5E8E2] bg-white px-4 py-2 text-sm font-extrabold text-[#008985]">
          ← กลับไปสินค้าและราคา
        </Link>

        <section className="rounded-3xl border border-[#CDE7E0] bg-white p-5 shadow-sm sm:p-7">
          <p className="text-[11px] font-extrabold tracking-widest text-[#008F89]">PRODUCTS & PRICES / VISIBLE CATALOGUE</p>
          <h1 className="mt-2 text-2xl font-black sm:text-3xl">จัดการสินค้าที่แสดงให้ลูกค้า</h1>
          <p className="mt-2 text-sm leading-6 text-[#648178]">
            ค้นหาสินค้าจาก Product Master และกำหนดให้แสดงหรือซ่อนเป็นราย SKU
            การตั้งค่านี้มีผลกับแคตตาล็อกของลูกค้าทุกราย
          </p>
          <div className="mt-4 rounded-xl border border-[#F0D58C] bg-[#FFF8E8] p-3 text-xs leading-5 text-[#835F12]">
            Excel import จะเปลี่ยนรายการที่แสดงทั้งชุด หากนำเข้าไฟล์ใหม่ในภายหลัง ระบบจะใช้ผลจากไฟล์นั้นแทนการแก้ไขรายตัว
          </div>
        </section>

        <section className="rounded-3xl border border-[#D6E8E2] bg-white p-4 shadow-sm sm:p-6">
          <label htmlFor="visibility-product-search" className="block text-sm font-extrabold">ค้นหาสินค้า</label>
          <input
            id="visibility-product-search"
            type="search"
            value={search}
            onChange={(event) => { setSearch(event.target.value); setNotice(""); }}
            placeholder="ค้นหา SKU, ชื่อสินค้า หรือหมวดสินค้า"
            className="mt-2 h-12 w-full rounded-xl border-2 border-[#C8E4DC] bg-[#FAFDFC] px-4 text-base outline-none focus:border-[#02B0AF] focus:ring-2 focus:ring-[#02B0AF]/15"
          />
          <div className="mt-4 flex flex-wrap gap-2" aria-label="กรองสถานะการแสดงสินค้า">
            {filters.map((item) => (
              <button
                key={item.value}
                type="button"
                aria-pressed={filter === item.value}
                onClick={() => { setFilter(item.value); setPage(0); setNotice(""); }}
                className={`min-h-10 rounded-xl px-4 py-2 text-sm font-bold ${filter === item.value
                  ? "bg-[#02B0AF] text-white shadow-sm"
                  : "border border-[#D7E8E2] bg-[#F5FAF8] text-[#59796E]"}`}
              >
                {item.title}
              </button>
            ))}
          </div>
          <div className="mt-4 flex items-center justify-between gap-3 text-sm text-[#6A8178]">
            <p aria-live="polite">{loading ? "กำลังโหลดรายการ..." : `พบ ${total.toLocaleString("th-TH")} SKU`}</p>
            <button type="button" onClick={() => { setNotice(""); setReload((i) => i + 1); }}
              disabled={loading || saving !== null}
              className="rounded-xl border border-[#C4DED6] px-3 py-2 font-bold text-[#007F79] disabled:opacity-40">
              ↻ รีเฟรช
            </button>
          </div>
        </section>

        {error && <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm font-semibold text-red-800">{error}</div>}
        {notice && <div role="status" className="rounded-xl border border-[#A4E0D3] bg-[#E6F9F4] p-4 text-sm font-bold text-[#00786F]">{notice}</div>}

        <section className="overflow-hidden rounded-3xl border border-[#D6E8E2] bg-white shadow-sm">
          <div className="hidden grid-cols-[125px_minmax(0,2fr)_minmax(0,1fr)_120px_110px_125px] gap-3 bg-[#EAF6F2] px-5 py-4 text-xs font-black text-[#41665A] md:grid">
            <span>SKU</span><span>สินค้า</span><span>หมวดสินค้า</span><span>ราคาปกติ</span><span>สถานะ</span><span className="text-right">จัดการ</span>
          </div>
          {loading ? (
            <div className="p-12 text-center text-sm text-[#71877E]">กำลังค้นหาสินค้า...</div>
          ) : rows.length === 0 ? (
            <div className="p-12 text-center text-sm text-[#71877E]">ไม่พบสินค้า ลองเปลี่ยนคำค้นหาหรือตัวกรอง</div>
          ) : (
            <div className="divide-y divide-[#E2EEEA]">
              {rows.map((product) => (
                <article key={product.id}
                  className="grid gap-3 p-4 sm:p-5 md:grid-cols-[125px_minmax(0,2fr)_minmax(0,1fr)_120px_110px_125px] md:items-center">
                  <p className="break-all text-sm font-extrabold text-[#008782]">{product.sku}</p>
                  <div className="min-w-0">
                    <p className="font-bold leading-6">{product.product_name}</p>
                    <p className="mt-1 text-xs text-[#7A9289]">{product.unit ?? "—"}</p>
                  </div>
                  <p className="text-sm text-[#70857D]">{product.category ?? "ไม่มีหมวด"}</p>
                  <p className="text-sm font-bold">{formatMoney(product.normal_price)}</p>
                  <div><VisibilityBadge visible={product.is_customer_visible}/></div>
                  <button
                    type="button"
                    disabled={saving !== null}
                    onClick={() => void updateVisibility(product)}
                    className={`min-h-11 rounded-xl border px-3 py-2.5 text-sm font-extrabold transition disabled:cursor-wait disabled:opacity-50 ${product.is_customer_visible
                      ? "border-[#E8CBCB] bg-[#FFF3F3] text-[#B14848]"
                      : "border-[#83D8C9] bg-[#02B0AF] text-white"}`}
                  >
                    {saving === product.id ? "กำลังบันทึก..." : product.is_customer_visible ? "ซ่อนสินค้า" : "แสดงสินค้า"}
                  </button>
                </article>
              ))}
            </div>
          )}
          <div className="flex items-center justify-between gap-3 border-t border-[#DDECE6] bg-[#F8FBFA] p-4">
            <button type="button" disabled={page === 0 || loading || saving !== null}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="min-h-11 rounded-xl border border-[#C4DDD5] bg-white px-4 text-sm font-bold disabled:opacity-35">← ก่อนหน้า</button>
            <p className="text-center text-xs font-bold text-[#5B776D]">
              หน้า {page + 1}{total > 0 ? ` / ${Math.ceil(total / PAGE_SIZE)}` : ""}
            </p>
            <button type="button" disabled={loading || saving !== null || (page + 1) * PAGE_SIZE >= total}
              onClick={() => setPage((p) => p + 1)}
              className="min-h-11 rounded-xl border border-[#C4DDD5] bg-white px-4 text-sm font-bold disabled:opacity-35">ถัดไป →</button>
          </div>
        </section>
      </div>
    </main>
  );
}
