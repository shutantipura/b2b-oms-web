"use client";



import { useEffect, useState } from "react";

import Link from "next/link";

import { useParams } from "next/navigation";

import { supabase } from "../../../lib/supabase";



type OrderDetails = {

  id: string;

  order_number: number;

  status: string;

  order_source: string | null;

  delivery_date: string | null;

  delivery_slot: string | null;

  delivery_address: string | null;

  customer_notes: string | null;

  final_amount: number | string | null;

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

  product_name_snapshot: string;

  requested_qty: number | string;

  confirmed_qty: number | string | null;

  actual_qty: number | string | null;

  unit_snapshot: string;

  unit_price_snapshot: number | string;



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
    confirmation: "ยืนยันคำสั่งซื้อ",
    billing: "ออกบิล",
    delivery: "จัดส่ง",
    payment_verification: "ตรวจสอบการชำระเงิน",
    task_claimed: "รับงาน",
    task_released: "ปล่อยงาน",
    order_created: "สร้างคำสั่งซื้อ",
    order_confirmed: "ยืนยันคำสั่งซื้อ",
    picking_completed: "จัดสินค้าเสร็จ",
    billing_completed: "ออกบิลเสร็จ",
    delivery_started: "เริ่มจัดส่ง",
    delivery_completed: "จัดส่งเสร็จ",
    payment_slip_submitted: "ส่งสลิปการชำระเงิน",
    payment_verified: "ตรวจสอบการชำระเงินแล้ว",
    order_completed: "ปิดคำสั่งซื้อ",
    order_cancelled: "ยกเลิกคำสั่งซื้อ",
    force_completed: "บังคับปิดคำสั่งซื้อ",
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



function fileLabel(type: string) {

  const labels: Record<string, string> = {

    cart_photo: "รูปรถเข็นสินค้า",

    bill: "บิล",

    payment_qr: "QR ชำระเงิน",

    delivery_proof: "หลักฐานการจัดส่ง",

    payment_slip: "สลิปการชำระเงิน",

  };



  return labels[type] ?? prettyText(type);

}



export default function OrderDetailsPage() {

  const params = useParams();



  const orderNumber = Number(params.orderNumber);



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
  const [editedFinalAmount, setEditedFinalAmount] = useState("");
  const [adjustmentReason, setAdjustmentReason] = useState("");
  const [savingAmount, setSavingAmount] = useState(false);
  const [amountMessage, setAmountMessage] = useState("");



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

        status,

        order_source,

        delivery_date,

        delivery_slot,

        delivery_address,

        customer_notes,

        final_amount,

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
    setEditedFinalAmount(loadedOrder.final_amount === null ? "" : String(loadedOrder.final_amount));



    // ------------------------------------------------

    // Order items

    // ------------------------------------------------



    const {

      data: itemData,

      error: itemError,

    } = await supabase

      .from("order_items")

      .select(`

        id,

        product_name_snapshot,

        requested_qty,

        confirmed_qty,

        actual_qty,

        unit_snapshot,

        unit_price_snapshot,

        products (

          sku

        )

      `)

      .eq("order_id", loadedOrder.id)

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



    setItems(

      (itemData ?? []) as unknown as OrderItem[]

    );



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

        mime_type

      `)

      .eq("order_id", loadedOrder.id)

      .eq("is_current", true);



    if (fileError) {

      setMessage(

        "ไม่สามารถโหลดไฟล์ได้: " +

          fileError.message

      );



      setLoading(false);

      return;

    }



    const rawFiles =

      (fileData ?? []) as OrderFile[];



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

  async function saveFinalAmount() {
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

              คำสั่งซื้อ #{order.order_number}

            </h1>



            <p className="text-xl mt-2">

              {order.customers?.customer_name}

            </p>



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



        {isManager && order.final_amount !== null && (
          <section className="mb-6 rounded-2xl border border-[#B8DEDA] bg-white p-5">
            <h2 className="text-xl font-bold text-[#17453F]">ปรับยอดบิลสุดท้าย (ผู้จัดการ)</h2>
            <p className="mt-1 text-sm text-gray-500">
              ปรับยอดหลังออกบิล โดยบันทึกเหตุผลและประวัติผู้แก้ไข ไม่เปลี่ยนรูปบิลหรือ QR ที่อัปโหลด
            </p>
            <label className="mt-4 block text-sm font-semibold">ยอดบิลสุดท้าย (บาท)</label>
            <input type="number" min="0" step="0.01" value={editedFinalAmount}
              onChange={(e) => setEditedFinalAmount(e.target.value)}
              className="mt-2 w-full max-w-sm rounded-xl border p-3 text-lg" />
            <label className="mt-4 block text-sm font-semibold">เหตุผลในการปรับยอด</label>
            <textarea value={adjustmentReason} onChange={(e) => setAdjustmentReason(e.target.value)}
              rows={2} placeholder="เช่น ยอดบนบิลจริงไม่ตรงกับยอดที่บันทึก"
              className="mt-2 w-full rounded-xl border p-3" />
            {amountMessage && <p role="status" className="mt-3 text-sm">{amountMessage}</p>}
            <button onClick={() => void saveFinalAmount()} disabled={savingAmount}
              className="mt-4 rounded-xl bg-[#009F9D] px-5 py-3 font-bold text-white disabled:opacity-50">
              {savingAmount ? "กำลังบันทึก..." : "บันทึกการปรับยอดบิล"}
            </button>
          </section>
        )}

        {message && (

          <div className="bg-white border rounded-lg p-4 mb-6 text-red-600">

            {message}

          </div>

        )}



        {/* CUSTOMER */}



        <section className="bg-white border rounded-2xl p-6 mb-6">



          <h2 className="font-bold text-lg mb-5">

            ลูกค้าและการจัดส่ง

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

                การจัดส่ง

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

              ที่อยู่จัดส่ง

            </p>



            <p>

              {order.delivery_address ?? "—"}

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



        {/* ITEMS */}



        <section className="bg-white border rounded-2xl overflow-hidden mb-6">



          <div className="p-6 border-b">



            <h2 className="font-bold text-lg">

              รายการสินค้า

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



                  const price =

                    Number(

                      item.unit_price_snapshot

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

                        {item.unit_snapshot}

                      </td>



                      <td className="p-4 text-right">

                        ฿{price.toFixed(2)}

                      </td>



                      <td className="p-4 text-right">

                        {item.actual_qty !== null

                          ? `฿${(

                              actual * price

                            ).toFixed(2)}`

                          : "—"}

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

                      file.file_type

                    )}

                  </p>



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

                            file.file_type

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