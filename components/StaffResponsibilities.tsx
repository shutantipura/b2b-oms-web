"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type StaffSummary = {
  id: string;
  staffCode: string;
  staffName: string;
  accountType: "staff" | "manager";
  isActive: boolean;
};

type ActiveClaim = {
  order_id: string;
  stage: string;
  staff_id: string;
};

type OrderSummary = {
  id: string;
  order_number: number;
  status: string;
  delivery_date: string | null;
  delivery_slot: string | null;
  customers: { customer_name: string } | { customer_name: string }[] | null;
};

type Assignment = {
  claim: ActiveClaim;
  order: OrderSummary | null;
};

const STAGE_LABELS: Record<string, string> = {
  confirmation: "เช็คสต็อก",
  picking: "จัดสินค้า",
  billing: "ออกบิล",
  delivery: "จัดส่ง",
  payment_verification: "ตรวจสอบการชำระเงิน",
};

function customerName(order: OrderSummary | null) {
  if (!order) return "ไม่พบข้อมูลคำสั่งซื้อ";
  const customer = Array.isArray(order.customers)
    ? order.customers[0]
    : order.customers;
  return customer?.customer_name || "ไม่ระบุลูกค้า";
}

function formatDelivery(order: OrderSummary | null) {
  if (!order?.delivery_date) return "";
  return [order.delivery_date, order.delivery_slot].filter(Boolean).join(" · ");
}

export default function StaffResponsibilities({ staff }: { staff: StaffSummary[] }) {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  async function loadAssignments() {
    setLoading(true);
    setErrorMessage("");

    try {
      const { data: claimData, error: claimError } = await supabase
        .from("task_claims")
        .select("order_id, stage, staff_id")
        .eq("claim_status", "active");

      if (claimError) throw claimError;

      const claims = (claimData ?? []) as ActiveClaim[];
      const orderIds = Array.from(new Set(claims.map((claim) => claim.order_id)));
      let orders: OrderSummary[] = [];

      if (orderIds.length) {
        const { data: orderData, error: orderError } = await supabase
          .from("orders")
          .select("id, order_number, status, delivery_date, delivery_slot, customers(customer_name)")
          .in("id", orderIds);

        if (orderError) throw orderError;
        orders = (orderData ?? []) as unknown as OrderSummary[];
      }

      const orderById = new Map(orders.map((order) => [order.id, order]));
      setAssignments(
        claims.map((claim) => ({
          claim,
          order: orderById.get(claim.order_id) ?? null,
        }))
      );
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "ไม่สามารถโหลดหน้าที่ปัจจุบันได้"
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAssignments();
  }, []);

  const people = useMemo(
    () => staff.filter((person) => person.isActive).sort((a, b) => a.staffCode.localeCompare(b.staffCode)),
    [staff]
  );

  const byPerson = useMemo(() => {
    const map = new Map<string, Assignment[]>();
    for (const assignment of assignments) {
      const current = map.get(assignment.claim.staff_id) ?? [];
      current.push(assignment);
      map.set(assignment.claim.staff_id, current);
    }
    return map;
  }, [assignments]);

  const busyCount = people.filter((person) => (byPerson.get(person.id)?.length ?? 0) > 0).length;

  const assignmentDetails = (assignment: Assignment) => (
    <div key={assignment.claim.order_id + assignment.claim.stage} className="rounded-xl border border-[#DEEBE7] bg-[#F8FBFA] px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-extrabold text-[#17453F]">
          {STAGE_LABELS[assignment.claim.stage] ?? assignment.claim.stage}
        </span>
        {assignment.order && (
          <Link
            href={"/orders/" + assignment.order.order_number}
            className="text-xs font-extrabold text-[#008F8D] underline underline-offset-2"
          >
            ดูคำสั่งซื้อ ↗
          </Link>
        )}
      </div>
      <p className="mt-1 text-sm font-semibold text-[#486D63]">{customerName(assignment.order)}</p>
      <p className="mt-1 text-xs text-[#7A918B]">
        {assignment.order ? "คำสั่งซื้อ #" + assignment.order.order_number : "คำสั่งซื้อไม่พร้อมใช้งาน"}
        {formatDelivery(assignment.order) ? " · " + formatDelivery(assignment.order) : ""}
      </p>
    </div>
  );

  return (
    <section className="overflow-hidden rounded-2xl border border-[#D7E9E4] bg-white shadow-[0_4px_18px_rgba(16,84,76,0.05)]">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#E3EEEA] px-4 py-5 sm:px-6">
        <div>
          <h2 className="text-xl font-black text-[#17453F]">หน้าที่ปัจจุบันของพนักงาน</h2>
          <p className="mt-1 text-sm text-[#729087]">งานที่พนักงานรับผิดชอบอยู่ทั้งหมด ไม่จำกัดเฉพาะคำสั่งซื้อวันนี้</p>
          {!loading && !errorMessage && (
            <p className="mt-2 text-xs font-bold text-[#008F8D]">
              กำลังรับงาน {busyCount} คน · ว่าง {people.length - busyCount} คน · งานที่กำลังรับผิดชอบ {assignments.length} รายการ
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => void loadAssignments()}
          disabled={loading}
          className="h-10 shrink-0 rounded-xl border border-[#B9DDD6] bg-[#F1FAF8] px-4 text-sm font-extrabold text-[#008F8D] disabled:opacity-50"
        >
          {loading ? "กำลังโหลด..." : "↻ รีเฟรช"}
        </button>
      </div>

      {errorMessage && (
        <p role="alert" className="m-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">
          {errorMessage}
        </p>
      )}
      {loading ? (
        <p className="p-8 text-center text-sm text-[#729087]">กำลังโหลดหน้าที่ปัจจุบัน...</p>
      ) : people.length === 0 ? (
        <p className="p-8 text-center text-sm text-[#729087]">ไม่มีพนักงานที่เปิดใช้งานอยู่</p>
      ) : (
        <>
          <div className="divide-y divide-[#E3EEEA] md:hidden">
            {people.map((person) => {
              const current = byPerson.get(person.id) ?? [];
              return (
                <article key={person.id} className="px-4 py-4">
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div>
                      <p className="text-base font-extrabold text-[#17453F]">{person.staffName}</p>
                      <p className="text-xs text-[#729087]">{person.staffCode} · {person.accountType === "manager" ? "ผู้จัดการ" : "พนักงาน"}</p>
                    </div>
                    <span className={current.length
                      ? "rounded-full bg-[#E1F7F1] px-3 py-1 text-xs font-extrabold text-[#008F8D]"
                      : "rounded-full bg-[#F1F5F3] px-3 py-1 text-xs font-semibold text-[#6A847C]"}>
                      {current.length ? "รับงาน " + current.length : "ว่าง"}
                    </span>
                  </div>
                  <div className="space-y-2">{current.map(assignmentDetails)}</div>
                </article>
              );
            })}
          </div>

          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[660px] text-left">
              <thead className="bg-[#F4FAF8] text-xs font-extrabold text-[#52786F]">
                <tr>
                  <th className="w-[28%] px-5 py-3">พนักงาน</th>
                  <th className="w-[18%] px-5 py-3">ประเภทบัญชี</th>
                  <th className="px-5 py-3">งานปัจจุบัน / ลูกค้า / คำสั่งซื้อ</th>
                  <th className="w-[12%] px-5 py-3 text-right">สถานะ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E3EEEA]">
                {people.map((person) => {
                  const current = byPerson.get(person.id) ?? [];
                  return (
                    <tr key={person.id} className="align-top">
                      <td className="px-5 py-4">
                        <p className="font-extrabold text-[#17453F]">{person.staffName}</p>
                        <p className="mt-1 text-xs text-[#819A92]">{person.staffCode}</p>
                      </td>
                      <td className="px-5 py-4 text-sm text-[#52786F]">
                        {person.accountType === "manager" ? "ผู้จัดการ" : "พนักงาน"}
                      </td>
                      <td className="space-y-2 px-5 py-4">
                        {current.length ? current.map(assignmentDetails) : <span className="text-sm text-[#92A7A0]">ยังไม่มีงานที่รับผิดชอบ</span>}
                      </td>
                      <td className="px-5 py-4 text-right">
                        <span className={current.length
                          ? "rounded-full bg-[#E1F7F1] px-3 py-1 text-xs font-extrabold text-[#008F8D]"
                          : "rounded-full bg-[#F1F5F3] px-3 py-1 text-xs font-semibold text-[#6A847C]"}>
                          {current.length ? "รับงาน " + current.length : "ว่าง"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
