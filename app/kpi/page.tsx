"use client";



import {

  useEffect,

  useMemo,

  useState,

} from "react";



import Link from "next/link";



import { supabase } from "../../lib/supabase";



type KPIOrder = {

  order_id: string;

  order_number: number;



  customer_name:

    | string

    | null;



  status: string;



  confirmation_on_time:

    | boolean

    | null;



  delivery_on_time:

    | boolean

    | null;



  short_pick:

    | boolean

    | null;



  payment_on_time:

    | boolean

    | null;



  delivery_slot:

    | string

    | null;

};



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



function percent(

  numerator: number,

  denominator: number

) {

  if (

    denominator ===

    0

  ) {

    return "—";

  }



  return `${(

    (

      numerator /

      denominator

    ) *

    100

  ).toFixed(

    1

  )}%`;

}



export default function KPIPage() {

  const [

    selectedDate,

    setSelectedDate,

  ] =

    useState(

      getBangkokToday()

    );



  const [

    orders,

    setOrders,

  ] =

    useState<KPIOrder[]>(

      []

    );



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



  // =====================================================

  // LOAD KPI

  // =====================================================



  async function loadKPI() {

    setLoading(true);

    setMessage("");



    const {

      data,

      error,

    } =

      await supabase.rpc(

        "get_operational_kpi_orders",

        {

          p_delivery_date:

            selectedDate,

        }

      );



    if (error) {

      setMessage(

        "Could not load KPI data: " +

          error.message

      );



      setOrders(

        []

      );



      setLoading(false);

      return;

    }



    setOrders(

      Array.isArray(

        data

      )

        ? data

        : []

    );



    setLoading(false);

  }



  useEffect(() => {

    loadKPI();

  }, [selectedDate]);



  // =====================================================

  // KPI CALCULATIONS

  // =====================================================



  const metrics =

    useMemo(() => {

      const confirmationOrders =

        orders.filter(

          (order) =>

            order.confirmation_on_time !==

            null

        );



      const confirmationOnTime =

        confirmationOrders.filter(

          (order) =>

            order.confirmation_on_time ===

            true

        );



      const deliveryOrders =

        orders.filter(

          (order) =>

            order.delivery_on_time !==

            null

        );



      const deliveryOnTime =

        deliveryOrders.filter(

          (order) =>

            order.delivery_on_time ===

            true

        );



      const pickedOrders =

        orders.filter(

          (order) =>

            order.short_pick !==

            null

        );



      const shortPicked =

        pickedOrders.filter(

          (order) =>

            order.short_pick ===

            true

        );



      const paymentOrders =

        orders.filter(

          (order) =>

            order.payment_on_time !==

            null

        );



      const paymentOnTime =

        paymentOrders.filter(

          (order) =>

            order.payment_on_time ===

            true

        );



      return {

        confirmationOrders:

          confirmationOrders.length,



        confirmationOnTime:

          confirmationOnTime.length,



        deliveryOrders:

          deliveryOrders.length,



        deliveryOnTime:

          deliveryOnTime.length,



        pickedOrders:

          pickedOrders.length,



        shortPicked:

          shortPicked.length,



        paymentOrders:

          paymentOrders.length,



        paymentOnTime:

          paymentOnTime.length,

      };

    }, [orders]);



  const exceptions =

    orders.filter(

      (order) =>

        order.confirmation_on_time ===

          false ||

        order.delivery_on_time ===

          false ||

        order.short_pick ===

          true ||

        order.payment_on_time ===

          false

    );



  // =====================================================

  // LOADING

  // =====================================================



  if (loading) {

    return (

      <main className="min-h-screen bg-gray-100 p-8">

        Loading KPI...

      </main>

    );

  }



  // =====================================================

  // PAGE

  // =====================================================



  return (

    <main className="min-h-screen bg-gray-100 p-8">



      <div className="max-w-7xl mx-auto">



        {/* HEADER */}



        <div className="flex flex-col md:flex-row md:justify-between md:items-end gap-5 mb-8">



          <div>



            <Link

              href="/"

              className="text-gray-500"

            >

              ← กลับ

            </Link>



            <h1 className="text-3xl font-bold mt-3">

              Operations KPI

            </h1>



            <p className="text-gray-500 mt-1">

              วัดผลตามวันที่จัดส่งของลูกค้า

            </p>



          </div>



          <div>



            <label className="block text-sm font-medium mb-2">

              Delivery Date

            </label>



            <input

              type="date"

              value={

                selectedDate

              }

              onChange={(

                event

              ) =>

                setSelectedDate(

                  event.target

                    .value

                )

              }

              className="bg-white border rounded-lg px-4 py-2"

            />



          </div>



        </div>



        {message && (

          <div className="bg-white border rounded-xl p-4 mb-6 text-red-600">

            {message}

          </div>

        )}



        {/* KPI CARDS */}



        <section className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">



          {/* CONFIRMATION */}



          <div className="bg-white border rounded-2xl p-6">



            <p className="text-sm text-gray-500">

              Confirmation On Time

            </p>



            <p className="text-3xl font-bold mt-2">

              {percent(

                metrics.confirmationOnTime,

                metrics.confirmationOrders

              )}

            </p>



            <p className="text-sm text-gray-500 mt-2">

              {

                metrics.confirmationOnTime

              }

              {" / "}

              {

                metrics.confirmationOrders

              }

            </p>



            <p className="text-xs text-gray-400 mt-3">

              Confirmed within 30 minutes of order submission

            </p>



          </div>



          {/* DELIVERY */}



          <div className="bg-white border rounded-2xl p-6">



            <p className="text-sm text-gray-500">

              Delivery On Time

            </p>



            <p className="text-3xl font-bold mt-2">

              {percent(

                metrics.deliveryOnTime,

                metrics.deliveryOrders

              )}

            </p>



            <p className="text-sm text-gray-500 mt-2">

              {

                metrics.deliveryOnTime

              }

              {" / "}

              {

                metrics.deliveryOrders

              }

            </p>



            <p className="text-xs text-gray-400 mt-3">

              Delivered before the end of the customer&apos;s chosen time slot

            </p>



          </div>



          {/* SHORT PICK */}



          <div className="bg-white border rounded-2xl p-6">



            <p className="text-sm text-gray-500">

              Short Pick Rate

            </p>



            <p className="text-3xl font-bold mt-2">

              {percent(

                metrics.shortPicked,

                metrics.pickedOrders

              )}

            </p>



            <p className="text-sm text-gray-500 mt-2">

              {

                metrics.shortPicked

              }

              {" / "}

              {

                metrics.pickedOrders

              }

            </p>



            <p className="text-xs text-gray-400 mt-3">

              Weighted products allow up to 0.5 kg below confirmed quantity

            </p>



          </div>



          {/* PAYMENT */}



          <div className="bg-white border rounded-2xl p-6">



            <p className="text-sm text-gray-500">

              Payment On Time

            </p>



            <p className="text-3xl font-bold mt-2">

              {percent(

                metrics.paymentOnTime,

                metrics.paymentOrders

              )}

            </p>



            <p className="text-sm text-gray-500 mt-2">

              {

                metrics.paymentOnTime

              }

              {" / "}

              {

                metrics.paymentOrders

              }

            </p>



            <p className="text-xs text-gray-400 mt-3">

              Payment verified by 21:00 on delivery date

            </p>



          </div>



        </section>



        {/* SUMMARY */}



        <section className="bg-white border rounded-2xl p-6 mb-6">



          <h2 className="font-bold text-lg">

            คำสั่งซื้อวันที่{" "}

            {

              selectedDate

            }

          </h2>



          <p className="text-4xl font-bold mt-3">

            {

              orders.length

            }

          </p>



          <p className="text-gray-500 mt-1">

            จำนวนคำสั่งซื้อที่ไม่ถูกยกเลิกและมีกำหนดจัดส่งในวันนี้

          </p>



        </section>



        {/* EXCEPTIONS */}



        <section className="bg-white border rounded-2xl overflow-hidden">



          <div className="p-6 border-b">



            <h2 className="font-bold text-lg">

              KPI Exceptions

            </h2>



            <p className="text-sm text-gray-500 mt-1">

              คำสั่งซื้อที่พลาดเป้าหมายการดำเนินงานอย่างน้อยหนึ่งรายการ

            </p>



          </div>



          {exceptions.length ===

          0 ? (



            <div className="p-6 text-gray-500">

              ไม่พบ KPI exceptions สำหรับวันนี้

            </div>



          ) : (



            <div className="overflow-x-auto">



              <table className="w-full">



                <thead className="bg-gray-50">



                  <tr>



                    <th className="p-4 text-left">

                      คำสั่งซื้อ

                    </th>



                    <th className="p-4 text-left">

                      ลูกค้า

                    </th>



                    <th className="p-4 text-left">

                      ประเด็น

                    </th>



                    <th className="p-4 text-right">

                      การดำเนินการ

                    </th>



                  </tr>



                </thead>



                <tbody>



                  {exceptions.map(

                    (order) => {

                      const issues:

                        string[] =

                        [];



                      if (

                        order.confirmation_on_time ===

                        false

                      ) {

                        issues.push(

                          "Late confirmation"

                        );

                      }



                      if (

                        order.delivery_on_time ===

                        false

                      ) {

                        issues.push(

                          "Late delivery"

                        );

                      }



                      if (

                        order.short_pick ===

                        true

                      ) {

                        issues.push(

                          "Short pick"

                        );

                      }



                      if (

                        order.payment_on_time ===

                        false

                      ) {

                        issues.push(

                          "Late payment"

                        );

                      }



                      return (

                        <tr

                          key={

                            order.order_id

                          }

                          className="border-t"

                        >



                          <td className="p-4 font-semibold">

                            #

                            {

                              order.order_number

                            }

                          </td>



                          <td className="p-4">

                            {

                              order.customer_name ??

                              "ไม่ทราบชื่อลูกค้า"

                            }

                          </td>



                          <td className="p-4">

                            {issues.join(

                              " · "

                            )}

                          </td>



                          <td className="p-4 text-right">



                            <Link

                              href={`/orders/${order.order_number}`}

                              className="underline font-medium"

                            >

                              ดู

                            </Link>



                          </td>



                        </tr>

                      );

                    }

                  )}



                </tbody>



              </table>



            </div>



          )}



        </section>



      </div>



    </main>

  );

}