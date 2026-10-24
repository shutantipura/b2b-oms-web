"use client";



import { useEffect, useState } from "react";

import Link from "next/link";

import { useParams, useRouter } from "next/navigation";

import { supabase } from "../../../../lib/supabase";
import DeliverySchedule from "../../../../components/DeliverySchedule";
import TaskFilePicker from "../../../../components/TaskFilePicker";



type OrderDetails = {

  id: string;

  order_number: number;

  delivery_date: string | null;

  delivery_slot: string | null;

  delivery_address: string | null;

  customer_notes: string | null;

  final_amount: number | string | null;



  customers: {

    customer_name: string;
    customer_code: string;
    cv_card_storage_path: string | null;

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



export default function BillingPage() {

  const params = useParams();

  const router = useRouter();



  const orderNumber = Number(params.orderNumber);



  const [order, setOrder] =

    useState<OrderDetails | null>(null);



  const [items, setItems] =

    useState<OrderItem[]>([]);



  const [cartPhotoUrl, setCartPhotoUrl] =

    useState<string | null>(null);



  const [billUploaded, setBillUploaded] =

    useState(false);



  const [qrUploaded, setQrUploaded] =

    useState(false);
  const [suspendedMode, setSuspendedMode] = useState(false);
  const [cvCardUrl, setCvCardUrl] = useState<string | null>(null);
  const [cvCardPreviewError, setCvCardPreviewError] = useState("");



  const [billName, setBillName] = useState<string | null>(null);
  const [qrName, setQrName] = useState<string | null>(null);
  const [billPreviewUrl, setBillPreviewUrl] = useState<string | null>(null);
  const [qrPreviewUrl, setQrPreviewUrl] = useState<string | null>(null);
  const [billMimeType, setBillMimeType] = useState<string | null>(null);

  const [finalAmount, setFinalAmount] =

    useState("");



  const [loading, setLoading] =

    useState(true);



  const [uploadingBill, setUploadingBill] =

    useState(false);



  const [uploadingQr, setUploadingQr] =

    useState(false);



  const [submitting, setSubmitting] =

    useState(false);



  const [message, setMessage] =

    useState("");



  async function loadOrder() {

    setLoading(true);

    setMessage("");



    const {

      data: orderData,

      error: orderError,

    } = await supabase

      .from("orders")

      .select(`

        id,

        order_number,

        delivery_date,

        delivery_slot,

        delivery_address,

        customer_notes,

        final_amount,

        customers (

          customer_name,
          customer_code,
          cv_card_storage_path,

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



    setOrder(

      orderData as unknown as OrderDetails

    );
    setCvCardUrl(null);
    setCvCardPreviewError("");
    const cvCardPath = orderData.customers?.cv_card_storage_path;
    if (cvCardPath) {
      const { data: cvSigned, error: cvError } = await supabase.storage
        .from("order-files")
        .createSignedUrl(cvCardPath, 3600);
      if (cvError || !cvSigned?.signedUrl) {
        setCvCardPreviewError("ไม่สามารถแสดง CV card ได้ กรุณาตรวจสอบรูปในข้อมูลลูกค้า");
      } else {
        setCvCardUrl(cvSigned.signedUrl);
      }
    }



    if (orderData.final_amount !== null) {

      setFinalAmount(

        String(orderData.final_amount)

      );

    }



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

      .eq("order_id", orderData.id)

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

      .eq("order_id", orderData.id)

      .eq("is_current", true);



    if (fileError) {

      setMessage(

        "ไม่สามารถโหลดไฟล์ของคำสั่งซื้อได้: " +

          fileError.message

      );



      setLoading(false);

      return;

    }



    const files =

      (fileData ?? []) as OrderFile[];



    const cartPhoto = files.find(

      (file) =>

        file.file_type === "cart_photo"

    );



    const bill = files.find(

      (file) =>

        file.file_type === "bill"

    );



    const qr = files.find(

      (file) =>

        file.file_type === "payment_qr"

    );



    setBillUploaded(Boolean(bill));

    setQrUploaded(Boolean(qr));
    setBillName(bill?.original_filename ?? null);
    setQrName(qr?.original_filename ?? null);
    const [billSigned, qrSigned] = await Promise.all([
      bill
        ? supabase.storage.from("order-files").createSignedUrl(bill.storage_path, 3600)
        : Promise.resolve({ data: null, error: null }),
      qr
        ? supabase.storage.from("order-files").createSignedUrl(qr.storage_path, 3600)
        : Promise.resolve({ data: null, error: null }),
    ]);
    setBillPreviewUrl(billSigned.data?.signedUrl ?? null);
    setQrPreviewUrl(qrSigned.data?.signedUrl ?? null);
    setBillMimeType(bill?.mime_type ?? null);




    if (cartPhoto) {

      const {

        data: signedData,

        error: signedError,

      } = await supabase.storage

        .from("order-files")

        .createSignedUrl(

          cartPhoto.storage_path,

          60 * 60

        );



      if (!signedError && signedData) {

        setCartPhotoUrl(

          signedData.signedUrl

        );

      }

    }



    setLoading(false);

  }



  useEffect(() => {

    if (!Number.isNaN(orderNumber)) {

      loadOrder();

    }

  }, [orderNumber]);



  async function uploadFile(

    file: File,

    fileType: "bill" | "payment_qr"

  ) {

    const extension =

      file.name.split(".").pop() || "jpg";



    const storagePath =

      `orders/${orderNumber}/${fileType}/` +

      `${crypto.randomUUID()}.${extension}`;



    const { error: uploadError } =

      await supabase.storage

        .from("order-files")

        .upload(

          storagePath,

          file,

          {

            upsert: false,

            contentType:

              file.type ||

              "image/jpeg",

          }

        );



    if (uploadError) {

      throw new Error(

        "อัปโหลดไฟล์ไม่สำเร็จ: " +

          uploadError.message

      );

    }



    const { error: registerError } =

      await supabase.rpc(

        "register_my_order_file",

        {

          p_order_number: orderNumber,

          p_file_type: fileType,

          p_storage_path: storagePath,

          p_original_filename:

            file.name,

          p_mime_type:

            file.type ||

            "image/jpeg",

        }

      );



    if (registerError) {

      throw new Error(

        "อัปโหลดไฟล์สำเร็จ แต่บันทึกข้อมูลไฟล์ไม่สำเร็จ: " +

          registerError.message

      );

    }

  }



  async function refreshBillPreview() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: currentOrder } = await supabase.from("orders").select("id").eq("order_number", orderNumber).maybeSingle();
    if (!currentOrder) return;
    const { data: file } = await supabase.from("order_files")
      .select("storage_path,mime_type").eq("order_id", currentOrder.id)
      .eq("file_type", "bill").eq("is_current", true).maybeSingle();
    if (!file) return;
    const { data } = await supabase.storage.from("order-files").createSignedUrl(file.storage_path, 3600);
    setBillPreviewUrl(data?.signedUrl ?? null);
    setBillMimeType(file.mime_type ?? null);
  }

  async function refreshQrPreview() {
    const { data: currentOrder } = await supabase.from("orders").select("id").eq("order_number", orderNumber).maybeSingle();
    if (!currentOrder) return;
    const { data: file } = await supabase.from("order_files")
      .select("storage_path").eq("order_id", currentOrder.id)
      .eq("file_type", "payment_qr").eq("is_current", true).maybeSingle();
    if (!file) return;
    const { data } = await supabase.storage.from("order-files").createSignedUrl(file.storage_path, 3600);
    setQrPreviewUrl(data?.signedUrl ?? null);
  }

  async function uploadBill(file: File) {
    if (uploadingBill || submitting) return;
    try {
      setUploadingBill(true);
      setMessage("กำลังอัปโหลดบิล...");
      await uploadFile(file, "bill");
      setBillUploaded(true);
      setBillName(file.name);
      await refreshBillPreview();
      setMessage("✓ บันทึกบิลเรียบร้อยแล้ว");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "อัปโหลดบิลไม่สำเร็จ");
    } finally {
      setUploadingBill(false);
    }
  }

  async function uploadQr(file: File) {
    if (uploadingQr || submitting) return;
    try {
      setUploadingQr(true);
      setMessage("กำลังอัปโหลด QR ชำระเงิน...");
      await uploadFile(file, "payment_qr");
      setQrUploaded(true);
      setQrName(file.name);
      await refreshQrPreview();
      setMessage("✓ บันทึก QR ชำระเงินเรียบร้อยแล้ว");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "อัปโหลด QR ไม่สำเร็จ");
    } finally {
      setUploadingQr(false);
    }
  }

  async function completeBilling() {

    setMessage("");



    const amount =

      Number(finalAmount);



    if (

      Number.isNaN(amount) ||

      amount <= 0

    ) {

      setMessage(

        "กรุณากรอกยอดบิลสุดท้ายให้ถูกต้อง"

      );

      return;

    }



    if (!suspendedMode && !billUploaded) {

      setMessage(

        "ต้องอัปโหลดบิลก่อนจึงจะปิดงานออกบิลได้"

      );

      return;

    }



    if (!suspendedMode && !qrUploaded) {

      setMessage(

        "ต้องอัปโหลด QR ชำระเงินก่อนจึงจะปิดงานออกบิลได้"

      );

      return;

    }



    if (suspendedMode && (!order?.customers?.cv_card_storage_path || !cvCardUrl)) {
      setMessage("ต้องบันทึกรูป CV card ในข้อมูลลูกค้าให้สำเร็จก่อนปิดงานแบบบัญชีถูกระงับ");
      return;
    }

    setSubmitting(true);

    const { error } = await supabase.rpc(

      suspendedMode ? "complete_my_billing_suspended" : "complete_my_billing",

      {

        p_order_number: orderNumber,

        p_final_amount: amount,

      }

    );



    if (error) {

      setMessage(

        "ไม่สามารถปิดงานออกบิลได้: " +

          error.message

      );



      setSubmitting(false);

      return;

    }



    router.push("/tasks");

    router.refresh();

  }



  async function releaseTask() {

    const confirmedRelease =

      window.confirm(

        "ต้องการปล่อยงานนี้เพื่อให้พนักงานคนอื่นรับไปดำเนินการหรือไม่?"

      );



    if (!confirmedRelease) {

      return;

    }



    const { error } = await supabase.rpc(

      "release_my_task",

      {

        p_order_number: orderNumber,

      }

    );



    if (error) {

      setMessage(

        "ไม่สามารถปล่อยงานได้: " +

          error.message

      );

      return;

    }



    router.push("/tasks");

    router.refresh();

  }



  const calculatedTotal =

    items.reduce(

      (sum, item) => {

        const actual =

          Number(item.actual_qty ?? 0);



        const price =

          Number(

            item.unit_price_snapshot ?? 0

          );



        return (

          sum +

          actual * price

        );

      },

      0

    );



  if (loading) {

    return (

      <main className="min-h-screen bg-gray-100 p-8">

        กำลังโหลดงานออกบิล...

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

      <div className="max-w-6xl mx-auto">



        <Link

          href="/tasks"

          className="text-gray-500"

        >

          ← กลับไปหน้างาน

        </Link>



        <div className="flex justify-between items-start mt-4 mb-8">



          <div>

            <p className="text-sm text-gray-500">

              ออกบิล

            </p>



            <h1 className="mt-1 text-2xl font-extrabold leading-tight text-[#17453F] md:text-3xl">
              {order.customers?.customer_name ?? "ไม่ทราบชื่อร้าน"}
            </h1>
            <p className="mt-1 text-xs font-semibold text-[#82958F]">
              คำสั่งซื้อ #{order.order_number}
            </p>

          </div>



          <button

            onClick={releaseTask}

            className="bg-white border rounded-lg px-4 py-2"

          >

            ปล่อยงาน

          </button>



        </div>



        <section className="bg-white border rounded-2xl p-6 mb-6">



          <h2 className="font-bold text-lg mb-4">

            ข้อมูลลูกค้าและการจัดส่ง

          </h2>



          <div className="grid md:grid-cols-2 gap-4">



            <div>

              <p className="text-sm text-gray-500">

                ผู้ติดต่อ

              </p>



              <p className="font-medium">

                {order.customers

                  ?.contact_name ??

                  "—"}

              </p>

            </div>



            <div>

              <p className="text-sm text-gray-500">

                เบอร์โทรศัพท์

              </p>



              {order.customers?.phone ? (

                <a

                  href={`tel:${order.customers.phone}`}

                  className="underline font-medium"

                >

                  {order.customers.phone}

                </a>

              ) : (

                "—"

              )}

            </div>



            <div>

              <p className="text-sm text-gray-500">

                การจัดส่ง

              </p>



              <DeliverySchedule date={order.delivery_date} slot={order.delivery_slot} />

            </div>



            <div>

              <p className="text-sm text-gray-500">

                ที่อยู่จัดส่ง

              </p>



              <p className="font-medium">

                {order.delivery_address ??

                  "—"}

              </p>

            </div>



          </div>



        </section>



        <section className="bg-white border rounded-2xl overflow-hidden mb-6">



          <div className="p-6 border-b">



            <h2 className="font-bold text-lg">

              รายการสินค้าที่หยิบแล้ว

            </h2>



            <p className="text-sm text-gray-500 mt-1">

              ตรวจสอบจำนวนที่หยิบจริงก่อนออกบิลภายนอกระบบ

            </p>



          </div>



          <div className="overflow-x-auto">



            <table className="w-full">



              <thead className="bg-gray-50">



                <tr>

                  <th className="text-left p-4">

                    สินค้า

                  </th>



                  <th className="text-left p-4">

                    SKU

                  </th>



                  <th className="text-right p-4">

                    จำนวนที่หยิบจริง

                  </th>



                  <th className="text-right p-4">

                    ราคา

                  </th>



                  <th className="text-right p-4">

                    มูลค่าอ้างอิง

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

                        {

                          item.product_name_snapshot

                        }

                      </td>



                      <td className="p-4">

                        {item.products?.sku ??

                          "—"}

                      </td>



                      <td className="p-4 text-right font-semibold">

                        {actual}{" "}

                        {item.unit_snapshot}

                      </td>



                      <td className="p-4 text-right">

                        ฿

                        {price.toFixed(2)}

                      </td>



                      <td className="p-4 text-right">

                        ฿

                        {(

                          actual * price

                        ).toFixed(2)}

                      </td>



                    </tr>

                  );

                })}



              </tbody>



            </table>



          </div>



          <div className="p-5 border-t text-right">



            <span className="text-gray-500">

              ยอดรวมอ้างอิง:

            </span>



            <span className="font-bold ml-3">

              ฿

              {calculatedTotal.toFixed(2)}

            </span>



          </div>



        </section>



        <section className="grid md:grid-cols-2 gap-6 mb-6">



          <div className="bg-white border rounded-2xl p-6">



            <h2 className="font-bold text-lg mb-4">

              รูปรถเข็นจากผู้จัดสินค้า

            </h2>



            {cartPhotoUrl ? (

              <img

                src={cartPhotoUrl}

                alt="รูปรถเข็นสินค้าที่จัดเสร็จแล้ว"

                className="w-full max-h-96 object-contain rounded-lg border"

              />

            ) : (

              <p className="text-gray-500">

                ไม่มีรูปรถเข็นสินค้า

              </p>

            )}



          </div>



          <div className="bg-white border rounded-2xl p-6">



            <h2 className="font-bold text-lg">

              ยอดบิลสุดท้าย

            </h2>



            <p className="text-sm text-gray-500 mt-1 mb-4">

              กรอกยอดจากบิลที่ออกภายนอกระบบ

            </p>



            <div className="flex items-center gap-3">



              <span className="text-2xl">

                ฿

              </span>



              <input

                type="number"

                min="0"

                step="0.01"

                value={finalAmount}

                onChange={(event) =>

                  setFinalAmount(

                    event.target.value

                  )

                }

                placeholder="0.00"

                className="w-full border rounded-lg px-4 py-3 text-xl"

              />



            </div>



          </div>



        </section>



        <section className="mb-6 rounded-2xl border border-[#B8EAE5] bg-[#F4FBFA] p-5 sm:p-6">
          <button
            type="button"
            aria-pressed={suspendedMode}
            onClick={() => {
              setSuspendedMode((previous) => !previous);
              setMessage("");
            }}
            disabled={submitting || uploadingBill || uploadingQr}
            className={`min-h-12 rounded-xl border-2 px-5 py-3 text-sm font-extrabold transition disabled:opacity-40 ${suspendedMode
              ? "border-[#007F79] bg-[#00BCB4] text-[#173F3C]"
              : "border-[#B8EAE5] bg-white text-[#173F3C]"}`}
          >
            {suspendedMode ? "✓ บัญชีลูกค้าถูกระงับ" : "บัญชีลูกค้าถูกระงับ"}
          </button>
          <p className="mt-3 text-sm text-[#526F69]">
            {suspendedMode
              ? "โหมดบัญชีถูกระงับ: ไม่บังคับแนบบิล และจะใช้รูป CV card ของลูกค้าแทนรูป QR ชำระเงินเมื่อปิดงาน"
              : "กรณีออกบิลตามปกติ ต้องแนบทั้งบิลและ QR ชำระเงิน"}
          </p>
          {suspendedMode && !order.customers?.cv_card_storage_path && (
            <p className="mt-3 rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm font-semibold text-orange-800">
              ยังไม่มี CV card สำหรับลูกค้ารายนี้ กรุณาอัปโหลดจาก
              {" "}
              <Link href={`/customers/${order.customers?.customer_code ?? ""}`} className="underline">
                ข้อมูลลูกค้า
              </Link>
              {" "}ก่อนปิดงาน
            </p>
          )}
          {suspendedMode && cvCardPreviewError && (
            <p className="mt-3 text-sm font-semibold text-red-600">{cvCardPreviewError}</p>
          )}
        </section>

        <section className="grid md:grid-cols-2 gap-6">

          <div className="bg-white border rounded-2xl p-6">

            <h2 className="font-bold text-lg">

              บิล

            </h2>



            <p className="text-sm text-gray-500 mt-1 mb-4">

              {suspendedMode ? "โหมดบัญชีถูกระงับ: ไม่ต้องแนบบิล" : "อัปโหลดบิลที่ออกจากระบบภายนอก OMS"}

            </p>

            {!suspendedMode && <TaskFilePicker
              label="ไฟล์บิล"
              chooseLabel="เลือกและอัปโหลดบิล"
              replaceLabel="เปลี่ยนไฟล์บิล"
              accept="image/*,application/pdf,.pdf"
              uploaded={billUploaded}
              uploading={uploadingBill}
              disabled={submitting}
              fileName={billName}
              onSelect={uploadBill}
            />}
            {billPreviewUrl && (
              <div className="mt-4 rounded-xl border bg-gray-50 p-3">
                <p className="mb-2 text-sm font-semibold text-[#17453F]">ตัวอย่างบิลที่บันทึกไว้</p>
                {billMimeType?.startsWith("image/") ? (
                  <a href={billPreviewUrl} target="_blank" rel="noreferrer">
                    <img src={billPreviewUrl} alt="ตัวอย่างภาพบิล" className="max-h-72 w-full rounded-lg object-contain" />
                  </a>
                ) : (
                  <a href={billPreviewUrl} target="_blank" rel="noreferrer" className="font-semibold text-[#008F8D] underline">
                    เปิดไฟล์บิล / PDF
                  </a>
                )}
              </div>
            )}


          </div>



          <div className="bg-white border rounded-2xl p-6">



            <h2 className="font-bold text-lg">

              QR ชำระเงิน

            </h2>



            <p className="text-sm text-gray-500 mt-1 mb-4">

              {suspendedMode ? "ใช้รูป CV card ที่บันทึกไว้ในข้อมูลลูกค้าโดยอัตโนมัติ" : "อัปโหลด QR ชำระเงินสำหรับให้ลูกค้าใช้ชำระเงิน"}

            </p>

            {suspendedMode ? (
              cvCardUrl ? (
                <div className="rounded-xl border border-[#B8EAE5] bg-[#F4FBFA] p-3">
                  <p className="mb-2 text-sm font-semibold text-[#007F79]">✓ CV card ที่จะใช้แทน QR</p>
                  <img src={cvCardUrl} alt="CV card ของลูกค้า" className="max-h-72 w-full rounded-lg object-contain" />
                </div>
              ) : (
                <p className="rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm text-orange-800">
                  ยังไม่มีรูป CV card ที่พร้อมใช้งาน
                </p>
              )
            ) : (
            <TaskFilePicker
              label="รูป QR ชำระเงิน"
              chooseLabel="เลือกรูป QR ชำระเงิน"
              replaceLabel="เปลี่ยนรูป QR"
              accept="image/*"
              uploaded={qrUploaded}
              uploading={uploadingQr}
              disabled={submitting}
              fileName={qrName}
              onSelect={uploadQr}
            />
            )}
            {!suspendedMode && qrPreviewUrl && (
              <div className="mt-4 rounded-xl border bg-gray-50 p-3">
                <p className="mb-2 text-sm font-semibold text-[#17453F]">ตัวอย่าง QR ที่บันทึกไว้</p>
                <a href={qrPreviewUrl} target="_blank" rel="noreferrer">
                  <img src={qrPreviewUrl} alt="ตัวอย่าง QR ชำระเงิน" className="max-h-72 w-full rounded-lg object-contain" />
                </a>
              </div>
            )}


          </div>



        </section>



        {message && (

          <div className="mt-6 bg-white border rounded-lg p-4">

            {message}

          </div>

        )}



        <div className="flex justify-end mt-6">



          <button

            onClick={completeBilling}

            disabled={submitting || uploadingBill || uploadingQr ||
              (suspendedMode ? !cvCardUrl : !billUploaded || !qrUploaded)}

            className="bg-black text-white rounded-lg px-8 py-4 font-semibold disabled:opacity-30"

          >

            {submitting

              ? "กำลังบันทึก..."

              : "ออกบิลเสร็จสิ้น → ส่งไปงานจัดส่ง"}

          </button>



        </div>



      </div>

    </main>

  );

}