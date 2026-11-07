"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import LotusLoading from "@/components/LotusLoading";
import { supabase } from "@/lib/supabase";

type StockProduct = { sku: string; productName: string; unit: string | null };
type StockCount = { sku: string; quantity_kg: number | string; counted_at: string };

export default function MorningStockCountPage() {
  const [access, setAccess] = useState<"loading" | "allowed" | "denied">("loading");
  const [date, setDate] = useState("");
  const [products, setProducts] = useState<StockProduct[]>([]);
  const [saved, setSaved] = useState<Record<string, number>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    void (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!live) return;
      if (!auth.user) return setAccess("denied");
      const { data: staff, error: staffError } = await supabase.from("staff")
        .select("account_type, is_active").eq("auth_user_id", auth.user.id).maybeSingle();
      if (!live) return;
      setAccess(!staffError && staff?.is_active === true && ["manager", "staff"].includes(staff.account_type) ? "allowed" : "denied");
    })();
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (access !== "allowed") return;
    let live = true;
    void (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) throw new Error("กรุณาเข้าสู่ระบบอีกครั้ง");
        const response = await fetch("/api/stock/morning-counts", {
          headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "โหลดรายการสินค้าไม่สำเร็จ");
        if (!live) return;
        setDate(result.countDate);
        setProducts(result.products ?? []);
        const old: Record<string, number> = {};
        for (const row of (result.counts ?? []) as StockCount[]) old[row.sku] = Number(row.quantity_kg);
        setSaved(old);
      } catch (caught) { if (live) setError(caught instanceof Error ? caught.message : "โหลดข้อมูลไม่สำเร็จ"); }
    })();
    return () => { live = false; };
  }, [access]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return products.filter((product) => !query || `${product.sku} ${product.productName}`.toLowerCase().includes(query));
  }, [products, search]);
  const visible = filtered.slice(page * 30, page * 30 + 30);
  const completed = products.filter((product) => Object.hasOwn(saved, product.sku)).length;
  const changed = Object.entries(drafts).filter(([, value]) => value.trim() !== "");

  async function saveCounts() {
    const counts = changed.map(([sku, quantity]) => ({ sku, quantityKg: Number(quantity) }));
    if (!counts.length || working) return;
    if (counts.some((row) => !Number.isFinite(row.quantityKg) || row.quantityKg < 0 ||
      Math.abs(row.quantityKg * 1000 - Math.round(row.quantityKg * 1000)) > 1e-6)) {
      setError("จำนวนคงเหลือต้องไม่ติดลบ และใช้ทศนิยมได้ไม่เกิน 3 ตำแหน่ง");
      return;
    }
    setWorking(true); setError(""); setMessage("");
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("กรุณาเข้าสู่ระบบอีกครั้ง");
      for (let offset = 0; offset < counts.length; offset += 150) {
        const chunk = counts.slice(offset, offset + 150);
        const response = await fetch("/api/stock/morning-counts", {
          method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ counts: chunk }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "บันทึกไม่สำเร็จ");
      }
      setSaved((old) => Object.fromEntries([...Object.entries(old), ...counts.map((row) => [row.sku, row.quantityKg]) ]));
      setDrafts({});
      setMessage(`บันทึกสต็อกแล้ว ${counts.length} SKU`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "บันทึกไม่สำเร็จ"); }
    finally { setWorking(false); }
  }

  if (access === "loading") return <LotusLoading message="กำลังตรวจสอบสิทธิ์บันทึกสต็อก..." />;
  if (access === "denied") return <main className="min-h-screen bg-[#F3F8F7] p-6 text-center text-[#17453F]">เมนูนี้สำหรับพนักงานและผู้จัดการที่เข้าสู่ระบบแล้ว <Link href="/login" className="underline">กลับหน้าแรก</Link></main>;

  return (
    <main className="min-h-screen bg-[#F3F8F7] px-3 pb-28 pt-5 sm:px-6">
      <div className="mx-auto max-w-4xl">
        <header className="rounded-2xl border border-[#CDE9E3] bg-white p-4 sm:p-6">
          <p className="text-xs font-extrabold text-[#008B8B]">LOTUS’S B2B / MORNING STOCK COUNT</p>
          <h1 className="mt-2 text-2xl font-black text-[#17453F]">บันทึกสต็อกเช้า · เนื้อสด</h1>
          <p className="mt-1 text-sm text-[#66857C]">วันที่ {date || "กำลังโหลด..."} · นับสต็อกที่พร้อมขายจริง หน่วย กก.</p>
          <p className="mt-2 rounded-lg bg-[#FFF4D4] p-3 text-xs leading-5 text-[#795D17]">ให้นับสต็อกก่อนเริ่มขายหรือ Picking ของวัน และบันทึกก่อน 10:00 น. · ระบบจะหักยอดขายที่คาดว่าจะเกิดขึ้นในวันนี้ออกจากสต็อกเช้า จึงไม่ควรนับหลังจากขาย/หยิบสินค้าไปแล้ว มิฉะนั้นยอดนั้นอาจถูกหักซ้ำ · สินค้าที่แยกไป Picking แล้วอย่านับซ้ำ · ช่องว่างหมายถึงยังไม่ได้นับ ส่วนเลข 0 หมายถึงนับแล้วว่าไม่มีสต็อก</p>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-bold text-[#38746C]">นับแล้ว {completed} / {products.length} SKU</p>
            <Link href="/stock-management" className="text-sm font-bold text-[#008B8B] underline">ไปหน้าพยากรณ์ (Manager)</Link>
          </div>
        </header>
        <section className="mt-4 rounded-2xl border border-[#CDE9E3] bg-white p-3 sm:p-5">
          <input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }}
            placeholder="ค้นหา SKU หรือชื่อสินค้า" aria-label="ค้นหาสินค้า"
            className="min-h-12 w-full rounded-xl border border-[#CDE5DE] px-4 text-sm outline-none focus:border-[#02B0AF]" />
          <div className="mt-3 space-y-2">
            {visible.map((product) => (
              <div key={product.sku} className="flex items-center gap-3 rounded-xl border border-[#E0ECE8] px-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-black text-[#17453F]">{product.productName}</p>
                  <p className="text-[11px] text-[#6B8A80]">{product.sku} · {Object.hasOwn(saved, product.sku) ? `บันทึกแล้ว ${saved[product.sku]} กก.` : "ยังไม่ตรวจนับ"}</p>
                </div>
                <input type="number" min="0" step="0.001" inputMode="decimal" value={drafts[product.sku] ?? ""}
                  placeholder={Object.hasOwn(saved, product.sku) ? String(saved[product.sku]) : "กก."}
                  onChange={(event) => setDrafts((old) => ({ ...old, [product.sku]: event.target.value }))}
                  aria-label={`สต็อก ${product.productName} (กก.)`}
                  className="h-11 w-24 rounded-lg border border-[#BDDCD5] px-2 text-right text-sm font-bold text-[#17453F] outline-none focus:border-[#02B0AF]" />
              </div>
            ))}
            {visible.length === 0 && <p className="p-5 text-center text-sm text-[#68867D]">ไม่พบสินค้าที่ตรงกับการค้นหา</p>}
          </div>
          <div className="mt-4 flex items-center justify-between gap-2">
            <button type="button" disabled={page === 0} onClick={() => setPage((old) => old - 1)} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-40">ก่อนหน้า</button>
            <p className="text-xs text-[#718C84]">{filtered.length ? page + 1 : 0} / {Math.ceil(filtered.length / 30)} หน้า</p>
            <button type="button" disabled={(page + 1) * 30 >= filtered.length} onClick={() => setPage((old) => old + 1)} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-40">ถัดไป</button>
          </div>
          {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          {message && <p role="status" className="mt-3 rounded-lg bg-[#E5F8F5] p-3 text-sm font-bold text-[#006F6B]">{message}</p>}
          <button type="button" disabled={!changed.length || working} onClick={() => void saveCounts()}
            className="mt-4 min-h-12 w-full rounded-xl bg-[#02B0AF] px-4 py-3 font-black text-white disabled:opacity-45">
            {working ? "กำลังบันทึก..." : `บันทึกสต็อก ${changed.length} SKU`}
          </button>
        </section>
      </div>
    </main>
  );
}
