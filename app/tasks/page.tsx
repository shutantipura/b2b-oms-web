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

  // LOADING

  // =====================================================



  if (loading) {

    return (

      <main className="min-h-screen bg-gray-100 p-8">



        <p>

          กำลังโหลดงาน...

        </p>



      </main>

    );

  }



  // =====================================================

  // PAGE

  // =====================================================



  return (

    <main className="min-h-screen bg-gray-100 p-8">



      <div className="max-w-6xl mx-auto">



        {/* HEADER */}



        <div className="flex justify-between items-center mb-8">



          <div>



            <Link

              href="/login"

              className="text-sm text-gray-500"

            >

              ← กลับ

            </Link>



            <h1 className="text-3xl font-bold mt-2">

              งาน

            </h1>



            <p className="text-gray-500 mt-1">

              เลือกคำสั่งซื้อเพื่อเริ่มงาน

            </p>



          </div>



          <button

            onClick={

              loadData

            }

            className="bg-white border rounded-lg px-4 py-2"

          >

            รีเฟรช

          </button>



        </div>



        {/* MESSAGE */}



        {message && (

          <div className="bg-white border rounded-lg p-4 mb-6">

            {message}

          </div>

        )}



        {callStage && (
          <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
            onClick={() => setCallStage(null)}>
            <div role="dialog" aria-modal="true" aria-label="เรียกพนักงาน"
              onClick={(event) => event.stopPropagation()}
              className="bg-white w-full max-w-lg rounded-2xl p-5 shadow-xl max-h-[85vh] overflow-y-auto">
              <div className="flex items-start justify-between gap-3 mb-4">
                <div>
                  <h2 className="text-xl font-bold">📞 เรียกพนักงาน</h2>
                  <p className="text-sm text-gray-500 mt-1">{groups.find((g) => g.stage === callStage)?.title}</p>
                </div>
                <button type="button" onClick={() => setCallStage(null)} className="border rounded-lg px-3 py-2">ปิด</button>
              </div>
              {callLoading ? <p className="text-gray-500 py-5">กำลังโหลดรายชื่อ...</p>
                : callError ? <p className="text-red-600 py-5">{callError}</p>
                : callStaff.length === 0 ? <p className="text-gray-500 py-5">ไม่มีพนักงานที่ได้รับสิทธิ์งานประเภทนี้</p>
                : <div className="divide-y">{callStaff.map((person) => (
                  <div key={person.staff_id} className="py-4 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold">{person.staff_name} <span className="text-xs text-gray-500">({person.staff_code})</span></p>
                      <p className="text-xs text-gray-500">{person.account_type === "manager" ? "Manager" : "Staff"}</p>
                      <p className="text-sm text-gray-600">{person.phone || "ยังไม่มีเบอร์โทรศัพท์"}</p>
                    </div>
                    {person.phone ? <a href={`tel:${person.phone}`} className="shrink-0 bg-green-600 text-white rounded-xl px-4 py-3 font-semibold">📞 โทร</a>
                      : <span className="text-xs text-gray-400">โทรไม่ได้</span>}
                  </div>
                ))}</div>}
            </div>
          </div>
        )}

        {/* TASK GROUPS */}



        <div className="space-y-6">



          {groups

            .map(

            (group) => {

              const canWork = allowedStages.includes(group.stage);
              const expanded = isExpanded(group.stage);

              const groupOrders =

                orders.filter(

                  (order) =>

                    group.statuses.includes(

                      order.status

                    )

                );



              return (

                <section

                  key={

                    group.stage

                  }

                  className="bg-white border rounded-2xl overflow-hidden"

                >



                  {/* All stages visible; only authorized stages start expanded. */}
                  <div className="p-4 sm:p-5 border-b flex items-center justify-between gap-2 sm:gap-3">
                    <div className="flex min-w-0 flex-wrap items-center gap-2 sm:gap-3">
                      <span className="text-lg sm:text-xl font-bold">{group.title}</span>
                      <span className="text-xs sm:text-sm bg-gray-100 rounded-full px-3 py-1 whitespace-nowrap">
                        {groupOrders.length} คำสั่งซื้อ
                      </span>
                      {!canWork && (
                        <span className="text-xs text-gray-500 border rounded-full px-3 py-1 whitespace-nowrap">
                          ดูได้เท่านั้น
                        </span>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void openStaffDirectory(group.stage)}
                        className="text-xs sm:text-sm bg-green-50 border border-green-200 text-green-700 rounded-full px-2.5 sm:px-3 py-1 font-medium whitespace-nowrap hover:bg-green-100"
                      >
                        📞 เรียกพนักงาน
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleGroup(group.stage)}
                        aria-expanded={expanded}
                        aria-label={`${expanded ? "ย่อ" : "แสดง"}รายการ${group.title}`}
                        className="text-gray-500 text-sm whitespace-nowrap rounded-lg px-1.5 py-1 hover:bg-gray-100"
                      >
                        {expanded ? "▲ ย่อ" : "▼ แสดง"}
                      </button>
                    </div>
                  </div>

                  {expanded && (
                    <>

                  {/* NO ORDERS */}



                  {groupOrders.length ===

                  0 ? (



                    <div className="p-5 text-gray-400">

                      ไม่มีคำสั่งซื้อรอดำเนินการ

                    </div>



                  ) : (



                    <div>



                      {groupOrders.map(

                        (order) => {

                          const claim =

                            claims.find(

                              (

                                claim

                              ) =>

                                claim.order_id ===

                                  order.id &&

                                claim.stage ===

                                  group.stage

                            );



                          const isMine =

                            Boolean(

                              claim &&

                                currentStaff &&

                                claim.staff_id ===

                                  currentStaff.id

                            );



                          const isAwaitingPayment =

                            order.status ===

                            "awaiting_payment";



                          return (

                            <div

                              key={

                                order.order_number

                              }

                              className="p-5 border-b last:border-b-0 flex flex-col md:flex-row md:justify-between md:items-center gap-6"

                            >



                              {/* ORDER DETAILS */}



                              <div>



                                <div className="font-semibold text-lg">

                                  คำสั่งซื้อ #

                                  {

                                    order.order_number

                                  }

                                </div>



                                <div className="text-gray-600 mt-1">

                                  {

                                    order.customers

                                      ?.customer_name ??

                                    "ไม่ทราบชื่อลูกค้า"

                                  }

                                </div>



                                <div className="text-sm text-gray-400 mt-1">

                                  {

                                    order.delivery_date ??

                                    "ยังไม่ระบุวันที่"

                                  }



                                  {" · "}



                                  {

                                    order.delivery_slot ??

                                    "ยังไม่ระบุช่วงเวลา"

                                  }

                                </div>



                                <div className="text-xs text-gray-400 mt-1">

                                  {prettyStatus(

                                    order.status

                                  )}

                                </div>



                              </div>



                              {/* ACTION */}



                              <div>



                                {/* ============================== */}

                                {/* AWAITING PAYMENT */}

                                {/* ============================== */}



                                {!canWork ? (
                                  <div className="text-sm text-gray-500 text-right">
                                    <div className="font-medium">ดูสถานะได้เท่านั้น</div>
                                    <div className="mt-1">
                                      {claim ? `ผู้รับงาน: ${claim.staff_name}` : "ยังไม่มีผู้รับงาน"}
                                    </div>
                                  </div>
                                ) : isAwaitingPayment ? (



                                  <div className="text-right">



                                    <div className="font-semibold mb-1">

                                      รอชำระเงิน

                                    </div>



                                    <div className="text-sm text-gray-500 mb-3">

                                      พนักงานสามารถอัปโหลดสลิปการชำระเงินแทนลูกค้าได้

                                    </div>



                                    <Link

                                      href={`/tasks/payment-verification/${order.order_number}`}

                                      className="inline-block bg-black text-white rounded-lg px-5 py-3 font-semibold"

                                    >

                                      ชำระเงิน

                                    </Link>



                                  </div>



                                ) : !claim ? (



                                  /* ============================ */

                                  /* AVAILABLE TASK */

                                  /* ============================ */



                                  <button

                                    onClick={() =>

                                      startWork(

                                        order.order_number,

                                        group.stage

                                      )

                                    }

                                    className="bg-black text-white rounded-lg px-5 py-3 font-semibold"

                                  >

                                    รับงาน

                                  </button>



                                ) : isMine ? (



                                  /* ============================ */

                                  /* CURRENT STAFF OWNS TASK */

                                  /* ============================ */



                                  <div className="text-right">



                                    <div className="font-semibold">

                                      กำลังดำเนินการ

                                    </div>



                                    <div className="text-sm text-gray-500 mb-3">

                                      คุณ ·{" "}

                                      {

                                        claim?.staff_name

                                      }

                                    </div>



                                    <Link

                                      href={taskLink(

                                        group.stage,

                                        order.order_number

                                      )}

                                      className="inline-block bg-black text-white rounded-lg px-5 py-2 font-semibold"

                                    >

                                      ทำต่อ

                                    </Link>



                                  </div>



                                ) : (



                                  /* ============================ */

                                  /* SOMEONE ELSE OWNS TASK */

                                  /* ============================ */



                                  <div className="text-right">



                                    <div className="font-semibold">

                                      กำลังดำเนินการ

                                    </div>



                                    <div className="text-sm text-gray-500">

                                      {

                                        claim?.staff_name

                                      }

                                    </div>



                                  </div>



                                )}



                              </div>



                            </div>

                          );

                        }

                      )}



                    </div>



                  )}



                    </>
                  )}
                </section>

              );

            }

          )}



        </div>



      </div>



    </main>

  );

}