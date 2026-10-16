"use client";



import {

  useEffect,

  useMemo,

  useState,

} from "react";



import Link from "next/link";



import {

  supabase,

} from "../../lib/supabase";



type StaffAccess = {

  staffCode: string;

  staffName: string;

  accountType: string;

  isAuthorized: boolean;

};



type LineUser = {

  lineUserRowId: string;

  lineUserId: string;

  displayName:

    | string

    | null;



  internalName:

    | string

    | null;



  isActive: boolean;

  createdAt: string;



  customerCodes:

    string[];



  staff:

    | StaffAccess

    | null;

};



type CustomerOption = {

  customerCode: string;

  customerName: string;

  isActive: boolean;

};



type StaffOption = {

  staffCode: string;

  staffName: string;

  accountType: string;

  isActive: boolean;

};



type AccessData = {

  line_users?: LineUser[];

  customers?: CustomerOption[];

  staff?: StaffOption[];

};



export default function LineAccessPage() {

  const [

    lineUsers,

    setLineUsers,

  ] =

    useState<LineUser[]>(

      []

    );



  const [

    customers,

    setCustomers,

  ] =

    useState<

      CustomerOption[]

    >([]);



  const [

    staffOptions,

    setStaffOptions,

  ] =

    useState<

      StaffOption[]

    >([]);



  const [

    loading,

    setLoading,

  ] =

    useState(true);



  const [

    working,

    setWorking,

  ] =

    useState("");



  const [

    message,

    setMessage,

  ] =

    useState("");



  const [

    search,

    setSearch,

  ] =

    useState("");



  // Each LINE user gets its own

  // customer/staff selector.



  const [

    customerSelections,

    setCustomerSelections,

  ] =

    useState<

      Record<string, string>

    >({});



  const [

    staffSelections,

    setStaffSelections,

  ] =

    useState<

      Record<string, string>

    >({});



  const [

    nameSelections,

    setNameSelections,

  ] =

    useState<

      Record<string, string>

    >({});



  // =====================================================

  // LOAD

  // =====================================================



  async function loadData() {

    setLoading(

      true

    );



    setMessage(

      ""

    );



    const {

      data,

      error,

    } =

      await supabase.rpc(

        "get_line_access_admin"

      );



    if (error) {

      setMessage(

        error.message

      );



      setLoading(

        false

      );



      return;

    }



    const result =

      (data ??

        {}) as AccessData;



    const {

      data: nameData,

      error: nameError,

    } =

      await supabase.rpc(

        "get_line_user_internal_names"

      );



    if (nameError) {

      setMessage(

        nameError.message

      );



      setLoading(

        false

      );



      return;

    }



    const internalNameMap =

      new Map<string, string | null>(

        ((nameData ?? []) as {

          lineUserRowId: string;

          internalName: string | null;

        }[]).map(

          (item) => [

            item.lineUserRowId,

            item.internalName,

          ]

        )

      );



    const loadedLineUsers =

      (result.line_users ?? []).map(

        (user) => ({

          ...user,

          internalName:

            internalNameMap.get(

              user.lineUserRowId

            ) ?? null,

        })

      );



    setLineUsers(

      loadedLineUsers

    );



    setNameSelections(

      Object.fromEntries(

        loadedLineUsers.map(

          (user) => [

            user.lineUserRowId,

            user.internalName ?? "",

          ]

        )

      )

    );



    setCustomers(

      result.customers ??

        []

    );



    setStaffOptions(

      result.staff ??

        []

    );



    setLoading(

      false

    );

  }



  useEffect(() => {

    loadData();

  }, []);



  // =====================================================

  // OMS PERSON NAME

  // =====================================================



  async function saveInternalName(

    user: LineUser

  ) {

    const value =

      nameSelections[

        user.lineUserRowId

      ] ?? "";



    setWorking(

      `name-${user.lineUserRowId}`

    );



    setMessage(

      ""

    );



    const {

      error,

    } =

      await supabase.rpc(

        "set_line_user_internal_name",

        {

          p_line_user_row_id:

            user.lineUserRowId,

          p_internal_name:

            value.trim() || null,

        }

      );



    if (error) {

      setMessage(

        error.message

      );



      setWorking(

        ""

      );



      return;

    }



    await loadData();



    setWorking(

      ""

    );

  }



  // =====================================================

  // CUSTOMER ACCESS

  // =====================================================



  async function addCustomer(

    user: LineUser

  ) {

    const customerCode =

      customerSelections[

        user.lineUserRowId

      ];



    if (!customerCode) {

      setMessage(

        "กรุณาเลือกลูกค้าก่อน"

      );



      return;

    }



    setWorking(

      `customer-${user.lineUserRowId}`

    );



    setMessage(

      ""

    );



    const {

      error,

    } =

      await supabase.rpc(

        "set_line_customer_access",

        {

          p_line_user_row_id:

            user.lineUserRowId,



          p_customer_code:

            customerCode,



          p_enabled:

            true,

        }

      );



    if (error) {

      setMessage(

        error.message

      );



      setWorking(

        ""

      );



      return;

    }



    setCustomerSelections(

      (previous) => ({

        ...previous,



        [user.lineUserRowId]:

          "",

      })

    );



    await loadData();



    setWorking(

      ""

    );

  }



  async function removeCustomer(

    user: LineUser,

    customerCode: string

  ) {

    const confirmed =

      window.confirm(

        `ยกเลิกสิทธิ์ลูกค้า ${customerCode} จาก ${user.displayName ?? "ผู้ใช้ LINE นี้"} หรือไม่?`

      );



    if (!confirmed) {

      return;

    }



    setWorking(

      `customer-${user.lineUserRowId}`

    );



    setMessage(

      ""

    );



    const {

      error,

    } =

      await supabase.rpc(

        "set_line_customer_access",

        {

          p_line_user_row_id:

            user.lineUserRowId,



          p_customer_code:

            customerCode,



          p_enabled:

            false,

        }

      );



    if (error) {

      setMessage(

        error.message

      );



      setWorking(

        ""

      );



      return;

    }



    await loadData();



    setWorking(

      ""

    );

  }



  // =====================================================

  // STAFF ACCESS

  // =====================================================



  async function addStaff(

    user: LineUser

  ) {

    const staffCode =

      staffSelections[

        user.lineUserRowId

      ];



    if (!staffCode) {

      setMessage(

        "กรุณาเลือกบัญชีพนักงานก่อน"

      );



      return;

    }



    if (

      user.staff

        ?.isAuthorized

    ) {

      const confirmed =

        window.confirm(

          `${user.displayName ?? "ผู้ใช้ LINE นี้"} เชื่อมกับ ${user.staff.staffCode} อยู่แล้ว ต้องการเปลี่ยนเป็น ${staffCode} หรือไม่?`

        );



      if (!confirmed) {

        return;

      }

    }



    setWorking(

      `staff-${user.lineUserRowId}`

    );



    setMessage(

      ""

    );



    const {

      error,

    } =

      await supabase.rpc(

        "set_line_staff_access",

        {

          p_line_user_row_id:

            user.lineUserRowId,



          p_staff_code:

            staffCode,



          p_enabled:

            true,

        }

      );



    if (error) {

      setMessage(

        error.message

      );



      setWorking(

        ""

      );



      return;

    }



    setStaffSelections(

      (previous) => ({

        ...previous,



        [user.lineUserRowId]:

          "",

      })

    );



    await loadData();



    setWorking(

      ""

    );

  }



  async function revokeStaff(

    user: LineUser

  ) {

    if (

      !user.staff

    ) {

      return;

    }



    const confirmed =

      window.confirm(

        `ยกเลิกสิทธิ์พนักงานของ ${user.displayName ?? user.lineUserId} หรือไม่?`

      );



    if (!confirmed) {

      return;

    }



    setWorking(

      `staff-${user.lineUserRowId}`

    );



    setMessage(

      ""

    );



    const {

      error,

    } =

      await supabase.rpc(

        "set_line_staff_access",

        {

          p_line_user_row_id:

            user.lineUserRowId,



          p_staff_code:

            user.staff.staffCode,



          p_enabled:

            false,

        }

      );



    if (error) {

      setMessage(

        error.message

      );



      setWorking(

        ""

      );



      return;

    }



    await loadData();



    setWorking(

      ""

    );

  }



  // =====================================================

  // FILTER

  // =====================================================



  const filteredUsers =

    useMemo(() => {

      const term =

        search

          .trim()

          .toLowerCase();



      if (!term) {

        return lineUsers;

      }



      return lineUsers.filter(

        (user) => {

          const customerText =

            user.customerCodes

              .join(" ")

              .toLowerCase();



          const staffText =

            user.staff

              ? `${user.staff.staffCode} ${user.staff.staffName}`

                  .toLowerCase()

              : "";



          return (

            (

              user.internalName ??

              ""

            )

              .toLowerCase()

              .includes(

                term

              ) ||

            (

              user.displayName ??

              ""

            )

              .toLowerCase()

              .includes(

                term

              ) ||

            user.lineUserId

              .toLowerCase()

              .includes(

                term

              ) ||

            customerText.includes(

              term

            ) ||

            staffText.includes(

              term

            )

          );

        }

      );

    }, [

      lineUsers,

      search,

    ]);



  // =====================================================

  // LOADING

  // =====================================================



  if (loading) {

    return (

      <main className="min-h-screen bg-gray-100 p-8">



        กำลังโหลดสิทธิ์ LINE...



      </main>

    );

  }



  // =====================================================

  // PAGE

  // =====================================================



  return (

    <main className="min-h-screen bg-gray-100 p-6 md:p-8">



      <div className="max-w-6xl mx-auto">



        {/* HEADER */}



        <div className="flex flex-wrap justify-between items-start gap-4 mb-8">



          <div>



            <Link

              href="/"

              className="text-sm text-gray-500"

            >

              ← กลับไป OMS

            </Link>



            <h1 className="text-3xl font-bold mt-3">

              จัดการสิทธิ์ LINE

            </h1>



            <p className="text-gray-500 mt-2">

              จัดการสิทธิ์ลูกค้าและพนักงานสำหรับผู้ใช้ LINE ที่ลงทะเบียนแล้ว

            </p>



          </div>



          <button

            type="button"

            onClick={

              loadData

            }

            className="bg-white border rounded-lg px-4 py-2"

          >

            รีเฟรช

          </button>



        </div>



        {/* MESSAGE */}



        {message && (



          <div className="bg-white border rounded-xl p-4 mb-6">



            {

              message

            }



          </div>



        )}



        {/* SEARCH */}



        <div className="bg-white border rounded-xl p-5 mb-6">



          <label className="block font-semibold mb-2">

            ค้นหาผู้ใช้ LINE

          </label>



          <input

            value={

              search

            }

            onChange={(event) =>

              setSearch(

                event.target.value

              )

            }

            placeholder="ชื่อบุคคล ชื่อ LINE, LINE ID, รหัสลูกค้า หรือรหัสพนักงาน..."

            className="w-full border rounded-lg px-4 py-3"

          />



        </div>



        {/* SUMMARY */}



        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">



          <div className="bg-white border rounded-xl p-5">



            <p className="text-sm text-gray-500">

              ผู้ใช้ LINE ที่ลงทะเบียน

            </p>



            <p className="text-3xl font-bold mt-1">

              {

                lineUsers.length

              }

            </p>



          </div>



          <div className="bg-white border rounded-xl p-5">



            <p className="text-sm text-gray-500">

              มีสิทธิ์ลูกค้า

            </p>



            <p className="text-3xl font-bold mt-1">



              {

                lineUsers.filter(

                  (user) =>

                    user

                      .customerCodes

                      .length >

                    0

                ).length

              }



            </p>



          </div>



          <div className="bg-white border rounded-xl p-5">



            <p className="text-sm text-gray-500">

              มีสิทธิ์พนักงาน

            </p>



            <p className="text-3xl font-bold mt-1">



              {

                lineUsers.filter(

                  (user) =>

                    user.staff

                      ?.isAuthorized

                ).length

              }



            </p>



          </div>



        </div>



        {/* USERS */}



        <div className="space-y-5">



          {filteredUsers.length ===

          0 ? (



            <div className="bg-white border rounded-xl p-8 text-center text-gray-500">



              ไม่พบผู้ใช้ LINE



            </div>



          ) : (



            filteredUsers.map(

              (user) => {



                const customerBusy =

                  working ===

                  `customer-${user.lineUserRowId}`;



                const staffBusy =

                  working ===

                  `staff-${user.lineUserRowId}`;



                const nameBusy =

                  working ===

                  `name-${user.lineUserRowId}`;



                return (

                  <section

                    key={

                      user.lineUserRowId

                    }

                    className="bg-white border rounded-2xl overflow-hidden"

                  >



                    {/* IDENTITY */}



                    <div className="p-5 border-b">



                      <div className="flex flex-wrap justify-between gap-4">



                        <div className="flex-1 min-w-[260px]">



                          <h2 className="text-xl font-bold">

                            {

                              user.internalName ??

                              user.displayName ??

                              "ผู้ใช้ LINE ที่ไม่มีชื่อ"

                            }

                          </h2>



                          {user.internalName && (

                            <p className="text-sm text-gray-500 mt-1">

                              ชื่อ LINE: {user.displayName ?? "—"}

                            </p>

                          )}



                          <p className="text-sm text-gray-500 mt-1 break-all">

                            {

                              user.lineUserId

                            }

                          </p>



                          <div className="mt-4 max-w-xl">

                            <label className="block text-sm font-semibold mb-2">

                              ชื่อบุคคลใน OMS

                            </label>



                            <div className="flex flex-col sm:flex-row gap-2">

                              <input

                                value={

                                  nameSelections[

                                    user.lineUserRowId

                                  ] ?? ""

                                }

                                onChange={(event) =>

                                  setNameSelections(

                                    (previous) => ({

                                      ...previous,

                                      [user.lineUserRowId]:

                                        event.target.value,

                                    })

                                  )

                                }

                                placeholder="เช่น สมชาย ใจดี / คุณแอน"

                                className="flex-1 border rounded-lg px-3 py-2.5"

                              />



                              <button

                                type="button"

                                onClick={() =>

                                  saveInternalName(

                                    user

                                  )

                                }

                                disabled={

                                  nameBusy

                                }

                                className="bg-black text-white rounded-lg px-4 py-2.5 font-semibold disabled:opacity-40"

                              >

                                {nameBusy

                                  ? "กำลังบันทึก..."

                                  : "บันทึกชื่อ"}

                              </button>

                            </div>



                            <p className="text-xs text-gray-500 mt-2">

                              ชื่อนี้ใช้ภายใน OMS เท่านั้น และไม่เปลี่ยนชื่อที่ผู้ใช้ตั้งไว้ใน LINE

                            </p>

                          </div>



                        </div>



                        <div>



                          {user.isActive ? (

                            <span className="inline-block bg-gray-100 rounded-full px-3 py-1 text-sm font-medium">

                              บัญชี LINE ใช้งานอยู่

                            </span>

                          ) : (

                            <span className="inline-block border rounded-full px-3 py-1 text-sm">

                              ไม่ใช้งาน

                            </span>

                          )}



                        </div>



                      </div>



                    </div>



                    <div className="grid grid-cols-1 lg:grid-cols-2">



                      {/* ================================= */}

                      {/* CUSTOMER ACCESS */}

                      {/* ================================= */}



                      <div className="p-5 lg:border-r border-b lg:border-b-0">



                        <h3 className="font-bold text-lg">

                          สิทธิ์ลูกค้า

                        </h3>



                        <p className="text-sm text-gray-500 mt-1">

                          LINE หนึ่งบัญชีสามารถเข้าถึงลูกค้าได้หลายบัญชี

                        </p>



                        <div className="mt-5 space-y-2">



                          {user.customerCodes.length ===

                          0 ? (



                            <p className="text-sm text-gray-400">

                              ไม่มีสิทธิ์ลูกค้า

                            </p>



                          ) : (



                            user.customerCodes.map(

                              (

                                customerCode

                              ) => {



                                const customer =

                                  customers.find(

                                    (item) =>

                                      item.customerCode ===

                                      customerCode

                                  );



                                return (

                                  <div

                                    key={

                                      customerCode

                                    }

                                    className="border rounded-lg p-3 flex justify-between items-center gap-3"

                                  >



                                    <div>



                                      <p className="font-semibold">

                                        {

                                          customerCode

                                        }

                                      </p>



                                      <p className="text-sm text-gray-500">

                                        {

                                          customer

                                            ?.customerName ??

                                          ""

                                        }

                                      </p>



                                    </div>



                                    <button

                                      type="button"

                                      disabled={

                                        customerBusy

                                      }

                                      onClick={() =>

                                        removeCustomer(

                                          user,

                                          customerCode

                                        )

                                      }

                                      className="text-sm border rounded-lg px-3 py-2 disabled:opacity-40"

                                    >

                                      ลบ

                                    </button>



                                  </div>

                                );

                              }

                            )



                          )}



                        </div>



                        <div className="flex flex-col sm:flex-row gap-2 mt-5">



                          <select

                            value={

                              customerSelections[

                                user.lineUserRowId

                              ] ??

                              ""

                            }

                            onChange={(event) =>

                              setCustomerSelections(

                                (

                                  previous

                                ) => ({

                                  ...previous,



                                  [user.lineUserRowId]:

                                    event

                                      .target

                                      .value,

                                })

                              )

                            }

                            className="flex-1 border rounded-lg px-3 py-3"

                          >



                            <option value="">

                              เลือกลูกค้า

                            </option>



                            {customers

                              .filter(

                                (

                                  customer

                                ) =>

                                  customer.isActive &&

                                  !user.customerCodes.includes(

                                    customer.customerCode

                                  )

                              )

                              .map(

                                (

                                  customer

                                ) => (



                                <option

                                  key={

                                    customer.customerCode

                                  }

                                  value={

                                    customer.customerCode

                                  }

                                >

                                  {

                                    customer.customerCode

                                  }

                                  {" — "}

                                  {

                                    customer.customerName

                                  }

                                </option>



                              ))}



                          </select>



                          <button

                            type="button"

                            disabled={

                              customerBusy

                            }

                            onClick={() =>

                              addCustomer(

                                user

                              )

                            }

                            className="bg-black text-white rounded-lg px-5 py-3 font-semibold disabled:opacity-40"

                          >

                            {customerBusy

                              ? "กำลังบันทึก..."

                              : "เพิ่ม"}

                          </button>



                        </div>



                      </div>



                      {/* ================================= */}

                      {/* STAFF ACCESS */}

                      {/* ================================= */}



                      <div className="p-5">



                        <h3 className="font-bold text-lg">

                          สิทธิ์พนักงาน

                        </h3>



                        <p className="text-sm text-gray-500 mt-1">

                          LINE หนึ่งบัญชีสามารถเชื่อมกับบัญชีพนักงานได้หนึ่งบัญชี

                        </p>



                        <div className="mt-5">



                          {user.staff &&

                          user.staff

                            .isAuthorized ? (



                            <div className="border rounded-xl p-4">



                              <p className="font-bold">

                                {

                                  user.staff.staffCode

                                }

                                {" — "}

                                {

                                  user.staff.staffName

                                }

                              </p>



                              <p className="text-sm text-gray-500 mt-1">

                                {

                                  user.staff.accountType

                                }

                              </p>



                              <button

                                type="button"

                                disabled={

                                  staffBusy

                                }

                                onClick={() =>

                                  revokeStaff(

                                    user

                                  )

                                }

                                className="border rounded-lg px-4 py-2 text-sm mt-4 disabled:opacity-40"

                              >

                                ยกเลิกสิทธิ์พนักงาน

                              </button>



                            </div>



                          ) : (



                            <p className="text-sm text-gray-400">

                              ไม่มีสิทธิ์พนักงานที่ใช้งานอยู่

                            </p>



                          )}



                        </div>



                        <div className="flex flex-col sm:flex-row gap-2 mt-5">



                          <select

                            value={

                              staffSelections[

                                user.lineUserRowId

                              ] ??

                              ""

                            }

                            onChange={(event) =>

                              setStaffSelections(

                                (

                                  previous

                                ) => ({

                                  ...previous,



                                  [user.lineUserRowId]:

                                    event

                                      .target

                                      .value,

                                })

                              )

                            }

                            className="flex-1 border rounded-lg px-3 py-3"

                          >



                            <option value="">

                              เลือกพนักงาน

                            </option>



                            {staffOptions

                              .filter(

                                (

                                  staff

                                ) =>

                                  staff.isActive

                              )

                              .map(

                                (

                                  staff

                                ) => (



                                <option

                                  key={

                                    staff.staffCode

                                  }

                                  value={

                                    staff.staffCode

                                  }

                                >

                                  {

                                    staff.staffCode

                                  }

                                  {" — "}

                                  {

                                    staff.staffName

                                  }

                                  {" · "}

                                  {

                                    staff.accountType

                                  }

                                </option>



                              ))}



                          </select>



                          <button

                            type="button"

                            disabled={

                              staffBusy

                            }

                            onClick={() =>

                              addStaff(

                                user

                              )

                            }

                            className="bg-black text-white rounded-lg px-5 py-3 font-semibold disabled:opacity-40"

                          >

                            {staffBusy

                              ? "กำลังบันทึก..."

                              : user.staff

                                  ?.isAuthorized

                              ? "เปลี่ยน"

                              : "อนุญาต"}

                          </button>



                        </div>



                      </div>



                    </div>



                  </section>

                );

              }

            )



          )}



        </div>



      </div>



    </main>

  );

}