"use client";



import {

  FormEvent,

  useEffect,

  useState,

} from "react";



import Link from "next/link";



import { supabase } from "../lib/supabase";



type StaffProfile = {

  staff_code: string;

  staff_name: string;

  account_type: string;

  is_active: boolean;

};



const TASK_STATUS_MAP:
  Record<string, string[]> = {
  confirmation: [
    "awaiting_confirmation",
  ],
  picking: [
    "awaiting_picking",
    "picking",
  ],
  billing: [
    "awaiting_billing",
  ],
  delivery: [
    "ready_for_delivery",
    "out_for_delivery",
  ],
  payment_verification: [
    "awaiting_payment",
    "payment_submitted",
  ],
};

type NavigationItem = {

  name: string;

  href: string;

  description?: string;

};



export default function Home() {

  const [

    email,

    setEmail,

  ] =

    useState("");



  const [

    password,

    setPassword,

  ] =

    useState("");



  const [

    staff,

    setStaff,

  ] =

    useState<StaffProfile | null>(

      null

    );



  const [

    activeOrderCount,

    setActiveOrderCount,

  ] =

    useState(0);



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

  // ACTIVE ORDERS

  // =====================================================



  async function loadActiveOrderCount(
    allowedStages: string[]
  ) {
    const allowedStatuses =
      Array.from(
        new Set(
          allowedStages.flatMap(
            (stage) =>
              TASK_STATUS_MAP[
                stage
              ] ?? []
          )
        )
      );

    if (
      allowedStatuses.length ===
      0
    ) {
      setActiveOrderCount(0);
      return;
    }

    const {

      count,

      error,

    } =

      await supabase

        .from("orders")

        .select(

          "id",

          {

            count:

              "exact",



            head:

              true,

          }

        )

        .in(

          "status",

          allowedStatuses

        );



    if (error) {

      console.error(

        "Could not load active order count:",

        error

      );



      setActiveOrderCount(

        0

      );



      return;

    }



    setActiveOrderCount(

      count ?? 0

    );

  }



  // =====================================================

  // LOAD STAFF

  // =====================================================



  async function loadStaff() {

    setLoading(true);



    const {

      data: { user },

    } =

      await supabase.auth.getUser();



    if (!user) {

      setStaff(

        null

      );



      setActiveOrderCount(

        0

      );



      setLoading(false);

      return;

    }



    const {

      data,

      error,

    } =

      await supabase

        .from("staff")

        .select(`

          staff_code,

          staff_name,

          account_type,

          is_active

        `)

        .eq(

          "auth_user_id",

          user.id

        )

        .eq(

          "is_active",

          true

        )

        .single();



    if (error) {

      console.error(

        error

      );



      await supabase.auth.signOut();



      setMessage(

        "บัญชีนี้ไม่ได้เชื่อมกับพนักงานที่ใช้งานอยู่ใน OMS"

      );



      setStaff(

        null

      );



      setLoading(false);

      return;

    }



    setStaff(

      data

    );



    setMessage(

      ""

    );



    const {
      data: permissionData,
      error: permissionError,
    } =
      await supabase.rpc(
        "get_my_task_permissions"
      );

    if (permissionError) {
      console.error(
        "Could not load task permissions:",
        permissionError
      );

      setActiveOrderCount(0);
    } else {
      const allowedStages =
        (permissionData ?? [])
          .map(
            (row: { stage?: string }) =>
              row.stage ?? ""
          )
          .filter(Boolean);

      await loadActiveOrderCount(
        allowedStages
      );
    }



    setLoading(false);

  }



  useEffect(() => {

    loadStaff();

  }, []);



  // =====================================================

  // SIGN IN

  // =====================================================



  async function handleSignIn(

    event:

      FormEvent<HTMLFormElement>

  ) {

    event.preventDefault();



    setMessage(

      "กำลังเข้าสู่ระบบ..."

    );



    const {

      error,

    } =

      await supabase.auth.signInWithPassword(

        {

          email,

          password,

        }

      );



    if (error) {

      setMessage(

        error.message

      );



      return;

    }



    await loadStaff();

  }



  // =====================================================

  // SIGN OUT

  // =====================================================



  async function handleSignOut() {

    await supabase.auth.signOut();



    window.location.assign(

      "/miniapp?portal=access"

    );

  }



  // =====================================================

  // LOADING

  // =====================================================



  if (loading) {

    return (

      <main className="min-h-screen bg-gray-100 flex items-center justify-center">

        <p className="text-xl">

          กำลังโหลด B2B OMS...

        </p>

      </main>

    );

  }



  // =====================================================

  // LOGIN

  // =====================================================



  if (!staff) {

    return (

      <main className="min-h-screen bg-gray-100 flex items-center justify-center p-6">



        <div className="w-full max-w-md bg-white rounded-2xl shadow p-8">



          <h1 className="text-3xl font-bold mb-2">

            B2B OMS

          </h1>



          <p className="text-gray-500 mb-8">

            เข้าสู่ระบบสำหรับพนักงานและผู้จัดการ

          </p>



          <form

            onSubmit={

              handleSignIn

            }

            className="space-y-5"

          >



            <div>



              <label className="block mb-2 font-medium">

                อีเมล

              </label>



              <input

                type="email"

                value={

                  email

                }

                onChange={(

                  event

                ) =>

                  setEmail(

                    event.target

                      .value

                  )

                }

                className="w-full border rounded-lg px-4 py-3"

                required

              />



            </div>



            <div>



              <label className="block mb-2 font-medium">

                รหัสผ่าน

              </label>



              <input

                type="password"

                value={

                  password

                }

                onChange={(

                  event

                ) =>

                  setPassword(

                    event.target

                      .value

                  )

                }

                className="w-full border rounded-lg px-4 py-3"

                required

              />



            </div>



            <button

              type="submit"

              className="w-full bg-black text-white rounded-lg py-3 font-semibold"

            >

              เข้าสู่ระบบ

            </button>



          </form>



          {message && (

            <p className="mt-5 text-sm text-red-600">

              {message}

            </p>

          )}



        </div>



      </main>

    );

  }



  // =====================================================

  // NAVIGATION

  // =====================================================



  const managerNavigation:

    NavigationItem[] =

    [

      {

        name:

          "งาน",



        href:

          "/tasks",



        description:

          "คิวงานปฏิบัติการ",

      },



      {

        name:

          "คำสั่งซื้อ",



        href:

          "/orders",



        description:

          "ดูคำสั่งซื้อ B2B ทั้งหมด",

      },



      {

        name:

          "ศูนย์ควบคุม",



        href:

          "/control-tower",



        description:

          "ติดตามภาพรวมการปฏิบัติงานวันนี้",

      },



      {

        name:

          "KPI",



        href:

          "/kpi",



        description:

          "Operational performance",

      },



      {

        name:

          "ลูกค้า",



        href:

          "/customers",



        description:

          "จัดการข้อมูลลูกค้า B2B",

      },



      {

        name:

          "พนักงาน",



        href:

          "/staff",



        description:

          "สร้าง แก้ไข และปิดใช้งานบัญชีพนักงาน",

      },



      {

        name:

          "สิทธิ์ LINE",



        href:

          "/line-access",



        description:

          "จัดการสิทธิ์ LINE ของลูกค้าและพนักงาน",

      },



      {

        name:

          "ข้อมูลสินค้าและราคา",



        href:

          "/catalog",



        description:

          "นำเข้า Product Master ราคาปกติ ราคาพิเศษ รูปสินค้า และรายการ SKU ที่แสดงให้ลูกค้า",

      },

    ];



  const staffNavigation:

    NavigationItem[] =

    [

      {

        name:

          "งาน",

        href:

          "/tasks",

        description:

          "คิวงานปฏิบัติการตามสิทธิ์ที่ได้รับ",

      },

      {

        name:

          "คำสั่งซื้อ",

        href:

          "/orders",

        description:

          "ดูคำสั่งซื้อ B2B",

      },

    ];



  const navigation =

    staff.account_type ===

    "manager"

      ? managerNavigation

      : staffNavigation;



  // =====================================================

  // HOME

  // =====================================================



  return (

    <main className="min-h-screen bg-gray-100 p-4 md:p-8">



      <div className="max-w-6xl mx-auto">



        {/* HEADER */}



        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4 mb-10">



          <div>



            <h1 className="text-3xl font-bold">

              สวัสดี{" "}

              {

                staff.staff_name

              }{" "}

              👋

            </h1>



            <p className="text-gray-500 mt-2">



              {

                staff.staff_code

              }



              {" · "}



              {staff.account_type ===

              "manager"

                ? "Manager"

                : "Staff"}



            </p>



          </div>



          <button

            onClick={

              handleSignOut

            }

            className="bg-white border rounded-lg px-4 py-2"

          >

            ออกจากระบบ

          </button>



        </div>



        <h2 className="text-xl font-semibold mb-5">

          B2B OMS

        </h2>



        {/* NAVIGATION */}



        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">



          {navigation.map(

            (item) => {



              // =========================================

              // TASK CARD

              // =========================================



              if (

                item.href ===

                "/tasks"

              ) {

                return (

                  <Link

                    key={

                      item.href

                    }

                    href={

                      item.href

                    }

                    className="bg-white border rounded-xl p-7 hover:shadow transition"

                  >



                    <div className="flex justify-between items-start gap-4">



                      <div>



                        <p className="font-semibold text-lg">

                          งาน

                        </p>



                        <p className="text-sm text-gray-500 mt-2">



                          {activeOrderCount ===

                          0

                            ? "ไม่มีคำสั่งซื้อที่กำลังดำเนินการ"

                            : `${activeOrderCount} คำสั่งซื้อที่กำลังดำเนินการ`}



                        </p>



                      </div>



                      <div className="min-w-12 h-12 px-3 bg-black text-white rounded-full flex items-center justify-center font-bold text-lg">

                        {

                          activeOrderCount

                        }

                      </div>



                    </div>



                    <p className="text-sm font-medium mt-6">

                      ดูคิวงาน →

                    </p>



                  </Link>

                );

              }



              // =========================================

              // NORMAL CARD

              // =========================================



              return (

                <Link

                  key={

                    item.href

                  }

                  href={

                    item.href

                  }

                  className="bg-white border rounded-xl p-7 hover:shadow transition min-h-40"

                >



                  <p className="font-semibold text-lg">

                    {

                      item.name

                    }

                  </p>



                  {item.description && (

                    <p className="text-sm text-gray-500 mt-2">

                      {

                        item.description

                      }

                    </p>

                  )}



                </Link>

              );

            }

          )}



        </div>



        {/* CONNECTION */}



        <div className="bg-white border rounded-xl p-6 mt-8">



          <p className="font-semibold">

            เชื่อมต่อระบบ OMS สำเร็จ

          </p>



          <p className="text-gray-500 mt-2">

            บัญชีของคุณเชื่อมต่อกับฐานข้อมูลพนักงานของ OMS แล้ว

          </p>



        </div>



      </div>



    </main>

  );

}
