"use client";



import { useEffect, useState } from "react";

import Link from "next/link";

import { useParams } from "next/navigation";

import { supabase } from "../../../lib/supabase";
import { getManagerDeliveryOptions } from "../../../lib/deliveryRules";
import TaskFilePicker from "../../../components/TaskFilePicker";
import { isConsolidatedGroup } from "../../../lib/groupOrderDisplay";
import { combinePickedItems, type PickedItem } from "../../../lib/groupedOrderItems";



type OrderDetails = {

  id: string;

  order_number: number;
  group_root_order_id: string | null;
  group_sequence: number | null;

  status: string;

  order_source: string | null;
  fulfillment_method: "delivery" | "pickup";

  delivery_date: string | null;

  delivery_slot: string | null;

  delivery_address: string | null;

  customer_notes: string | null;

  final_amount: number | string | null;
  billing_account_suspended: boolean;
  billing_no_cv: boolean;
  cv_card_resolved_at: string | null;

  created_at: string;



  customers: {

    customer_code: string;

    customer_name: string;

    contact_name: string | null;

    phone: string | null;

  } | null;

};



type OrderItem = {

  id: string;
  order_id: string;
  product_id: string;

  product_name_snapshot: string;

  requested_qty: number | string;

  confirmed_qty: number | string | null;

  actual_qty: number | string | null;

  unit_snapshot: string;

  unit_price_snapshot: number | string;
  piece_price_per_kg_snapshot?: number | string | null;



  products: {

    sku: string;

  } | null;

};



type OrderFile = {

  id: string;

  file_type: string;

  storage_path: string;

  original_filename: string | null;

  mime_type: string | null;

  is_current: boolean;

  created_at: string;

};



type DisplayFile = OrderFile & {

  url: string | null;

};



type HistoryRow = {

  id: string;

  action: string;

  stage: string | null;

  from_status: string | null;

  to_status: string | null;

  note: string | null;

  performed_by_staff_id: string | null;

  performed_by_line_user_id: string | null;

  created_at: string;

};



type DisplayHistory = HistoryRow & {

  performed_by: string;

};



function prettyText(value: string | null) {
  if (!value) return "—";

  const labels: Record<string, string> = {
    awaiting_confirmation: "รอเช็คสต็อก",
    awaiting_picking: "รอจัดสินค้า",
    picking: "กำลังจัดสินค้า",
    awaiting_billing: "รอออกบิล",
    ready_for_delivery: "พร้อมจัดส่ง",
    out_for_delivery: "กำลังจัดส่ง",
    awaiting_payment: "รอชำระเงิน",
    payment_submitted: "ส่งหลักฐานการชำระเงินแล้ว",
    completed: "เสร็จสิ้น",
    cancelled: "ยกเลิก",
    confirmation: "เช็คสต็อก",
    billing: "ออกบิล",
    delivery: "จัดส่ง",
    payment_verification: "ตรวจสอบการชำระเงิน",
    task_claimed: "รับงาน",
    task_released: "ปล่อยงาน",
    order_created: "สร้างคำสั่งซื้อ",
    order_confirmed: "เช็คสต็อกเสร็จสิ้น",
    picking_completed: "จัดสินค้าเสร็จ",
    billing_completed: "ออกบิลเสร็จ",
    delivery_started: "เริ่มจัดส่ง",
    delivery_completed: "จัดส่งเสร็จ",
    payment_slip_submitted: "ส่งสลิปการชำระเงิน",
    payment_verified: "ตรวจสอบการชำระเงินแล้ว",
    order_completed: "ปิดคำสั่งซื้อ",
    order_cancelled: "ยกเลิกคำสั่งซื้อ",
    force_completed: "บังคับปิดคำสั่งซื้อ",
    manager_adjusted_final_amount: "ผู้จัดการปรับยอดบิล",
    manager_rescheduled_delivery: "ผู้จัดการเปลี่ยนเวลาจัดส่ง",
    cv_card_bill_resolved: "ผู้จัดการเพิ่มบิลพิมพ์ซ้ำและแก้ไขปัญหา CV Card",
  };

  return (
    labels[value] ??
    value
      .split("_")
      .map(
        (word) =>
          word.charAt(0).toUpperCase() +
          word.slice(1)
      )
      .join(" ")
  );
}



function fileLabel(type: string, suspendedBilling = false, noCvBilling = false) {
  if (type === "bill" && noCvBilling) return "รูปพักบิล (POS)";
  if (type === "payment_qr" && suspendedBilling) return "CV Card ลูกค้า";

  const labels: Record<string, string> = {

    cart_photo: "รูปรถเข็นสินค้า 1",

    cart_photo_2: "รูปรถเข็นสินค้า 2",

    bill: "บิล",

    payment_qr: "QR ชำระเงิน",

    delivery_proof: "หลักฐานการจัดส่ง 1",

    delivery_proof_2: "หลักฐานการจัดส่ง 2",

    payment_slip: "สลิปการชำระเงิน",

  };



  return labels[type] ?? prettyText(type);

}



type GroupAuditMember = {
  id: string;
  order_number: number;
  group_sequence: number | null;
  status: string;
  pickedBy: string | null;
  pickedAt: string | null;
  lines: OrderItem[];
};

export default function OrderDetailsPage() {

  const params = useParams();



  const orderNumber = Number(params.orderNumber);



  const [groupRootNumber, setGroupRootNumber] = useState<number | null>(null);
  const [groupAudit, setGroupAudit] = useState<GroupAuditMember[]>([]);
  const [order, setOrder] =

    useState<OrderDetails | null>(null);



  const [items, setItems] =

    useState<OrderItem[]>([]);



  const [files, setFiles] =

    useState<DisplayFile[]>([]);



  const [history, setHistory] =

    useState<DisplayHistory[]>([]);



  const [loading, setLoading] =

    useState(true);



  const [message, setMessage] =

    useState("");

  const [isManager, setIsManager] = useState(false);
  const [uploadingCvBill, setUploadingCvBill] = useState(false);
  const [cvBillMessage, setCvBillMessage] = useState("");
  const [editedFinalAmount, setEditedFinalAmount] = useState("");
  const [adjustmentReason, setAdjustmentReason] = useState("");
  const [savingAmount, setSavingAmount] = useState(false);
  const [amountMessage, setAmountMessage] = useState("");
  const [editedDeliveryDate, setEditedDeliveryDate] = useState("");
  const [editedDeliverySlot, setEditedDeliverySlot] = useState("");
  const [savingDelivery, setSavingDelivery] = useState(false);
  const [deliveryMessage, setDeliveryMessage] = useState("");



  async function loadOrder() {

    setLoading(true);

    setMessage("");



    // ------------------------------------------------

    // Order header

    // ------------------------------------------------



    const {

      data: orderData,

      error: orderError,

    } = await supabase

      .from("orders")

      .select(`

        id,

        order_number,
        group_root_order_id,
        group_sequence,

        status,

        order_source,
        fulfillment_method,

        delivery_date,

        delivery_slot,

        delivery_address,

        customer_notes,

        final_amount,
        billing_account_suspended,
        billing_no_cv,
        cv_card_resolved_at,

        created_at,

        customers (

          customer_code,

          customer_name,

          contact_name,

          phone

        )

      `)

      .eq("order_number", orderNumber)

      .single();



    if (orderError) {

      setMessage(

        "ไม่สามารถโหลดคำสั่งซื้อได้: " +

          orderError.message

      );



      setLoading(false);

      return;

    }



    const loadedOrder =

      orderData as unknown as OrderDetails;



    setOrder(loadedOrder);
    if (loadedOrder.group_root_order_id && loadedOrder.group_root_order_id!==loadedOrder.id) {
      const {data:parent} = await supabase.from("orders")
        .select("order_number").eq("id",loadedOrder.group_root_order_id).maybeSingle();
      setGroupRootNumber(parent?.order_number ?? null);
    } else {
      setGroupRootNumber(loadedOrder.group_root_order_id===loadedOrder.id ? loadedOrder.order_number : null);
    }
    setEditedFinalAmount(loadedOrder.final_amount === null ? "" : String(loadedOrder.final_amount));
    const options = getManagerDeliveryOptions(new Date());
    const selectedDate = options.find((item) => item.date === loadedOrder.delivery_date) ?? options[0];
    setEditedDeliveryDate(selectedDate?.date ?? "");
    setEditedDeliverySlot(selectedDate?.slots.find((item) => item.value === loadedOrder.delivery_slot)?.value
      ?? selectedDate?.slots[0]?.value ?? "");



    // ------------------------------------------------

    // Order items: preserve original /x rows and show a read-only combined summary.

    // ------------------------------------------------

    setGroupAudit([]);
    let readyMembers: { id: string; order_number: number; group_sequence: number | null; status: string }[] = [];
    if (loadedOrder.group_root_order_id === loadedOrder.id) {
      const { data: members, error: membersError } = await supabase
        .from("orders")
        .select("id,order_number,group_sequence,group_root_order_id,status")
        .eq("group_root_order_id", loadedOrder.id)
        .order("group_sequence", { ascending: true });
      if (membersError) {
        setMessage("ไม่สามารถโหลดรายการย่อยได้: " + membersError.message);
        setLoading(false);
        return;
      }
      if (isConsolidatedGroup(members ?? [])) readyMembers = members ?? [];
    }

    const {

      data: itemData,

      error: itemError,

    } = await supabase

      .from("order_items")

      .select(`

        id,
        order_id,
        product_id,

        product_name_snapshot,

        requested_qty,

        confirmed_qty,

        actual_qty,

        unit_snapshot,

        unit_price_snapshot,
        piece_price_per_kg_snapshot,

        products (

          sku

        )

      `)

      .in("order_id", readyMembers.length ? readyMembers.map(member => member.id) : [loadedOrder.id])

      .order(

        "product_name_snapshot",

        { ascending: true }

      );



    if (itemError) {

      setMessage(

        "ไม่สามารถโหลดรายการสินค้าได้: " +

          itemError.message

      );



      setLoading(false);

      return;

    }



    const pickedLines = (itemData ?? []) as unknown as OrderItem[];
    if (readyMembers.length > 0) {
      setItems(combinePickedItems(pickedLines as PickedItem[]) as OrderItem[]);
      const { data: pickClaims } = await supabase.from("task_claims")
        .select("order_id,completed_at,staff(staff_name)")
        .in("order_id", readyMembers.map(member => member.id))
        .eq("stage", "picking")
        .eq("claim_status", "completed")
        .order("completed_at", { ascending: false });
      setGroupAudit(readyMembers.map(member => {
        const claim = (pickClaims ?? []).find(row => row.order_id === member.id);
        const staffData = claim?.staff as {staff_name:string} | {staff_name:string}[] | null | undefined;
        const pickedBy = Array.isArray(staffData) ? staffData[0]?.staff_name : staffData?.staff_name;
        return { ...member, pickedBy: pickedBy ?? null, pickedAt: claim?.completed_at ?? null,
          lines: pickedLines.filter(line => line.order_id === member.id) };
      }));
    } else {
      setItems(pickedLines);
    }



    // ------------------------------------------------

    // Files

    // ------------------------------------------------



    const {

      data: fileData,

      error: fileError,

    } = await supabase

      .from("order_files")

      .select(`

        id,

        file_type,

        storage_path,

        original_filename,

        mime_type,
        is_current,
        created_at

      `)

      .eq("order_id", loadedOrder.id)
      .order("created_at", { ascending: true });



    if (fileError) {

      setMessage(

        "ไม่สามารถโหลดไฟล์ได้: " +

          fileError.message

      );



      setLoading(false);

      return;

    }



    // Historical picking photos are retained after merges and must remain
    // visible alongside the latest ones. Keep other document types current-only.
    const rawFiles = ((fileData ?? []) as OrderFile[]).filter(
      (file) => file.is_current ||
        file.file_type === "cart_photo" ||
        file.file_type === "cart_photo_2"
    );



    const displayFiles =

      await Promise.all(

        rawFiles.map(

          async (file): Promise<DisplayFile> => {

            const {

              data,

              error,

            } = await supabase.storage

              .from("order-files")

              .createSignedUrl(

                file.storage_path,

                60 * 60

              );



            return {

              ...file,

              url:

                error || !data

                  ? null

                  : data.signedUrl,

            };

          }

        )

      );



    setFiles(displayFiles);



    // ------------------------------------------------

    // Order history

    // ------------------------------------------------



    const {

      data: historyData,

      error: historyError,

    } = await supabase

      .from("order_history")

      .select(`

        id,

        action,

        stage,

        from_status,

        to_status,

        note,

        performed_by_staff_id,

        performed_by_line_user_id,

        created_at

      `)

      .eq("order_id", loadedOrder.id)

      .order(

        "created_at",

        { ascending: true }

      );



    if (historyError) {

      setMessage(

        "ไม่สามารถโหลดประวัติคำสั่งซื้อได้: " +

          historyError.message

      );



      setLoading(false);

      return;

    }



    const rawHistory =

      (historyData ?? []) as HistoryRow[];



    // Find all staff used in history



    const staffIds = Array.from(

      new Set(

        rawHistory

          .map(

            (row) =>

              row.performed_by_staff_id

          )

          .filter(

            (id): id is string =>

              Boolean(id)

          )

      )

    );



    const lineUserIds = Array.from(

      new Set(

        rawHistory

          .map(

            (row) =>

              row.performed_by_line_user_id

          )

          .filter(

            (id): id is string =>

              Boolean(id)

          )

      )

    );



    let staffMap:

      Record<string, string> = {};



    let lineMap:

      Record<string, string> = {};



    if (staffIds.length > 0) {

      const { data: staffData } =

        await supabase

          .from("staff")

          .select("id, staff_name")

          .in("id", staffIds);



      staffMap = Object.fromEntries(

        (staffData ?? []).map(

          (staff) => [

            staff.id,

            staff.staff_name,

          ]

        )

      );

    }



    if (lineUserIds.length > 0) {

      const { data: lineData } =

        await supabase

          .from("line_users")

          .select("id, display_name")

          .in("id", lineUserIds);



      lineMap = Object.fromEntries(

        (lineData ?? []).map(

          (user) => [

            user.id,

            user.display_name,

          ]

        )

      );

    }



    const displayHistory =

      rawHistory.map(

        (row): DisplayHistory => ({

          ...row,



          performed_by:

            (row.performed_by_staff_id

              ? staffMap[

                  row.performed_by_staff_id

                ]

              : null) ??

            (row.performed_by_line_user_id

              ? lineMap[

                  row.performed_by_line_user_id

                ]

              : null) ??

            "ระบบ",

        })

      );



    setHistory(displayHistory);



    setLoading(false);

  }



  useEffect(() => {
    async function checkManager() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setIsManager(false); return; }
      const { data, error } = await supabase.from("staff")
        .select("account_type")
        .eq("auth_user_id", user.id)
        .eq("is_active", true)
        .maybeSingle();
      setIsManager(!error && data?.account_type === "manager");
    }
    void checkManager();
  }, []);

  async function uploadReprintedCvBill(file: File) {
    if (!isManager || !order || order.status !== "completed" || !order.billing_account_suspended) {
      setCvBillMessage("เฉพาะ Manager เท่านั้นที่เพิ่มบิลพิมพ์ซ้ำให้คำสั่งซื้อ CV Card ที่เสร็จสิ้นแล้วได้");
      return;
    }

    const mimeByExtension: Record<string, string> = {
      jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
      webp: "image/webp", heic: "image/heic",
      heif: "image/heif", avif: "image/avif",
    };
    const storageExtension: Record<string, string> = {
      "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
      "image/heic": "heic", "image/heif": "heif", "image/avif": "avif",
    };
    const fileExtension = file.name.split(".").pop()?.toLowerCase() ?? "";
    const rawMime = file.type.toLowerCase();
    const mimeType = rawMime === "image/jpg" ? "image/jpeg"
      : rawMime || mimeByExtension[fileExtension] || "";
    const extension = storageExtension[mimeType];

    if (!extension || file.size === 0 || file.size > 15 * 1024 * 1024) {
      setCvBillMessage("กรุณาเลือกรูปบิล JPG, PNG, WEBP หรือ HEIC ขนาดไม่เกิน 15 MB");
      return;
    }
    if (!file.name.trim() || file.name.length > 255) {
      setCvBillMessage("ชื่อไฟล์บิลไม่ถูกต้องหรือยาวเกินไป");
      return;
    }
    if (!window.confirm(`ยืนยันเพิ่มรูปบิลพิมพ์ซ้ำสำหรับคำสั่งซื้อ #${order.order_number} และทำเครื่องหมายว่าปัญหา CV Card ได้รับการแก้ไขแล้ว?`)) {
      return;
    }

    setUploadingCvBill(true);
    setCvBillMessage("");
    const storagePath = `orders/${order.order_number}/bill/reprint/${crypto.randomUUID()}.${extension}`;

    try {
      const { error: uploadError } = await supabase.storage
        .from("order-files")
        .upload(storagePath, file, { upsert: false, contentType: mimeType });
      if (uploadError) throw new Error("อัปโหลดรูปบิลไม่สำเร็จ: " + uploadError.message);

      const { error: resolveError } = await supabase.rpc("manager_resolve_cv_card_bill", {
        p_order_number: order.order_number,
        p_storage_path: storagePath,
        p_original_filename: file.name,
        p_mime_type: mimeType,
      });
      if (resolveError) throw new Error("บันทึกการแก้ไข CV Card ไม่สำเร็จ: " + resolveError.message);

      await loadOrder();
      setCvBillMessage("✓ บันทึกบิลพิมพ์ซ้ำและทำเครื่องหมายว่าแก้ไขปัญหา CV Card แล้ว");
    } catch (error) {
      setCvBillMessage(error instanceof Error ? error.message : "ไม่สามารถบันทึกบิลพิมพ์ซ้ำได้");
    } finally {
      setUploadingCvBill(false);
    }
  }

  async function saveFinalAmount() {
    if (!isManager || !order || ["completed", "cancelled"].includes(order.status)) {
      setAmountMessage("ไม่สามารถแก้ไขยอดบิลของคำสั่งซื้อที่ปิดแล้ว");
      return;
    }
    const rawAmount = editedFinalAmount.trim();
    const amount = Number(rawAmount);
    if (!rawAmount || !Number.isFinite(amount) || amount < 0 || !/^\d+(?:\.\d{1,2})?$/.test(rawAmount)) {
      setAmountMessage("กรุณากรอกยอดเงินที่ถูกต้อง (ทศนิยมไม่เกิน 2 ตำแหน่ง)");
      return;
    }
    if (!adjustmentReason.trim()) {
      setAmountMessage("กรุณาระบุเหตุผลในการปรับยอดบิล");
      return;
    }
    if (!window.confirm(`ยืนยันการปรับยอดบิลเป็น ฿${amount.toFixed(2)}?`)) return;
    setSavingAmount(true);
    setAmountMessage("");
    const { error } = await supabase.rpc("manager_adjust_final_amount", {
      p_order_number: orderNumber,
      p_new_amount: amount,
      p_reason: adjustmentReason.trim(),
    });
    if (error) {
      setAmountMessage("ไม่สามารถปรับยอดบิลได้: " + error.message);
    } else {
      setAdjustmentReason("");
      setAmountMessage("✓ บันทึกยอดบิลใหม่แล้ว");
      await loadOrder();
    }
    setSavingAmount(false);
  }

  async function saveDeliveryTime() {
    if (!isManager || !order || ["completed", "cancelled"].includes(order.status)) {
      setDeliveryMessage("ไม่สามารถเปลี่ยนเวลาจัดส่งของคำสั่งซื้อที่ปิดแล้ว");
      return;
    }
    if (order.group_root_order_id && order.group_root_order_id !== order.id) {
      setDeliveryMessage("กรุณาเปลี่ยนเวลาที่คำสั่งซื้อหลักของกลุ่ม");
      return;
    }
    const validOptions = getManagerDeliveryOptions(new Date());
    if (!validOptions.some((option) => option.date === editedDeliveryDate &&
      option.slots.some((slot) => slot.value === editedDeliverySlot))) {
      setDeliveryMessage("รอบจัดส่งนี้ต้องยังมีเวลาจัดส่งหลังครบ 2 ชั่วโมงจากเวลาที่บันทึก กรุณาเลือกรอบใหม่");
      return;
    }
    if (!window.confirm(`ยืนยันเปลี่ยนเวลาจัดส่งเป็น ${editedDeliveryDate} ${editedDeliverySlot}?`)) return;
    setSavingDelivery(true);
    setDeliveryMessage("");
    const { error } = await supabase.rpc("manager_reschedule_delivery", {
      p_order_number: orderNumber,
      p_delivery_date: editedDeliveryDate,
      p_delivery_slot: editedDeliverySlot,
    });
    if (error) {
      setDeliveryMessage("ไม่สามารถเปลี่ยนเวลาจัดส่งได้: " + error.message);
    } else {
      setDeliveryMessage("✓ บันทึกเวลาจัดส่งใหม่เรียบร้อยแล้ว");
      await loadOrder();
    }
    setSavingDelivery(false);
  }

  useEffect(() => {

    if (!Number.isNaN(orderNumber)) {

      loadOrder();

    }

  }, [orderNumber]);



  if (loading) {

    return (

      <main className="min-h-screen bg-gray-100 p-8">

        กำลังโหลดรายละเอียดคำสั่งซื้อ...

      </main>

    );

  }



  if (!order) {

    return (

      <main className="min-h-screen bg-gray-100 p-8">

        ไม่พบคำสั่งซื้อ

      </main>

    );

  }



  return (

    <main className="min-h-screen bg-gray-100 p-8">



      <div className="max-w-7xl mx-auto">



        <Link

          href="/orders"

          className="text-gray-500"

        >

          ← กลับไปคำสั่งซื้อ

        </Link>



        <div className="flex justify-between items-start mt-4 mb-8">



          <div>



            <p className="text-sm text-gray-500">

              รายละเอียดคำสั่งซื้อ

            </p>



            <h1 className="text-3xl font-bold mt-1">

              คำสั่งซื้อ #{groupAudit.length > 1
                ? order.order_number
                : order.group_sequence
                  ? `${groupRootNumber ?? order.order_number}/${order.group_sequence}`
                  : order.order_number}
              {groupAudit.length > 1 && (
                <span className="ml-2 align-middle text-sm font-bold text-[#008F8D]">
                  รวม {groupAudit.length} ออเดอร์
                </span>
              )}

            </h1>



            <p className="text-xl mt-2">

              {order.customers?.customer_name}

            </p>

            {(order.billing_account_suspended || order.billing_no_cv) && (
              <p className={`mt-3 inline-flex rounded-lg border px-3 py-2 text-xs font-bold ${
                order.billing_account_suspended && order.cv_card_resolved_at
                  ? "border-[#A9D7D0] bg-[#E9F8F5] text-[#126C63]"
                  : "border-[#F0BD59] bg-[#FFF7E3] text-[#8A4A00]"
              }`}>
                {order.billing_account_suspended
                  ? order.cv_card_resolved_at
                    ? "CV Card · ✓ แก้ไขปัญหาแล้ว (บิลพิมพ์ซ้ำ)"
                    : "CV Card · รอรูปบิลพิมพ์ซ้ำ"
                  : "B2B Barcode · ใช้รูปพักบิลจาก POS ไม่ต้องใช้ QR"}
              </p>
            )}



          </div>



          <div className="text-right">



            <div className="inline-block bg-white border rounded-full px-4 py-2 font-medium">

              {prettyText(order.status)}

            </div>



            {order.final_amount !== null && (

              <p className="text-2xl font-bold mt-3">

                ฿

                {Number(

                  order.final_amount

                ).toFixed(2)}

              </p>

            )}



          </div>



        </div>



        {message && (

          <div className="bg-white border rounded-lg p-4 mb-6 text-red-600">

            {message}

          </div>

        )}



        {/* CUSTOMER */}



        <section className="bg-white border rounded-2xl p-6 mb-6">



          <h2 className="font-bold text-lg mb-5">

            {order.fulfillment_method === "pickup" ? "ลูกค้าและการรับสินค้าที่สาขา" : "ลูกค้าและการจัดส่ง"}

          </h2>



          <div className="grid md:grid-cols-3 gap-5">



            <div>

              <p className="text-sm text-gray-500">

                ลูกค้า

              </p>



              <p className="font-medium">

                {order.customers?.customer_name}

              </p>



              <p className="text-sm text-gray-500">

                {order.customers?.customer_code}

              </p>

            </div>



            <div>

              <p className="text-sm text-gray-500">

                ผู้ติดต่อ

              </p>



              <p className="font-medium">

                {order.customers?.contact_name ??

                  "—"}

              </p>



              <p>

                {order.customers?.phone ?? "—"}

              </p>

            </div>



            <div>

              <p className="text-sm text-gray-500">

                {order.fulfillment_method === "pickup" ? "วันและเวลารับสินค้า" : "การจัดส่ง"}

              </p>



              <p className="font-medium">

                {order.delivery_date ?? "—"}

              </p>



              <p>

                {order.delivery_slot ?? "—"}

              </p>

            </div>



          </div>



          <div className="mt-5">



            <p className="text-sm text-gray-500">

              {order.fulfillment_method === "pickup" ? "วิธีรับสินค้า" : "ที่อยู่จัดส่ง"}

            </p>



            <p>

              {order.fulfillment_method === "pickup" ? "🏬 ลูกค้ารับสินค้าที่สาขา" : (order.delivery_address ?? "—")}

            </p>



          </div>



          {order.customer_notes && (

            <div className="mt-5">



              <p className="text-sm text-gray-500">

                หมายเหตุจากลูกค้า

              </p>



              <p>

                {order.customer_notes}

              </p>



            </div>

          )}



        </section>



        {groupAudit.length > 1 && (
          <section className="mb-6 rounded-2xl border border-[#B7E3DB] bg-[#F4FBF9] p-4 sm:p-5" data-testid="grouped-order-audit">
            <h2 className="text-lg font-bold text-[#17453F]">คำสั่งซื้อรวม #{order.order_number}</h2>
            <p className="mt-1 text-sm text-[#52786F]">
              รวมรายการสินค้าเมื่อหยิบครบ · ยังคงตรวจสอบ /1, /2 และผู้หยิบแต่ละรายการได้
            </p>
            <div className="mt-3 space-y-2">
              {groupAudit.map(member => (
                <details key={member.id} className="rounded-xl border border-[#D3E7E1] bg-white p-3">
                  <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm font-bold text-[#17453F]">
                    <span>#{order.order_number}/{member.group_sequence ?? 1}</span>
                    <span className="text-[#52786F]">{prettyText(member.status)}</span>
                    <span className="font-normal text-[#52786F]">{member.lines.length} รายการ</span>
                    <span className="ml-auto text-xs text-[#007F79]">รายละเอียด</span>
                  </summary>
                  <div className="mt-3 space-y-2 border-t border-[#E4EFEB] pt-3 text-sm">
                    <p className="text-[#52786F]">
                      ผู้หยิบ: {member.pickedBy ?? "—"}
                      {member.pickedAt ? ` · ${new Date(member.pickedAt).toLocaleString("th-TH", {timeZone:"Asia/Bangkok"})}` : ""}
                    </p>
                    {member.lines.map(line => (
                      <div key={line.id} className="flex flex-wrap justify-between gap-2 border-b border-[#F0F5F3] pb-2">
                        <span className="min-w-0 flex-1">{line.product_name_snapshot}</span>
                        <span className="tabular-nums text-[#17453F]">
                          สั่ง {Number(line.requested_qty)} {line.unit_snapshot} ·
                          หยิบ {line.actual_qty == null ? "—" : Number(line.actual_qty)}
                          {" "}{line.piece_price_per_kg_snapshot != null ? "กก." : line.unit_snapshot}
                        </span>
                      </div>
                    ))}
                    {member.id !== order.id ? (
                      <Link href={`/orders/${member.order_number}`} className="inline-block font-bold text-[#007F79] underline">
                        ดูประวัติคำสั่งซื้อย่อยนี้
                      </Link>
                    ) : <span className="text-xs text-[#52786F]">ประวัติของ /1 แสดงในส่วนประวัติคำสั่งซื้อนี้</span>}
                  </div>
                </details>
              ))}
            </div>
          </section>
        )}

        {/* ITEMS */}



        <section className="bg-white border rounded-2xl overflow-hidden mb-6">



          <div className="p-6 border-b">



            <h2 className="font-bold text-lg">

              {groupAudit.length > 1 ? "รายการสินค้ารวม" : "รายการสินค้า"}

            </h2>



            <p className="text-sm text-gray-500 mt-1">

              จำนวนที่สั่ง → จำนวนที่ยืนยัน → จำนวนที่หยิบจริง

            </p>



          </div>



          <div className="overflow-x-auto">



            <table className="w-full">



              <thead className="bg-gray-50">



                <tr>

                  <th className="p-4 text-left">

                    สินค้า

                  </th>



                  <th className="p-4 text-left">

                    SKU

                  </th>



                  <th className="p-4 text-right">

                    จำนวนที่สั่ง

                  </th>



                  <th className="p-4 text-right">

                    จำนวนที่ยืนยัน

                  </th>



                  <th className="p-4 text-right">

                    จำนวนจริง

                  </th>



                  <th className="p-4 text-right">

                    ราคา

                  </th>



                  <th className="p-4 text-right">

                    ยอดเงิน

                  </th>

                </tr>



              </thead>



              <tbody>



                {items.map((item) => {



                  const actual =

                    Number(

                      item.actual_qty ?? 0

                    );



                  const price = Number(
                    item.piece_price_per_kg_snapshot ?? item.unit_price_snapshot
                  );



                  return (

                    <tr

                      key={item.id}

                      className="border-t"

                    >



                      <td className="p-4 font-medium">

                        {item.product_name_snapshot}

                      </td>



                      <td className="p-4">

                        {item.products?.sku ?? "—"}

                      </td>



                      <td className="p-4 text-right">

                        {Number(

                          item.requested_qty

                        )}{" "}

                        {item.unit_snapshot}

                      </td>



                      <td className="p-4 text-right">

                        {item.confirmed_qty !== null

                          ? Number(

                              item.confirmed_qty

                            )

                          : "—"}{" "}

                        {item.unit_snapshot}

                      </td>



                      <td className="p-4 text-right font-semibold">

                        {item.actual_qty !== null

                          ? Number(

                              item.actual_qty

                            )

                          : "—"}{" "}

                        {item.piece_price_per_kg_snapshot != null ? "กก." : item.unit_snapshot}

                      </td>



                      <td className="p-4 text-right">

                        {item.piece_price_per_kg_snapshot != null
                          ? `฿${Number(item.piece_price_per_kg_snapshot).toFixed(2)} / กก.`
                          : `฿${price.toFixed(2)}`}

                      </td>



                      <td className="p-4 text-right">

                        {item.actual_qty !== null ? `฿${(actual * price).toFixed(2)}` : "—"}

                      </td>



                    </tr>

                  );

                })}



              </tbody>



            </table>



          </div>



        </section>



        {/* FILES */}



        <section className="bg-white border rounded-2xl p-6 mb-6">



          <h2 className="font-bold text-lg">

            เอกสารคำสั่งซื้อ

          </h2>



          <p className="text-sm text-gray-500 mt-1 mb-5">

            ไฟล์ที่รวบรวมระหว่างกระบวนการคำสั่งซื้อ

          </p>

          {order.billing_account_suspended && order.status === "completed" && (
            <div className={`mb-5 rounded-2xl border p-4 sm:p-5 ${
              order.cv_card_resolved_at
                ? "border-[#B7E1D4] bg-[#F0FBF6]"
                : "border-[#F0D495] bg-[#FFF9EA]"
            }`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-extrabold text-[#17453F]">บิลพิมพ์ซ้ำสำหรับ CV Card</h3>
                <span className={`rounded-full px-3 py-1 text-xs font-extrabold ${
                  order.cv_card_resolved_at
                    ? "bg-[#D9F4E7] text-[#0B7654]"
                    : "bg-[#FFECC0] text-[#8A6000]"
                }`}>
                  {order.cv_card_resolved_at ? "✓ แก้ไขปัญหาแล้ว" : "รอแก้ไข"}
                </span>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-[#516A61]">
                เมื่อพิมพ์บิลใหม่ได้แล้ว ให้ Manager อัปโหลดรูปเพื่อปิดปัญหา CV Card
                โดยยอดเงินและสถานะคำสั่งซื้อไม่เปลี่ยน
              </p>
              {order.cv_card_resolved_at && (
                <p className="mt-2 text-xs font-semibold text-[#0B7654]">
                  บันทึกการแก้ไขเมื่อ {new Date(order.cv_card_resolved_at).toLocaleString("th-TH", {
                    timeZone: "Asia/Bangkok", dateStyle: "medium", timeStyle: "short",
                  })}
                </p>
              )}
              {isManager && (
                <div className="mt-4">
                  <TaskFilePicker
                    label="รูปบิลพิมพ์ซ้ำ CV Card"
                    chooseLabel="อัปโหลดรูปบิลพิมพ์ซ้ำ"
                    replaceLabel="เปลี่ยนรูปบิลพิมพ์ซ้ำ"
                    accept="image/*"
                    uploaded={Boolean(order.cv_card_resolved_at)}
                    uploading={uploadingCvBill}
                    fileName={files.find((file) => file.file_type === "bill" && file.is_current)?.original_filename}
                    selectionHint="เลือกหรือถ่ายรูปบิลเพื่อปิดปัญหา"
                    uploadedHint="✓ ปิดปัญหาแล้ว · เปลี่ยนรูปได้"
                    onSelect={uploadReprintedCvBill}
                  />
                  {cvBillMessage && (
                    <p role="status" className="mt-3 text-sm font-semibold text-[#17453F]">
                      {cvBillMessage}
                    </p>
                  )}
                </div>
              )}
              {order.cv_card_resolved_at && files
                .filter((file) => file.file_type === "bill" && file.is_current && file.url && file.mime_type?.startsWith("image/"))
                .map((bill) => (
                  <div key={bill.id} className="mt-4">
                    <p className="mb-2 text-sm font-bold text-[#17453F]">รูปบิลพิมพ์ซ้ำ</p>
                    <a href={bill.url ?? undefined} target="_blank" rel="noreferrer" className="block rounded-xl border border-[#B7E1D4] bg-white p-2">
                      <img
                        src={bill.url ?? undefined}
                        alt="รูปบิลพิมพ์ซ้ำสำหรับ CV Card"
                        className="mx-auto max-h-80 w-full rounded-lg object-contain"
                      />
                    </a>
                    <p className="mt-2 text-xs text-[#516A61]">แตะรูปเพื่อดูขนาดเต็ม</p>
                  </div>
                ))}
            </div>
          )}

          {files.length === 0 ? (



            <p className="text-gray-500">

              ยังไม่มีไฟล์

            </p>



          ) : (



            <div className="grid md:grid-cols-3 gap-5">



              {files.map((file) => (



                <div

                  key={file.id}

                  className="border rounded-xl p-4"

                >



                  <p className="font-semibold">

                    {fileLabel(

                      file.file_type,
                      order.billing_account_suspended,
                      order.billing_no_cv

                    )}

                  </p>



                  {(file.file_type === "cart_photo" || file.file_type === "cart_photo_2") && (
                    <p className={file.is_current
                      ? "mt-2 text-xs font-extrabold text-[#007F79]"
                      : "mt-2 text-xs font-extrabold text-[#946200]"}>
                      {file.is_current ? "รูปรอบล่าสุด" : "รูปเดิมจากการจัดสินค้าก่อนหน้า (เก็บไว้)"}
                    </p>
                  )}

                  <p className="text-sm text-gray-500 mt-1 mb-4 truncate">

                    {file.original_filename ??

                      "ไฟล์"}

                  </p>



                  {file.url ? (



                    file.mime_type?.startsWith(

                      "image/"

                    ) ? (



                      <>

                        <img

                          src={file.url}

                          alt={fileLabel(

                            file.file_type,
                            order.billing_account_suspended,
                            order.billing_no_cv

                          )}

                          className="w-full h-48 object-contain border rounded-lg"

                        />



                        <a

                          href={file.url}

                          target="_blank"

                          rel="noreferrer"

                          className="inline-block mt-3 underline"

                        >

                          เปิดรูปขนาดเต็ม

                        </a>

                      </>



                    ) : (



                      <a

                        href={file.url}

                        target="_blank"

                        rel="noreferrer"

                        className="inline-block border rounded-lg px-4 py-2 font-medium"

                      >

                        เปิดไฟล์

                      </a>



                    )



                  ) : (



                    <p className="text-red-600">

                      ไม่สามารถเปิดไฟล์ได้

                    </p>



                  )}



                </div>



              ))}



            </div>



          )}



        </section>



        {/* Manager controls deliberately sit directly above the history trail. */}
        {isManager && !["completed", "cancelled"].includes(order.status) && (
          <section className="mb-6 rounded-2xl border border-[#B8DEDA] bg-white p-3 sm:p-4">
            <h2 className="text-base font-bold text-[#17453F]">จัดการคำสั่งซื้อ (ผู้จัดการ)</h2>
            <p className="mt-1 text-xs text-[#718C84]">แก้ไขได้เฉพาะคำสั่งซื้อที่ยังไม่ปิดงาน · ระบบบันทึกประวัติทุกครั้ง</p>
            <div className="mt-3 grid grid-cols-1 items-start gap-3 md:grid-cols-2">
              {order.final_amount !== null && (
                <details className="rounded-xl border border-[#DCEAE5] bg-[#FAFDFB] p-3">
                  <summary className="cursor-pointer text-sm font-bold text-[#007F79]">ปรับยอดบิลสุดท้าย</summary>
                  <div className="mt-3 space-y-2">
                    <label className="block text-xs font-semibold" htmlFor="manager-final-amount">ยอดบิลสุดท้าย (บาท)</label>
                    <input id="manager-final-amount" type="number" min="0" step="0.01"
                      value={editedFinalAmount} onChange={(event) => setEditedFinalAmount(event.target.value)}
                      className="w-full rounded-lg border border-[#C8DED8] bg-white px-3 py-2 text-sm" />
                    <label className="block text-xs font-semibold" htmlFor="manager-amount-reason">เหตุผลในการปรับยอด</label>
                    <textarea id="manager-amount-reason" rows={2} value={adjustmentReason}
                      onChange={(event) => setAdjustmentReason(event.target.value)}
                      placeholder="เหตุผลที่ต้องแก้ยอดบิล"
                      className="w-full rounded-lg border border-[#C8DED8] bg-white px-3 py-2 text-sm" />
                    <p className="text-[11px] text-gray-500">ไม่เปลี่ยนรูปบิลหรือ QR ที่อัปโหลดไว้</p>
                    {amountMessage && <p role="status" className="text-xs">{amountMessage}</p>}
                    <button type="button" onClick={() => void saveFinalAmount()} disabled={savingAmount}
                      className="rounded-lg bg-[#009F9D] px-4 py-2 text-xs font-bold text-white disabled:opacity-50">
                      {savingAmount ? "กำลังบันทึก..." : "บันทึกยอดบิล"}
                    </button>
                  </div>
                </details>
              )}
              {order.group_root_order_id && order.group_root_order_id !== order.id ? (
                <div className="rounded-xl border border-[#DCEAE5] p-3 text-xs text-gray-600">
                  เวลาจัดส่งของออเดอร์ย่อยเปลี่ยนได้จาก
                  {groupRootNumber !== null ? (
                    <Link href={`/orders/${groupRootNumber}`} className="ml-1 font-bold text-[#007F79] underline">
                      ออเดอร์หลัก #{groupRootNumber}
                    </Link>
                  ) : "ออเดอร์หลัก"}
                </div>
              ) : (
                <details className="rounded-xl border border-[#DCEAE5] bg-[#FAFDFB] p-3">
                  <summary className="cursor-pointer text-sm font-bold text-[#007F79]">เปลี่ยนเวลาจัดส่ง</summary>
                  <div className="mt-3 space-y-2">
                    <p className="text-xs text-gray-500">
                      เวลาเดิม: {order.delivery_date ?? "—"} · {order.delivery_slot ?? "—"}
                    </p>
                    <p className="text-[11px] text-[#8A6000]">
                      เลือกรอบที่ยังมีเวลาจัดส่งหลังครบ 2 ชั่วโมงจากที่กดบันทึก เช่น 10:04 เลือก 11:00–13:00 ได้ แต่จัดส่งไม่ก่อน 12:04
                    </p>
                    <label className="block text-xs font-semibold" htmlFor="manager-delivery-date">{order.fulfillment_method === "pickup" ? "วันที่รับสินค้าใหม่" : "วันที่จัดส่งใหม่"}</label>
                    <select id="manager-delivery-date" value={editedDeliveryDate}
                      onChange={(event) => {
                        const date = event.target.value;
                        const options = getManagerDeliveryOptions(new Date());
                        setEditedDeliveryDate(date);
                        setEditedDeliverySlot(options.find((option) => option.date === date)?.slots[0]?.value ?? "");
                      }}
                      className="w-full rounded-lg border border-[#C8DED8] bg-white px-3 py-2 text-sm">
                      {getManagerDeliveryOptions(new Date()).map((option) => (
                        <option key={option.date} value={option.date}>{option.date}</option>
                      ))}
                    </select>
                    <label className="block text-xs font-semibold" htmlFor="manager-delivery-slot">รอบจัดส่งใหม่</label>
                    <select id="manager-delivery-slot" value={editedDeliverySlot}
                      onChange={(event) => setEditedDeliverySlot(event.target.value)}
                      className="w-full rounded-lg border border-[#C8DED8] bg-white px-3 py-2 text-sm">
                      {(getManagerDeliveryOptions(new Date())
                        .find((option) => option.date === editedDeliveryDate)?.slots ?? []).map((slot) => (
                        <option key={slot.value} value={slot.value}>{slot.label}</option>
                      ))}
                    </select>
                    {deliveryMessage && <p role="status" className="text-xs">{deliveryMessage}</p>}
                    <button type="button" onClick={() => void saveDeliveryTime()} disabled={savingDelivery || !editedDeliveryDate || !editedDeliverySlot}
                      className="rounded-lg bg-[#009F9D] px-4 py-2 text-xs font-bold text-white disabled:opacity-50">
                      {savingDelivery ? "กำลังบันทึก..." : "บันทึกเวลาจัดส่ง"}
                    </button>
                  </div>
                </details>
              )}
            </div>
          </section>
        )}

        {/* HISTORY */}



        <section className="bg-white border rounded-2xl overflow-hidden">



          <div className="p-6 border-b">



            <h2 className="font-bold text-lg">

              ประวัติคำสั่งซื้อ

            </h2>



            <p className="text-sm text-gray-500 mt-1">

              ประวัติการดำเนินการทั้งหมดของคำสั่งซื้อนี้

            </p>



          </div>



          {history.length === 0 ? (



            <div className="p-6 text-gray-500">

              ยังไม่มีประวัติ

            </div>



          ) : (



            <div>



              {history.map((row) => (



                <div

                  key={row.id}

                  className="p-5 border-b last:border-b-0"

                >



                  <div className="flex flex-col md:flex-row md:justify-between gap-2">



                    <div>



                      <p className="font-semibold">

                        {prettyText(

                          row.action

                        )}

                      </p>



                      <p className="text-sm text-gray-500 mt-1">

                        {row.stage

                          ? `ขั้นตอน: ${prettyText(

                              row.stage

                            )}`

                          : ""}

                      </p>



                    </div>



                    <div className="md:text-right">



                      <p className="font-medium">

                        {row.performed_by}

                      </p>



                      <p className="text-sm text-gray-500">

                        {new Date(

                          row.created_at

                        ).toLocaleString()}

                      </p>



                    </div>



                  </div>



                  {(row.from_status ||

                    row.to_status) && (

                    <p className="text-sm mt-3">

                      {prettyText(

                        row.from_status

                      )}

                      {" → "}

                      {prettyText(

                        row.to_status

                      )}

                    </p>

                  )}



                  {row.note && (

                    <p className="text-sm text-gray-600 mt-2">

                      {row.note}

                    </p>

                  )}



                </div>



              ))}



            </div>



          )}



        </section>



        {/* USEFUL ACTIONS */}



        <div className="flex gap-3 justify-end mt-6">



          {order.status ===

            "awaiting_payment" && (



            <Link

              href={`/orders/${order.order_number}/payment`}

              className="bg-black text-white rounded-lg px-6 py-3 font-semibold"

            >

              อัปโหลดสลิปการชำระเงิน

            </Link>



          )}



          {order.status ===

            "payment_submitted" && (



            <Link

              href="/tasks"

              className="bg-black text-white rounded-lg px-6 py-3 font-semibold"

            >

              ไปงานตรวจสอบการชำระเงิน

            </Link>



          )}



        </div>



      </div>



    </main>

  );

}