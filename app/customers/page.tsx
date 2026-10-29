"use client";



import { useEffect, useMemo, useState } from "react";

import Link from "next/link";

import { supabase } from "../../lib/supabase";



type Customer = {

  id: string;

  customer_code: string;
  has_no_cv: boolean;

  customer_name: string;

  customer_type: string | null;

  contact_name: string | null;

  phone: string | null;

  delivery_address: string | null;

  is_active: boolean;

};



export default function CustomersPage() {

  const [customers, setCustomers] =

    useState<Customer[]>([]);



  const [loading, setLoading] =

    useState(true);



  const [message, setMessage] =

    useState("");



  const [search, setSearch] =

    useState("");



  const [statusFilter, setStatusFilter] =

    useState("all");



  async function loadCustomers() {

    setLoading(true);

    setMessage("");



    const { data, error } =

      await supabase

        .from("customers")

        .select(`

          id,

          customer_code,
          has_no_cv,

          customer_name,

          customer_type,

          contact_name,

          phone,

          delivery_address,

          is_active

        `)

        .order("customer_name", {

          ascending: true,

        });



    if (error) {

      console.error(error);



      setMessage(

        "ไม่สามารถโหลดลูกค้าได้: " +

          error.message

      );



      setLoading(false);

      return;

    }



    setCustomers(

      (data ?? []) as Customer[]

    );



    setLoading(false);

  }



  useEffect(() => {

    loadCustomers();

  }, []);



  const filteredCustomers =

    useMemo(() => {

      const searchText =

        search.trim().toLowerCase();



      return customers.filter(

        (customer) => {

          const matchesStatus =

  statusFilter === "all" ||

  (statusFilter === "active"

    ? customer.is_active

    : !customer.is_active);



          const matchesSearch =

            searchText === "" ||

            customer.customer_name

              .toLowerCase()

              .includes(searchText) ||

            customer.customer_code

              .toLowerCase()

              .includes(searchText) ||

            customer.phone

              ?.toLowerCase()

              .includes(searchText) ||

            customer.contact_name

              ?.toLowerCase()

              .includes(searchText);



          return (

            matchesStatus &&

            matchesSearch

          );

        }

      );

    }, [

      customers,

      search,

      statusFilter,

    ]);



  const activeCount =

  customers.filter(

    (customer) => customer.is_active

  ).length;



const inactiveCount =

  customers.filter(

    (customer) => !customer.is_active

  ).length;



  if (loading) {

    return (

      <main className="min-h-screen bg-gray-100 p-8">

        กำลังโหลดลูกค้า...

      </main>

    );

  }



  return (

    <main className="min-h-screen bg-gray-100 p-8">

      <div className="max-w-7xl mx-auto">



        <div className="flex justify-between items-start mb-8">



          <div>

            <Link

              href="/login"

              className="text-gray-500"

            >

              ← กลับ

            </Link>



            <p className="oms-page-kicker">CUSTOMERS / ACCOUNT MANAGEMENT</p>
<h1 className="text-3xl font-bold mt-3">ลูกค้า</h1>



            <p className="text-gray-500 mt-1">

              จัดการบัญชีลูกค้า B2B

            </p>

          </div>



          <div className="flex flex-wrap gap-3">



            <button

              onClick={loadCustomers}

              className="bg-white border rounded-lg px-5 py-2"

            >

              รีเฟรช

            </button>



            <Link

              href="/customers/new"

              className="bg-black text-white rounded-lg px-5 py-2 font-semibold"

            >

              + สร้างลูกค้า

            </Link>



          </div>



        </div>



        <div className="oms-customer-stats grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4 mb-8">



          <div className="bg-white border rounded-2xl p-5">

            <p className="text-sm text-gray-500">

              ลูกค้าทั้งหมด

            </p>



            <p className="text-3xl font-bold mt-2">

              {customers.length}

            </p>

          </div>



          <div className="bg-white border rounded-2xl p-5">

            <p className="text-sm text-gray-500">

              ใช้งานอยู่

            </p>



            <p className="text-3xl font-bold mt-2">

              {activeCount}

            </p>

          </div>



          <div className="bg-white border rounded-2xl p-5">

            <p className="text-sm text-gray-500">

              ไม่ใช้งาน

            </p>



            <p className="text-3xl font-bold mt-2">

              {inactiveCount}

            </p>

          </div>



        </div>



        <section className="bg-white border rounded-2xl p-5 mb-6">



          <div className="grid md:grid-cols-2 gap-4">



            <div>

              <label className="block text-sm font-medium mb-2">

                ค้นหา

              </label>



              <input

                type="text"

                value={search}

                onChange={(event) =>

                  setSearch(

                    event.target.value

                  )

                }

                placeholder="ชื่อลูกค้า รหัสลูกค้า ผู้ติดต่อ หรือเบอร์โทร"

                className="w-full border rounded-lg px-4 py-3"

              />

            </div>



            <div>

              <label className="block text-sm font-medium mb-2">

                สถานะ

              </label>



              <select

                value={statusFilter}

                onChange={(event) =>

                  setStatusFilter(

                    event.target.value

                  )

                }

                className="w-full border rounded-lg px-4 py-3 bg-white"

              >

                <option value="all">

                  ลูกค้าทั้งหมด

                </option>



                <option value="active">

                  ใช้งานอยู่

                </option>



                <option value="inactive">

                  ไม่ใช้งาน

                </option>

              </select>

            </div>



          </div>



        </section>



        {message && (

          <div className="bg-white border rounded-lg p-4 mb-6 text-red-600">

            {message}

          </div>

        )}



        <section className="bg-white border rounded-2xl overflow-hidden">



          <div className="p-5 border-b flex justify-between">



            <h2 className="font-bold text-lg">

              รายชื่อลูกค้า

            </h2>



            <span className="text-gray-500 text-sm">

              {filteredCustomers.length} ราย

            </span>



          </div>



          {filteredCustomers.length === 0 ? (

            <div className="p-8 text-gray-500">

              ไม่พบลูกค้า

            </div>

          ) : (

            <div className="w-full">
              <table className="w-full table-fixed">
                <thead className="bg-[#F4FAF8] text-[#315C54]">
                  <tr>
                    <th scope="col" className="w-[44%] px-3 py-3 text-left text-sm font-semibold sm:px-4">
                      ลูกค้า / รหัสลูกค้า
                    </th>
                    <th scope="col" className="w-[38%] px-2 py-3 text-left text-sm font-semibold sm:px-4">
                      ผู้ติดต่อ / เบอร์โทร
                    </th>
                    <th scope="col" className="w-[18%] px-2 py-3 text-right text-sm font-semibold sm:px-4">
                      ดู
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCustomers.map((customer) => (
                    <tr key={customer.id} className="border-t border-[#E6EFEB]">
                      <td className="px-3 py-3 align-top sm:px-4">
                        <p className="line-clamp-2 break-words text-sm font-semibold text-[#194840] sm:text-base" title={customer.customer_name}>
                          {customer.customer_name}
                        </p>
                        <p className="mt-1 break-all text-xs text-gray-500 sm:text-sm">
                          {customer.has_no_cv ? "No CV" : customer.customer_code}
                        </p>
                      </td>
                      <td className="px-2 py-3 align-top sm:px-4">
                        <p className="line-clamp-2 break-words text-sm text-gray-800 sm:text-base">
                          {customer.contact_name || "—"}
                        </p>
                        <p className="mt-1 break-all text-xs text-gray-500 sm:text-sm">
                          {customer.phone || "—"}
                        </p>
                      </td>
                      <td className="px-2 py-3 text-right align-top sm:px-4">
                        <Link
                          href={`/customers/${customer.customer_code}`}
                          className="inline-flex min-h-10 items-center justify-center whitespace-nowrap rounded-lg border border-[#B6DDD4] bg-[#EAF8F5] px-2.5 py-2 text-sm font-semibold text-[#007F79] hover:bg-[#DDF2EC] sm:px-4"
                          aria-label={`ดูข้อมูลลูกค้า ${customer.customer_name}`}
                        >
                          ดู
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

          )}



        </section>



      </div>

    </main>

  );

}