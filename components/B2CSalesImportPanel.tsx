"use client";

import { useEffect, useState, type ChangeEvent } from "react";
import { supabase } from "@/lib/supabase";

type ImportPreview = {
  format: "daily" | "total";
  periodStart: string;
  periodEnd: string;
  dates: { date: string; weekday: string }[];
  blankAsZero: boolean | null;
  totalSkus: number;
  matchedSkus: number;
  unmatchedSkus: number;
  unmatchedExamples: string[];
  unitWarnings: string[];
  sample: { sku: string; soldQty: number; unit: string | null; productName: string; quantities?: (number | null)[] }[];
};
type ActiveImport = { id: string; period_start: string; period_end: string; source_filename: string; row_count: number; imported_at: string; format: "daily" | "total"; sales_scope: "unverified" | "b2c_only" | "all_store" };

export default function B2CSalesImportPanel() {
  const [active, setActive] = useState<ActiveImport | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [blankAsZero, setBlankAsZero] = useState(true);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) return;
        const response = await fetch("/api/admin/b2c-sales-import", {
          headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
        });
        if (!response.ok) return;
        const result = await response.json();
        if (live) setActive(result.activeImport ?? null);
      } catch { /* An unavailable import must not break the demand page. */ }
    })();
    return () => { live = false; };
  }, []);

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    setFile(event.target.files?.[0] ?? null);
    setPreview(null); setMessage(""); setError("");
  }

  async function submit(mode: "preview" | "commit") {
    if (!file || busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("กรุณาเข้าสู่ระบบใหม่");
      const form = new FormData();
      form.set("file", file); form.set("periodStart", periodStart); form.set("periodEnd", periodEnd); form.set("mode", mode); form.set("blankAsZero", String(blankAsZero));
      const response = await fetch("/api/admin/b2c-sales-import", {
        method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form,
      });
      const result = await response.json();
      if (!response.ok) throw new Error([result.error, ...(result.errors ?? []).slice(0, 8)].filter(Boolean).join(" · ") || "นำเข้าไม่สำเร็จ");
      setPreview(result.preview ?? null);
      if (result.imported) {
        setActive({ id: result.importId, period_start: result.preview.periodStart, period_end: result.preview.periodEnd,
          source_filename: file.name, row_count: result.preview.totalSkus, imported_at: new Date().toISOString(), format: result.preview.format, sales_scope: "b2c_only" });
        setMessage(`นำเข้าสำเร็จ ${result.preview.totalSkus} SKU · ใช้เป็นฐาน B2C ปัจจุบันแล้ว`);
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : "นำเข้าไม่สำเร็จ"); }
    finally { setBusy(false); }
  }

  return (
    <details className="mt-5 overflow-hidden rounded-2xl border border-[#CDE9E3] bg-white">
      <summary className="cursor-pointer p-4 text-base font-black text-[#17453F] marker:text-[#02B0AF] sm:p-5">
        นำเข้ายอดขาย B2C · รายวัน / ยอดรวม (Excel)
      </summary>
      <div className="space-y-4 border-t border-[#DCEAE6] p-4 sm:p-5">
        {active ? <p className="rounded-lg bg-[#E8F8F4] px-3 py-2 text-xs leading-5 text-[#28766D]">
          ฐานข้อมูลปัจจุบัน: {active.format === "daily" ? "รายวัน" : "ยอดรวม 30 วัน"} · {active.row_count.toLocaleString()} SKU · ช่วง {active.period_start} ถึง {active.period_end} · {active.source_filename}
        </p> : <p className="rounded-lg bg-[#FFF4DC] px-3 py-2 text-xs text-[#826324]">ยังไม่มียอดขาย B2C ที่นำเข้า · ตัวเลขรวม B2B+B2C จะยังไม่พร้อมใช้งาน</p>}
        <p className="text-xs leading-5 text-[#68867D]">รูปแบบใหม่: SKU อยู่แถวซ้าย วันที่อยู่หัวคอลัมน์ เช่น <strong>01/09/2026, 02/09/2026</strong> ไม่จำกัดเดือน (7–120 วันติดต่อกัน) · ระบบอ่านวันที่และคำนวณวันในสัปดาห์ให้อัตโนมัติ · ยอดขายต้องเป็นจำนวน ไม่ใช่เงินบาท · หน่วยเนื้อสดเป็น กก.</p>
        <label className="flex items-start gap-2 rounded-lg bg-[#FFF8E8] p-3 text-xs leading-5 text-[#785D21]">
          <input type="checkbox" checked={blankAsZero} onChange={(event) => { setBlankAsZero(event.target.checked); setPreview(null); }} className="mt-1" />
          <span>ช่องยอดขายรายวันที่ว่างเปล่า = ขาย 0 (ค่าเริ่มต้นสำหรับตาราง Power BI) · หากช่องว่างหมายถึงข้อมูลไม่พร้อม ให้เอาเครื่องหมายออก ระบบจะไม่นับช่องว่างเป็นตัวอย่าง</span>
        </label>
        <details className="rounded-lg border border-[#DCEAE6] p-3">
          <summary className="cursor-pointer text-xs font-bold text-[#416D65]">กรณีใช้ไฟล์ยอดรวม 30 วันแบบเดิมเท่านั้น: ระบุวันที่รายงาน</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-bold text-[#486E65]">วันแรกของรายงาน
            <input type="date" value={periodStart} onChange={(event) => { setPeriodStart(event.target.value); setPreview(null); }} className="mt-1 min-h-11 w-full rounded-lg border border-[#CDE5DE] px-3" />
          </label>
          <label className="text-xs font-bold text-[#486E65]">วันสุดท้ายของรายงาน (รวม 30 วัน)
            <input type="date" value={periodEnd} onChange={(event) => { setPeriodEnd(event.target.value); setPreview(null); }} className="mt-1 min-h-11 w-full rounded-lg border border-[#CDE5DE] px-3" />
          </label>
          </div>
        </details>
        <input type="file" accept=".xlsx,.xls" onChange={chooseFile}
          aria-label="เลือกไฟล์ Excel ยอดขาย B2C" className="block w-full text-xs file:mr-3 file:rounded-lg file:border-0 file:bg-[#E4F8F4] file:px-3 file:py-3 file:font-bold file:text-[#008B8B]" />
        <button type="button" disabled={!file || busy}
          onClick={() => void submit("preview")}
          className="min-h-11 rounded-xl border border-[#7DC9BC] bg-[#E7F8F4] px-5 text-sm font-black text-[#008B8B] disabled:opacity-40">
          {busy ? "กำลังอ่าน Excel..." : "ตรวจสอบและแสดงตัวอย่าง"}
        </button>
        {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-xs text-red-700">{error}</p>}
        {message && <p role="status" className="rounded-lg bg-[#E4F8F4] p-3 text-xs font-bold text-[#008B8B]">{message}</p>}
        {preview && <div className="space-y-3">
          <p className="rounded-lg bg-[#E8F8F4] p-3 text-xs font-bold text-[#26796F]">
            รูปแบบ {preview.format === "daily" ? `รายวัน ${preview.dates.length} วัน` : "ยอดรวม 30 วัน"} · {preview.periodStart} ถึง {preview.periodEnd}
          </p>
          {preview.format === "daily" && <div className="max-h-36 overflow-auto rounded-lg border border-[#DCEAE6] p-2 text-xs">
            <p className="font-bold text-[#315C54]">วันที่และวันในสัปดาห์ (ระบบคำนวณให้)</p>
            <div className="mt-2 flex flex-wrap gap-1">{preview.dates.map(({ date, weekday }) => <span key={date} className="rounded-md bg-[#EFF7F4] px-2 py-1">{date.slice(5)} · {weekday}</span>)}</div>
          </div>}
          <p className="text-sm font-black text-[#17453F]">พบ {preview.totalSkus.toLocaleString()} SKU · ตรง Master {preview.matchedSkus.toLocaleString()} · ไม่พบ {preview.unmatchedSkus.toLocaleString()}</p>
          {preview.unmatchedSkus > 0 && <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">SKU ที่ไม่พบใน Master จะเก็บไว้เพื่อ audit แต่ไม่ใช้คำนวณ: {preview.unmatchedExamples.join(", ")}</p>}
          {preview.unitWarnings.length > 0 && <p className="rounded-lg bg-red-50 p-3 text-xs text-red-700">หน่วยไม่ตรง Master: {preview.unitWarnings.slice(0, 8).join(" · ")}</p>}
          <div className="overflow-x-auto rounded-lg border border-[#DCEAE6]">
            <table className="w-full min-w-[440px] text-left text-xs">
              <thead className="bg-[#EFF8F5] text-[#3F7469]"><tr><th className="p-2">SKU</th><th className="p-2">สินค้า</th><th className="p-2 text-right">ยอดรวมช่วงที่เลือก</th>{preview.format === "daily" && preview.dates.slice(0, 7).map(({ date, weekday }) => <th className="p-2 text-right" key={date}>{date.slice(5)}<br />{weekday}</th>)}</tr></thead>
              <tbody>{preview.sample.map((row) => <tr key={row.sku} className="border-t border-[#E3EDE9]"><td className="p-2">{row.sku}</td><td className="p-2">{row.productName}</td><td className="p-2 text-right tabular-nums">{row.soldQty.toLocaleString()} {row.unit ?? ""}</td>{preview.format === "daily" && row.quantities?.slice(0, 7).map((value, index) => <td key={index} className="p-2 text-right">{value ?? "—"}</td>)}</tr>)}</tbody>
            </table>
          </div>
          <button type="button" disabled={busy || preview.unitWarnings.length > 0} onClick={() => void submit("commit")}
            className="min-h-12 w-full rounded-xl bg-[#02B0AF] p-3 text-sm font-black text-white disabled:opacity-40">
            {busy ? "กำลังบันทึก..." : "ยืนยันนำเข้าฐานยอดขาย B2C"}
          </button>
        </div>}
      </div>
    </details>
  );
}
