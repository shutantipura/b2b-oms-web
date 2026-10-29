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

  allCustomersAccess: boolean;



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



type AccessFilter = "all" | "staff" | "customer" | "unlinked";

type AccessData = {

  line_users?: LineUser[];

  customers?: CustomerOption[];

  staff?: StaffOption[];

};

// No-CV customers use NCV-* keys internally to preserve unique relationships.
// Never expose those generated keys as customer/CV numbers in the UI.
function displayCustomerCode(code: string): string {
  return /^NCV-/i.test(code) ? "No CV" : code;
}

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



  const [

    statusFilter,

    setStatusFilter,

  ] =

    useState<

      "active" |

      "removed" |

      "all"

    >("active");



  const [accountFilter, setAccountFilter] = useState<AccessFilter>("all");
  const [expandedAccountCards, setExpandedAccountCards] = useState<Record<string, boolean>>({});

  // Customer search belongs to each LINE account, not the global LINE-user filter.
  const [customerSearches, setCustomerSearches] =
    useState<Record<string, string>>({});

  // Customer lists start collapsed; each LINE user can expand independently.
  const [expandedCustomerLists, setExpandedCustomerLists] =
    useState<Record<string, boolean>>({});

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



    setLineUsers((previous) => previous.map((item) =>
      item.lineUserRowId === user.lineUserRowId ? { ...item, internalName: value.trim() || null } : item
    ));



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



    // Update this LINE user locally; do not reload the entire page.
    setLineUsers((previous) => previous.map((item) =>
      item.lineUserRowId === user.lineUserRowId
        ? { ...item, customerCodes: Array.from(new Set([...item.customerCodes, customerCode])).sort() }
        : item
    ));



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

        `ยกเลิกสิทธิ์ลูกค้า ${customers.find((item) => item.customerCode === customerCode)?.customerName ?? displayCustomerCode(customerCode)} (${displayCustomerCode(customerCode)}) จาก ${user.displayName ?? "ผู้ใช้ LINE นี้"} หรือไม่?${user.allCustomersAccess ? "\n\nการยกเลิกเพียงรายเดียวจะปิดโหมดสิทธิ์ลูกค้าทั้งหมดด้วย (สิทธิ์ลูกค้ารายอื่นยังอยู่)" : ""}`

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



    // Update only the affected LINE account, preserving search and scroll.
    setLineUsers((previous) => previous.map((item) =>
      item.lineUserRowId === user.lineUserRowId
        ? { ...item, allCustomersAccess: false, customerCodes: item.customerCodes.filter((code) => code !== customerCode) }
        : item
    ));



    setWorking(

      ""

    );

  }



  // =====================================================
  // BULK CUSTOMER ACCESS (ONE DATABASE TRANSACTION)
  // =====================================================

  async function setAllCustomerAccess(user: LineUser, enabled: boolean) {
    const eligible = customers.filter((customer) => customer.isActive);
    const count = enabled
      ? eligible.filter((customer) => !user.customerCodes.includes(customer.customerCode)).length
      : user.customerCodes.length;

    if ((enabled && user.allCustomersAccess) ||
      (!enabled && !user.allCustomersAccess && count === 0)) {
      setMessage(enabled
        ? "บัญชีนี้เปิดสิทธิ์ลูกค้าทั้งหมดรวมถึงลูกค้าใหม่อยู่แล้ว"
        : "บัญชีนี้ไม่มีสิทธิ์ลูกค้าให้ยกเลิก");
      return;
    }

    const personName = user.internalName ?? user.displayName ?? user.lineUserId;
    const confirmed = window.confirm(
      enabled
        ? `เปิดสิทธิ์เข้าถึงลูกค้าทั้งหมดให้ ${personName} ใช่หรือไม่?\n\nลูกค้าปัจจุบันและลูกค้าที่สร้างใหม่ในอนาคตจะได้รับสิทธิ์อัตโนมัติสำหรับ LINE บัญชีนี้`
        : `ปิดสิทธิ์ลูกค้าทั้งหมดของ ${personName} ใช่หรือไม่?\n\nสิทธิ์ของลูกค้าปัจจุบันจะถูกยกเลิก และลูกค้าใหม่จะไม่ได้รับสิทธิ์อัตโนมัติ (ไม่กระทบสิทธิ์พนักงาน)`
    );
    if (!confirmed) return;

    setWorking(`customer-${user.lineUserRowId}`);
    setMessage("");

    try {
      const { data, error } = await supabase.rpc("set_line_all_customer_access", {
        p_line_user_row_id: user.lineUserRowId,
        p_enabled: enabled,
      });
      if (error) throw error;

      const result = data as { customerCodes?: string[]; changedCount?: number; allCustomersAccess?: boolean } | null;
      if (!result || !Array.isArray(result.customerCodes) ||
        result.allCustomersAccess !== enabled) {
        throw new Error("ไม่สามารถยืนยันรายการสิทธิ์หลังบันทึกได้ กรุณากดรีเฟรชเพื่อตรวจสอบ");
      }

      setLineUsers((previous) => previous.map((item) =>
        item.lineUserRowId === user.lineUserRowId
          ? { ...item, customerCodes: result.customerCodes!, allCustomersAccess: enabled }
          : item
      ));
      setCustomerSelections((previous) => ({ ...previous, [user.lineUserRowId]: "" }));
      setMessage(enabled
        ? `เปิดสิทธิ์ลูกค้าทั้งหมดสำเร็จสำหรับ ${personName} · ลูกค้าใหม่จะได้รับสิทธิ์อัตโนมัติ`
        : `ยกเลิกสิทธิ์ลูกค้าทั้งหมดสำเร็จสำหรับ ${personName}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "ไม่สามารถเปลี่ยนสิทธิ์ลูกค้าทั้งหมดได้");
    } finally {
      setWorking("");
    }
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



    setLineUsers((previous) => previous.map((item) =>
      item.lineUserRowId === user.lineUserRowId
        ? { ...item, staff: { staffCode, staffName: staffOptions.find((staff) => staff.staffCode === staffCode)?.staffName ?? staffCode, accountType: staffOptions.find((staff) => staff.staffCode === staffCode)?.accountType ?? "staff", isAuthorized: true } }
        : item
    ));
    setStaffSelections((previous) => ({ ...previous, [user.lineUserRowId]: "" }));



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



    setLineUsers((previous) => previous.map((item) =>
      item.lineUserRowId === user.lineUserRowId ? { ...item, staff: null } : item
    ));



    setWorking(

      ""

    );

  }



  // =====================================================

  // REMOVE / RESTORE LINE ACCOUNT FROM ACTIVE LIST

  // =====================================================



  async function setLineUserActive(

    user: LineUser,

    nextActive: boolean

  ) {

    if (

      !nextActive &&

      (

        user.customerCodes.length > 0 ||

        user.staff?.isAuthorized

      )

    ) {

      setMessage(

        "กรุณายกเลิกสิทธิ์ลูกค้าและสิทธิ์พนักงานทั้งหมดก่อนนำบัญชี LINE ออกจากรายการ"

      );

      return;

    }



    const personName =

      user.internalName ??

      user.displayName ??

      user.lineUserId;



    const confirmed =

      window.confirm(

        nextActive

          ? `เปิดใช้งานบัญชี LINE ของ ${personName} อีกครั้งหรือไม่?`

          : `นำบัญชี LINE ของ ${personName} ออกจากรายการใช้งานหรือไม่?\n\nบัญชีจะถูกปิดใช้งานและซ่อนจากรายการปกติ แต่ประวัติเดิมจะยังคงอยู่`

      );



    if (!confirmed) {

      return;

    }



    setWorking(

      `status-${user.lineUserRowId}`

    );



    setMessage(

      ""

    );



    const {

      error,

    } =

      await supabase.rpc(

        "set_line_user_active_status",

        {

          p_line_user_row_id:

            user.lineUserRowId,

          p_active:

            nextActive,

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



    setLineUsers((previous) => previous.map((item) =>
      item.lineUserRowId === user.lineUserRowId ? { ...item, isActive: nextActive } : item
    ));



    setWorking(

      ""

    );

  }



  // =====================================================

  // FILTER

  // =====================================================



  const accountCounts = useMemo(() => {
    const visible = lineUsers.filter((user) =>
      statusFilter === "all" ||
      (statusFilter === "active" ? user.isActive : !user.isActive)
    );
    const withStaff = visible.filter((user) => Boolean(user.staff?.isAuthorized)).length;
    const withCustomers = visible.filter(
      (user) => user.allCustomersAccess || user.customerCodes.length > 0
    ).length;
    return {
      all: visible.length,
      staff: withStaff,
      customer: withCustomers,
      unlinked: visible.filter(
        (user) => !user.staff?.isAuthorized &&
          !user.allCustomersAccess && user.customerCodes.length === 0
      ).length,
    };
  }, [lineUsers, statusFilter]);

  const filteredUsers =

    useMemo(() => {

      const term =

        search

          .trim()

          .toLowerCase();



      const customerNameByCode = new Map(
        customers.map((customer) => [customer.customerCode, customer.customerName])
      );
      return lineUsers.filter(

        (user) => {

          if (

            statusFilter === "active" &&

            !user.isActive

          ) {

            return false;

          }



          if (

            statusFilter === "removed" &&

            user.isActive

          ) {

            return false;

          }



          const hasStaff = Boolean(user.staff?.isAuthorized);
          const hasCustomers = user.allCustomersAccess || user.customerCodes.length > 0;
          if (accountFilter === "staff" && !hasStaff) return false;
          if (accountFilter === "customer" && !hasCustomers) return false;
          if (accountFilter === "unlinked" && (hasStaff || hasCustomers)) return false;

          if (!term) {

            return true;

          }



          const customerText =

            user.customerCodes

              .join(" ")

              .toLowerCase();



          const customerNames = user.customerCodes
            .map((code) => customerNameByCode.get(code) ?? "")
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

            customerNames.includes(term) ||
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

      statusFilter,
      accountFilter,
      customers,
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

    <main className="min-h-screen bg-[#F5F9F7] p-3 sm:p-6 md:p-8">



      <div className="max-w-6xl mx-auto">



        {/* HEADER */}



        <div className="flex flex-wrap justify-between items-start gap-4 mb-8">



          <div>



            <Link

              href="/login"

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



        <div className="bg-white border rounded-xl p-4 mb-4">



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

            placeholder="ชื่อบุคคล ชื่อ LINE ชื่อร้าน LINE ID รหัสลูกค้า หรือพนักงาน..."

            className="w-full border rounded-lg px-4 py-3"

          />



          <div className="flex flex-wrap gap-2 mt-4">

            {([

              ["active", "ใช้งานอยู่"],

              ["removed", "นำออกแล้ว"],

              ["all", "ทั้งหมด"],

            ] as const).map(

              ([value, label]) => (

                <button

                  key={value}

                  type="button"

                  onClick={() =>

                    setStatusFilter(

                      value

                    )

                  }

                  className={`rounded-full px-4 py-2 text-sm font-semibold border ${

                    statusFilter === value

                      ? "bg-black text-white border-black"

                      : "bg-white"

                  }`}

                >

                  {label}

                </button>

              )

            )}

          </div>

          <div className="mt-4 border-t border-[#E2EEE9] pt-3">
            <p className="mb-2 text-xs font-extrabold text-[#52786F]">ประเภทบัญชี LINE</p>
            <div className="flex flex-wrap gap-2" role="group" aria-label="กรองตามสิทธิ์ LINE">
              {([
                ["all", "ทุกบัญชี"],
                ["staff", "พนักงาน"],
                ["customer", "ลูกค้า"],
                ["unlinked", "ไม่มีสิทธิ์"],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={accountFilter === value}
                  onClick={() => setAccountFilter(value)}
                  className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-extrabold transition ${accountFilter === value
                    ? "border-[#008F8D] bg-[#02B0AF] text-white"
                    : "border-[#CFDFDA] bg-white text-[#426D62] hover:border-[#02B0AF]"}`}
                >
                  {label}
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${accountFilter === value ? "bg-white/20" : "bg-[#EDF5F2]"}`}>
                    {accountCounts[value]}
                  </span>
                </button>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-[#78918A]">บัญชีที่มีทั้งสิทธิ์พนักงานและลูกค้าจะแสดงในทั้งสองหมวด</p>
          </div>

        </div>



        {/* SUMMARY */}



        <div className="grid grid-cols-3 gap-2 sm:gap-4 mb-4">



          <div className="bg-white border rounded-xl p-3 sm:p-5">



            <p className="text-[11px] leading-tight sm:text-sm text-gray-500">

              บัญชี LINE ที่ใช้งานอยู่

            </p>



            <p className="text-2xl sm:text-3xl font-bold mt-1 text-[#008F8D]">

              {

                lineUsers.filter(

                  (user) =>

                    user.isActive

                ).length

              }

            </p>



          </div>



          <div className="bg-white border rounded-xl p-3 sm:p-5">



            <p className="text-[11px] leading-tight sm:text-sm text-gray-500">

              มีสิทธิ์ลูกค้า

            </p>



            <p className="text-2xl sm:text-3xl font-bold mt-1 text-[#008F8D]">



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



          <div className="bg-white border rounded-xl p-3 sm:p-5">



            <p className="text-[11px] leading-tight sm:text-sm text-gray-500">

              มีสิทธิ์พนักงาน

            </p>



            <p className="text-2xl sm:text-3xl font-bold mt-1 text-[#008F8D]">



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



        <div className="space-y-2.5">



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



                const statusBusy =

                  working ===

                  `status-${user.lineUserRowId}`;



                const canRemove =

                  user.customerCodes.length === 0 &&
                  !user.allCustomersAccess &&
                  !user.staff?.isAuthorized;

                const customerQuery = (customerSearches[user.lineUserRowId] ?? "").trim().toLowerCase();
                const availableCustomers = customers.filter(
                  (customer) => customer.isActive && !user.customerCodes.includes(customer.customerCode)
                );
                const matchingCustomers = availableCustomers.filter(
                  (customer) =>
                    customer.customerCode.toLowerCase().includes(customerQuery) ||
                    displayCustomerCode(customer.customerCode).toLowerCase().includes(customerQuery) ||
                    customer.customerName.toLowerCase().includes(customerQuery)
                );
                const chosenCode = customerSelections[user.lineUserRowId] ?? "";
                const chosenCustomer = availableCustomers.find(
                  (customer) => customer.customerCode === chosenCode
                );
                const customerOptions = chosenCustomer &&
                  !matchingCustomers.some((customer) => customer.customerCode === chosenCode)
                  ? [chosenCustomer, ...matchingCustomers]
                  : matchingCustomers;

                const hasStaffAccess = Boolean(user.staff?.isAuthorized);
                const hasCustomerAccess = user.allCustomersAccess || user.customerCodes.length > 0;
                const accountExpanded = Boolean(expandedAccountCards[user.lineUserRowId]);

                return (

                  <section

                    key={

                      user.lineUserRowId

                    }

                    className="overflow-hidden rounded-2xl border border-[#D9EAE3] bg-white shadow-sm"

                  >
                    <button
                      type="button"
                      aria-expanded={accountExpanded}
                      aria-controls={`line-account-details-${user.lineUserRowId}`}
                      onClick={() => setExpandedAccountCards((previous) => ({
                        ...previous,
                        [user.lineUserRowId]: !previous[user.lineUserRowId],
                      }))}
                      className="flex w-full items-center gap-2.5 px-3 py-3 text-left transition hover:bg-[#F5FBF9] sm:px-4"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-extrabold text-[#17453F] sm:text-base">
                          {user.internalName ?? user.displayName ?? "ผู้ใช้ LINE ที่ไม่มีชื่อ"}
                        </p>
                        <p className="mt-0.5 truncate text-[11px] text-[#718D84]">
                          LINE: {user.displayName ?? "—"} · ID …{user.lineUserId.slice(-8)}
                        </p>
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {hasStaffAccess && (
                            <span className="rounded-md bg-[#E4F7F3] px-1.5 py-0.5 text-[10px] font-bold text-[#007C75]">
                              พนักงาน{user.staff?.accountType === "manager" ? " · Manager" : ""}
                            </span>
                          )}
                          {hasCustomerAccess && (
                            <span className="rounded-md bg-[#FFF4D8] px-1.5 py-0.5 text-[10px] font-bold text-[#846019]">
                              {user.allCustomersAccess ? "ลูกค้าทั้งหมด" : `ลูกค้า ${user.customerCodes.length} ร้าน`}
                            </span>
                          )}
                          {!hasStaffAccess && !hasCustomerAccess && (
                            <span className="rounded-md bg-[#F2F4F3] px-1.5 py-0.5 text-[10px] font-bold text-[#667A73]">ยังไม่มีสิทธิ์</span>
                          )}
                          {!user.isActive && (
                            <span className="rounded-md bg-[#FEEEEE] px-1.5 py-0.5 text-[10px] font-bold text-[#AD4545]">นำออกแล้ว</span>
                          )}
                        </div>
                      </div>
                      <span className="shrink-0 rounded-lg bg-[#EFF8F5] px-2.5 py-2 text-xs font-extrabold text-[#008F8D]">
                        {accountExpanded ? "ซ่อน ▲" : "จัดการ ▼"}
                      </span>
                    </button>

                    {accountExpanded && (
                    <div id={`line-account-details-${user.lineUserRowId}`}>
                    {/* Account actions stay in the top-right; the identity is already in the card header. */}
                    <div className="border-b border-[#E0EEE9] px-4 py-4 sm:px-5">
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {user.isActive ? (
                          <span className="rounded-full bg-[#EAF7F3] px-3 py-1.5 text-xs font-semibold text-[#17766C]">
                            บัญชี LINE ใช้งานอยู่
                          </span>
                        ) : (
                          <span className="rounded-full bg-gray-100 px-3 py-1.5 text-xs font-semibold text-gray-600">
                            นำออกจากรายการแล้ว
                          </span>
                        )}

                        {user.isActive ? (
                          <button
                            type="button"
                            onClick={() => setLineUserActive(user, false)}
                            disabled={statusBusy || !canRemove}
                            title={
                              canRemove
                                ? "นำบัญชี LINE ออกจากรายการใช้งาน"
                                : "ต้องยกเลิกสิทธิ์ลูกค้าและสิทธิ์พนักงานทั้งหมดก่อน"
                            }
                            className="rounded-lg border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {statusBusy ? "กำลังนำออก..." : "นำบัญชีออก"}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setLineUserActive(user, true)}
                            disabled={statusBusy}
                            className="rounded-lg border border-green-300 px-3 py-1.5 text-xs font-semibold text-green-700 disabled:opacity-40"
                          >
                            {statusBusy ? "กำลังเปิดใช้งาน..." : "เปิดใช้งานอีกครั้ง"}
                          </button>
                        )}
                      </div>

                      {user.isActive && !canRemove && (
                        <p className="mt-1.5 text-right text-[11px] text-[#81958F]">
                          ยกเลิกสิทธิ์ลูกค้าและสิทธิ์พนักงานทั้งหมดก่อน จึงจะนำบัญชีออกได้
                        </p>
                      )}

                      <p className="mt-3 break-all text-xs text-[#81958F]">
                        LINE ID: {user.lineUserId}
                      </p>

                      <div className="mt-3 max-w-xl">
                        <label
                          htmlFor={`line-internal-name-${user.lineUserRowId}`}
                          className="mb-2 block text-sm font-semibold"
                        >
                          ชื่อบุคคลใน OMS
                        </label>
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <input
                            id={`line-internal-name-${user.lineUserRowId}`}
                            value={nameSelections[user.lineUserRowId] ?? ""}
                            onChange={(event) =>
                              setNameSelections((previous) => ({
                                ...previous,
                                [user.lineUserRowId]: event.target.value,
                              }))
                            }
                            placeholder="เช่น สมชาย ใจดี / คุณแอน"
                            disabled={!user.isActive}
                            className="min-w-0 flex-1 rounded-lg border px-3 py-2.5 disabled:bg-gray-100"
                          />
                          <button
                            type="button"
                            onClick={() => saveInternalName(user)}
                            disabled={nameBusy || !user.isActive}
                            className="rounded-lg bg-[#008F8D] px-4 py-2.5 font-semibold text-white disabled:opacity-40"
                          >
                            {nameBusy ? "กำลังบันทึก..." : "บันทึกชื่อ"}
                          </button>
                        </div>
                        <p className="mt-2 text-xs text-gray-500">
                          ชื่อนี้ใช้ภายใน OMS เท่านั้น และไม่เปลี่ยนชื่อที่ผู้ใช้ตั้งไว้ใน LINE
                        </p>
                      </div>
                    </div>

                    {/* Permissions display whenever the outer account card is expanded. */}
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



                        <div className="flex flex-wrap gap-2 mt-4">
                          <button
                            type="button"
                            disabled={!user.isActive || customerBusy || working !== "" || user.allCustomersAccess}
                            onClick={() => void setAllCustomerAccess(user, true)}
                            className="border border-green-300 text-green-800 rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-40"
                          >
                            {customerBusy ? "กำลังบันทึก..." : user.allCustomersAccess ? "✓ อนุญาตลูกค้าทั้งหมดแล้ว" : "อนุญาตลูกค้าทั้งหมด"}
                          </button>
                          <button
                            type="button"
                            disabled={!user.isActive || customerBusy || working !== "" || (user.customerCodes.length === 0 && !user.allCustomersAccess)}
                            onClick={() => void setAllCustomerAccess(user, false)}
                            className="border border-red-300 text-red-700 rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-40"
                          >
                            {customerBusy ? "กำลังบันทึก..." : "ยกเลิกสิทธิ์ลูกค้าทั้งหมด"}
                          </button>
                        </div>
                        <p className="text-xs text-gray-500 mt-2">
                          {user.allCustomersAccess
                            ? "✓ เปิดสิทธิ์ถาวร: ลูกค้าใหม่จะเพิ่มให้ LINE บัญชีนี้อัตโนมัติ · ไม่เปลี่ยนสิทธิ์พนักงาน"
                            : "เลือกอนุญาตลูกค้าทั้งหมดเพื่อรวมลูกค้าที่สร้างใหม่ในอนาคตด้วย · ไม่เปลี่ยนสิทธิ์พนักงาน"}
                        </p>

                        <button
                          type="button"
                          aria-expanded={Boolean(expandedCustomerLists[user.lineUserRowId])}
                          aria-controls={`customer-list-${user.lineUserRowId}`}
                          onClick={() =>
                            setExpandedCustomerLists((previous) => ({
                              ...previous,
                              [user.lineUserRowId]: !previous[user.lineUserRowId],
                            }))
                          }
                          className="mt-5 w-full flex items-center justify-between gap-3 rounded-lg border bg-gray-50 px-4 py-3 text-left text-sm font-semibold hover:bg-gray-100"
                        >
                          <span>
                            {expandedCustomerLists[user.lineUserRowId]
                              ? "ซ่อนรายชื่อลูกค้า"
                              : "ดูรายชื่อลูกค้า"}
                            {` (${user.customerCodes.length})`}
                          </span>
                          <span aria-hidden="true" className="text-gray-500">
                            {expandedCustomerLists[user.lineUserRowId] ? "▲" : "▼"}
                          </span>
                        </button>

                        {expandedCustomerLists[user.lineUserRowId] && (
                          <div id={`customer-list-${user.lineUserRowId}`}>
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

                                        {displayCustomerCode(customerCode)}

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

                                        customerBusy ||

                                        !user.isActive

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



                          </div>
                        )}

                        <label
                          htmlFor={`customer-search-${user.lineUserRowId}`}
                          className="block text-sm font-medium mt-5 mb-2"
                        >
                          ค้นหาลูกค้า
                        </label>
                        <input
                          id={`customer-search-${user.lineUserRowId}`}
                          type="search"
                          value={customerSearches[user.lineUserRowId] ?? ""}
                          onChange={(event) =>
                            setCustomerSearches((previous) => ({
                              ...previous,
                              [user.lineUserRowId]: event.target.value,
                            }))
                          }
                          placeholder="ชื่อร้าน หรือรหัส CV"
                          disabled={!user.isActive}
                          className="w-full border border-[#BBD9D2] rounded-lg px-4 py-3 focus:outline-none focus:border-[#02B0AF] focus:ring-2 focus:ring-[#02B0AF]/15 disabled:bg-gray-100"
                        />
                        {customerQuery && (
                          <p role="status" className="mt-2 text-xs text-[#647D74]">
                            {matchingCustomers.length > 0
                              ? `พบลูกค้า ${matchingCustomers.length} ราย`
                              : "ไม่พบลูกค้าที่ค้นหา"}
                          </p>
                        )}

                        <div className="flex flex-col sm:flex-row gap-2 mt-3">

                          <select

                            aria-label="เลือกลูกค้าที่จะให้สิทธิ์"

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

                            disabled={!user.isActive}

                            className="flex-1 border rounded-lg px-3 py-3 disabled:bg-gray-100"

                          >



                            <option value="">

                              เลือกลูกค้า

                            </option>



                            {customerOptions

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

                                  {displayCustomerCode(customer.customerCode)}

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

                              customerBusy ||

                              !user.isActive

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

                                  staffBusy ||

                                  !user.isActive

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

                            disabled={!user.isActive}

                            className="flex-1 border rounded-lg px-3 py-3 disabled:bg-gray-100"

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

                              staffBusy ||

                              !user.isActive

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
                    </div>
                    )}



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