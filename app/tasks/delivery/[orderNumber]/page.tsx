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

  } | null;

};



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



    const {

      data: existingProof,

      error: proofError,

    } = await supabase

      .from("order_files")

      .select("id")

      .eq("order_id", orderData.id)

      .eq("file_type", "delivery_proof")

      .eq("is_current", true)

      .maybeSingle();



    if (!proofError && existingProof) {

      setPhotoUploaded(true);

    }



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

              ที่อยู่จัดส่ง

            </p>



            <p className="font-medium text-lg">

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