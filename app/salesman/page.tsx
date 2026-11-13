"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import LotusLoading from "@/components/LotusLoading";
import { supabase } from "@/lib/supabase";

type Customer = {
  id: string;
  customer_code: string;
  customer_name: string;
  contact_name: string | null;
  phone: string | null;
};
type Order = {
  id: string;
  order_number: number;
  customer_id: string;
  delivery_date: string | null;
  delivery_slot: string | null;
  status: string;
  created_at: string;
};

const STATUS: Record<string, string> = {
  awaiting_confirmation: "รอเช็คสต็อก",
  awaiting_picking: "รอจัดสินค้า",
  picking: "กำลังจัดสินค้า",
  awaiting_billing: "รอออกบิล",
  ready_for_delivery: "รอจัดส่ง",
  out_for_delivery: "กำลังจัดส่ง",
  awaiting_payment: "รอชำระเงิน",
  payment_submitted: "รอตรวจสลิป",
  completed: "เสร็จสมบูรณ์",
  cancelled: "ยกเลิก",
};

function displayDate(value: string | null) {
  if (!value) return "ยังไม่ระบุ";
  const date = value.length === 10 ? new Date(value + "T12:00:00+07:00") : new Date(value);
  return Number.isNaN(date.getTime()) ? "ยังไม่ระบุ" :
    date.toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", year: "numeric" });
}

export default function SalesmanPage() {
  const [access, setAccess] = useState<"loading" | "allowed" | "denied">("loading");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) throw new Error("กรุณาเข้าสู่ระบบด้วย LINE");
        const { data: staff, error: staffError } = await supabase
          .from("staff").select("account_type, is_active")
          .eq("auth_user_id", user.id).maybeSingle();
        if (staffError) throw staffError;
        if (!staff?.is_active || !["salesman", "manager"].includes(staff.account_type)) {
          if (active) setAccess("denied");
          return;
        }
        const [customerResult, orderResult] = await Promise.all([
          supabase.from("customers")
            .select("id, customer_code, customer_name, contact_name, phone")
            .eq("is_active", true).order("customer_name", { ascending: true }).limit(1000),
          supabase.from("orders")
            .select("id, order_number, customer_id, delivery_date, delivery_slot, status, created_at")
            .order("created_at", { ascending: false }).limit(200),
        ]);
        if (customerResult.error) throw customerResult.error;
        if (orderResult.error) throw orderResult.error;
        if (!active) return;
        setCustomers((customerResult.data ?? []) as Customer[]);
        setOrders((orderResult.data ?? []) as Order[]);
        setAccess("allowed");
      } catch (cause) {
        if (!active) return;
        setError(cause instanceof Error ? cause.message : "ไม่สามารถโหลดข้อมูลฝ่ายขายได้");
        setAccess("denied");
      }
    }
    void load();
    return () => { active = false; };
  }, []);

  const customerById = useMemo(() =>
    new Map(customers.map((customer) => [customer.id, customer])), [customers]);
  const lastOrderByCustomer = useMemo(() => {
    const map = new Map<string, Order>();
    for (const order of orders) {
      if (!map.has(order.customer_id)) map.set(order.customer_id, order);
    }
    return map;
  }, [orders]);
  const filteredCustomers = useMemo(() => {
    const q = search.trim().toLocaleLowerCase();
    return q
      ? customers.filter((customer) =>
          [customer.customer_code, customer.customer_name, customer.contact_name ?? "", customer.phone ?? ""]
            .some((value) => value.toLocaleLowerCase().includes(q)))
      : customers;
  }, [customers, search]);

  if (access === "loading") return <LotusLoading message="กำลังเปิดพื้นที่ทำงานฝ่ายขาย..." />;
  if (access === "denied") {
    return (
      <main className="min-h-screen bg-[#F3F8F7] px-4 py-10">
        <div className="mx-auto max-w-md rounded-2xl border border-[#D6E8E2] bg-white p-6">
          <h1 className="text-xl font-black text-[#17453F]">ไม่มีสิทธิ์เข้าถึงฝ่ายขาย</h1>
          <p className="mt-3 text-sm text-[#647D74]">{error || "หน้านี้สำหรับ Salesman และ Manager เท่านั้น"}</p>
          <Link href="/login" className="mt-4 inline-flex rounded-xl bg-[#02B0AF] px-4 py-3 font-bold text-white">กลับหน้าหลัก</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#F3F8F7] px-3 pb-28 pt-5 text-[#17453F] sm:px-6">
      <div className="mx-auto max-w-5xl space-y-4">
        <header className="rounded-[22px] border border-[#CCE7E1] bg-gradient-to-br from-[#E3F8F3] to-white p-5 shadow-sm">
          <p className="text-xs font-black tracking-wider text-[#008C88]">LOTUS’S B2B · SALESMAN</p>
          <h1 className="mt-2 text-2xl font-black">ลูกค้าและการขาย</h1>
          <p className="mt-1 text-sm text-[#608176]">ค้นหาลูกค้า ติดตามสถานะ และช่วยลูกค้าสั่งสินค้า — ไม่ใช่ระบบงานหน้าร้าน</p>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Link href="/miniapp?portal=customer"
              className="rounded-xl bg-[#FFBE16] px-3 py-3 text-center text-sm font-black text-[#4A3900]">
              เลือกลูกค้าเพื่อสั่งสินค้า
            </Link>
            <Link href="/orders"
              className="rounded-xl bg-[#02B0AF] px-3 py-3 text-center text-sm font-black text-white">
              ติดตามคำสั่งซื้อ
            </Link>
          </div>
          <p className="mt-3 text-xs leading-5 text-[#608176]">
            การสั่งแทนลูกค้าต้องได้รับสิทธิ์ลูกค้าผ่าน LINE จาก Manager ก่อน ระบบจะให้เลือกชื่อลูกค้าเอง
          </p>
        </header>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-white p-4 shadow-sm">
            <p className="text-xs font-bold text-[#5D8075]">ลูกค้าที่ใช้งานอยู่</p>
            <p className="mt-1 text-2xl font-black text-[#008B8B]">{customers.length}</p>
          </div>
          <div className="rounded-xl bg-white p-4 shadow-sm">
            <p className="text-xs font-bold text-[#5D8075]">ออเดอร์ที่แสดง (ล่าสุด)</p>
            <p className="mt-1 text-2xl font-black text-[#008B8B]">{orders.length}</p>
          </div>
        </div>

        <section className="rounded-2xl border border-[#D6E9E3] bg-white p-4">
          <h2 className="text-lg font-black">รายชื่อลูกค้า</h2>
          <p className="mt-1 text-xs text-[#718E82]">ดูข้อมูลติดต่อได้ แต่ไม่สามารถแก้ข้อมูลลูกค้าหรือราคาพิเศษ</p>
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)}
            placeholder="ค้นหาชื่อลูกค้า รหัสลูกค้า ผู้ติดต่อ หรือเบอร์โทร"
            className="mt-3 min-h-11 w-full rounded-xl border border-[#D4E8E2] px-3 text-sm outline-none focus:border-[#02B0AF]"
            aria-label="ค้นหาลูกค้าในพื้นที่ฝ่ายขาย" />
          <p className="mt-2 text-xs text-[#718E82]">แสดง {filteredCustomers.length} จาก {customers.length} ราย</p>
          <div className="mt-3 max-h-[540px] space-y-2 overflow-y-auto">
            {filteredCustomers.map((customer) => {
              const lastOrder = lastOrderByCustomer.get(customer.id);
              return (
                <article key={customer.id} className="rounded-xl border border-[#E0ECE8] bg-[#FAFDFC] p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-black">{customer.customer_name}</p>
                      <p className="mt-0.5 text-xs text-[#739087]">รหัส {customer.customer_code}</p>
                      <p className="mt-2 text-sm text-[#55756C]">{customer.contact_name || "ยังไม่ระบุผู้ติดต่อ"}</p>
                    </div>
                    {customer.phone && <a href={`tel:${customer.phone.replace(/[^+\d]/g, "")}`}
                      className="rounded-lg border border-[#B7E3DA] bg-white px-3 py-2 text-xs font-bold text-[#008C87]">โทรหาลูกค้า</a>}
                  </div>
                  <p className="mt-2 text-xs text-[#6F8E83]">
                    {lastOrder ? `ออเดอร์ล่าสุด #${lastOrder.order_number} · ส่ง ${displayDate(lastOrder.delivery_date)} · ${STATUS[lastOrder.status] ?? lastOrder.status}`
                      : "ยังไม่พบออเดอร์ในรายการล่าสุด"}
                  </p>
                </article>
              );
            })}
            {filteredCustomers.length === 0 && <p className="py-8 text-center text-sm text-[#6D8C81]">ไม่พบลูกค้าที่ตรงกับคำค้นหา</p>}
          </div>
        </section>

        <section className="rounded-2xl border border-[#D6E9E3] bg-white p-4">
          <div className="flex items-start justify-between gap-2">
            <h2 className="text-lg font-black">คำสั่งซื้อล่าสุด</h2>
            <Link href="/orders" className="text-xs font-bold text-[#008E88]">ดูคำสั่งซื้อทั้งหมด</Link>
          </div>
          <div className="mt-3 space-y-2">
            {orders.slice(0, 20).map((order) => (
              <Link key={order.id} href={`/orders/${order.order_number}`}
                className="flex items-center justify-between gap-3 rounded-xl border border-[#E0ECE8] p-3">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-bold">#{order.order_number} · {customerById.get(order.customer_id)?.customer_name ?? "ลูกค้า"}</span>
                  <span className="mt-1 block text-xs text-[#759187]">วันส่ง {displayDate(order.delivery_date)} · {order.delivery_slot || "ไม่ระบุช่วงเวลา"}</span>
                </span>
                <span className="shrink-0 rounded-lg bg-[#ECF8F5] px-2 py-1.5 text-[11px] font-bold text-[#007F7F]">
                  {STATUS[order.status] ?? order.status}
                </span>
              </Link>
            ))}
            {orders.length === 0 && <p className="py-6 text-center text-sm text-[#718E82]">ยังไม่มีคำสั่งซื้อ</p>}
          </div>
        </section>
        <p className="text-center text-xs text-[#759187]">Salesman ดูข้อมูลลูกค้าและออเดอร์เท่านั้น · ไม่สามารถจัดการสต็อก งานบิล การเงินหรือสิทธิ์ LINE</p>
      </div>
    </main>
  );
}
