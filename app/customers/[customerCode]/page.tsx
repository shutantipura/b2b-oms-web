"use client";



import { useEffect, useMemo, useState } from "react";

import Link from "next/link";

import { useParams, useRouter } from "next/navigation";

import { supabase } from "../../../lib/supabase";



type Customer = {

  id: string;

  customer_code: string;

  customer_name: string;

  customer_type: string | null;

  contact_name: string | null;

  phone: string | null;

  delivery_address: string | null;

  delivery_map_url: string | null;

  rider_note: string | null;

  is_active: boolean;

};



type LineUser = {

  id: string;

  display_name: string;

  internal_name: string | null;

  user_type: string;

};



type CustomerLineUser = {

  line_user_id: string;

  can_order: boolean;



  line_users: {

    id: string;

    display_name: string;

    internal_name: string | null;

    user_type: string;

  } | null;

};



type CustomerOrder = {

  order_number: number;

  status: string;

  delivery_date: string | null;

  final_amount: number | string | null;

};



function prettyText(value: string | null) {

  if (!value) return "—";



  const names: Record<string, string> = {

    restaurant: "ร้านอาหาร",

    grocery: "ร้านโชห่วย",

    hotel: "โรงแรม",

    cafe: "คาเฟ่",

    other: "อื่น ๆ",



    customer: "ลูกค้า",

    staff: "พนักงาน",

    manager: "ผู้จัดการ",

    salesman: "ฝ่ายขาย",



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



  return (

    names[value] ??

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


export default function CustomerDetailPage() {

  const params = useParams();

  const router = useRouter();



  const customerCode =

    String(params.customerCode).toUpperCase();



  const [customer, setCustomer] =

    useState<Customer | null>(null);



  const [linkedUsers, setLinkedUsers] =

    useState<CustomerLineUser[]>([]);



  const [allLineUsers, setAllLineUsers] =

    useState<LineUser[]>([]);



  const [orders, setOrders] =

    useState<CustomerOrder[]>([]);



  const [editing, setEditing] =

    useState(false);



  const [customerCodeInput, setCustomerCodeInput] =

    useState("");



  const [customerName, setCustomerName] =

    useState("");



  const [customerType, setCustomerType] =

    useState("");



  const [contactName, setContactName] =

    useState("");



  const [phone, setเบอร์โทรศัพท์] =

    useState("");



  const [deliveryMapUrl, setDeliveryMapUrl] =

    useState("");



  const [riderNote, setRiderNote] =

    useState("");



  const [selectedLineUser, setSelectedLineUser] =

    useState("");



  const [loading, setLoading] =

    useState(true);



  const [saving, setSaving] =

    useState(false);



  const [message, setMessage] =

    useState("");



  async function loadCustomer() {

    setLoading(true);

    setMessage("");



    // ----------------------------

    // Customer

    // ----------------------------



    const {

      data: customerData,

      error: customerError,

    } = await supabase

      .from("customers")

      .select(`

        id,

        customer_code,

        customer_name,

        customer_type,

        contact_name,

        phone,

        delivery_address,

        delivery_map_url,

        rider_note,

        is_active

      `)

      .eq("customer_code", customerCode)

      .single();



    if (customerError) {

      setMessage(

        "ไม่สามารถโหลดข้อมูลลูกค้าได้: " +

          customerError.message

      );



      setLoading(false);

      return;

    }



    const loadedCustomer =

      customerData as Customer;



    setCustomer(loadedCustomer);



    setCustomerName(

      loadedCustomer.customer_name

    );



    setCustomerType(

      loadedCustomer.customer_type ?? ""

    );



    setContactName(

      loadedCustomer.contact_name ?? ""

    );



    setเบอร์โทรศัพท์(

      loadedCustomer.phone ?? ""

    );



    setDeliveryMapUrl(

      loadedCustomer.delivery_map_url ??

        (loadedCustomer.delivery_address?.startsWith("http")

          ? loadedCustomer.delivery_address

          : "")

    );



    setRiderNote(

      loadedCustomer.rider_note ?? ""

    );



    // ----------------------------

    // Linked LINE users

    // ----------------------------



    const {

      data: linkData,

      error: linkError,

    } = await supabase

      .from("customer_line_users")

      .select(`

        line_user_id,

        can_order,

        line_users (

          id,

          display_name,

          internal_name,

          user_type

        )

      `)

      .eq(

        "customer_id",

        loadedCustomer.id

      );



    if (linkError) {

      setMessage(

        "ไม่สามารถโหลดบัญชี LINE ได้: " +

          linkError.message

      );



      setLoading(false);

      return;

    }



    setLinkedUsers(

      (linkData ?? []) as unknown as CustomerLineUser[]

    );



    // ----------------------------

    // All available LINE users

    // ----------------------------



    const {

      data: lineData,

      error: lineError,

    } = await supabase

      .from("line_users")

      .select(`

        id,

        display_name,

        internal_name,

        user_type

      `)

      .order("internal_name", {

        ascending: true,

      });



    if (lineError) {

      setMessage(

        "ไม่สามารถโหลดผู้ใช้ LINE ได้: " +

          lineError.message

      );



      setLoading(false);

      return;

    }



    setAllLineUsers(

      (lineData ?? []) as LineUser[]

    );



    // ----------------------------

    // Recent orders

    // ----------------------------



    const {

      data: orderData,

      error: orderError,

    } = await supabase

      .from("orders")

      .select(`

        order_number,

        status,

        delivery_date,

        final_amount

      `)

      .eq(

        "customer_id",

        loadedCustomer.id

      )

      .order(

        "order_number",

        { ascending: false }

      )

      .limit(10);



    if (orderError) {

      setMessage(

        "ไม่สามารถโหลดคำสั่งซื้อได้: " +

          orderError.message

      );



      setLoading(false);

      return;

    }



    setOrders(

      (orderData ?? []) as CustomerOrder[]

    );



    setLoading(false);

  }



  useEffect(() => {

    loadCustomer();

  }, [customerCode]);



  const availableLineUsers =

    useMemo(() => {

      const linkedIds =

        new Set(

          linkedUsers.map(

            (link) =>

              link.line_user_id

          )

        );



      return allLineUsers.filter(

        (user) =>

          !linkedIds.has(user.id)

      );

    }, [

      allLineUsers,

      linkedUsers,

    ]);



  async function saveCustomer() {

    if (!customer) return;



    const nextCustomerCode =

      customerCodeInput.trim();



    const codeChanged =

      nextCustomerCode !==

      customer.customer_code;



    if (!nextCustomerCode) {

      setMessage(

        "กรุณากรอกเลข CV"

      );

      return;

    }



    // The legacy ABC test account may remain C001.

    // Any changed / real customer เลข CV must be exactly 10 digits.

    if (

      codeChanged &&

      !/^\d{10}$/.test(

        nextCustomerCode

      )

    ) {

      setMessage(

        "เลข CV ต้องเป็นตัวเลข 10 หลัก"

      );

      return;

    }



    if (!customerName.trim()) {

      setMessage(

        "กรุณากรอกชื่อร้าน"

      );

      return;

    }



    if (!phone.trim()) {

      setMessage(

        "กรุณากรอกเบอร์โทรศัพท์"

      );

      return;

    }



    if (!deliveryMapUrl.trim()) {

      setMessage(

        "กรุณากรอกลิงก์ Google Maps"

      );

      return;

    }



    try {

      const url = new URL(deliveryMapUrl.trim());

      if (url.protocol !== "https:" && url.protocol !== "http:") {

        throw new Error("invalid protocol");

      }

    } catch {

      setMessage(

        "ลิงก์ Google Maps ไม่ถูกต้อง"

      );

      return;

    }



    setSaving(true);

    setMessage("");



    if (codeChanged) {

      const {

        data: duplicateCustomer,

        error: duplicateError,

      } = await supabase

        .from("customers")

        .select("id")

        .eq(

          "customer_code",

          nextCustomerCode

        )

        .neq(

          "id",

          customer.id

        )

        .limit(1)

        .maybeSingle();



      if (duplicateError) {

        setMessage(

          "ไม่สามารถตรวจสอบเลข CV ได้: " +

            duplicateError.message

        );

        setSaving(false);

        return;

      }



      if (duplicateCustomer) {

        setMessage(

          "เลข CV นี้ถูกใช้โดยลูกค้ารายอื่นแล้ว"

        );

        setSaving(false);

        return;

      }

    }



    const { error } =

      await supabase

        .from("customers")

        .update({

          customer_code:

            nextCustomerCode,



          customer_name:

            customerName.trim(),



          customer_type:

            customerType || null,



          contact_name:

            contactName.trim() || null,



          phone:

            phone.trim(),



          delivery_map_url:

            deliveryMapUrl.trim(),



          rider_note:

            riderNote.trim() || null,



          // Legacy compatibility mirror. New orders use this as

          // the location snapshot until delivery_address is retired.

          delivery_address:

            deliveryMapUrl.trim(),

        })

        .eq(

          "id",

          customer.id

        );



    if (error) {

      setMessage(

        "ไม่สามารถอัปเดตข้อมูลลูกค้าได้: " +

          error.message

      );



      setSaving(false);

      return;

    }



    setEditing(false);

    setSaving(false);



    if (codeChanged) {

      router.replace(

        `/customers/${nextCustomerCode}`

      );

      return;

    }



    await loadCustomer();

  }

  async function toggleCustomerStatus() {

    if (!customer) return;



    const nextActive =

      !customer.is_active;



    const action =

      nextActive

        ? "เปิดใช้งานอีกครั้ง"

        : "ปิดใช้งาน";



    const confirmed =

      window.confirm(

        `ยืนยันที่จะ${action}ลูกค้า ${customer.customer_name} หรือไม่?`

      );



    if (!confirmed) {

      return;

    }



    const { error } =

      await supabase

        .from("customers")

        .update({

          is_active:

            nextActive,

        })

        .eq(

          "id",

          customer.id

        );



    if (error) {

      setMessage(

        "ไม่สามารถเปลี่ยนสถานะลูกค้าได้: " +

          error.message

      );



      return;

    }



    await loadCustomer();

  }



  async function addLineUser() {

    if (

      !customer ||

      !selectedLineUser

    ) {

      setMessage(

        "กรุณาเลือกบัญชี LINE"

      );

      return;

    }



    setMessage("");



    const { error } =

      await supabase

        .from("customer_line_users")

        .insert({

          customer_id:

            customer.id,



          line_user_id:

            selectedLineUser,



          can_order: true,

        });



    if (error) {

      setMessage(

        "ไม่สามารถอนุญาตบัญชี LINE ได้: " +

          error.message

      );



      return;

    }



    setSelectedLineUser("");



    await loadCustomer();

  }



  async function toggleCanOrder(

    lineUserId: string,

    currentValue: boolean

  ) {

    if (!customer) return;



    const { error } =

      await supabase

        .from("customer_line_users")

        .update({

          can_order:

            !currentValue,

        })

        .eq(

          "customer_id",

          customer.id

        )

        .eq(

          "line_user_id",

          lineUserId

        );



    if (error) {

      setMessage(

        "ไม่สามารถอัปเดตสิทธิ์ LINE ได้: " +

          error.message

      );



      return;

    }



    await loadCustomer();

  }



  async function removeLineUser(

    lineUserId: string,

    displayName: string

  ) {

    if (!customer) return;



    const confirmed =

      window.confirm(

        `นำ ${displayName} ออกจากบัญชีลูกค้านี้หรือไม่?`

      );



    if (!confirmed) {

      return;

    }



    const { error } =

      await supabase

        .from("customer_line_users")

        .delete()

        .eq(

          "customer_id",

          customer.id

        )

        .eq(

          "line_user_id",

          lineUserId

        );



    if (error) {

      setMessage(

        "ไม่สามารถนำบัญชี LINE ออกได้: " +

          error.message

      );



      return;

    }



    await loadCustomer();

  }



  if (loading) {

    return (

      <main className="min-h-screen bg-gray-100 p-8">

        กำลังโหลดข้อมูลลูกค้า...

      </main>

    );

  }



  if (!customer) {

    return (

      <main className="min-h-screen bg-gray-100 p-8">

        ไม่พบข้อมูลลูกค้า

      </main>

    );

  }



  return (

    <main className="min-h-screen bg-gray-100 p-8">



      <div className="max-w-6xl mx-auto">



        <Link

          href="/customers"

          className="text-gray-500"

        >

          ← กลับไปหน้าลูกค้า

        </Link>



        <div className="flex justify-between items-start mt-4 mb-8">



          <div>



            <p className="text-sm text-gray-500">

              ลูกค้า

            </p>



            <h1 className="text-3xl font-bold mt-1">

              {customer.customer_name}

            </h1>



            <p className="text-gray-500 mt-2">

              {customer.customer_code}

            </p>



          </div>



          <div className="text-right">



            <span className="inline-block bg-white border rounded-full px-4 py-2 font-semibold">

              {customer.is_active

                ? "ใช้งานอยู่"

                : "ปิดใช้งาน"}

            </span>



          </div>



        </div>



        {message && (

          <div className="bg-white border rounded-lg p-4 mb-6 text-red-600">

            {message}

          </div>

        )}



        {/* ลูกค้า DETAILS */}



        <section className="bg-white border rounded-2xl p-6 mb-6">



          <div className="flex justify-between items-center mb-6">



            <h2 className="font-bold text-lg">

              ข้อมูลลูกค้า

            </h2>



            {!editing && (

              <button

                onClick={() =>

                  setEditing(true)

                }

                className="bg-white border rounded-lg px-4 py-2 font-semibold"

              >

                แก้ไขข้อมูลลูกค้า

              </button>

            )}



          </div>



          {editing ? (



            <div className="grid md:grid-cols-2 gap-5">

              <div>

                <label className="block text-sm font-medium mb-2">

                  เลข CV

                </label>



                <input

                  value={customerCodeInput}

                  onChange={(event) =>

                    setCustomerCodeInput(

                      event.target.value

                        .replace(/\D/g, "")

                        .slice(0, 10)

                    )

                  }

                  inputMode="numeric"

                  maxLength={10}

                  className="w-full border rounded-lg px-4 py-3"

                  placeholder="เลข CV 10 หลัก"

                />



                <p className="text-xs text-gray-500 mt-2">

                  เลข CV ของลูกค้าจริงต้องเป็นตัวเลข 10 หลัก ส่วนบัญชีทดสอบ ABC Restaurant สามารถใช้ C001 ต่อไปได้

                </p>

              </div>



              <div>

                <label className="block text-sm font-medium mb-2">

                  ชื่อร้าน

                </label>



                <input

                  value={customerName}

                  onChange={(event) =>

                    setCustomerName(

                      event.target.value

                    )

                  }

                  className="w-full border rounded-lg px-4 py-3"

                />

              </div>



              <div>

                <label className="block text-sm font-medium mb-2">

                  ประเภทลูกค้า

                </label>



                <select

                  value={customerType}

                  onChange={(event) =>

                    setCustomerType(

                      event.target.value

                    )

                  }

                  className="w-full border rounded-lg px-4 py-3 bg-white"

                >

                  <option value="">

                    เลือกประเภท

                  </option>



                  <option value="restaurant">

                    ร้านอาหาร

                  </option>



                  <option value="grocery">

                    ร้านโชห่วย

                  </option>



                  <option value="hotel">

                    โรงแรม

                  </option>



                  <option value="cafe">

                    คาเฟ่

                  </option>



                  <option value="other">

                    อื่น ๆ

                  </option>

                </select>

              </div>



              <div>

                <label className="block text-sm font-medium mb-2">

                  ชื่อลูกค้า CV

                </label>



                <input

                  value={contactName}

                  onChange={(event) =>

                    setContactName(

                      event.target.value

                    )

                  }

                  className="w-full border rounded-lg px-4 py-3"

                />

              </div>



              <div>

                <label className="block text-sm font-medium mb-2">

                  เบอร์โทรศัพท์

                </label>



                <input

                  value={phone}

                  onChange={(event) =>

                    setเบอร์โทรศัพท์(

                      event.target.value

                    )

                  }

                  className="w-full border rounded-lg px-4 py-3"

                />

              </div>



              <div className="md:col-span-2">

                <label className="block text-sm font-medium mb-2">

                  ลิงก์ Google Maps

                </label>

                <input

                  type="url"

                  value={deliveryMapUrl}

                  onChange={(event) =>

                    setDeliveryMapUrl(

                      event.target.value

                    )

                  }

                  placeholder="https://maps.app.goo.gl/..."

                  className="w-full border rounded-lg px-4 py-3"

                />

              </div>



              <div className="md:col-span-2">

                <label className="block text-sm font-medium mb-2">

                  หมายเหตุถึงไรเดอร์

                </label>

                <textarea

                  value={riderNote}

                  onChange={(event) =>

                    setRiderNote(

                      event.target.value

                    )

                  }

                  rows={3}

                  placeholder="เช่น เข้าทางประตูหลัง โทรก่อนถึง 10 นาที"

                  className="w-full border rounded-lg px-4 py-3"

                />

              </div>



              <div className="md:col-span-2 flex justify-end gap-3">



                <button

                  onClick={() => {

                    setEditing(false);



                    setCustomerCodeInput(

                      customer.customer_code

                    );



                    setCustomerName(

                      customer.customer_name

                    );



                    setCustomerType(

                      customer.customer_type ??

                        ""

                    );



                    setContactName(

                      customer.contact_name ??

                        ""

                    );



                    setเบอร์โทรศัพท์(

                      customer.phone ??

                        ""

                    );



                    setDeliveryMapUrl(

                      customer.delivery_map_url ??

                        (customer.delivery_address?.startsWith("http")

                          ? customer.delivery_address

                          : "")

                    );



                    setRiderNote(

                      customer.rider_note ?? ""

                    );

                  }}

                  className="bg-white border rounded-lg px-5 py-3"

                >

                  ยกเลิก

                </button>



                <button

                  onClick={saveCustomer}

                  disabled={saving}

                  className="bg-black text-white rounded-lg px-6 py-3 font-semibold disabled:opacity-40"

                >

                  {saving

                    ? "กำลังบันทึก..."

                    : "บันทึกการเปลี่ยนแปลง"}

                </button>



              </div>



            </div>



          ) : (



            <div className="grid md:grid-cols-2 gap-6">



              <div>

                <p className="text-sm text-gray-500">

                  เลข CV

                </p>



                <p className="font-medium">

                  {customer.customer_code}

                </p>

              </div>



              <div>

                <p className="text-sm text-gray-500">

                  ประเภทลูกค้า

                </p>



                <p className="font-medium">

                  {prettyText(

                    customer.customer_type

                  )}

                </p>

              </div>



              <div>

                <p className="text-sm text-gray-500">

                  ชื่อลูกค้า CV

                </p>



                <p className="font-medium">

                  {customer.contact_name ??

                    "—"}

                </p>

              </div>



              <div>

                <p className="text-sm text-gray-500">

                  เบอร์โทรศัพท์

                </p>



                {customer.phone ? (

                  <a

                    href={`tel:${customer.phone}`}

                    className="font-medium underline"

                  >

                    {customer.phone}

                  </a>

                ) : (

                  <p>—</p>

                )}

              </div>



              <div className="md:col-span-2">

                <p className="text-sm text-gray-500">

                  ตำแหน่งจัดส่ง

                </p>



                {customer.delivery_map_url ? (

                  <a

                    href={customer.delivery_map_url}

                    target="_blank"

                    rel="noopener noreferrer"

                    className="inline-block mt-2 bg-black text-white rounded-lg px-4 py-2 font-semibold"

                  >

                    📍 เปิด Google Maps

                  </a>

                ) : (

                  <p className="font-medium">—</p>

                )}

              </div>



              <div className="md:col-span-2">

                <p className="text-sm text-gray-500">

                  หมายเหตุถึงไรเดอร์

                </p>



                <p className="font-medium whitespace-pre-wrap">

                  {customer.rider_note ?? "—"}

                </p>

              </div>



            </div>



          )}



        </section>



        {/* LINE ACCOUNTS */}



        <section className="bg-white border rounded-2xl p-6 mb-6">



          <h2 className="font-bold text-lg">

            บัญชี LINE ที่ได้รับอนุญาต

          </h2>



          <p className="text-sm text-gray-500 mt-1 mb-5">

            ลูกค้าหนึ่งรายสามารถเชื่อมกับบัญชี LINE ได้หลายบัญชี

          </p>



          {linkedUsers.length === 0 ? (



            <p className="text-gray-500 mb-6">

              ยังไม่มีบัญชี LINE ที่เชื่อมกับลูกค้านี้

            </p>



          ) : (



            <div className="space-y-3 mb-6">



              {linkedUsers.map(

                (link) => {



                  const line =

                    link.line_users;



                  return (

                    <div

                      key={link.line_user_id}

                      className="border rounded-xl p-4 flex flex-col md:flex-row md:justify-between md:items-center gap-4"

                    >



                      <div>



                        <p className="font-semibold">

                          {line?.internal_name?.trim() ||

                            "ยังไม่ได้ตั้งชื่อใน OMS"}

                        </p>



                        <p className="text-sm text-gray-500">

                          {prettyText(

                            line?.user_type ??

                              null

                          )}

                        </p>



                        <p className="text-sm mt-1">

                          {link.can_order

                            ? "✓ สามารถสั่งซื้อได้"

                            : "ไม่สามารถสั่งซื้อได้"}

                        </p>



                      </div>



                      <div className="flex gap-2">



                        <button

                          onClick={() =>

                            toggleCanOrder(

                              link.line_user_id,

                              link.can_order

                            )

                          }

                          className="bg-white border rounded-lg px-4 py-2"

                        >

                          {link.can_order

                            ? "ยกเลิกสิทธิ์"

                            : "อนุญาต"}

                        </button>



                        <button

                          onClick={() =>

                            removeLineUser(

                              link.line_user_id,

                              line?.internal_name?.trim() ||

                                "บัญชี LINE นี้"

                            )

                          }

                          className="bg-white border rounded-lg px-4 py-2"

                        >

                          นำออก

                        </button>



                      </div>



                    </div>

                  );

                }

              )}



            </div>



          )}



          <div className="border-t pt-5">



            <p className="font-medium mb-3">

              เพิ่มบัญชี LINE

            </p>



            <div className="flex flex-col md:flex-row gap-3">



              <select

                value={selectedLineUser}

                onChange={(event) =>

                  setSelectedLineUser(

                    event.target.value

                  )

                }

                className="flex-1 border rounded-lg px-4 py-3 bg-white"

              >



                <option value="">

                  เลือกบัญชี LINE

                </option>



                {availableLineUsers.map(

                  (user) => (

                    <option

                      key={user.id}

                      value={user.id}

                    >

                      {user.internal_name?.trim() ||

                        "ยังไม่ได้ตั้งชื่อใน OMS"}

                      {" · "}

                      {prettyText(

                        user.user_type

                      )}

                    </option>

                  )

                )}



              </select>



              <button

                onClick={addLineUser}

                disabled={!selectedLineUser}

                className="bg-black text-white rounded-lg px-6 py-3 font-semibold disabled:opacity-30"

              >

                อนุญาตบัญชี LINE

              </button>



            </div>



          </div>



        </section>



        {/* ORDERS */}



        <section className="bg-white border rounded-2xl overflow-hidden mb-6">



          <div className="p-6 border-b">



            <h2 className="font-bold text-lg">

              คำสั่งซื้อล่าสุด

            </h2>



          </div>



          {orders.length === 0 ? (



            <div className="p-6 text-gray-500">

              ลูกค้ารายนี้ยังไม่มีคำสั่งซื้อ

            </div>



          ) : (



            <div>



              {orders.map((order) => (



                <div

                  key={order.order_number}

                  className="p-5 border-b last:border-b-0 flex justify-between items-center"

                >



                  <div>



                    <Link

                      href={`/orders/${order.order_number}`}

                      className="font-semibold underline"

                    >

                      ออเดอร์ #{order.order_number}

                    </Link>



                    <p className="text-sm text-gray-500 mt-1">

                      {order.delivery_date ??

                        "ยังไม่ระบุวันจัดส่ง"}

                      {" · "}

                      {prettyText(

                        order.status

                      )}

                    </p>



                  </div>



                  <div className="font-semibold">



                    {order.final_amount !==

                    null

                      ? `฿${Number(

                          order.final_amount

                        ).toFixed(2)}`

                      : "—"}



                  </div>



                </div>



              ))}



            </div>



          )}



        </section>



        {/* ACCOUNT STATUS */}



        <section className="bg-white border rounded-2xl p-6">



          <h2 className="font-bold text-lg">

            สถานะบัญชี

          </h2>



          <p className="text-gray-500 mt-1">

            ลูกค้าที่ถูกปิดใช้งานจะไม่สามารถสร้างคำสั่งซื้อใหม่ได้ แต่ข้อมูลย้อนหลังจะยังคงอยู่

          </p>



          <div className="flex justify-between items-center mt-6">



            <div>



              <p className="font-semibold">

                สถานะปัจจุบัน

              </p>



              <p className="mt-1">

                {customer.is_active

                  ? "ใช้งานอยู่"

                  : "ปิดใช้งาน"}

              </p>



            </div>



            <button

              onClick={toggleCustomerStatus}

              className="bg-white border rounded-lg px-5 py-3 font-semibold"

            >

              {customer.is_active

                ? "ปิดใช้งานลูกค้า"

                : "เปิดใช้งานลูกค้าอีกครั้ง"}

            </button>



          </div>



        </section>



      </div>



    </main>

  );

}