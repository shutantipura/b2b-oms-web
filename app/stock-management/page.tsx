"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import LotusLoading from "@/components/LotusLoading";
import { supabase } from "@/lib/supabase";
import { stockReportDates } from "@/lib/stockSalesReport";

type Access = "loading" | "manager" | "denied" | "signed-out";

export default function StockManagementPage() {
  const [access, setAccess] = useState<Access>("loading");
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");
  const [dates, setDates] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    setDates(stockReportDates());
    void (async () => {
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (!active) return;
      if (authError || !auth.user) {
        setAccess("signed-out");
        return;
      }
      const { data: staff, error: staffError } = await supabase
        .from("staff")
        .select("account_type, is_active")
        .eq("auth_user_id", auth.user.id)
        .maybeSingle();
      if (!active) return;
      setAccess(!staffError && staff?.account_type === "manager" && staff.is_active === true ? "manager" : "denied");
    })();
    return () => { active = false; };
  }, []);

  async function downloadReport() {
    if (access !== "manager" || downloading) return;
    setDownloading(true);
    setError("");
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (sessionError || !token) throw new Error("เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่");

      const response = await fetch("/api/admin/stock-sales", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(typeof body.error === "string" ? body.error : "ดาวน์โหลดรายงานไม่สำเร็จ");
      }
      const file = await response.blob();
      const url = URL.createObjectURL(file);
      const link = document.createElement("a");
      link.href = url;
      link.download = `stock_sales_${dates[0] ?? "start"}_${dates[dates.length - 1] ?? "end"}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "ดาวน์โหลดรายงานไม่สำเร็จ");
    } finally {
      setDownloading(false);
    }
  }

  if (access === "loading") return <LotusLoading message="กำลังตรวจสอบสิทธิ์จัดการสต็อก..." />;

  if (access !== "manager") {
    return (
      <main className="min-h-screen bg-[#F3F8F7] px-4 pb-28 pt-8">
        <section className="mx-auto max-w-lg rounded-2xl border border-[#D7EAE6] bg-white p-6 text-center shadow-sm">
          <h1 className="text-2xl font-black text-[#17453F]">จัดการสต็อก</h1>
          <p className="mt-3 text-sm text-[#6E8982]">
            {access === "signed-out" ? "กรุณาเข้าสู่ระบบก่อนใช้งาน" : "เมนูนี้สำหรับผู้จัดการเท่านั้น"}
          </p>
          <Link href="/login" className="mt-5 inline-flex min-h-11 items-center rounded-xl bg-[#02B0AF] px-5 font-bold text-white">
            กลับหน้าหลัก
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#F3F8F7] px-4 pb-28 pt-6 sm:px-7 sm:py-8">
      <div className="mx-auto max-w-5xl">
        <header className="rounded-[24px] border border-[#CDE9E3] bg-gradient-to-br from-[#E8FAF6] to-white p-5 sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-extrabold tracking-[0.13em] text-[#008B8B]">LOTUS’S B2B / OMS</p>
              <h1 className="mt-2 text-3xl font-black text-[#17453F]">จัดการสต็อก</h1>
              <p className="mt-2 text-sm text-[#6B8880]">รายงานปริมาณขาย เพื่อเตรียมวางแผนการสั่งสินค้าและสต็อก</p>
            </div>
            <span className="rounded-full border border-[#F7DB83] bg-[#FFF7DC] px-4 py-2 text-sm font-extrabold text-[#815B00]">
              Manager
            </span>
          </div>
        </header>

        <section className="mt-5 rounded-[22px] border border-[#D8E9E5] bg-white p-5 shadow-[0_4px_16px_rgba(18,96,89,0.05)] sm:p-7">
          <div className="flex items-start gap-3">
            <span aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#E6F8F5] text-2xl">📊</span>
            <div>
              <h2 className="text-xl font-black text-[#17453F]">ปริมาณขายย้อนหลัง 14 วัน</h2>
              <p className="mt-1 text-sm text-[#6B8880]">
                {dates.length ? `${dates[0]} – ${dates[dates.length - 1]}` : "14 วันล่าสุด"} (เวลาไทย)
              </p>
            </div>
          </div>

          <p className="mt-5 text-sm leading-7 text-[#466F67]">
            ดาวน์โหลด Excel โดยเรียงแถวตาม <strong>ลูกค้า → รหัสสินค้า → ชื่อสินค้า → หน่วยนับ</strong>
            และแสดงยอดขายแต่ละวันเป็นคอลัมน์ พร้อมยอดรวม 14 วันของสินค้าแต่ละรายการ
          </p>
          <div className="mt-4 rounded-xl bg-[#F3FAF8] p-4 text-sm leading-6 text-[#557C73]">
            <p><strong>วันที่ขาย:</strong> วันที่ปิดงาน Billing สำเร็จ</p>
            <p><strong>ปริมาณขาย:</strong> จำนวนที่หยิบจริง (สินค้าขายตามน้ำหนักจะแสดงเป็น กก.)</p>
            <p><strong>การนับ:</strong> ไม่นับออเดอร์ที่ยกเลิก และนับออเดอร์ที่แยก /1, /2 เพียงครั้งเดียว</p>
          </div>

          {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}

          <button
            type="button"
            disabled={downloading}
            onClick={() => void downloadReport()}
            className="mt-6 flex min-h-14 w-full items-center justify-center gap-3 rounded-2xl bg-[#02B0AF] px-5 py-3 text-base font-extrabold text-white shadow-[0_6px_16px_rgba(0,153,150,0.15)] transition hover:bg-[#009A9A] disabled:cursor-wait disabled:opacity-60 sm:w-auto"
          >
            <span aria-hidden="true">↓</span>
            {downloading ? "กำลังจัดทำไฟล์ Excel..." : "ดาวน์โหลด Excel ปริมาณขาย 14 วัน"}
          </button>
        </section>

        <p className="mt-5 text-center text-xs leading-5 text-[#79928B]">
          ขณะนี้เมนูนี้ใช้สำหรับออกรายงานเท่านั้น · ระบบพยากรณ์ยอดขายและแนะนำสั่งสต็อกจะเพิ่มในระยะถัดไป
        </p>
      </div>
    </main>
  );
}
