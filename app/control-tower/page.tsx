"use client";



import {

  useEffect,

  useMemo,

  useState,

} from "react";



import Link from "next/link";



import { supabase } from "../../lib/supabase";



// ======================================================

// TYPES

// ======================================================



type Order = {

  id: string;

  order_number: number;

  status: string;

  created_at: string;



  final_amount:

    | number

    | string

    | null;



  delivery_date:

    | string

    | null;



  delivery_slot:

    | string

    | null;



  customers: {

    customer_code: string;

    customer_name: string;

  } | null;

};



type KPIOrder = {

  order_id: string;

  order_number: number;



  customer_name:

    | string

    | null;



  status: string;



  confirmation_at:

    | string

    | null;



  confirmation_due_at:

    | string

    | null;



  confirmation_on_time:

    | boolean

    | null;



  picking_completed_at:

    | string

    | null;



  short_pick:

    | boolean

    | null;



  delivery_slot:

    | string

    | null;



  delivery_at:

    | string

    | null;



  delivery_due_at:

    | string

    | null;



  delivery_on_time:

    | boolean

    | null;



  payment_completed_at:

    | string

    | null;



  payment_due_at:

    | string

    | null;



  payment_on_time:

    | boolean

    | null;

};



type Staff = {

  id: string;

  staff_code: string;

  staff_name: string;

  account_type: string;

};



type ActiveClaim = {

  order_id: string;

  stage: string;

  staff_id: string;

};



type OrderHistoryEntry = {

  order_id: string;

  to_status:

    | string

    | null;

  created_at: string;

};



type StuckOrder = {

  order: KPIOrder;

  minutesInStage: number;

  thresholdMinutes: number;

};



type AttentionOrder = {

  order: KPIOrder;

  issues: string[];

  severity:

    | "urgent"

    | "warning";

};



// ======================================================

// HELPERS

// ======================================================



function getBangkokToday() {

  const parts =

    new Intl.DateTimeFormat(

      "en-US",

      {

        timeZone:

          "Asia/Bangkok",



        year:

          "numeric",



        month:

          "2-digit",



        day:

          "2-digit",

      }

    ).formatToParts(

      new Date()

    );



  const year =

    parts.find(

      (part) =>

        part.type ===

        "year"

    )?.value;



  const month =

    parts.find(

      (part) =>

        part.type ===

        "month"

    )?.value;



  const day =

    parts.find(

      (part) =>

        part.type ===

        "day"

    )?.value;



  return `${year}-${month}-${day}`;

}



function prettyStatus(
  status: string
) {
  const labels: Record<string, string> = {
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

  return labels[status] ?? status;
}



function prettyStage(

  stage: string

) {

  const names:

    Record<

      string,

      string

    > = {

    confirmation:

      "ยืนยันคำสั่งซื้อ",



    picking:

      "จัดสินค้า",



    billing:

      "ออกบิล",



    delivery:

      "จัดส่ง",



    payment_verification:

      "ตรวจสอบการชำระเงิน",

  };



  return (

    names[stage] ??

    prettyStatus(stage)

  );

}



function minutesUntil(

  iso:

    | string

    | null

) {

  if (!iso) {

    return null;

  }



  const due =

    new Date(

      iso

    ).getTime();



  const now =

    Date.now();



  return Math.ceil(

    (due - now) /

      (

        1000 *

        60

      )

  );

}



function timeRemainingText(

  minutes:

    | number

    | null

) {

  if (

    minutes ===

    null

  ) {

    return "";

  }



  if (minutes < 0) {

    const overdue =

      Math.abs(

        minutes

      );



    if (

      overdue < 60

    ) {

      return `${overdue} นาที เกินเวลา`;

    }



    const hours =

      Math.floor(

        overdue /

          60

      );



    const mins =

      overdue %

      60;



    return `${hours} ชม. ${mins} นาที เกินเวลา`;

  }



  if (

    minutes < 60

  ) {

    return `เหลือ ${minutes} นาที`;

  }



  const hours =

    Math.floor(

      minutes /

        60

    );



  const mins =

    minutes %

    60;



  return `เหลือ ${hours} ชม. ${mins} นาที`;

}



// ======================================================

// STUCK-ORDER HELPERS

// ======================================================



const STUCK_STAGE_THRESHOLDS:

  Record<string, number> = {

  // Confirmation already has its own 30-minute KPI,
  // so it is intentionally excluded here.

  awaiting_picking: 45,

  picking: 60,

  awaiting_billing: 30,

  payment_submitted: 20,

};



function minutesSince(

  iso:

    | string

    | null

    | undefined

) {

  if (!iso) {

    return null;

  }



  const startedAt =

    new Date(

      iso

    ).getTime();



  if (

    Number.isNaN(

      startedAt

    )

  ) {

    return null;

  }



  return Math.max(

    0,

    Math.floor(

      (

        Date.now() -

        startedAt

      ) /

        (1000 * 60)

    )

  );

}



function elapsedText(

  minutes: number

) {

  if (minutes < 60) {

    return `${minutes} นาที`;

  }



  const hours =

    Math.floor(

      minutes / 60

    );



  const mins =

    minutes % 60;



  if (mins === 0) {

    return `${hours} ชม.`;

  }



  return `${hours} ชม. ${mins} นาที`;

}



// ======================================================

// PAGE

// ======================================================



export default function ControlTowerPage() {

  const today =

    getBangkokToday();



  const [

    orders,

    setOrders,

  ] =

    useState<Order[]>([]);



  const [

    kpiOrders,

    setKpiOrders,

  ] =

    useState<KPIOrder[]>(

      []

    );



  const [

    staff,

    setStaff,

  ] =

    useState<Staff[]>([]);



  const [

    claims,

    setClaims,

  ] =

    useState<

      ActiveClaim[]

    >([]);



  const [

    stageEnteredAt,

    setStageEnteredAt,

  ] =

    useState<

      Record<string, string>

    >({});



  const [

    loading,

    setLoading,

  ] =

    useState(true);



  const [

    message,

    setMessage,

  ] =

    useState("");



  // ====================================================

  // LOAD DASHBOARD

  // ====================================================



  async function loadDashboard() {

    setLoading(true);

    setMessage("");



    // --------------------------------------------------

    // TODAY'S ORDERS

    // --------------------------------------------------



    const {

      data: orderData,

      error: orderError,

    } =

      await supabase

        .from("orders")

        .select(`

          id,

          order_number,

          status,

          created_at,

          final_amount,

          delivery_date,

          delivery_slot,

          customers (

            customer_code,

            customer_name

          )

        `)

        .eq(

          "delivery_date",

          today

        )

        .order(

          "order_number",

          {

            ascending:

              true,

          }

        );



    if (orderError) {

      setMessage(

        "ไม่สามารถโหลดคำสั่งซื้อวันนี้ได้: " +

          orderError.message

      );



      setLoading(false);

      return;

    }



    const loadedOrders =

      (orderData ??

        []) as unknown as Order[];



    setOrders(

      loadedOrders

    );



    // --------------------------------------------------

    // CURRENT-STAGE START TIMES

    // --------------------------------------------------



    // Start with the order creation time as a safe

    // fallback. Then replace it with the latest history

    // row that moved the order into its current status.

    const enteredAtMap:

      Record<string, string> =

      Object.fromEntries(

        loadedOrders.map(

          (order) => [

            order.id,

            order.created_at,

          ]

        )

      );



    const orderIds =

      loadedOrders.map(

        (order) =>

          order.id

      );



    if (orderIds.length > 0) {

      const {

        data: historyData,

        error: historyError,

      } =

        await supabase

          .from(

            "order_history"

          )

          .select(`

            order_id,

            to_status,

            created_at

          `)

          .in(

            "order_id",

            orderIds

          )

          .order(

            "created_at",

            {

              ascending: true,

            }

          );



      if (historyError) {

        console.error(

          "Could not load stage timing history:",

          historyError

        );

      } else {

        const currentStatusById =

          Object.fromEntries(

            loadedOrders.map(

              (order) => [

                order.id,

                order.status,

              ]

            )

          );



        (

          (historyData ?? []) as

            OrderHistoryEntry[]

        ).forEach(

          (entry) => {

            if (

              entry.to_status &&

              entry.to_status ===

                currentStatusById[

                  entry.order_id

                ]

            ) {

              // Rows are ordered oldest -> newest,

              // so the latest matching transition wins.

              enteredAtMap[

                entry.order_id

              ] =

                entry.created_at;

            }

          }

        );

      }

    }



    setStageEnteredAt(

      enteredAtMap

    );



    // --------------------------------------------------

    // KPI / EXCEPTION DATA

    // --------------------------------------------------



    const {

      data: kpiData,

      error: kpiError,

    } =

      await supabase.rpc(

        "get_operational_kpi_orders",

        {

          p_delivery_date:

            today,

        }

      );



    if (kpiError) {

      setMessage(

        "ไม่สามารถโหลดข้อมูลแจ้งเตือนได้: " +

          kpiError.message

      );



      setLoading(false);

      return;

    }



    setKpiOrders(

      Array.isArray(

        kpiData

      )

        ? (

            kpiData as KPIOrder[]

          )

        : []

    );



    // --------------------------------------------------

    // STAFF

    // --------------------------------------------------



    const {

      data: staffData,

      error: staffError,

    } =

      await supabase

        .from("staff")

        .select(`

          id,

          staff_code,

          staff_name,

          account_type

        `)

        .order(

          "staff_code",

          {

            ascending:

              true,

          }

        );



    if (staffError) {

      setMessage(

        "ไม่สามารถโหลดข้อมูลพนักงานได้: " +

          staffError.message

      );



      setLoading(false);

      return;

    }



    setStaff(

      (staffData ??

        []) as Staff[]

    );



    // --------------------------------------------------

    // ACTIVE TASK CLAIMS

    // --------------------------------------------------



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

        );



    if (claimError) {

      setMessage(

        "ไม่สามารถโหลดภาระงานพนักงานได้: " +

          claimError.message

      );



      setLoading(false);

      return;

    }



    setClaims(

      (claimData ??

        []) as ActiveClaim[]

    );



    setLoading(false);

  }



  useEffect(() => {

    loadDashboard();

  }, []);



  // ====================================================

  // TODAY'S BASIC COUNTS

  // ====================================================



  const activeOrders =

    useMemo(

      () =>

        orders.filter(

          (order) =>

            order.status !==

              "completed" &&

            order.status !==

              "cancelled"

        ),

      [orders]

    );



  const completedOrders =

    orders.filter(

      (order) =>

        order.status ===

        "completed"

    );



  // ====================================================

  // WORKFLOW COUNTS

  // ====================================================



  const stageCounts = {

    confirmation:

      activeOrders.filter(

        (order) =>

          order.status ===

          "awaiting_confirmation"

      ).length,



    picking:

      activeOrders.filter(

        (order) =>

          order.status ===

            "awaiting_picking" ||

          order.status ===

            "picking"

      ).length,



    billing:

      activeOrders.filter(

        (order) =>

          order.status ===

          "awaiting_billing"

      ).length,



    delivery:

      activeOrders.filter(

        (order) =>

          order.status ===

            "ready_for_delivery" ||

          order.status ===

            "out_for_delivery"

      ).length,



    payment:

      activeOrders.filter(

        (order) =>

          order.status ===

            "awaiting_payment" ||

          order.status ===

            "payment_submitted"

      ).length,

  };



  // ====================================================

  // EXCEPTIONS

  // ====================================================



  const lateConfirmations =

    kpiOrders.filter(

      (order) =>

        order.status !==

          "completed" &&

        order.status !==

          "cancelled" &&

        order.confirmation_on_time ===

          false &&

        !order.confirmation_at

    );



  const lateDeliveries =

    kpiOrders.filter(

      (order) =>

        order.status !==

          "completed" &&

        order.status !==

          "cancelled" &&

        !order.delivery_at &&

        order.delivery_on_time ===

          false

    );



  const deliveryAtRisk =

    kpiOrders.filter(

      (order) => {

        if (

          order.status ===

            "completed" ||

          order.status ===

            "cancelled" ||

          order.delivery_at

        ) {

          return false;

        }



        const minutes =

          minutesUntil(

            order.delivery_due_at

          );



        return (

          minutes !==

            null &&

          minutes >= 0 &&

          minutes <= 60

        );

      }

    );



  const shortPicks =

    kpiOrders.filter(

      (order) =>

        order.status !==

          "completed" &&

        order.status !==

          "cancelled" &&

        order.short_pick ===

          true

    );



  const awaitingPayment =

    orders.filter(

      (order) =>

        order.status ===

        "awaiting_payment"

    );



  const overduePayments =

    kpiOrders.filter(

      (order) =>

        order.status !==

          "completed" &&

        order.status !==

          "cancelled" &&

        !order.payment_completed_at &&

        order.payment_on_time ===

          false

    );



  // ====================================================

  // STUCK ORDERS

  // ====================================================



  const stuckOrders =

    useMemo(() => {

      const results:

        StuckOrder[] =

        [];



      kpiOrders.forEach(

        (order) => {

          if (

            order.status ===

              "completed" ||

            order.status ===

              "cancelled"

          ) {

            return;

          }



          const threshold =

            STUCK_STAGE_THRESHOLDS[

              order.status

            ];



          if (!threshold) {

            return;

          }



          const elapsed =

            minutesSince(

              stageEnteredAt[

                order.order_id

              ]

            );



          if (

            elapsed !== null &&

            elapsed >=

              threshold

          ) {

            results.push({

              order,

              minutesInStage:

                elapsed,

              thresholdMinutes:

                threshold,

            });

          }

        }

      );



      return results.sort(

        (a, b) =>

          b.minutesInStage -

          a.minutesInStage

      );

    }, [

      kpiOrders,

      stageEnteredAt,

    ]);



  // ====================================================

  // ORDERS NEEDING ATTENTION

  // ====================================================



  const attentionOrders =

    useMemo(() => {

      const results:

        AttentionOrder[] =

        [];



      kpiOrders.forEach(

        (order) => {

          if (

            order.status ===

              "completed" ||

            order.status ===

              "cancelled"

          ) {

            return;

          }



          const issues:

            string[] =

            [];



          let severity:

            | "urgent"

            | "warning" =

            "warning";



          // Stuck in current internal stage

          const stuckInfo =

            stuckOrders.find(

              (item) =>

                item.order

                  .order_id ===

                order.order_id

            );



          if (stuckInfo) {

            issues.push(

              `งานค้างในขั้นตอน ${elapsedText(

                stuckInfo

                  .minutesInStage

              )}`

            );



            severity =

              "urgent";

          }



          // Late confirmation

          if (

            order.confirmation_on_time ===

              false &&

            !order.confirmation_at

          ) {

            issues.push(

              "ยืนยันคำสั่งซื้อล่าช้า"

            );



            severity =

              "urgent";

          }



          // Delivery

          if (

            !order.delivery_at

          ) {

            const minutes =

              minutesUntil(

                order.delivery_due_at

              );



            if (

              order.delivery_on_time ===

              false

            ) {

              issues.push(

                `Delivery ${timeRemainingText(

                  minutes

                )}`

              );



              severity =

                "urgent";

            } else if (

              minutes !==

                null &&

              minutes >= 0 &&

              minutes <= 60

            ) {

              issues.push(

                `Delivery due in ${minutes} min`

              );

            }

          }



          // Short pick

          if (

            order.short_pick ===

            true

          ) {

            issues.push(

              "หยิบสินค้าไม่ครบ"

            );

          }



          // Payment

          if (

            !order.payment_completed_at &&

            order.payment_on_time ===

              false

          ) {

            issues.push(

              "ชำระเงินเกินเวลา"

            );



            severity =

              "urgent";

          } else if (

            order.status ===

            "awaiting_payment"

          ) {

            issues.push(

              "รอชำระเงิน"

            );

          }



          if (

            issues.length >

            0

          ) {

            results.push(

              {

                order,

                issues,

                severity,

              }

            );

          }

        }

      );



      return results.sort(

        (

          a,

          b

        ) => {

          if (

            a.severity ===

              "urgent" &&

            b.severity !==

              "urgent"

          ) {

            return -1;

          }



          if (

            b.severity ===

              "urgent" &&

            a.severity !==

              "urgent"

          ) {

            return 1;

          }



          return (

            a.order

              .order_number -

            b.order

              .order_number

          );

        }

      );

    }, [

      kpiOrders,

      stuckOrders,

    ]);



  // ====================================================

  // STAFF WORKLOAD

  // ====================================================



  const todayOrderIds =

    new Set(

      orders.map(

        (order) =>

          order.id

      )

    );



  const todayClaims =

    claims.filter(

      (claim) =>

        todayOrderIds.has(

          claim.order_id

        )

    );



  const staffWorkload =

    staff.map(

      (person) => {

        const claim =

          todayClaims.find(

            (claim) =>

              claim.staff_id ===

              person.id

          );



        const order =

          claim

            ? orders.find(

                (order) =>

                  order.id ===

                  claim.order_id

              )

            : null;



        return {

          ...person,

          claim:

            claim ?? null,

          order:

            order ?? null,

        };

      }

    );



  // ====================================================

  // LOADING

  // ====================================================



  if (loading) {

    return (

      <main className="min-h-screen bg-gray-100 p-8">

        กำลังโหลดศูนย์ควบคุม...

      </main>

    );

  }



  // ====================================================

  // PAGE

  // ====================================================



  return (

    <main className="min-h-screen bg-gray-100 p-8">



      <div className="max-w-7xl mx-auto">



        {/* ============================================ */}

        {/* HEADER */}

        {/* ============================================ */}



        <div className="flex flex-col md:flex-row md:justify-between md:items-start gap-4 mb-8">



          <div>



            <Link

              href="/"

              className="text-gray-500"

            >

              ← กลับ

            </Link>



            <h1 className="text-3xl font-bold mt-3">

              ศูนย์ควบคุม

            </h1>



            <p className="text-gray-500 mt-1">

              รายการที่ผู้จัดการควรตรวจสอบในขณะนี้

            </p>



            <p className="text-sm text-gray-400 mt-1">

              วันที่จัดส่ง:{" "}

              {

                today

              }

            </p>



          </div>



          <div className="flex gap-3">



            <Link

              href="/tasks"

              className="bg-black text-white rounded-lg px-5 py-3 font-semibold"

            >

              เปิดหน้างาน

            </Link>



            <button

              onClick={

                loadDashboard

              }

              className="bg-white border rounded-lg px-5 py-3"

            >

              รีเฟรช

            </button>



          </div>



        </div>



        {message && (

          <div className="bg-white border rounded-xl p-4 mb-6 text-red-600">

            {message}

          </div>

        )}



        {/* ============================================ */}

        {/* TODAY */}

        {/* ============================================ */}



        <section className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">



          <div className="bg-white border rounded-2xl p-5">



            <p className="text-sm text-gray-500">

              คำสั่งซื้อวันนี้

            </p>



            <p className="text-3xl font-bold mt-2">

              {

                orders.filter(

                  (order) =>

                    order.status !==

                    "cancelled"

                ).length

              }

            </p>



          </div>



          <div className="bg-white border rounded-2xl p-5">



            <p className="text-sm text-gray-500">

              เสร็จสิ้น

            </p>



            <p className="text-3xl font-bold mt-2">

              {

                completedOrders.length

              }

            </p>



          </div>



          <div className="bg-white border rounded-2xl p-5">



            <p className="text-sm text-gray-500">

              กำลังดำเนินการ

            </p>



            <p className="text-3xl font-bold mt-2">

              {

                activeOrders.length

              }

            </p>



          </div>



          <div className="bg-white border rounded-2xl p-5">



            <p className="text-sm text-gray-500">

              ต้องตรวจสอบ

            </p>



            <p className="text-3xl font-bold mt-2">

              {

                attentionOrders.length

              }

            </p>



          </div>



        </section>



        {/* ============================================ */}

        {/* URGENT / EXCEPTION CARDS */}

        {/* ============================================ */}



        <section className="mb-6">



          <h2 className="text-xl font-bold mb-4">

            ข้อยกเว้นและความเสี่ยง

          </h2>



          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">



            <div className="bg-white border rounded-2xl p-5">



              <p className="text-sm text-gray-500">

                ยืนยันล่าช้า

              </p>



              <p className="text-3xl font-bold mt-2">

                {

                  lateConfirmations.length

                }

              </p>



              <p className="text-xs text-gray-400 mt-2">

                เกิน 30 นาที

              </p>



            </div>



            <div className="bg-white border rounded-2xl p-5">



              <p className="text-sm text-gray-500">

                เสี่ยงจัดส่งไม่ทัน

              </p>



              <p className="text-3xl font-bold mt-2">

                {

                  deliveryAtRisk.length

                }

              </p>



              <p className="text-xs text-gray-400 mt-2">

                เหลือไม่เกิน 60 นาที

              </p>



            </div>



            <div className="bg-white border rounded-2xl p-5">



              <p className="text-sm text-gray-500">

                จัดส่งล่าช้า

              </p>



              <p className="text-3xl font-bold mt-2">

                {

                  lateDeliveries.length

                }

              </p>



              <p className="text-xs text-gray-400 mt-2">

                เกินช่วงเวลาที่ลูกค้าเลือก

              </p>



            </div>



            <div className="bg-white border rounded-2xl p-5">



              <p className="text-sm text-gray-500">

                หยิบสินค้าไม่ครบ

              </p>



              <p className="text-3xl font-bold mt-2">

                {

                  shortPicks.length

                }

              </p>



              <p className="text-xs text-gray-400 mt-2">

                เกินค่าความคลาดเคลื่อนที่กำหนด

              </p>



            </div>



            <div className="bg-white border rounded-2xl p-5">



              <p className="text-sm text-gray-500">

                งานค้างในขั้นตอน

              </p>



              <p className="text-3xl font-bold mt-2">

                {

                  stuckOrders.length

                }

              </p>



              <p className="text-xs text-gray-400 mt-2">

                Picking / Billing / Payment Verification

              </p>



            </div>



            <div className="bg-white border rounded-2xl p-5">



              <p className="text-sm text-gray-500">

                รอชำระเงิน

              </p>



              <p className="text-3xl font-bold mt-2">

                {

                  awaitingPayment.length

                }

              </p>



              {overduePayments.length >

                0 && (

                <p className="text-xs font-semibold mt-2">

                  {

                    overduePayments.length

                  }{" "}

                  เกินกำหนดหลัง 21:00

                </p>

              )}



            </div>



          </div>



        </section>



        {/* ============================================ */}

        {/* ORDERS NEEDING ATTENTION */}

        {/* ============================================ */}



        <section className="bg-white border rounded-2xl overflow-hidden mb-6">



          <div className="p-6 border-b">



            <h2 className="text-xl font-bold">

              คำสั่งซื้อที่ต้องตรวจสอบ

            </h2>



            <p className="text-sm text-gray-500 mt-1">

              แสดงคำสั่งซื้อที่มีข้อยกเว้น ใกล้ถึงกำหนด หรือค้างอยู่ในขั้นตอนภายในนานเกินไป

            </p>



          </div>



          {attentionOrders.length ===

          0 ? (



            <div className="p-8 text-center">



              <p className="font-semibold">

                ✓ ไม่มีข้อยกเว้นในการดำเนินงาน

              </p>



              <p className="text-gray-500 mt-1">

                การดำเนินงานวันนี้เป็นไปตามแผน

              </p>



            </div>



          ) : (



            <div>



              {attentionOrders.map(

                ({

                  order,

                  issues,

                  severity,

                }) => (



                  <div

                    key={

                      order.order_id

                    }

                    className="p-5 border-b last:border-b-0 flex flex-col md:flex-row md:justify-between md:items-center gap-5"

                  >



                    <div>



                      <div className="flex flex-wrap items-center gap-3">



                        <p className="font-bold text-lg">

                          คำสั่งซื้อ #

                          {

                            order.order_number

                          }

                        </p>



                        <span

                          className={

                            severity ===

                            "urgent"

                              ? "text-xs border rounded-full px-3 py-1 font-semibold"

                              : "text-xs bg-gray-100 rounded-full px-3 py-1 font-semibold"

                          }

                        >

                          {severity ===

                          "urgent"

                            ? "ด่วน"

                            : "เฝ้าระวัง"}

                        </span>



                      </div>



                      <p className="text-gray-600 mt-1">

                        {

                          order.customer_name ??

                          "ไม่ทราบชื่อลูกค้า"

                        }

                      </p>



                      <p className="text-sm text-gray-400 mt-1">

                        {

                          prettyStatus(

                            order.status

                          )

                        }

                        {" · "}

                        {

                          order.delivery_slot ??

                          "ไม่มีช่วงเวลาจัดส่ง"

                        }

                      </p>



                      <div className="flex flex-wrap gap-2 mt-3">



                        {issues.map(

                          (

                            issue

                          ) => (



                            <span

                              key={

                                issue

                              }

                              className="border rounded-full px-3 py-1 text-sm"

                            >

                              {

                                issue

                              }

                            </span>



                          )

                        )}



                      </div>



                    </div>



                    <Link

                      href={`/orders/${order.order_number}`}

                      className="bg-black text-white rounded-lg px-5 py-3 font-semibold text-center"

                    >

                      ดูคำสั่งซื้อ

                    </Link>



                  </div>



                )

              )}



            </div>



          )}



        </section>



        {/* ============================================ */}

        {/* WORKFLOW */}

        {/* ============================================ */}



        <section className="bg-white border rounded-2xl p-6 mb-6">



          <div className="flex justify-between items-center mb-5">



            <div>



              <h2 className="text-xl font-bold">

                สถานะงานปัจจุบัน

              </h2>



              <p className="text-sm text-gray-500 mt-1">

                จำนวนคำสั่งซื้อที่ค้างอยู่ในแต่ละขั้นตอน

              </p>



            </div>



            <Link

              href="/tasks"

              className="underline font-semibold"

            >

              ดูงาน →

            </Link>



          </div>



          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">



            <div className="border rounded-xl p-4">



              <p className="text-sm text-gray-500">

                ยืนยันคำสั่งซื้อ

              </p>



              <p className="text-3xl font-bold mt-2">

                {

                  stageCounts.confirmation

                }

              </p>



            </div>



            <div className="border rounded-xl p-4">



              <p className="text-sm text-gray-500">

                จัดสินค้า

              </p>



              <p className="text-3xl font-bold mt-2">

                {

                  stageCounts.picking

                }

              </p>



            </div>



            <div className="border rounded-xl p-4">



              <p className="text-sm text-gray-500">

                ออกบิล

              </p>



              <p className="text-3xl font-bold mt-2">

                {

                  stageCounts.billing

                }

              </p>



            </div>



            <div className="border rounded-xl p-4">



              <p className="text-sm text-gray-500">

                จัดส่ง

              </p>



              <p className="text-3xl font-bold mt-2">

                {

                  stageCounts.delivery

                }

              </p>



            </div>



            <div className="border rounded-xl p-4">



              <p className="text-sm text-gray-500">

                ชำระเงิน

              </p>



              <p className="text-3xl font-bold mt-2">

                {

                  stageCounts.payment

                }

              </p>



            </div>



          </div>



        </section>



        {/* ============================================ */}

        {/* STAFF WORKLOAD */}

        {/* ============================================ */}



        <section className="bg-white border rounded-2xl overflow-hidden">



          <div className="p-6 border-b">



            <h2 className="text-xl font-bold">

              ภาระงานพนักงาน

            </h2>



            <p className="text-sm text-gray-500 mt-1">

              ผู้รับผิดชอบงานที่กำลังดำเนินการของวันนี้

            </p>



          </div>



          <div className="overflow-x-auto">



            <table className="w-full">



              <thead className="bg-gray-50">



                <tr>



                  <th className="p-4 text-left">

                    พนักงาน

                  </th>



                  <th className="p-4 text-left">

                    ประเภทบัญชี

                  </th>



                  <th className="p-4 text-left">

                    งานปัจจุบัน

                  </th>



                  <th className="p-4 text-left">

                    ลูกค้า

                  </th>



                  <th className="p-4 text-right">

                    การดำเนินการ

                  </th>



                </tr>



              </thead>



              <tbody>



                {staffWorkload.map(

                  (

                    person

                  ) => (



                    <tr

                      key={

                        person.id

                      }

                      className="border-t"

                    >



                      <td className="p-4">



                        <p className="font-semibold">

                          {

                            person.staff_name

                          }

                        </p>



                        <p className="text-xs text-gray-400">

                          {

                            person.staff_code

                          }

                        </p>



                      </td>



                      <td className="p-4">

                        {person.account_type ===

                        "manager"

                          ? "ผู้จัดการ"

                          : "พนักงาน"}

                      </td>



                      <td className="p-4">



                        {person.claim &&

                        person.order ? (



                          <>



                            <p className="font-semibold">

                              {prettyStage(

                                person.claim

                                  .stage

                              )}

                            </p>



                            <p className="text-sm text-gray-500">

                              คำสั่งซื้อ #

                              {

                                person.order

                                  .order_number

                              }

                            </p>



                          </>



                        ) : (



                          <span className="text-gray-400">

                            ว่าง

                          </span>



                        )}



                      </td>



                      <td className="p-4">



                        {person.order

                          ?.customers

                          ?.customer_name ??

                          "—"}



                      </td>



                      <td className="p-4 text-right">



                        {person.order ? (



                          <Link

                            href={`/orders/${person.order.order_number}`}

                            className="underline font-semibold"

                          >

                            ดู

                          </Link>



                        ) : (



                          <span className="text-gray-300">

                            —

                          </span>



                        )}



                      </td>



                    </tr>



                  )

                )}



              </tbody>



            </table>



          </div>



        </section>



      </div>



    </main>

  );

}