"use client";



import {

  useEffect,

  useState,

} from "react";



import Link from "next/link";



import { supabase } from "../../lib/supabase";



type Order = {

  id: string;

  order_number: number;

  status: string;

  delivery_date: string | null;

  delivery_slot: string | null;



  customers: {

    customer_name: string;

  } | null;

};



type ActiveClaim = {

  order_id: string;

  stage: string;

  staff_id: string;

  staff_name: string;

};



type CurrentStaff = {

  id: string;

  staff_name: string;

  account_type: string;

};



type CallableStaff = {
  staff_id: string;
  staff_code: string;
  staff_name: string;
  phone: string | null;
  account_type: string;
  stage: string;
};

type TaskGroup = {

  title: string;

  stage: string;

  statuses: string[];

};



const groups: TaskGroup[] = [

  {

    title: "ยืนยันคำสั่งซื้อ",

    stage: "confirmation",

    statuses: [

      "awaiting_confirmation",

    ],

  },



  {

    title: "จัดสินค้า",

    stage: "picking",

    statuses: [

      "awaiting_picking",

      "picking",

    ],

  },



  {

    title: "ออกบิล",

    stage: "billing",

    statuses: [

      "awaiting_billing",

    ],

  },



  {

    title: "จัดส่ง",

    stage: "delivery",

    statuses: [

      "ready_for_delivery",

      "out_for_delivery",

    ],

  },



  {

    title: "ชำระเงิน",

    stage: "payment_verification",

    statuses: [

      "awaiting_payment",

      "payment_submitted",

    ],

  },

];



function prettyStatus(
  status: string
) {
  const names: Record<string, string> = {
    awaiting_confirmation: "รอยืนยันคำสั่งซื้อ",
    awaiting_picking: "รอจัดสินค้า",
    picking: "กำลังจัดสินค้า",
    awaiting_billing: "รอออกบิล",
    ready_for_delivery: "พร้อมจัดส่ง",
    out_for_delivery: "กำลังจัดส่ง",
    awaiting_payment: "รอชำระเงิน",
    payment_submitted: "ส่งหลักฐานการชำระเงินแล้ว",
    completed: "เสร็จสิ้น",
    cancelled: "ยกเลิก",
  };

  return names[status] ?? status;
}

export default function TasksPage() {

  const [

    orders,

    setOrders,

  ] =

    useState<Order[]>([]);



  const [

    claims,

    setClaims,

  ] =

    useState<

      ActiveClaim[]

    >([]);



  const [

    currentStaff,

    setCurrentStaff,

  ] =

    useState<CurrentStaff | null>(

      null

    );



  const [

    allowedStages,

    setAllowedStages,

  ] = useState<string[]>([]);



  const [

    loading,

    setLoading,

  ] = useState(true);



  const [

    message,

    setMessage,

  ] = useState("");



  const [callStage, setCallStage] = useState<string | null>(null);
  const [callStaff, setCallStaff] = useState<CallableStaff[]>([]);
  const [callLoading, setCallLoading] = useState(false);
  const [callError, setCallError] = useState("");

  async function openStaffDirectory(stage: string) {
    setCallStage(stage);
    setCallStaff([]);
    setCallError("");
    setCallLoading(true);
    const { data, error } = await supabase.rpc("get_callable_staff_for_stage", { p_stage: stage });
    if (error) setCallError("ไม่สามารถโหลดรายชื่อพนักงานได้: " + error.message);
    else setCallStaff((data ?? []) as CallableStaff[]);
    setCallLoading(false);
  }

  // Overrides for expanded/collapsed task groups.
  // Authorized groups are expanded by default; others collapsed.
  const [expandedOverrides, setExpandedOverrides] = useState<Record<string, boolean>>({});

  function isExpanded(stage: string) {
    return expandedOverrides[stage] ?? allowedStages.includes(stage);
  }

  function toggleGroup(stage: string) {
    setExpandedOverrides((previous) => ({
      ...previous,
      [stage]: !(previous[stage] ?? allowedStages.includes(stage)),
    }));
  }

  // =====================================================

  // LOAD DATA

  // =====================================================



  async function loadData() {

    setLoading(true);

    setMessage("");



    // ---------------------------------------------------

    // CURRENT AUTHENTICATED USER

    // ---------------------------------------------------



    const {

      data: { user },

    } =

      await supabase.auth.getUser();



    if (!user) {

      setMessage(

        "คุณยังไม่ได้เข้าสู่ระบบ"

      );



      setLoading(false);

      return;

    }



    // ---------------------------------------------------

    // CURRENT STAFF PROFILE

    // ---------------------------------------------------



    const {

      data: staffData,

      error: staffError,

    } =

      await supabase

        .from("staff")

        .select(`

          id,

          staff_name,

          account_type

        `)

        .eq(

          "auth_user_id",

          user.id

        )

        .single();



    if (staffError) {

      setMessage(

        "ไม่สามารถโหลดข้อมูลพนักงานได้: " +

          staffError.message

      );



      setLoading(false);

      return;

    }



    setCurrentStaff(

      staffData

    );



    // ---------------------------------------------------

    // TASK PERMISSIONS

    // ---------------------------------------------------



    const {

      data: permissionData,

      error: permissionError,

    } =

      await supabase.rpc(

        "get_my_task_permissions"

      );



    if (permissionError) {

      setMessage(

        "ไม่สามารถโหลดสิทธิ์งานได้: " +

          permissionError.message

      );



      setLoading(false);

      return;

    }



    const permissionStages =

      (permissionData ?? [])

        .map(

          (row: { stage?: string }) =>

            row.stage ?? ""

        )

        .filter(Boolean);



    setAllowedStages(

      permissionStages

    );



    // Load every active stage so unauthorized staff can see
    // the workload without gaining permission to process it.
    const allStatuses = Array.from(
      new Set(groups.flatMap((group) => group.statuses))
    );

    const { data: orderData, error: orderError } =
      await supabase
        .from("orders")
        .select(`
          id,
          order_number,
          status,
          delivery_date,
          delivery_slot,
          customers (customer_name)
        `)
        .in("status", allStatuses)
        .order("delivery_date", { ascending: true })
        .order("order_number", { ascending: true });

    if (orderError) {
      setMessage(orderError.message);
      setLoading(false);
      return;
    }

    setOrders((orderData ?? []) as unknown as Order[]);

    // ---------------------------------------------------

    // ACTIVE TASK CLAIMS

    // ---------------------------------------------------



    const {

      data: claimData,

      error: claimError,

    } =

      await supabase

        .from(

          "task_claims"

        )

        .select(`

          order_id,

          stage,

          staff_id

        `)

        .eq(

          "claim_status",

          "active"

        )

        .in(

          "stage",

          groups.map((group) => group.stage)

        );



    if (claimError) {

      setMessage(

        claimError.message

      );



      setLoading(false);

      return;

    }



    const rawClaims =

      claimData ?? [];



    // ---------------------------------------------------

    // STAFF NAMES FOR CLAIMS

    // ---------------------------------------------------



    const staffIds = [

      ...new Set(

        rawClaims.map(

          (claim) =>

            claim.staff_id

        )

      ),

    ];



    let staffNameMap: Record<

      string,

      string

    > = {};



    if (

      staffIds.length >

      0

    ) {

      const {

        data: staffList,

        error:

          staffListError,

      } =

        await supabase

          .from("staff")

          .select(`

            id,

            staff_name

          `)

          .in(

            "id",

            staffIds

          );



      if (

        staffListError

      ) {

        setMessage(

          staffListError.message

        );



        setLoading(false);

        return;

      }



      staffNameMap =

        Object.fromEntries(

          (

            staffList ??

            []

          ).map(

            (staff) => [

              staff.id,

              staff.staff_name,

            ]

          )

        );

    }



    const formattedClaims: ActiveClaim[] =

      rawClaims.map(

        (claim) => ({

          order_id:

            claim.order_id,



          stage:

            claim.stage,



          staff_id:

            claim.staff_id,



          staff_name:

            staffNameMap[

              claim.staff_id

            ] ??

            "ไม่ทราบชื่อพนักงาน",

        })

      );



    setClaims(

      formattedClaims

    );



    setLoading(false);

  }



  useEffect(() => {

    loadData();

  }, []);



  // =====================================================

  // CLAIM TASK

  // =====================================================



  async function startWork(
  orderNumber: number,
  stage: string
) {
  if (!allowedStages.includes(stage)) {
    setMessage("คุณไม่มีสิทธิ์รับงานประเภทนี้");
    return;
  }
  setMessage(
    `กำลังรับงานคำสั่งซื้อ #${orderNumber}...`
  );

  const {
    error,
  } =
    await supabase.rpc(
      "claim_my_task",
      {
        p_order_number:
          orderNumber,

        p_stage:
          stage,
      }
    );

  if (error) {
    setMessage(
      "ไม่สามารถรับงานได้: " +
        error.message
    );

    await loadData();

    return;
  }

  // รับงานสำเร็จแล้ว
  // เปิดหน้างานทันที ไม่ต้องกลับมากด "ทำต่อ"

  window.location.assign(
    taskLink(
      stage,
      orderNumber
    )
  );
}



  // =====================================================

  // CONTINUE LINK

  // =====================================================



  function taskLink(

    stage: string,

    orderNumber: number

  ) {

    if (

      stage ===

      "confirmation"

    ) {

      return `/tasks/confirmation/${orderNumber}`;

    }



    if (

      stage === "picking"

    ) {

      return `/tasks/picking/${orderNumber}`;

    }



    if (

      stage === "billing"

    ) {

      return `/tasks/billing/${orderNumber}`;

    }



    if (

      stage === "delivery"

    ) {

      return `/tasks/delivery/${orderNumber}`;

    }



    if (

      stage ===

      "payment_verification"

    ) {

      return `/tasks/payment-verification/${orderNumber}`;

    }



    return "/tasks";

  }



  // =====================================================
  // VISUAL DESIGN — KEEP EXISTING WORKFLOW AND PERMISSIONS
  // =====================================================

  const stageStyles: Record<string, {
    icon: string;
    accent: string;
    border: string;
    surface: string;
    badge: string;
    button: string;
    subtle: string;
  }> = {
    confirmation: {
      icon: "✓", accent: "text-emerald-800", border: "border-emerald-300",
      surface: "bg-emerald-50", badge: "bg-emerald-100 text-emerald-800",
      button: "bg-emerald-700 hover:bg-emerald-800", subtle: "border-emerald-200",
    },
    picking: {
      icon: "▣", accent: "text-amber-800", border: "border-amber-300",
      surface: "bg-amber-50", badge: "bg-amber-100 text-amber-800",
      button: "bg-amber-600 hover:bg-amber-700", subtle: "border-amber-200",
    },
    billing: {
      icon: "฿", accent: "text-blue-800", border: "border-blue-300",
      surface: "bg-blue-50", badge: "bg-blue-100 text-blue-800",
      button: "bg-blue-700 hover:bg-blue-800", subtle: "border-blue-200",
    },
    delivery: {
      icon: "➜", accent: "text-violet-800", border: "border-violet-300",
      surface: "bg-violet-50", badge: "bg-violet-100 text-violet-800",
      button: "bg-violet-700 hover:bg-violet-800", subtle: "border-violet-200",
    },
    payment_verification: {
      icon: "✓", accent: "text-rose-800", border: "border-rose-300",
      surface: "bg-rose-50", badge: "bg-rose-100 text-rose-800",
      button: "bg-rose-700 hover:bg-rose-800", subtle: "border-rose-200",
    },
  };

  const activeTaskCount = orders.filter((order) =>
    groups.some((group) =>
      allowedStages.includes(group.stage) && group.statuses.includes(order.status)
    )
  ).length;

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-10 sm:px-8">
        <div className="mx-auto max-w-6xl animate-pulse space-y-5">
          <div className="h-20 rounded-2xl bg-slate-200" />
          {[1, 2, 3].map((item) => (
            <div key={item} className="h-28 rounded-2xl bg-slate-200" />
          ))}
          <p className="text-sm text-slate-500">กำลังโหลดงาน...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 px-3 py-5 text-slate-900 sm:px-6 sm:py-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 overflow-hidden rounded-3xl bg-gradient-to-r from-emerald-900 via-emerald-800 to-teal-700 p-5 text-white shadow-lg sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <Link href="/" className="text-sm font-medium text-emerald-100 hover:text-white">
                ← กลับหน้าหลัก
              </Link>
              <div className="mt-3 flex items-center gap-3">
                <span aria-hidden="true" className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15 text-2xl">▦</span>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest text-emerald-100">LOTUS’S B2B · OPERATIONS</p>
                  <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">งานประจำวัน</h1>
                </div>
              </div>
              <p className="mt-3 text-sm text-emerald-50">
                {currentStaff?.staff_name ? `สวัสดี ${currentStaff.staff_name} · ` : ""}
                ดูความคืบหน้าทุกขั้นตอน และรับงานตามสิทธิ์ที่ได้รับ
              </p>
            </div>
            <button
              type="button"
              onClick={() => void loadData()}
              className="rounded-xl border border-white/40 bg-white/15 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/25"
            >
              ↻ รีเฟรช
            </button>
          </div>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:max-w-lg">
            <div className="rounded-2xl border border-white/20 bg-white/15 px-4 py-3">
              <p className="text-xs text-emerald-100">งานที่คุณทำได้</p>
              <p className="mt-1 text-2xl font-extrabold">{activeTaskCount} <span className="text-sm font-normal">คำสั่งซื้อ</span></p>
            </div>
            <div className="rounded-2xl border border-white/20 bg-white/15 px-4 py-3">
              <p className="text-xs text-emerald-100">ประเภทงานที่ได้รับสิทธิ์</p>
              <p className="mt-1 text-2xl font-extrabold">{allowedStages.length} <span className="text-sm font-normal">จาก 5 ประเภท</span></p>
            </div>
          </div>
        </div>

        {message && (
          <div role="alert" className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {message}
          </div>
        )}

        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 px-1">
          <h2 className="text-lg font-bold text-slate-800">ขั้นตอนการดำเนินงาน</h2>
          <div className="flex items-center gap-3 text-xs text-slate-600">
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-emerald-600" /> มีสิทธิ์รับงาน</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-slate-300" /> ดูสถานะเท่านั้น</span>
          </div>
        </div>

        <div className="space-y-4">
          {groups.map((group) => {
            const canWork = allowedStages.includes(group.stage);
            const expanded = isExpanded(group.stage);
            const groupOrders = orders.filter((order) => group.statuses.includes(order.status));
            const style = stageStyles[group.stage];
            return (
              <section
                key={group.stage}
                className={`overflow-hidden rounded-2xl border-2 bg-white shadow-sm transition-shadow ${canWork ? `${style.border} shadow-md` : "border-slate-200"}`}
              >
                <div className={`flex flex-wrap items-center justify-between gap-3 px-3 py-4 sm:px-5 ${canWork ? style.surface : "bg-slate-50"}`}>
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <span aria-hidden="true" className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-xl font-bold ${canWork ? `${style.badge}` : "bg-slate-200 text-slate-500"}`}>
                      {style.icon}
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className={`text-base font-extrabold sm:text-lg ${canWork ? style.accent : "text-slate-600"}`}>
                          {group.title}
                        </h3>
                        {canWork ? (
                          <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[11px] font-semibold text-white">✓ รับงานได้</span>
                        ) : (
                          <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-600">ดูได้เท่านั้น</span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-slate-500">{canWork ? "พร้อมให้คุณดำเนินการ" : "เปิดดูรายการและเรียกพนักงานที่รับผิดชอบได้"}</p>
                    </div>
                  </div>
                  <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
                    <span className={`whitespace-nowrap rounded-full px-2.5 py-1.5 text-xs font-bold ${canWork ? style.badge : "bg-slate-200 text-slate-700"}`}>
                      {groupOrders.length} คำสั่งซื้อ
                    </span>
                    <button
                      type="button"
                      onClick={() => void openStaffDirectory(group.stage)}
                      className="whitespace-nowrap rounded-full border border-emerald-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-emerald-800 shadow-sm hover:bg-emerald-50 sm:px-3"
                      aria-label={`เรียกพนักงานสำหรับ${group.title}`}
                    >
                      ☎ เรียกพนักงาน
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleGroup(group.stage)}
                      aria-expanded={expanded}
                      aria-controls={`task-list-${group.stage}`}
                      className="rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-700 hover:bg-white/80"
                    >
                      {expanded ? "▲ ย่อ" : "▼ แสดง"}
                    </button>
                  </div>
                </div>

                {expanded && (
                  <div id={`task-list-${group.stage}`} className="border-t border-slate-200 bg-white">
                    {groupOrders.length === 0 ? (
                      <div className="flex items-center gap-3 px-5 py-7 text-sm text-slate-500">
                        <span className="text-xl">✓</span> ไม่มีคำสั่งซื้อรอดำเนินการ
                      </div>
                    ) : (
                      <div className="divide-y divide-slate-100">
                        {groupOrders.map((order) => {
                          const claim = claims.find((item) => item.order_id === order.id && item.stage === group.stage);
                          const isMine = Boolean(claim && currentStaff && claim.staff_id === currentStaff.id);
                          const isAwaitingPayment = order.status === "awaiting_payment";
                          return (
                            <div key={order.id} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="text-base font-extrabold text-slate-900">คำสั่งซื้อ #{order.order_number}</p>
                                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600">{prettyStatus(order.status)}</span>
                                </div>
                                <p className="mt-1 font-medium text-slate-700">{order.customers?.customer_name ?? "ไม่ทราบชื่อลูกค้า"}</p>
                                <p className="mt-1 text-xs text-slate-500">
                                  {order.delivery_date ?? "ยังไม่ระบุวันที่"} · {order.delivery_slot ?? "ยังไม่ระบุช่วงเวลา"}
                                </p>
                                {claim && (
                                  <p className="mt-1 text-xs text-slate-500">ผู้รับงาน: {isMine ? "คุณ · " : ""}{claim.staff_name}</p>
                                )}
                              </div>
                              <div className="flex shrink-0 items-center sm:justify-end">
                                {!canWork ? (
                                  <span className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-500">ดูสถานะเท่านั้น</span>
                                ) : isAwaitingPayment ? (
                                  <div className="flex flex-wrap items-center gap-3">
                                    <span className="text-xs text-slate-500">รอชำระเงิน · อัปโหลดสลิปแทนลูกค้าได้</span>
                                    <Link href={`/tasks/payment-verification/${order.order_number}`} className={`rounded-xl px-4 py-2.5 text-sm font-bold text-white ${style.button}`}>
                                      ชำระเงิน →
                                    </Link>
                                  </div>
                                ) : !claim ? (
                                  <button type="button" onClick={() => void startWork(order.order_number, group.stage)} className={`rounded-xl px-5 py-2.5 text-sm font-bold text-white shadow-sm ${style.button}`}>
                                    รับงาน →
                                  </button>
                                ) : isMine ? (
                                  <Link href={taskLink(group.stage, order.order_number)} className={`rounded-xl px-5 py-2.5 text-sm font-bold text-white ${style.button}`}>
                                    ทำต่อ →
                                  </Link>
                                ) : (
                                  <span className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-600">กำลังดำเนินการ</span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </section>
            );
          })}
        </div>

        {callStage && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4" onClick={() => setCallStage(null)}>
            <div
              role="dialog"
              aria-modal="true"
              aria-label="เรียกพนักงาน"
              onClick={(event) => event.stopPropagation()}
              className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl sm:p-6"
            >
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-extrabold text-slate-900">☎ เรียกพนักงาน</h2>
                  <p className="mt-1 text-sm text-slate-500">{groups.find((group) => group.stage === callStage)?.title}</p>
                </div>
                <button type="button" onClick={() => setCallStage(null)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700">ปิด</button>
              </div>
              {callLoading ? (
                <p className="py-5 text-sm text-slate-500">กำลังโหลดรายชื่อ...</p>
              ) : callError ? (
                <p className="py-5 text-sm text-red-700">{callError}</p>
              ) : callStaff.length === 0 ? (
                <p className="py-5 text-sm text-slate-500">ไม่มีพนักงานที่ได้รับสิทธิ์งานประเภทนี้</p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {callStaff.map((person) => (
                    <div key={person.staff_id} className="flex items-center justify-between gap-3 py-4">
                      <div className="min-w-0">
                        <p className="font-bold text-slate-900">{person.staff_name} <span className="text-xs font-normal text-slate-500">({person.staff_code})</span></p>
                        <p className="mt-1 text-xs text-slate-500">{person.account_type === "manager" ? "Manager" : "Staff"}</p>
                        <p className="mt-1 text-sm text-slate-700">{person.phone || "ยังไม่มีเบอร์โทรศัพท์"}</p>
                      </div>
                      {person.phone ? (
                        <a href={`tel:${person.phone}`} className="shrink-0 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-800">☎ โทร</a>
                      ) : (
                        <span className="text-xs text-slate-400">โทรไม่ได้</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
