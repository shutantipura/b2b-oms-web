"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import LotusLoading from "@/components/LotusLoading";
import { supabase } from "@/lib/supabase";

type OperationalHealth = {
  checkedAt: string;
  unhealthyStations: {
    label: string;
    status: "offline" | "degraded" | "disabled" | "awaiting";
    minutesSinceSeen: number | null;
  }[];
  missingBillCount: number;
  recentMissingBillCount: number;
  missingBillOrders: { orderNumber: number; completedAt: string | null }[];
  manualClosedWithoutBillCount: number;
  manualClosedWithoutBillOrders: { orderNumber: number; completedAt: string | null }[];
};

function deviceStatus(status: OperationalHealth["unhealthyStations"][number]["status"]) {
  switch (status) {
    case "offline": return "ไม่ออนไลน์";
    case "disabled": return "หยุดเฝ้าระวังออเดอร์";
    case "degraded": return "เชื่อม OMS ไม่สำเร็จ";
    case "awaiting": return "ยังไม่เคยเชื่อมต่อ";
  }
}

export default function ManagerWarningsPage() {
  const [report, setReport] = useState<OperationalHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) throw new Error("กรุณาเข้าสู่ระบบก่อนใช้งาน");

      const { data: staff, error: staffError } = await supabase
        .from("staff").select("account_type")
        .eq("auth_user_id", user.id)
        .eq("is_active", true)
        .maybeSingle();
      if (staffError || staff?.account_type !== "manager") {
        throw new Error("เมนูนี้สำหรับ Manager เท่านั้น");
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("กรุณาเข้าสู่ระบบก่อนใช้งาน");
      const response = await fetch("/api/admin/operational-health", {
        headers: { Authorization: "Bearer " + session.access_token },
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok) throw new Error("ไม่สามารถตรวจสอบสถานะได้ กรุณาลองใหม่");
      setReport(data as OperationalHealth);
      setError("");
    } catch (caught) {
      // Never show an old healthy state if authorization or the live check fails.
      setReport(null);
      setError(caught instanceof Error ? caught.message : "ไม่สามารถตรวจสอบสถานะได้");
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const first = window.setTimeout(() => void refresh(), 0);
    const interval = window.setInterval(() => void refresh(), 60_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(interval);
    };
  }, [refresh]);

  if (loading) return <LotusLoading message="กำลังตรวจสอบรายการ..." />;

  const urgentCount = report
    ? report.unhealthyStations.length + report.missingBillCount
    : 0;

  return (
    <main className="min-h-screen bg-[#F3F8F7] px-4 pb-28 pt-5 sm:px-7 sm:py-8">
      <div className="mx-auto w-full max-w-3xl space-y-5">
        <Link href="/login" className="inline-flex min-h-11 items-center gap-2 rounded-full border border-[#CDE6E0] bg-white px-4 py-2 text-sm font-bold text-[#078F8A]">
          <span aria-hidden="true">←</span> กลับหน้าหลัก
        </Link>

        <header className="rounded-[24px] border border-[#CDE9E3] bg-white p-5 sm:p-7">
          <p className="text-xs font-extrabold tracking-[0.12em] text-[#008F8C]">LOTUS’S B2B / MANAGER</p>
          <h1 className="mt-2 text-2xl font-black text-[#17453F]">รายการที่ต้องตรวจสอบ</h1>
          <p className="mt-2 text-sm leading-6 text-[#728D85]">
            รวมปัญหาอุปกรณ์แจ้งเตือนและคำสั่งซื้อที่ต้องตรวจสอบ โดยแยกรายการย้อนหลังออกจากปัญหาเร่งด่วน
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <span className="rounded-full bg-[#EAF7F4] px-3 py-1.5 text-sm font-extrabold text-[#126F65]">
              {report ? (urgentCount > 0 ? urgentCount + " รายการที่ต้องตรวจสอบ" : "ไม่มีรายการเร่งด่วน") : "ไม่สามารถตรวจสอบสถานะได้"}
            </span>
            <button type="button" onClick={() => void refresh()} disabled={refreshing}
              className="rounded-xl border border-[#CFE6E0] bg-white px-4 py-2 text-sm font-bold text-[#078F8A] disabled:opacity-60">
              {refreshing ? "กำลังตรวจสอบ..." : "รีเฟรช"}
            </button>
          </div>
        </header>

        {error && (
          <section role="alert" className="rounded-xl border border-[#E8D7A9] bg-white p-4 text-sm text-[#8A6110]">
            {error}
          </section>
        )}

        {report && (
          <>
            {urgentCount === 0 && (
              <section className="rounded-2xl border border-[#CDE6E0] bg-white p-5 text-sm text-[#356E64]">
                ไม่มีอุปกรณ์ที่รายงานปัญหา และไม่มีคำสั่งซื้อที่ขาดข้อมูลบิลโดยไม่ทราบเหตุผล
              </section>
            )}

            {report.unhealthyStations.length > 0 && (
              <section className="rounded-[22px] border border-[#E0E8E5] bg-white p-5">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-lg font-black text-[#17453F]">อุปกรณ์แจ้งเตือน</h2>
                  <span className="rounded-full bg-[#FFF3D5] px-3 py-1 text-sm font-black text-[#855D0E]">
                    {report.unhealthyStations.length}
                  </span>
                </div>
                <div className="mt-4 space-y-3">
                  {report.unhealthyStations.map((station, i) => (
                    <div key={station.label + "-" + i} className="rounded-xl border border-[#E3EBE7] bg-[#F9FCFA] p-4">
                      <p className="font-extrabold text-[#17453F]">{station.label}</p>
                      <p className="mt-1 text-sm text-[#876219]">
                        {deviceStatus(station.status)}
                        {station.minutesSinceSeen !== null && " · ไม่พบสถานะใหม่ " + station.minutesSinceSeen + " นาที"}
                      </p>
                    </div>
                  ))}
                </div>
                <Link href="/alarm-stations" className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-[#E9F8F5] px-4 py-2 text-sm font-extrabold text-[#008F8C]">
                  ตรวจสอบและจัดการอุปกรณ์
                </Link>
              </section>
            )}

            {report.missingBillCount > 0 && (
              <section className="rounded-[22px] border border-[#E0E8E5] bg-white p-5">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-lg font-black text-[#17453F]">คำสั่งซื้อที่ขาดข้อมูลบิล</h2>
                  <span className="rounded-full bg-[#FFF3D5] px-3 py-1 text-sm font-black text-[#855D0E]">{report.missingBillCount}</span>
                </div>
                <p className="mt-2 text-sm leading-6 text-[#728D85]">
                  {report.recentMissingBillCount > 0
                    ? report.recentMissingBillCount + " รายการเกิดขึ้นใน 14 วันที่ผ่านมา · "
                    : "เป็นรายการย้อนหลัง · "}
                  ตรวจสอบเอกสารจริงก่อนดำเนินการ ระบบไม่ใส่ยอดบิลอัตโนมัติ
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {report.missingBillOrders.map(order => (
                    <Link key={order.orderNumber} href={"/orders/" + order.orderNumber}
                      className="rounded-xl border border-[#D6E7E1] px-3 py-2 text-sm font-extrabold text-[#17453F]">
                      #{order.orderNumber}
                    </Link>
                  ))}
                </div>
              </section>
            )}

            {report.manualClosedWithoutBillCount > 0 && (
              <details className="rounded-[22px] border border-[#DCE9E4] bg-white p-5">
                <summary className="cursor-pointer text-base font-black text-[#356E64]">
                  ประวัติ: Manager บังคับปิดงานก่อนมีบิล ({report.manualClosedWithoutBillCount})
                </summary>
                <p className="mt-3 text-sm leading-6 text-[#728D85]">
                  เป็นการบังคับปิดงานที่บันทึกไว้แล้ว ไม่ถือเป็นยอดขายที่ยืนยัน และไม่รวมใน KPI การเงิน
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {report.manualClosedWithoutBillOrders.map(order => (
                    <Link key={order.orderNumber} href={"/orders/" + order.orderNumber}
                      className="rounded-xl border border-[#D6E7E1] bg-[#F7FBF9] px-3 py-2 text-sm font-bold text-[#356E64]">
                      #{order.orderNumber}
                    </Link>
                  ))}
                </div>
              </details>
            )}
            {report.checkedAt && (
              <p className="px-1 text-xs text-[#849C95]">
                สถานะล่าสุด: {new Date(report.checkedAt).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })}
              </p>
            )}
          </>
        )}
      </div>
    </main>
  );
}
