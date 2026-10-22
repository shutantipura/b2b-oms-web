"use client";



import {

  useEffect,

  useState,

} from "react";



import Link from "next/link";



import {

  useParams,

  useRouter,

} from "next/navigation";



import { supabase } from "../../../../lib/supabase";
import DeliverySchedule from "../../../../components/DeliverySchedule";



type OrderDetails = {

  id: string;

  order_number: number;

  status: string;
  delivery_date: string | null;
  delivery_slot: string | null;

  final_amount:

    | number

    | string

    | null;



  customers: {

    customer_name: string;

    contact_name:

      | string

      | null;

    phone:

      | string

      | null;

  } | null;

};



type OrderFile = {

  id: string;

  file_type: string;

  storage_path: string;

  original_filename:

    | string

    | null;

  mime_type:

    | string

    | null;

};



type DisplayFile = {

  url: string;

  name: string;

  mimeType:

    | string

    | null;

};



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


export default function PaymentVerificationPage() {

  const params =

    useParams();



  const router =

    useRouter();



  const orderNumber =

    Number(

      params.orderNumber

    );



  const [

    order,

    setOrder,

  ] =

    useState<OrderDetails | null>(

      null

    );



  const [

    bill,

    setBill,

  ] =

    useState<DisplayFile | null>(

      null

    );



  const [

    slip,

    setSlip,

  ] =

    useState<DisplayFile | null>(

      null

    );



  const [

    loading,

    setLoading,

  ] =

    useState(true);



  const [

    submitting,

    setSubmitting,

  ] =

    useState(false);



  const [

    message,

    setMessage,

  ] =

    useState("");



  // =====================================================

  // CREATE SIGNED FILE URL

  // =====================================================



  async function getDisplayFile(

    file: OrderFile

  ): Promise<DisplayFile | null> {

    const {

      data,

      error,

    } =

      await supabase.storage

        .from(

          "order-files"

        )

        .createSignedUrl(

          file.storage_path,

          60 * 60

        );



    if (error) {

      console.error(

        error

      );



      return null;

    }



    return {

      url:

        data.signedUrl,



      name:

        file.original_filename ??

        file.file_type,



      mimeType:

        file.mime_type,

    };

  }



  // =====================================================

  // LOAD ORDER

  // =====================================================



  async function loadOrder() {

    setLoading(true);

    setMessage("");



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

          delivery_date,
          delivery_slot,
          final_amount,

          customers (

            customer_name,

            contact_name,

            phone

          )

        `)

        .eq(

          "order_number",

          orderNumber

        )

        .single();



    if (

      orderError ||

      !orderData

    ) {

      setMessage(

        "ไม่สามารถโหลดคำสั่งซื้อได้: " +

          (

            orderError?.message ??

            "ไม่พบคำสั่งซื้อ"

          )

      );



      setLoading(false);

      return;

    }



    setOrder(

      orderData as unknown as OrderDetails

    );



    // ===================================================

    // LOAD BILL + PAYMENT SLIP

    // ===================================================



    const {

      data: fileData,

      error: fileError,

    } =

      await supabase

        .from(

          "order_files"

        )

        .select(`

          id,

          file_type,

          storage_path,

          original_filename,

          mime_type

        `)

        .eq(

          "order_id",

          orderData.id

        )

        .eq(

          "is_current",

          true

        )

        .in(

          "file_type",

          [

            "bill",

            "payment_slip",

          ]

        );



    if (fileError) {

      setMessage(

        "ไม่สามารถโหลดไฟล์ได้: " +

          fileError.message

      );



      setLoading(false);

      return;

    }



    const files =

      (fileData ??

        []) as OrderFile[];



    const billFile =

      files.find(

        (file) =>

          file.file_type ===

          "bill"

      );



    const slipFile =

      files.find(

        (file) =>

          file.file_type ===

          "payment_slip"

      );



    if (billFile) {

      setBill(

        await getDisplayFile(

          billFile

        )

      );

    } else {

      setBill(null);

    }



    if (slipFile) {

      setSlip(

        await getDisplayFile(

          slipFile

        )

      );

    } else {

      setSlip(null);

    }



    setLoading(false);

  }



  useEffect(() => {

    if (

      !Number.isNaN(

        orderNumber

      )

    ) {

      loadOrder();

    }

  }, [orderNumber]);



  // =====================================================

  // VERIFY PAYMENT

  // =====================================================



  async function verifyPayment() {

    setMessage("");



    if (!order) {

      return;

    }



    if (

      order.status !==

      "payment_submitted"

    ) {

      setMessage(

        `คำสั่งซื้อนี้อยู่ในสถานะ ${prettyStatus(order.status)} สามารถตรวจสอบการชำระเงินได้หลังจากส่งสลิปแล้วเท่านั้น`

      );



      return;

    }



    if (!slip) {

      setMessage(

        "ต้องมีสลิปการชำระเงินก่อนจึงจะตรวจสอบการชำระเงินได้"

      );



      return;

    }



    const confirmed =

      window.confirm(

        `ยืนยันว่าได้รับชำระเงินจำนวน ฿${Number(

          order.final_amount ??

            0

        ).toFixed(

          2

        )} และปิดคำสั่งซื้อ #${orderNumber} หรือไม่?`

      );



    if (!confirmed) {

      return;

    }



    setSubmitting(

      true

    );



    const { error } =

      await supabase.rpc(

        "verify_my_payment",

        {

          p_order_number:

            orderNumber,

        }

      );



    if (error) {

      setMessage(

        "ไม่สามารถยืนยันการชำระเงินได้: " +

          error.message

      );



      setSubmitting(

        false

      );



      return;

    }



    router.push(

      "/tasks"

    );



    router.refresh();

  }



  // =====================================================

  // RELEASE VERIFICATION TASK

  // =====================================================



  async function releaseTask() {

    const confirmed =

      window.confirm(

        "ต้องการปล่อยงานนี้เพื่อให้พนักงานคนอื่นตรวจสอบการชำระเงินหรือไม่?"

      );



    if (!confirmed) {

      return;

    }



    const { error } =

      await supabase.rpc(

        "release_my_task",

        {

          p_order_number:

            orderNumber,

        }

      );



    if (error) {

      setMessage(

        "ไม่สามารถปล่อยงานได้: " +

          error.message

      );



      return;

    }



    router.push(

      "/tasks"

    );



    router.refresh();

  }



  // =====================================================

  // FILE TYPE

  // =====================================================



  function isImage(

    file: DisplayFile | null

  ) {

    return Boolean(

      file?.mimeType?.startsWith(

        "image/"

      )

    );

  }



  // =====================================================

  // LOADING

  // =====================================================



  if (loading) {

    return (

      <main className="min-h-screen bg-gray-100 p-8">

        กำลังโหลดข้อมูลการชำระเงิน...

      </main>

    );

  }



  if (!order) {

    return (

      <main className="min-h-screen bg-gray-100 p-8">



        <Link

          href="/tasks"

          className="text-gray-500"

        >

          ← กลับไปหน้างาน

        </Link>



        <p className="mt-6">

          ไม่พบคำสั่งซื้อ

        </p>



      </main>

    );

  }



  // =====================================================

  // PAGE

  // =====================================================



  return (

    <main className="min-h-screen bg-gray-100 p-8">



      <div className="max-w-5xl mx-auto">



        <Link

          href="/tasks"

          className="text-gray-500"

        >

          ← กลับไปหน้างาน

        </Link>



        {/* HEADER */}



        <div className="flex flex-col md:flex-row md:justify-between md:items-start gap-4 mt-4 mb-8">



          <div>



            <p className="text-sm text-gray-500">

              ตรวจสอบการชำระเงิน

            </p>



            <h1 className="mt-1 text-2xl font-extrabold leading-tight text-[#17453F] md:text-3xl">
              {order.customers?.customer_name ?? "ไม่ทราบชื่อร้าน"}
            </h1>
            <p className="mt-1 text-xs font-semibold text-[#82958F]">
              คำสั่งซื้อ #{order.order_number}
            </p>
            <DeliverySchedule date={order.delivery_date} slot={order.delivery_slot} delivered />



            <p className="text-sm text-gray-500 mt-2">

              สถานะ:{" "}

              {

                order.status

              }

            </p>



          </div>



          {order.status ===

            "payment_submitted" && (

            <button

              onClick={

                releaseTask

              }

              className="bg-white border rounded-lg px-4 py-2"

            >

              ปล่อยงาน

            </button>

          )}



        </div>



        {/* SUMMARY */}



        <section className="bg-white border rounded-2xl p-6 mb-6">



          <h2 className="font-bold text-lg mb-5">

            สรุปการชำระเงิน

          </h2>



          <div className="grid md:grid-cols-3 gap-6">



            <div>



              <p className="text-sm text-gray-500">

                ยอดที่ต้องชำระ

              </p>



              <p className="text-3xl font-bold mt-1">

                ฿

                {Number(

                  order.final_amount ??

                    0

                ).toFixed(

                  2

                )}

              </p>



            </div>



            <div>



              <p className="text-sm text-gray-500">

                ลูกค้า

              </p>



              <p className="font-medium text-lg">

                {

                  order.customers

                    ?.customer_name ??

                  "—"

                }

              </p>



              <p className="text-sm text-gray-500">

                {

                  order.customers

                    ?.contact_name ??

                  ""

                }

              </p>



            </div>



            <div>



              <p className="text-sm text-gray-500">

                เบอร์โทรศัพท์ลูกค้า

              </p>



              {order.customers

                ?.phone ? (



                <a

                  href={`tel:${order.customers.phone}`}

                  className="font-medium text-lg underline"

                >

                  {

                    order.customers

                      .phone

                  }

                </a>



              ) : (



                <p>—</p>



              )}



            </div>



          </div>



        </section>



        {/* FILES */}



        <div className="grid md:grid-cols-2 gap-6">



          {/* BILL */}



          <section className="bg-white border rounded-2xl p-6">



            <h2 className="font-bold text-lg">

              บิล

            </h2>



            <p className="text-sm text-gray-500 mt-1 mb-5">

              บิลที่อัปโหลดในขั้นตอนออกบิล

            </p>



            {!bill ? (



              <p className="text-red-600">

                ไม่พบบิล

              </p>



            ) : isImage(

                bill

              ) ? (



              <>



                <img

                  src={

                    bill.url

                  }

                  alt="บิล"

                  className="w-full max-h-96 object-contain border rounded-lg"

                />



                <a

                  href={

                    bill.url

                  }

                  target="_blank"

                  rel="noreferrer"

                  className="inline-block mt-4 underline"

                >

                  เปิดบิลขนาดเต็ม

                </a>



              </>



            ) : (



              <a

                href={

                  bill.url

                }

                target="_blank"

                rel="noreferrer"

                className="inline-block bg-white border rounded-lg px-5 py-3 font-semibold"

              >

                เปิดบิล

              </a>



            )}



          </section>



          {/* PAYMENT SLIP */}



          <section className="bg-white border rounded-2xl p-6">



            <h2 className="font-bold text-lg">

              สลิปการชำระเงิน

            </h2>



            <p className="text-sm text-gray-500 mt-1 mb-5">



              {order.status ===

              "awaiting_payment"

                ? "ยังไม่มีการส่งสลิปการชำระเงิน"

                : "ตรวจสอบสลิปเทียบกับยอดที่ต้องชำระ"}



            </p>



            {!slip ? (



              <p className="text-gray-500">

                ไม่พบสลิปการชำระเงิน

              </p>



            ) : isImage(

                slip

              ) ? (



              <>



                <img

                  src={

                    slip.url

                  }

                  alt="สลิปการชำระเงิน"

                  className="w-full max-h-96 object-contain border rounded-lg"

                />



                <a

                  href={

                    slip.url

                  }

                  target="_blank"

                  rel="noreferrer"

                  className="inline-block mt-4 underline"

                >

                  เปิดสลิปขนาดเต็ม

                </a>



              </>



            ) : (



              <a

                href={

                  slip.url

                }

                target="_blank"

                rel="noreferrer"

                className="inline-block bg-white border rounded-lg px-5 py-3 font-semibold"

              >

                เปิดสลิปการชำระเงิน

              </a>



            )}



          </section>



        </div>



        {/* ACTION */}



        <section className="bg-white border rounded-2xl p-6 mt-6">



          {order.status ===

          "awaiting_payment" ? (



            <>



              <h2 className="font-bold text-lg">

                รอชำระเงิน

              </h2>



              <p className="text-gray-500 mt-1">

                พนักงานสามารถอัปโหลดสลิปการชำระเงินแทนลูกค้าได้

              </p>



              <div className="mt-5 flex flex-col md:flex-row gap-3">



                {order.customers

                  ?.phone && (



                  <a

                    href={`tel:${order.customers.phone}`}

                    className="text-center bg-white border rounded-lg px-5 py-3 font-semibold"

                  >

                    โทรหาลูกค้า

                  </a>



                )}



                <Link

                  href={`/orders/${order.order_number}/payment`}

                  className="text-center bg-black text-white rounded-lg px-8 py-3 font-semibold"

                >

                  อัปโหลดสลิปการชำระเงิน

                </Link>



              </div>



            </>



          ) : order.status ===

            "payment_submitted" ? (



            <>



              <h2 className="font-bold text-lg">

                ตรวจสอบการชำระเงิน

              </h2>



              <p className="text-gray-500 mt-1">

                ยืนยันว่าได้รับชำระเงินครบถ้วนตามยอดที่กำหนด

              </p>



              <div className="mt-5 flex flex-col md:flex-row gap-3">



                {order.customers

                  ?.phone && (



                  <a

                    href={`tel:${order.customers.phone}`}

                    className="text-center bg-white border rounded-lg px-5 py-3 font-semibold"

                  >

                    โทรหาลูกค้า

                  </a>



                )}



                <button

                  onClick={

                    verifyPayment

                  }

                  disabled={

                    submitting ||

                    !slip

                  }

                  className="bg-black text-white rounded-lg px-8 py-3 font-semibold disabled:opacity-30"

                >



                  {submitting

                    ? "กำลังตรวจสอบ..."

                    : "ยืนยันการชำระเงิน → ปิดคำสั่งซื้อ"}



                </button>



              </div>



            </>



          ) : (



            <>



              <h2 className="font-bold text-lg">

                สถานะการชำระเงิน

              </h2>



              <p className="text-gray-500 mt-1">

                คำสั่งซื้อนี้อยู่ในสถานะ{" "}

                <b>

                  {

                    order.status

                  }

                </b>

                .

              </p>



            </>



          )}



        </section>



        {message && (

          <div className="mt-6 bg-white border rounded-lg p-4 text-red-600">

            {message}

          </div>

        )}



      </div>



    </main>

  );

}