"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import LotusLoading from "@/components/LotusLoading";
import { supabase } from "@/lib/supabase";

type StaffProfile = {
  staff_code: string;
  staff_name: string;
  account_type: string;
  is_active: boolean;
};

type NavigationItem = {
  name: string;
  href: string;
  description: string;
};

const TASK_STATUS_MAP: Record<string, string[]> = {
  confirmation: ["awaiting_confirmation"],
  picking: ["awaiting_picking", "picking"],
  billing: ["awaiting_billing"],
  delivery: ["ready_for_delivery", "out_for_delivery"],
  payment_verification: ["awaiting_payment", "payment_submitted"],
};

const MANAGER_NAVIGATION: NavigationItem[] = [
  { name: "งาน", href: "/tasks", description: "คิวงานปฏิบัติการ" },
  { name: "คำสั่งซื้อ", href: "/orders", description: "ดูและติดตามคำสั่งซื้อ" },
  { name: "ศูนย์ควบคุม", href: "/control-tower", description: "ภาพรวมการปฏิบัติงาน" },
  { name: "ลูกค้า", href: "/customers", description: "จัดการบัญชีลูกค้า B2B" },
  { name: "สินค้าและราคา", href: "/catalog", description: "สินค้า รูปภาพ และราคาพิเศษ" },
  { name: "พนักงาน", href: "/staff", description: "บัญชีและข้อมูลพนักงาน" },
  { name: "สิทธิ์ LINE", href: "/line-access", description: "จัดการสิทธิ์ผู้ใช้ LINE" },
  { name: "KPI", href: "/kpi", description: "ติดตามผลการดำเนินงาน" },
];

const STAFF_NAVIGATION = MANAGER_NAVIGATION.slice(0, 2);

function goToLineLogin() {
  window.location.assign("/miniapp?portal=access");
}

export default function OmsHomePage() {
  const [staff, setStaff] = useState<StaffProfile | null>(null);
  const [activeOrderCount, setActiveOrderCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const loadStaff = useCallback(async () => {
    setLoading(true);
    setMessage("");

    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        setStaff(null);
        setActiveOrderCount(0);
        return;
      }

      const { data: profile, error: staffError } = await supabase
        .from("staff")
        .select("staff_code, staff_name, account_type, is_active")
        .eq("auth_user_id", user.id)
        .eq("is_active", true)
        .maybeSingle();

      if (staffError || !profile) {
        await supabase.auth.signOut();
        setStaff(null);
        setActiveOrderCount(0);
        setMessage("บัญชีนี้ยังไม่ได้รับสิทธิ์ใช้งาน OMS กรุณาติดต่อผู้จัดการ");
        return;
      }

      setStaff(profile);

      const { data: permissions, error: permissionError } =
        await supabase.rpc("get_my_task_permissions");

      if (permissionError) {
        console.error("Could not load task permissions", permissionError);
        setActiveOrderCount(0);
        return;
      }

      const allowedStages = (permissions ?? [])
        .map((row: { stage?: string }) => row.stage ?? "")
        .filter(Boolean);
      const allowedStatuses = Array.from(
        new Set(allowedStages.flatMap((stage: string) => TASK_STATUS_MAP[stage] ?? []))
      );

      if (allowedStatuses.length === 0) {
        setActiveOrderCount(0);
        return;
      }

      const { count, error: countError } = await supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .in("status", allowedStatuses);

      if (countError) {
        console.error("Could not load active order count", countError);
        setActiveOrderCount(0);
        return;
      }

      setActiveOrderCount(count ?? 0);
    } catch (error) {
      console.error("OMS staff home initialization", error);
      setStaff(null);
      setActiveOrderCount(0);
      setMessage("ไม่สามารถโหลดบัญชีพนักงานได้ กรุณาลองใหม่อีกครั้ง");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStaff();
  }, [loadStaff]);

  async function handleSignOut() {
    await supabase.auth.signOut();
    goToLineLogin();
  }

  if (loading) {
    return <LotusLoading message="กำลังเปิดระบบจัดการคำสั่งซื้อ..." />;
  }

  if (!staff) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#F3F8F7] px-4 py-8">
        <div className="w-full max-w-md overflow-hidden rounded-[26px] border border-[#D5E8E3] bg-white p-6 shadow-[0_18px_44px_rgba(20,91,83,0.10)] sm:p-8">
          <div className="mb-7 h-1.5 w-14 rounded-full bg-[#FDBC16]" />
          <div className="text-[28px] font-black tracking-tight text-[#02B0AF]">
            Lotus<span className="text-[#FDBC16]">’s</span>
            <span className="ml-2 rounded-lg bg-[#EAF8F5] px-2 py-1 align-middle text-sm tracking-normal text-[#17453F]">B2B</span>
          </div>
          <p className="mt-1 text-xs font-medium text-[#779087]">ระบบจัดการคำสั่งซื้อสำหรับธุรกิจ</p>
          <h1 className="mt-8 text-[27px] font-black tracking-tight text-[#17453F]">ยินดีต้อนรับสู่ Lotus’s B2B</h1>
          <p className="mt-2 text-sm leading-6 text-[#6F8982]">
            ลูกค้าและพนักงานใช้บัญชี LINE เดียวกัน ระบบจะตรวจสอบสิทธิ์และพาไปยังหน้าที่เหมาะสมโดยอัตโนมัติ
          </p>
          {message && (
            <div role="alert" className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              {message}
            </div>
          )}
          <button
            type="button"
            onClick={goToLineLogin}
            className="mt-7 flex min-h-14 w-full items-center justify-center gap-3 rounded-2xl bg-[#06C755] px-5 py-3 text-base font-extrabold text-white shadow-[0_6px_16px_rgba(6,199,85,0.18)] active:scale-[0.99]"
          >
            <span aria-hidden="true" className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 11a8 8 0 0 1 16 0c0 4-3.5 7-8 7-1 0-2-.1-3-.5L5 20l.7-4A7.4 7.4 0 0 1 4 11Z" />
                <path d="M8 11h8" />
              </svg>
            </span>
            เข้าใช้งาน Lotus’s B2B ด้วย LINE
          </button>
          <div className="mt-6 rounded-xl bg-[#F3FAF8] p-4 text-xs leading-5 text-[#69847B]">
            <p className="font-bold text-[#19766E]">เข้าใช้งานอย่างปลอดภัย</p>
            <p className="mt-1">ลูกค้าสามารถสั่งสินค้าและติดตามคำสั่งซื้อ ส่วนพนักงานที่ได้รับสิทธิ์จะเข้าสู่ OMS</p>
          </div>
        </div>
      </main>
    );
  }

  const isManager = staff.account_type === "manager";
  const navigation = isManager ? MANAGER_NAVIGATION : STAFF_NAVIGATION;
  const shortcuts = navigation.filter((item) => item.href !== "/tasks");

  return (
    <main className="min-h-screen bg-[#F3F8F7] px-4 pb-24 pt-5 sm:px-7 sm:py-8">
      <div className="mx-auto w-full max-w-5xl">
        <section className="relative overflow-hidden rounded-[24px] border border-[#CDE9E3] bg-gradient-to-br from-[#E8FAF6] via-white to-white p-5 shadow-[0_5px_20px_rgba(15,91,84,0.05)] sm:p-7">
          <div className="absolute right-0 top-0 h-24 w-24 translate-x-8 -translate-y-9 rounded-full bg-[#A7EEE6]/35" aria-hidden="true" />
          <p className="relative text-[11px] font-extrabold tracking-[0.13em] text-[#008B8B]">LOTUS’S B2B / OMS</p>
          <div className="relative mt-3 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-[26px] font-black leading-tight tracking-tight text-[#17453F] sm:text-3xl">
                สวัสดี {staff.staff_name}
              </h1>
              <p className="mt-2 text-sm text-[#6B8880]">
                {staff.staff_code} · {isManager ? "ผู้จัดการ" : "พนักงาน"}
              </p>
            </div>
            <button
              type="button"
              onClick={handleSignOut}
              className="min-h-11 rounded-xl border border-[#C5E3DD] bg-white px-4 py-2 text-sm font-bold text-[#3B736B]"
            >
              สลับบัญชี LINE
            </button>
          </div>
        </section>

        <Link
          href="/tasks"
          className="mt-5 flex min-h-[128px] items-center justify-between gap-4 rounded-[22px] bg-[#02B0AF] p-5 text-white shadow-[0_9px_22px_rgba(0,153,150,0.17)] transition hover:bg-[#009A9A] sm:p-6"
        >
          <div>
            <p className="text-xs font-bold text-white/80">งานที่ต้องดำเนินการ</p>
            <p className="mt-2 text-3xl font-black">{activeOrderCount} <span className="text-base font-semibold">คำสั่งซื้อ</span></p>
            <p className="mt-2 text-sm font-semibold text-white/90">เปิดคิวงานและตรวจสอบสถานะ</p>
          </div>
          <div aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/20">
            <svg viewBox="0 0 24 24" width="25" height="25" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14m-6-6 6 6-6 6" />
            </svg>
          </div>
        </Link>

        <div className="mt-8 mb-3 flex items-center justify-between">
          <h2 className="text-xl font-black text-[#17453F]">เมนูจัดการ</h2>
          <span className="rounded-full bg-[#E5F6F2] px-3 py-1 text-xs font-bold text-[#008C8C]">
            {isManager ? "Manager" : "Staff"}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {shortcuts.map((item, index) => (
            <Link
              key={item.href}
              href={item.href}
              className="oms-dashboard-tile flex min-h-[130px] flex-col rounded-[20px] border border-[#D8E9E5] bg-white p-4 shadow-[0_4px_16px_rgba(18,96,89,0.05)] transition hover:border-[#90D6CF] sm:p-5"
            >
              <span aria-hidden="true" className={index === 0 ? "mb-3 h-1.5 w-9 rounded-full bg-[#FDBC16]" : "mb-3 h-1.5 w-9 rounded-full bg-[#75D9CE]"} />
              <span className="pr-5 text-base font-black leading-snug text-[#17453F]">{item.name}</span>
              <span className="mt-2 pr-2 text-xs leading-5 text-[#77918A]">{item.description}</span>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
