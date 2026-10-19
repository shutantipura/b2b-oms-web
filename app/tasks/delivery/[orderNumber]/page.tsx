"use client";



import { useEffect, useState } from "react";

import Link from "next/link";

import { useParams, useRouter } from "next/navigation";

import { supabase } from "../../../../lib/supabase";



type OrderDetails = {

  id: string;

  order_number: number;

  status: string;

  delivery_date: string | null;

  delivery_slot: string | null;

  delivery_address: string | null;

  customer_notes: string | null;

  final_amount: number | string | null;



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



  const [deliveryPhoto, setDeliveryPhoto] =

    useState<File | null>(null);



  const [photoUploaded, setPhotoUploaded] =

    useState(false);



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



    setPhotoUploaded(

      files.some(

        (file) =>

          file.file_type ===

          "delivery_proof"

      )

    );



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



  async function uploadDeliveryProof() {

    if (!deliveryPhoto) {

      setMessage(

        "กรุณาเลือกรูปหลักฐานการจัดส่งก่อน"

      );

      return;

    }



    setUploading(true);

    setMessage(

      "กำลังอัปโหลดหลักฐานการจัดส่ง..."

    );



    const extension =

      deliveryPhoto.name.split(".").pop() ||

      "jpg";



    const storagePath =

      `orders/${orderNumber}/delivery_proof/` +

      `${crypto.randomUUID()}.${extension}`;



    const { error: uploadError } =

      await supabase.storage

        .from("order-files")

        .upload(

          storagePath,

          deliveryPhoto,

          {

            upsert: false,

            contentType:

              deliveryPhoto.type ||

              "image/jpeg",

          }

        );



    if (uploadError) {

      setMessage(

        "อัปโหลดหลักฐานการจัดส่งไม่สำเร็จ: " +

          uploadError.message

      );

      setUploading(false);

      return;

    }



    const { error: registerError } =

      await supabase.rpc(

        "register_my_order_file",

        {

          p_order_number: orderNumber,

          p_file_type: "delivery_proof",

          p_storage_path: storagePath,

          p_original_filename:

            deliveryPhoto.name,

          p_mime_type:

            deliveryPhoto.type ||

            "image/jpeg",

        }

      );



    if (registerError) {

      setMessage(

        "อัปโหลดรูปสำเร็จ แต่บันทึกข้อมูลไฟล์ไม่สำเร็จ: " +

          registerError.message

      );

      setUploading(false);

      return;

    }



    setPhotoUploaded(true);

    setUploading(false);



    setMessage(

      "อัปโหลดหลักฐานการจัดส่งสำเร็จ"

    );

  }



  async function completeDelivery() {

    setMessage("");



    if (!photoUploaded) {

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



            <h1 className="text-3xl font-bold mt-1">

              คำสั่งซื้อ #{order.order_number}

            </h1>



            <p className="text-xl mt-2">

              {order.customers?.customer_name}

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



              <p className="font-medium">

                {order.delivery_date ?? "—"}

                {" · "}

                {order.delivery_slot ?? "—"}

              </p>

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
            ตรวจสอบรูปรถเข็น บิล และ QR ชำระเงินก่อนออกจัดส่ง
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
                บิล
              </p>

              {!bill ? (
                <p className="text-sm text-gray-500">
                  ยังไม่มีบิล
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
                QR ชำระเงิน
              </p>

              {!paymentQr ? (
                <p className="text-sm text-gray-500">
                  ยังไม่มี QR ชำระเงิน
                </p>
              ) : (
                <a
                  href={paymentQr.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  <img
                    src={paymentQr.url}
                    alt="QR ชำระเงิน"
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

            อัปโหลดรูป 1 รูปเพื่อยืนยันว่าจัดส่งสินค้าเรียบร้อยแล้ว

          </p>



          {photoUploaded ? (

            <div className="font-semibold">

              ✓ อัปโหลดหลักฐานการจัดส่งแล้ว

            </div>

          ) : (

            <>

              <input

                type="file"

                accept="image/*"

                onChange={(event) =>

                  setDeliveryPhoto(

                    event.target.files?.[0] ??

                    null

                  )

                }

              />



              <button

                onClick={uploadDeliveryProof}

                disabled={uploading}

                className="block mt-4 bg-white border rounded-lg px-5 py-2"

              >

                {uploading

                  ? "กำลังอัปโหลด..."

                  : "อัปโหลดหลักฐานการจัดส่ง"}

              </button>

            </>

          )}



        </section>



        {message && (

          <div className="mt-6 bg-white border rounded-lg p-4">

            {message}

          </div>

        )}



        <div className="flex justify-end mt-6">



          <button

            onClick={completeDelivery}

            disabled={

              submitting ||

              !photoUploaded

            }

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