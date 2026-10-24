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

  status: string;

  delivery_date: string | null;

  delivery_slot: string | null;

  delivery_address: string | null;

  customer_notes: string | null;

  final_amount: number | string | null;
  billing_account_suspended: boolean;
  billing_no_cv: boolean;



  customers: {

    customer_name: string;

    contact_name: string | null;

    phone: string | null;

    delivery_map_url: string | null;

    rider_note: string | null;

  } | null;

};


type OrderFile = {
  id: string;
  file_type: string;
  storage_path: string;
  original_filename: string | null;
  mime_type: string | null;
};

type DisplayFile = {
  url: string;
  name: string;
  mimeType: string | null;
};

function safeWebUrl(
  value: string | null | undefined
) {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);

    if (
      url.protocol !== "https:" &&
      url.protocol !== "http:"
    ) {
      return null;
    }

    return value;
  } catch {
    return null;
  }
}



export default function DeliveryPage() {

  const params = useParams();

  const router = useRouter();



  const orderNumber = Number(params.orderNumber);



  const [order, setOrder] =

    useState<OrderDetails | null>(null);



  const [deliveryPhotoNames, setDeliveryPhotoNames] = useState<(string | null)[]>([null, null]);

  const [photoUploaded, setPhotoUploaded] = useState<boolean[]>([false, false]);



  const [cartPhoto, setCartPhoto] =

    useState<DisplayFile | null>(null);



  const [bill, setBill] =

    useState<DisplayFile | null>(null);



  const [paymentQr, setPaymentQr] =

    useState<DisplayFile | null>(null);



  const [loading, setLoading] =

    useState(true);



  const [uploading, setUploading] =

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

        status,

        delivery_date,

        delivery_slot,

        delivery_address,

        customer_notes,

        final_amount,
        billing_account_suspended,
        billing_no_cv,

        customers (

          customer_name,

          contact_name,

          phone,

          delivery_map_url,

          rider_note

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

      .eq("is_current", true)

      .in(

        "file_type",

        [

          "cart_photo",

          "bill",

          "payment_qr",

          "delivery_proof",

          "delivery_proof_2",

        ]

      );



    if (fileError) {

      setMessage(

        "ไม่สามารถโหลดไฟล์ประกอบคำสั่งซื้อได้: " +

          fileError.message

      );

      setLoading(false);

      return;

    }



    const files =

      (fileData ?? []) as OrderFile[];



    const firstProof = files.find((file) => file.file_type === "delivery_proof");
    const secondProof = files.find((file) => file.file_type === "delivery_proof_2");
    setPhotoUploaded([Boolean(firstProof), Boolean(secondProof)]);
    setDeliveryPhotoNames([
      firstProof?.original_filename ?? null,
      secondProof?.original_filename ?? null,
    ]);

    async function getDisplayFile(

      fileType: string

    ): Promise<DisplayFile | null> {

      const file =

        files.find(

          (item) =>

            item.file_type ===

            fileType

        );



      if (!file) {

        return null;

      }



      const {

        data,

        error,

      } = await supabase.storage

        .from("order-files")

        .createSignedUrl(

          file.storage_path,

          60 * 60

        );



      if (

        error ||

        !data

      ) {

        return null;

      }



      return {

        url: data.signedUrl,

        name:

          file.original_filename ??

          file.file_type,

        mimeType:

          file.mime_type,

      };

    }



    const [

      loadedCartPhoto,

      loadedBill,

      loadedPaymentQr,

    ] = await Promise.all([

      getDisplayFile(

        "cart_photo"

      ),

      getDisplayFile(

        "bill"

      ),

      getDisplayFile(

        "payment_qr"

      ),

    ]);



    setCartPhoto(

      loadedCartPhoto

    );



    setBill(

      loadedBill

    );



    setPaymentQr(

      loadedPaymentQr

    );



    setLoading(false);

  }



  useEffect(() => {

    if (!Number.isNaN(orderNumber)) {

      loadOrder();

    }

  }, [orderNumber]);



  async function uploadDeliveryProof(file: File, index: 0 | 1) {
    if (uploading || submitting) return;
    setUploading(true);
    setMessage(`กำลังอัปโหลดหลักฐานการจัดส่ง ${index + 1}...`);
    const fileType = index === 0 ? "delivery_proof" : "delivery_proof_2";
    const extension = file.name.split(".").pop() || "jpg";
    const storagePath =
      `orders/${orderNumber}/${fileType}/${crypto.randomUUID()}.${extension}`;

    try {
      const { error: uploadError } = await supabase.storage
        .from("order-files")
        .upload(storagePath, file, {
          upsert: false,
          contentType: file.type || "image/jpeg",
        });
      if (uploadError) throw new Error("อัปโหลดรูปไม่สำเร็จ: " + uploadError.message);

      const { error: registerError } = await supabase.rpc(
        "register_my_order_file",
        {
          p_order_number: orderNumber,
          p_file_type: fileType,
          p_storage_path: storagePath,
          p_original_filename: file.name,
          p_mime_type: file.type || "image/jpeg",
        }
      );
      if (registerError) throw new Error("บันทึกรูปไม่สำเร็จ: " + registerError.message);

      setPhotoUploaded((previous) =>
        previous.map((uploaded, photoIndex) => photoIndex === index ? true : uploaded)
      );
      setDeliveryPhotoNames((previous) =>
        previous.map((name, photoIndex) => photoIndex === index ? file.name : name)
      );
      setMessage(`✓ บันทึกหลักฐานการจัดส่ง ${index + 1} เรียบร้อยแล้ว`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "อัปโหลดหลักฐานการจัดส่งไม่สำเร็จ");
    } finally {
      setUploading(false);
    }
  }

  async function completeDelivery() {

    setMessage("");



    if (!photoUploaded[0]) {

      setMessage(

        "ต้องอัปโหลดหลักฐานการจัดส่งก่อนปิดงานจัดส่ง"

      );

      return;

    }



    setSubmitting(true);



    const { error } = await supabase.rpc(

      "complete_my_delivery",

      {

        p_order_number: orderNumber,

      }

    );



    if (error) {

      setMessage(

        "ไม่สามารถปิดงานจัดส่งได้: " +

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

        "ต้องการปล่อยงานจัดส่งนี้เพื่อให้พนักงานคนอื่นรับไปดำเนินการหรือไม่?"

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



  function isImage(

    file: DisplayFile | null

  ) {

    return Boolean(

      file?.mimeType?.startsWith(

        "image/"

      )

    );

  }



  if (loading) {

    return (

      <main className="min-h-screen bg-gray-100 p-8">

        กำลังโหลดงานจัดส่ง...

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



  const deliveryMapUrl =

    safeWebUrl(

      order.delivery_address

    ) ??

    safeWebUrl(

      order.customers?.delivery_map_url

    );



  return (

    <main className="min-h-screen bg-gray-100 p-8">

      <div className="max-w-4xl mx-auto">



        <Link

          href="/tasks"

          className="text-gray-500"

        >

          ← กลับไปหน้างาน

        </Link>



        <div className="flex justify-between items-start mt-4 mb-8">



          <div>

            <p className="text-sm text-gray-500">

              จัดส่ง

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



        {(order.billing_account_suspended || order.billing_no_cv) && (
          <section role="status" aria-live="polite"
            className="mb-6 rounded-2xl border-2 border-[#F0BD59] bg-[#FFF7E3] p-4 shadow-sm sm:p-5">
            <div className="flex items-start gap-3">
              <span aria-hidden="true" className="text-2xl">⚠️</span>
              <div>
                <h2 className="text-base font-extrabold text-[#8A4A00]">
                  แจ้งไรเดอร์: {order.billing_account_suspended ? "บัญชีถูกระงับ" : "ลูกค้าไม่มีCV"}
                </h2>
                <p className="mt-2 text-sm font-semibold leading-6 text-[#795323]">
                  {order.billing_account_suspended
                    ? "ออเดอร์นี้ใช้รูป CV card ของลูกค้าแทน QR ชำระเงิน และอาจไม่มีรูปบิล กรุณาตรวจสอบเอกสารก่อนจัดส่ง"
                    : "ออเดอร์นี้ไม่มี CV พนักงานออกบิลที่เครื่อง POS และถ่ายรูปพักบิลแล้ว ไม่มี QR ชำระเงิน กรุณาตรวจสอบรูปพักบิลก่อนจัดส่ง"}
                </p>
              </div>
            </div>
          </section>
        )}

        <section className="bg-white border rounded-2xl p-6 mb-6">



          <h2 className="font-bold text-lg mb-5">

            ข้อมูลการจัดส่ง

          </h2>



          <div className="grid md:grid-cols-2 gap-5">



            <div>

              <p className="text-sm text-gray-500">

                ผู้ติดต่อ

              </p>



              <p className="font-medium">

                {order.customers

                  ?.contact_name ?? "—"}

              </p>

            </div>



            <div>

              <p className="text-sm text-gray-500">

                เบอร์โทรศัพท์

              </p>



              {order.customers?.phone ? (

                <a

                  href={`tel:${order.customers.phone}`}

                  className="font-medium underline"

                >

                  {order.customers.phone}

                </a>

              ) : (

                <p>—</p>

              )}

            </div>



            <div>

              <p className="text-sm text-gray-500">

                ช่วงเวลาจัดส่ง

              </p>



              <DeliverySchedule date={order.delivery_date} slot={order.delivery_slot} />

            </div>



            <div>

              <p className="text-sm text-gray-500">

                ยอดบิลสุดท้าย

              </p>



              <p className="font-bold text-lg">

                ฿

                {Number(

                  order.final_amount ?? 0

                ).toFixed(2)}

              </p>

            </div>



          </div>



          <div className="mt-5">

            <p className="text-sm text-gray-500">

              ตำแหน่งจัดส่ง

            </p>



            {deliveryMapUrl ? (

              <a

                href={deliveryMapUrl}

                target="_blank"

                rel="noopener noreferrer"

                className="inline-block mt-2 bg-black text-white rounded-xl px-5 py-3 font-semibold"

              >

                📍 เปิด Google Maps

              </a>

            ) : (

              <p className="font-medium text-red-600 mt-2">

                ยังไม่ได้บันทึกลิงก์ Google Maps

              </p>

            )}

          </div>



          <div className="mt-5">

            <p className="text-sm text-gray-500">

              หมายเหตุถึงไรเดอร์

            </p>



            <p className="font-medium whitespace-pre-wrap mt-1">

              {order.customers?.rider_note ?? "—"}

            </p>

          </div>



          {order.customer_notes && (

            <div className="mt-5">

              <p className="text-sm text-gray-500">

                หมายเหตุคำสั่งซื้อจากลูกค้า

              </p>



              <p>

                {order.customer_notes}

              </p>

            </div>

          )}



        </section>



        <section className="bg-white border rounded-2xl p-6 mb-6">

          <h2 className="font-bold text-lg">
            เอกสารสำหรับการจัดส่ง
          </h2>

          <p className="text-sm text-gray-500 mt-1 mb-5">
            {order.billing_account_suspended
              ? "ตรวจสอบรูปรถเข็นและรูป CV card (บิลไม่บังคับ)"
              : order.billing_no_cv
                ? "ตรวจสอบรูปรถเข็นและรูปพักบิลจาก POS (ไม่ต้องใช้ QR)"
                : "ตรวจสอบรูปรถเข็น บิล และ QR ชำระเงินก่อนออกจัดส่ง"}
          </p>

          <div className="grid md:grid-cols-3 gap-5">

            <div className="border rounded-2xl p-4">
              <p className="font-semibold mb-3">
                รูปรถเข็นสินค้า
              </p>

              {!cartPhoto ? (
                <p className="text-sm text-gray-500">
                  ยังไม่มีรูปรถเข็นสินค้า
                </p>
              ) : isImage(cartPhoto) ? (
                <a
                  href={cartPhoto.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  <img
                    src={cartPhoto.url}
                    alt="รูปรถเข็นสินค้า"
                    className="w-full h-56 object-contain border rounded-xl bg-gray-50"
                  />
                </a>
              ) : (
                <a
                  href={cartPhoto.url}
                  target="_blank"
                  rel="noreferrer"
                  className="underline text-sm"
                >
                  เปิดไฟล์รูปรถเข็นสินค้า
                </a>
              )}
            </div>

            <div className="border rounded-2xl p-4">
              <p className="font-semibold mb-3">
                {order.billing_no_cv ? "รูปพักบิล (POS)" : "บิล"}
              </p>

              {!bill ? (
                <p className="text-sm text-gray-500">
                  {order.billing_account_suspended ? "บัญชีถูกระงับ: ไม่บังคับรูปบิล" : "ยังไม่มีรูปบิล"}
                </p>
              ) : isImage(bill) ? (
                <a
                  href={bill.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  <img
                    src={bill.url}
                    alt="บิล"
                    className="w-full h-56 object-contain border rounded-xl bg-gray-50"
                  />
                </a>
              ) : (
                <a
                  href={bill.url}
                  target="_blank"
                  rel="noreferrer"
                  className="underline text-sm"
                >
                  เปิดไฟล์บิล
                </a>
              )}
            </div>

            <div className="border rounded-2xl p-4">
              <p className="font-semibold mb-3">
                {order.billing_account_suspended ? "CV card ลูกค้า"
                  : order.billing_no_cv ? "QR ชำระเงิน (ไม่ต้องใช้)" : "QR ชำระเงิน"}
              </p>

              {!paymentQr ? (
                <p className="text-sm text-gray-500">
                  {order.billing_no_cv ? "ลูกค้าไม่มี CV: ไม่ต้องใช้ QR ชำระเงิน" : "ยังไม่มี QR ชำระเงิน"}
                </p>
              ) : (
                <a
                  href={paymentQr.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  <img
                    src={paymentQr.url}
                    alt={order.billing_account_suspended ? "CV card ลูกค้า" : "QR ชำระเงิน"}
                    className="w-full h-56 object-contain border rounded-xl bg-gray-50"
                  />
                </a>
              )}
            </div>

          </div>

        </section>



        <section className="bg-white border rounded-2xl p-6">



          <h2 className="font-bold text-lg">

            หลักฐานการจัดส่ง

          </h2>



          <p className="text-sm text-gray-500 mt-1 mb-5">

            ถ่ายหลักฐานการจัดส่งอย่างน้อย 1 รูป หลังบันทึกรูปแรกแล้วสามารถเพิ่มรูปที่ 2 ได้ (ไม่บังคับ)

          </p>

          <div className="space-y-4">
            <TaskFilePicker
              label="หลักฐานการจัดส่ง 1"
              chooseLabel="ถ่ายหรือเลือกหลักฐานการจัดส่ง"
              replaceLabel="เปลี่ยนรูปที่ 1"
              accept="image/*"
              uploaded={photoUploaded[0]}
              uploading={uploading}
              disabled={submitting}
              fileName={deliveryPhotoNames[0]}
              onSelect={(file) => uploadDeliveryProof(file, 0)}
            />
            {photoUploaded[0] && (
              <TaskFilePicker
                label="หลักฐานการจัดส่ง 2 (ไม่บังคับ)"
                chooseLabel="เพิ่มหลักฐานอีก 1 รูป (ไม่บังคับ)"
                replaceLabel="เปลี่ยนรูปที่ 2"
                appearance={photoUploaded[1] ? "default" : "add"}
                accept="image/*"
                uploaded={photoUploaded[1]}
                uploading={uploading}
                disabled={submitting}
                fileName={deliveryPhotoNames[1]}
                onSelect={(file) => uploadDeliveryProof(file, 1)}
              />
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

            onClick={completeDelivery}

            disabled={submitting || uploading || !photoUploaded[0]}

            className="bg-black text-white rounded-lg px-8 py-4 font-semibold disabled:opacity-30"

          >

            {submitting

              ? "กำลังบันทึก..."

              : "จัดส่งเสร็จสิ้น"}

          </button>



        </div>



      </div>

    </main>

  );

}