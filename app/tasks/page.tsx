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
  group_root_order_id: string | null;
  group_sequence: number | null;

  status: string;

  delivery_date: string | null;

  delivery_slot: string | null;
  customer_id: string;
  final_amount: number | string | null;
  billing_account_suspended: boolean;
  billing_no_cv: boolean;
  estimated_amount: number | null;
  estimate_uses_current_price: boolean;

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

    title: "รับสลิปชำระเงิน",

    stage: "payment_verification",

    statuses: [

      "awaiting_payment",

    ],

  },

];



// Keep task estimates consistent with the customer order-tracking page:
// use an amount saved at order time first; only fall back to today's price
// for historical lines without a saved price.
type PriceRecord = Record<string, unknown>;

function validAmount(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function firstAmount(record: PriceRecord, keys: string[]): number | null {
  for (const key of keys) {
    const amount = validAmount(record[key]);
    if (amount !== null) return amount;
  }
  return null;
}

function requestedQuantity(item: PriceRecord) {
  return firstAmount(item, [
    "requested_qty", "requested_quantity", "quantity", "requested",
  ]);
}

function savedLineAmount(item: PriceRecord, quantity: number | null) {
  const subtotal = firstAmount(item, [
    "estimated_subtotal", "subtotal_at_order", "requested_subtotal", "line_total_at_order",
  ]);
  if (subtotal !== null) return subtotal;

  const savedPrice = firstAmount(item, [
    "price_per_kg_at_order", "price_per_unit_at_order", "unit_price_at_order",
    "effective_price_at_order", "price_at_order", "agreed_price_at_order",
    "unit_price_snapshot", "price_per_kg", "unit_price",
  ]);
  return savedPrice !== null && quantity !== null ? savedPrice * quantity : null;
}

function formatBaht(amount: number) {
  return new Intl.NumberFormat("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}


type DeliveryUrgency = "overdue" | "at-risk" | "today" | "none";
type BangkokClock = { date: string; minutes: number };

function getBangkokClock(): BangkokClock {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const part = (kind: string) => parts.find((entry) => entry.type === kind)?.value ?? "";
  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    minutes: Number(part("hour")) * 60 + Number(part("minute")),
  };
}

function utcDateDay(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const timestamp = Date.UTC(year, month - 1, day);
  return Number.isFinite(timestamp) ? timestamp / 86_400_000 : null;
}

function deliveryDaysAway(deliveryDate: string | null, today: string): number | null {
  if (!deliveryDate) return null;
  const target = utcDateDay(deliveryDate);
  const baseline = utcDateDay(today);
  return target === null || baseline === null ? null : Math.round(target - baseline);
}

function relativeDeliveryDay(deliveryDate: string | null, today: string): string {
  const days = deliveryDaysAway(deliveryDate, today);
  if (days === null) return "ไม่ระบุวันที่";
  if (days === -1) return "เมื่อวาน";
  if (days === 0) return "วันนี้";
  if (days === 1) return "พรุ่งนี้";
  return days < 0 ? `${Math.abs(days)} วันที่แล้ว` : `${days} วันข้างหน้า`;
}

function deliverySlotMinutes(slot: string | null): { start: number; end: number } | null {
  if (!slot) return null;
  const times = [...slot.matchAll(/([01]?\d|2[0-3]):([0-5]\d)/g)]
    .map((match) => Number(match[1]) * 60 + Number(match[2]));
  if (times.length < 2) return null;
  return { start: times[0], end: times[1] <= times[0] ? times[1] + 1440 : times[1] };
}

function deliveryUrgency(order: Order, now: BangkokClock): DeliveryUrgency {
  const days = deliveryDaysAway(order.delivery_date, now.date);
  if (days === null) return "none";

  // The payment-verification queue is post-delivery; an unpaid order
  // should not be mislabelled as a missed delivery.
  if (order.status === "awaiting_payment" || order.status === "payment_submitted") {
    return days === 0 ? "today" : "none";
  }

  const slot = deliverySlotMinutes(order.delivery_slot);
  if (days < 0) return "overdue";
  if (days === 0 && slot && now.minutes >= slot.end) return "overdue";

  // Orange only while today's delivery slot is in progress.
  // Before the slot starts, today's tasks remain yellow; from the slot end,
  // unfinished tasks are red (handled above).
  if (days === 0 && slot && now.minutes >= slot.start && now.minutes < slot.end) {
    return "at-risk";
  }

  return days === 0 ? "today" : "none";
}

// All delivery-urgency colours are set as explicit inline styles.
// This prevents generic Tailwind border utilities or stale stylesheet rules
// from changing the order stripe to the wrong colour.
const urgencyPalette: Record<DeliveryUrgency, {
  accent: string;
  background: string;
  dayBorder: string;
  dayBackground: string;
  dayText: string;
  statusText: string;
}> = {
  overdue: {
    accent: "#E53935", background: "#FFF0F0",
    dayBorder: "#F5B7B5", dayBackground: "#FDE8E8",
    dayText: "#B42318", statusText: "#B42318",
  },
  "at-risk": {
    accent: "#FF9800", background: "#FFF3E0",
    dayBorder: "#FFB74D", dayBackground: "#FFE0B2",
    dayText: "#A34D00", statusText: "#A34D00",
  },
  today: {
    accent: "#E5B700", background: "#FFFBE6",
    dayBorder: "#F6DA65", dayBackground: "#FFF5B5",
    dayText: "#785A00", statusText: "#785A00",
  },
  none: {
    accent: "transparent", background: "#FFFFFF",
    dayBorder: "transparent", dayBackground: "transparent",
    dayText: "#6C877E", statusText: "#6C877E",
  },
};


async function withEstimatedAmounts(rawOrders: Order[]): Promise<Order[]> {
  const withoutEstimate = rawOrders.map((order) => ({
    ...order,
    estimated_amount: null,
    estimate_uses_current_price: false,
  }));
  if (withoutEstimate.length === 0) return withoutEstimate;

  const orderIds = withoutEstimate.map((order) => order.id);
  const { data: rows, error: itemsError } = await supabase
    .from("order_items")
    .select("*")
    .in("order_id", orderIds);

  // Task claiming remains usable even if an estimate is unavailable.
  if (itemsError) {
    console.warn("Could not calculate task estimates:", itemsError.message);
    return withoutEstimate;
  }

  const items = (rows ?? []) as PriceRecord[];
  const productIds = [...new Set(items
    .map((item) => String(item.product_id ?? ""))
    .filter(Boolean))];
  const customerIds = [...new Set(withoutEstimate.map((order) => order.customer_id).filter(Boolean))];

  const [productResult, specialPriceResult] = await Promise.all([
    productIds.length
      ? supabase.from("products").select("id, normal_price").in("id", productIds)
      : Promise.resolve({ data: [], error: null }),
    productIds.length && customerIds.length
      ? supabase.from("customer_prices")
          .select("customer_id, product_id, agreed_price")
          .in("customer_id", customerIds)
          .in("product_id", productIds)
          .eq("is_active", true)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const regularPrices = new Map<string, number>();
  if (!productResult.error) {
    for (const product of productResult.data ?? []) {
      const price = validAmount(product.normal_price);
      if (price !== null) regularPrices.set(String(product.id), price);
    }
  }

  const specialPrices = new Map<string, number>();
  if (!specialPriceResult.error) {
    for (const priceRow of specialPriceResult.data ?? []) {
      const price = validAmount(priceRow.agreed_price);
      if (price !== null) {
        specialPrices.set(String(priceRow.customer_id) + ":" + String(priceRow.product_id), price);
      }
    }
  }

  const byOrder = new Map<string, PriceRecord[]>();
  for (const item of items) {
    const id = String(item.order_id ?? "");
    const previous = byOrder.get(id) ?? [];
    previous.push(item);
    byOrder.set(id, previous);
  }

  return withoutEstimate.map((order) => {
    const orderItems = byOrder.get(order.id) ?? [];
    if (orderItems.length === 0) return order;

    let total = 0;
    let usedCurrentPrice = false;
    for (const item of orderItems) {
      const quantity = requestedQuantity(item);
      const saved = savedLineAmount(item, quantity);
      if (saved !== null) {
        total += saved;
        continue;
      }

      const productId = String(item.product_id ?? "");
      const current = !specialPriceResult.error
        ? specialPrices.get(order.customer_id + ":" + productId) ?? regularPrices.get(productId)
        : null;

      if (quantity === null || current === null || current === undefined) {
        return { ...order, estimated_amount: null, estimate_uses_current_price: false };
      }
      total += current * quantity;
      usedCurrentPrice = true;
    }

    return {
      ...order,
      estimated_amount: total,
      estimate_uses_current_price: usedCurrentPrice,
    };
  });
}

export default function TasksPage() {

  const [clock, setClock] = useState<BangkokClock>(() => getBangkokClock());

  useEffect(() => {
    // Refresh promptly when a delivery window starts/ends, including after a
    // backgrounded mobile browser resumes. Using a 60-second interval could
    // leave a task yellow for almost a minute after its slot started.
    const updateClock = () => {
      const next = getBangkokClock();
      setClock((previous) =>
        previous.date === next.date && previous.minutes === next.minutes
          ? previous
          : next
      );
    };
    updateClock();
    const timer = window.setInterval(updateClock, 5_000);
    window.addEventListener("focus", updateClock);
    document.addEventListener("visibilitychange", updateClock);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", updateClock);
      document.removeEventListener("visibilitychange", updateClock);
    };
  }, []);

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
          group_root_order_id,
          group_sequence,
          status,
          delivery_date,
          delivery_slot,
          customer_id,
          final_amount,
          billing_account_suspended,
          billing_no_cv,
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

    setOrders(await withEstimatedAmounts((orderData ?? []) as unknown as Order[]));

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



  async function takeOverTask(orderNumber: number, stage: string, currentOwnerId: string, currentOwnerName: string) {
    const proceed = window.confirm(
      `⚠️ ยืนยันการรับงานแทนพนักงานคนอื่น?\n\nคำสั่งซื้อ #${orderNumber}\nผู้รับงานปัจจุบัน: ${currentOwnerName}\n\nหากยืนยัน พนักงานเดิมจะเสียสิทธิ์ดำเนินงานนี้ทันที และคุณจะเป็นผู้รับงานใหม่ กรุณาตรวจสอบงานที่ทำไปแล้วก่อนทำต่อ`
    );
    if (!proceed) return;

    setMessage(`กำลังรับงานแทนสำหรับคำสั่งซื้อ #${orderNumber}...`);
    const { error } = await supabase.rpc("take_over_my_task", {
      p_order_number: orderNumber,
      p_stage: stage,
      p_expected_staff_id: currentOwnerId,
    });
    if (error) {
      await loadData();
      setMessage("ไม่สามารถรับงานแทนได้: " + error.message);
      return;
    }
    window.location.assign(taskLink(stage, orderNumber));
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

      return `/orders/${orderNumber}/payment`;

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



            <p className="oms-page-kicker">OPERATIONS / TASK QUEUE</p>
<h1 className="text-3xl font-bold mt-2">งาน</h1>



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
                    {person.phone ? <a href={`tel:${person.phone}`} className="shrink-0 bg-[#00BCB4] text-[#173F3C] rounded-xl px-4 py-3 font-semibold">📞 โทร</a>
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

                orders.filter((order) => {
                  if (!group.statuses.includes(order.status)) return false;
                  // Only the group primary owns Billing, Delivery and Payment.
                  const downstream = ["billing","delivery","payment_verification"].includes(group.stage);
                  if (downstream && order.group_root_order_id && order.group_root_order_id!==order.id)
                    return false;
                  // A root is not billable until every active suborder is picked.
                  if (group.stage==="billing" && order.group_root_order_id===order.id) {
                    const members = orders.filter(member=>member.group_root_order_id===order.id);
                    if (!members.every(member=>member.status==="awaiting_billing")) return false;
                  }
                  return true;
                });



              return (

                <section

                  key={

                    group.stage

                  }

                  className="oms-task-stage bg-white border rounded-2xl overflow-hidden"

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
                        className="text-xs sm:text-sm bg-[#E7FAF8] border border-[#B8EAE5] text-[#007F79] rounded-full px-2.5 sm:px-3 py-1 font-medium whitespace-nowrap hover:bg-[#CFF4F0]"
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
                        <span className="oms-stage-chevron" aria-hidden="true">{expanded ? "⌃" : "⌄"}</span><span>{expanded ? "ย่อ" : "แสดง"}</span>
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

                          const urgency = deliveryUrgency(order, clock);



                          return (
                            <div
                              key={order.id}
                              data-urgency={urgency}
                              className="flex items-center justify-between gap-3 border-b border-[#E2EEEA] border-l-4 px-3 py-3 last:border-b-0 sm:px-5 sm:py-3.5"
                              style={{
                                borderLeftColor: urgencyPalette[urgency].accent,
                                backgroundColor: urgencyPalette[urgency].background,
                              }}
                            >
                              <div className="min-w-0 flex-1">
                                <div
                                  className="truncate text-base font-extrabold leading-snug text-[#424242]"
                                  title={order.customers?.customer_name ?? "ไม่ทราบชื่อลูกค้า"}
                                >
                                  {order.customers?.customer_name ?? "ไม่ทราบชื่อลูกค้า"}
                                </div>

                                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                                  <span
                                    className="inline-flex min-h-7 items-center rounded-lg border px-2 py-1 text-xs font-extrabold"
                                    style={{
                                      borderColor: urgencyPalette[urgency].dayBorder,
                                      backgroundColor: urgencyPalette[urgency].dayBackground,
                                      color: urgencyPalette[urgency].dayText,
                                    }}
                                    title={
                                      urgency === "overdue" ? "เลยช่วงเวลาจัดส่งแล้ว"
                                        : urgency === "at-risk" ? "อยู่ระหว่างช่วงเวลาจัดส่ง"
                                        : urgency === "today" ? "กำหนดจัดส่งวันนี้" : "กำหนดจัดส่ง"
                                    }
                                  >
                                    {relativeDeliveryDay(order.delivery_date, clock.date)}
                                  </span>
                                  <span className="inline-flex min-h-7 items-center gap-1 rounded-lg border border-[#B8EAE5] bg-[#E7FAF8] px-2.5 py-1 text-sm font-extrabold tracking-tight text-[#424242]">
                                    <svg
                                      aria-hidden="true"
                                      className="h-3.5 w-3.5 shrink-0 text-[#007F79]"
                                      viewBox="0 0 24 24"
                                      fill="none"
                                      stroke="currentColor"
                                      strokeWidth="2"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    >
                                      <circle cx="12" cy="12" r="9" />
                                      <path d="M12 7v5l3 2" />
                                    </svg>
                                    {order.delivery_slot ?? "ไม่ระบุเวลา"}
                                  </span>
                                  {urgency === "overdue" && (
                                    <span className="text-[11px] font-extrabold" style={{ color: urgencyPalette[urgency].statusText }}>เกินกำหนด</span>
                                  )}
                                  {urgency === "at-risk" && (
                                    <span className="text-[11px] font-extrabold" style={{ color: urgencyPalette[urgency].statusText }}>อยู่ในช่วงจัดส่ง</span>
                                  )}
                                  {group.stage === "delivery" && (order.billing_account_suspended || order.billing_no_cv) && (
                                    <span className="inline-flex min-h-7 items-center rounded-lg border border-[#F0BD59] bg-[#FFF0CB] px-2 py-1 text-[11px] font-extrabold text-[#8A4A00]">
                                      ⚠ {order.billing_account_suspended ? "บัญชีถูกระงับ" : "ลูกค้าไม่มีCV"}
                                    </span>
                                  )}
                                </div>

                                <div
                                  className="mt-1.5 text-sm font-extrabold text-[#007F79]"
                                  title={order.final_amount !== null
                                    ? "ยอดบิลสุดท้าย (อัปเดตล่าสุด)"
                                    : "มูลค่าคำสั่งซื้อโดยประมาณ ก่อนยืนยันยอดบิล"}
                                >
                                  {order.final_amount !== null
                                    ? `฿${formatBaht(Number(order.final_amount))}`
                                    : (() => {
                                        const candidates = group.stage==="billing" &&
                                          order.group_root_order_id===order.id
                                          ? orders.filter(o=>o.group_root_order_id===order.id)
                                          : [order];
                                        return candidates.every(o=>o.estimated_amount!==null)
                                          ? `฿${formatBaht(candidates.reduce((sum,o)=>sum+Number(o.estimated_amount),0))}`
                                          : "฿ —";
                                      })()}
                                  <span className="ml-2 text-[10px] font-semibold text-[#718C84]">
                                    {order.final_amount !== null ? "ยอดบิลจริง" : "ประมาณการ"}
                                  </span>
                                </div>
                                <p className="mt-0.5 text-[11px] font-medium text-[#8A9E97]">
                                  คำสั่งซื้อ #{order.group_root_order_id
                                     ? `${orders.find(root=>root.id===order.group_root_order_id)?.order_number ?? order.order_number}/${order.group_sequence ?? 1}`
                                     : order.order_number}
                                </p>
                              </div>

                              <div className="flex shrink-0 items-center justify-end">
                                {claim && !isMine ? (
                                  <div className="flex max-w-40 flex-col items-end gap-1.5 text-right">
                                    <span className="text-[11px] font-semibold text-[#647D75]">
                                      กำลังดำเนินการ: {claim.staff_name}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => void takeOverTask(order.order_number, group.stage, claim.staff_id, claim.staff_name)}
                                      className="inline-flex min-h-10 items-center justify-center rounded-xl border border-orange-300 bg-orange-50 px-3 py-2 text-sm font-extrabold text-orange-800 hover:bg-orange-100"
                                    >
                                      รับงานแทน
                                    </button>
                                  </div>
                                ) : !canWork ? (
                                  <div className="max-w-28 text-right text-[11px] leading-snug text-[#718C84]">
                                    <div className="font-bold">ดูสถานะเท่านั้น</div>
                                    <div className="mt-1 break-words">
                                      {claim ? `ผู้รับงาน: ${claim.staff_name}` : "ยังไม่มีผู้รับงาน"}
                                    </div>
                                  </div>
                                ) : isAwaitingPayment ? (
                                  <Link
                                    href={`/orders/${order.order_number}/payment`}
                                    className="inline-flex min-h-10 items-center justify-center whitespace-nowrap rounded-xl bg-[#00BCB4] px-3 py-2 text-sm font-bold text-[#173F3C] shadow-sm"
                                  >
                                    ชำระเงิน
                                  </Link>
                                ) : !claim ? (
                                  <button
                                    type="button"
                                    onClick={() => startWork(order.order_number, group.stage)}
                                    className="inline-flex min-h-10 min-w-[76px] items-center justify-center whitespace-nowrap rounded-xl bg-[#00BCB4] px-3 py-2 text-sm font-bold text-[#173F3C] shadow-sm transition hover:bg-[#00AFA8]"
                                  >
                                    รับงาน
                                  </button>
                                ) : isMine ? (
                                  <div className="flex flex-col items-end gap-1">
                                    <span className="text-[11px] font-semibold text-[#52786F]">คุณรับงานแล้ว</span>
                                    <Link
                                      href={taskLink(group.stage, order.order_number)}
                                      className="inline-flex min-h-10 items-center justify-center rounded-xl bg-[#00BCB4] px-3 py-2 text-sm font-bold text-[#173F3C]"
                                    >
                                      ทำต่อ
                                    </Link>
                                  </div>
                                ) : (
                                  <div className="max-w-24 text-right text-[11px] leading-snug text-[#647D75]">
                                    <div className="font-bold">กำลังดำเนินการ</div>
                                    <div className="mt-1 break-words">{claim.staff_name}</div>
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