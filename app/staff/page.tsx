"use client";

import {
  FormEvent,
  useEffect,
  useMemo,
  useState,
} from "react";

import Link from "next/link";
import StaffResponsibilities from "@/components/StaffResponsibilities";

import {
  supabase,
} from "../../lib/supabase";

type TaskStage =
  | "confirmation"
  | "picking"
  | "billing"
  | "delivery"
  | "payment_verification";

const TASK_OPTIONS: Array<{
  stage: TaskStage;
  label: string;
}> = [
  { stage: "confirmation", label: "เช็คสต็อก" },
  { stage: "picking", label: "จัดสินค้า" },
  { stage: "billing", label: "ออกบิล" },
  { stage: "delivery", label: "จัดส่ง" },
  { stage: "payment_verification", label: "ตรวจสอบการชำระเงิน" },
];

const ALL_TASK_STAGES =
  TASK_OPTIONS.map(
    (option) => option.stage
  );

type StaffRow = {
  id: string;
  staffCode: string;
  staffName: string;
  phone: string | null;
  accountType:
    | "staff"
    | "manager";
  authUserId:
    | string
    | null;
  isActive: boolean;
  lastSignInAt:
    | string
    | null;
  isCurrentUser: boolean;
  taskPermissions: TaskStage[];
};

type StaffListResponse = {
  staff?: StaffRow[];
  error?: string;
};

type CreateStaffResponse = {
  success?: boolean;
  staff?: StaffRow;
  error?: string;
};

function accountLabel(
  accountType: string
) {
  return accountType ===
    "manager"
    ? "Manager"
    : "Staff";
}

function formatDateTime(
  value:
    | string
    | null
) {
  if (!value) {
    return "ยังไม่เคยเข้าสู่ระบบ";
  }

  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return value;
  }

  return new Intl.DateTimeFormat(
    "th-TH",
    {
      dateStyle:
        "medium",
      timeStyle:
        "short",
    }
  ).format(date);
}

export default function StaffManagementPage() {
  const [activeTab, setActiveTab] = useState<"list" | "responsibilities">("list");

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("tab") === "responsibilities") {
      setActiveTab("responsibilities");
    }
  }, []);

  function changeTab(nextTab: "list" | "responsibilities") {
    setActiveTab(nextTab);
    const url = nextTab === "responsibilities" ? "/staff?tab=responsibilities" : "/staff";
    window.history.replaceState(window.history.state, "", url);
  }

  const [
    staff,
    setStaff,
  ] =
    useState<StaffRow[]>(
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

  const [
    success,
    setSuccess,
  ] =
    useState("");

  const [
    search,
    setSearch,
  ] =
    useState("");

  const [
    filter,
    setFilter,
  ] =
    useState<
      | "active"
      | "inactive"
      | "all"
    >("active");

  const [
    showCreate,
    setShowCreate,
  ] =
    useState(false);

  const [
    creating,
    setCreating,
  ] =
    useState(false);

  const [
    createName,
    setCreateName,
  ] =
    useState("");

  const [createPhone, setCreatePhone] = useState("");

  const [
    createRole,
    setCreateRole,
  ] =
    useState<
      | "staff"
      | "manager"
    >("staff");

  const [
    createPermissions,
    setCreatePermissions,
  ] =
    useState<TaskStage[]>(
      [...ALL_TASK_STAGES]
    );

  const [
    editingId,
    setEditingId,
  ] =
    useState<
      string | null
    >(null);

  const [
    editName,
    setEditName,
  ] =
    useState("");

  const [editPhone, setEditPhone] = useState("");

  const [
    editRole,
    setEditRole,
  ] =
    useState<
      | "staff"
      | "manager"
    >("staff");

  const [
    editPermissions,
    setEditPermissions,
  ] =
    useState<TaskStage[]>([]);

  const [
    savingId,
    setSavingId,
  ] =
    useState<
      string | null
    >(null);

  // =====================================================
  // AUTHORIZED API CALL
  // =====================================================

  async function authorizedFetch(
    input: RequestInfo,
    init:
      RequestInit = {}
  ) {
    const {
      data: {
        session,
      },
    } =
      await supabase.auth
        .getSession();

    if (!session) {
      throw new Error(
        "กรุณาเข้าสู่ระบบ OMS ก่อน"
      );
    }

    return fetch(
      input,
      {
        ...init,
        headers: {
          "Content-Type":
            "application/json",
          Authorization:
            `Bearer ${session.access_token}`,
          ...(init.headers ??
            {}),
        },
      }
    );
  }

  // =====================================================
  // LOAD STAFF
  // =====================================================

  async function loadStaff() {
    setLoading(true);
    setMessage("");

    try {
      const response =
        await authorizedFetch(
          "/api/admin/staff",
          {
            method: "GET",
          }
        );

      const data =
        (await response.json()) as StaffListResponse;

      if (!response.ok) {
        throw new Error(
          data.error ??
            "ไม่สามารถโหลดข้อมูลพนักงานได้"
        );
      }

      setStaff(
        data.staff ??
          []
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "ไม่สามารถโหลดข้อมูลพนักงานได้"
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadStaff();
  }, []);

  // =====================================================
  // FILTERS
  // =====================================================

  const visibleStaff =
    useMemo(
      () => {
        const query =
          search
            .trim()
            .toLowerCase();

        return staff.filter(
          (item) => {
            if (
              filter ===
                "active" &&
              !item.isActive
            ) {
              return false;
            }

            if (
              filter ===
                "inactive" &&
              item.isActive
            ) {
              return false;
            }

            if (!query) {
              return true;
            }

            return [
              item.staffCode,
              item.staffName,
            ].some(
              (value) =>
                value
                  .toLowerCase()
                  .includes(
                    query
                  )
            );
          }
        );
      },
      [
        staff,
        filter,
        search,
      ]
    );

  const activeCount =
    staff.filter(
      (item) =>
        item.isActive
    ).length;

  const activeManagerCount =
    staff.filter(
      (item) =>
        item.isActive &&
        item.accountType ===
          "manager"
    ).length;

  // =====================================================
  // CREATE STAFF
  // =====================================================

  function openCreateForm() {
    setShowCreate(true);
    setCreateName("");
    setCreatePhone("");
    setCreateRole("staff");
    setCreatePermissions(
      [...ALL_TASK_STAGES]
    );
    setMessage("");
    setSuccess("");
  }

  async function createStaff(
    event:
      FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    setMessage("");
    setSuccess("");

    if (
      !createName.trim()
    ) {
      setMessage(
        "กรุณากรอกชื่อพนักงาน"
      );
      return;
    }

    setCreating(true);

    try {
      const response =
        await authorizedFetch(
          "/api/admin/staff",
          {
            method:
              "POST",
            body:
              JSON.stringify(
                {
                  staffName:
                    createName,
                  phone: createPhone,
                  accountType:
                    createRole,
                  taskPermissions:
                    createPermissions,
                }
              ),
          }
        );

      const data =
        (await response.json()) as CreateStaffResponse;

      if (!response.ok) {
        throw new Error(
          data.error ??
            "ไม่สามารถสร้างพนักงานได้"
        );
      }

      const createdCode =
        data.staff
          ?.staffCode ??
        "";

      const createdName =
        data.staff
          ?.staffName ??
        createName;

      setSuccess(
        `สร้าง ${createdCode} ${createdName} เรียบร้อยแล้ว — ขั้นตอนถัดไปให้ไปที่ “สิทธิ์ LINE” แล้วเชื่อมบัญชี LINE ของพนักงานกับ ${createdCode}`
      );

      setShowCreate(false);
      setCreateName("");
      setCreatePhone("");
      setCreateRole("staff");
      setCreatePermissions(
        [...ALL_TASK_STAGES]
      );

      await loadStaff();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "ไม่สามารถสร้างพนักงานได้"
      );
    } finally {
      setCreating(false);
    }
  }

  // =====================================================
  // EDIT STAFF
  // =====================================================

  function beginEdit(
    item: StaffRow
  ) {
    setEditingId(
      item.id
    );

    setEditName(
      item.staffName
    );
    setEditPhone(item.phone ?? "");

    setEditRole(
      item.accountType
    );

    setEditPermissions(
      [...item.taskPermissions]
    );

    setMessage("");
    setSuccess("");
  }

  async function saveEdit(
    item: StaffRow
  ) {
    if (
      !editName.trim()
    ) {
      setMessage(
        "กรุณากรอกชื่อพนักงาน"
      );
      return;
    }

    setSavingId(
      item.id
    );

    setMessage("");
    setSuccess("");

    try {
      const response =
        await authorizedFetch(
          "/api/admin/staff",
          {
            method:
              "PATCH",
            body:
              JSON.stringify(
                {
                  staffId:
                    item.id,
                  staffName:
                    editName,
                  phone: editPhone,
                  accountType:
                    editRole,
                  taskPermissions:
                    editPermissions,
                  isActive:
                    item.isActive,
                }
              ),
          }
        );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ??
            "ไม่สามารถอัปเดตพนักงานได้"
        );
      }

      setEditingId(
        null
      );

      setSuccess(
        `อัปเดต ${item.staffCode} เรียบร้อยแล้ว`
      );

      await loadStaff();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "ไม่สามารถอัปเดตพนักงานได้"
      );
    } finally {
      setSavingId(
        null
      );
    }
  }

  // =====================================================
  // ACTIVE / INACTIVE
  // =====================================================

  async function toggleActive(
    item: StaffRow
  ) {
    const nextActive =
      !item.isActive;

    const confirmed =
      window.confirm(
        nextActive
          ? `เปิดใช้งาน ${item.staffCode} ${item.staffName} อีกครั้ง?`
          : `ปิดใช้งาน ${item.staffCode} ${item.staffName}?\n\nพนักงานคนนี้จะไม่สามารถเข้าสู่ OMS ผ่าน LINE ได้ แต่ประวัติงานเดิมจะยังคงอยู่`
      );

    if (!confirmed) {
      return;
    }

    setSavingId(
      item.id
    );

    setMessage("");
    setSuccess("");

    try {
      const response =
        await authorizedFetch(
          "/api/admin/staff",
          {
            method:
              "PATCH",
            body:
              JSON.stringify(
                {
                  staffId:
                    item.id,
                  staffName:
                    item.staffName,
                  phone: item.phone,
                  accountType:
                    item.accountType,
                  taskPermissions:
                    item.taskPermissions,
                  isActive:
                    nextActive,
                }
              ),
          }
        );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ??
            "ไม่สามารถอัปเดตสถานะพนักงานได้"
        );
      }

      setSuccess(
        nextActive
          ? `เปิดใช้งาน ${item.staffCode} เรียบร้อยแล้ว`
          : `ปิดใช้งาน ${item.staffCode} เรียบร้อยแล้ว`
      );

      await loadStaff();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "ไม่สามารถอัปเดตสถานะพนักงานได้"
      );
    } finally {
      setSavingId(
        null
      );
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-100 flex items-center justify-center p-6">
        <div className="bg-white border rounded-2xl p-6">
          กำลังโหลดข้อมูลพนักงาน...
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-100">
      <header className="bg-white border-b">
        <div className="max-w-5xl mx-auto px-5 py-6">
          <Link
            href="/login"
            className="text-sm text-gray-500"
          >
            ← กลับหน้าหลัก
          </Link>

          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mt-4">
            <div>
              <p className="text-sm text-gray-500 font-semibold">
                ผู้จัดการ
              </p>

              <h1 className="text-3xl font-bold mt-1">
                จัดการพนักงาน
              </h1>

              <p className="text-gray-500 mt-2">
                {activeTab === "list"
                  ? "หนึ่งบัญชีต่อหนึ่งพนักงาน พร้อมกำหนดว่าสามารถทำงานประเภทใดได้บ้าง"
                  : "ตรวจสอบว่าแต่ละคนกำลังรับผิดชอบงานใด และมีใครพร้อมรับงานเพิ่ม"}
              </p>
            </div>

            {activeTab === "list" && <button
              type="button"
              onClick={
                showCreate
                  ? () =>
                      setShowCreate(
                        false
                      )
                  : openCreateForm
              }
              className="bg-black text-white rounded-xl px-5 py-3 font-semibold"
            >
              {showCreate
                ? "ยกเลิก"
                : "+ เพิ่มพนักงาน"}
            </button>}
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto space-y-5 p-4 sm:p-5">
        <div role="tablist" aria-label="ส่วนจัดการพนักงาน" className="grid grid-cols-2 gap-2 rounded-2xl border border-[#D7E9E4] bg-white p-1.5 shadow-sm">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "list"}
            onClick={() => changeTab("list")}
            className={activeTab === "list"
              ? "min-h-12 rounded-xl bg-[#02B0AF] px-3 text-sm font-extrabold text-white"
              : "min-h-12 rounded-xl px-3 text-sm font-extrabold text-[#52786F] hover:bg-[#EFF9F6]"}
          >
            รายชื่อพนักงาน
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "responsibilities"}
            onClick={() => changeTab("responsibilities")}
            className={activeTab === "responsibilities"
              ? "min-h-12 rounded-xl bg-[#02B0AF] px-3 text-sm font-extrabold text-white"
              : "min-h-12 rounded-xl px-3 text-sm font-extrabold text-[#52786F] hover:bg-[#EFF9F6]"}
          >
            งานที่รับผิดชอบ
          </button>
        </div>
        {activeTab === "list" ? (
          <>
        <section className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div className="bg-white border rounded-xl p-4">
            <p className="text-sm text-gray-500">
              พนักงานทั้งหมด
            </p>
            <p className="text-2xl font-bold mt-1">
              {staff.length}
            </p>
          </div>

          <div className="bg-white border rounded-xl p-4">
            <p className="text-sm text-gray-500">
              ใช้งานอยู่
            </p>
            <p className="text-2xl font-bold mt-1">
              {activeCount}
            </p>
          </div>

          <div className="bg-white border rounded-xl p-4">
            <p className="text-sm text-gray-500">
              Manager ที่ใช้งานอยู่
            </p>
            <p className="text-2xl font-bold mt-1">
              {activeManagerCount}
            </p>
          </div>
        </section>

        {showCreate && (
          <section className="bg-white border rounded-2xl p-6">
            <h2 className="text-xl font-bold">
              เพิ่มพนักงาน
            </h2>

            <p className="text-sm text-gray-500 mt-1">
              ระบบจะสร้างรหัส S00x และบัญชีระบบภายในให้อัตโนมัติ พนักงานไม่ต้องใช้อีเมลหรือรหัสผ่านในการเข้าสู่ระบบ
            </p>

            <form
              onSubmit={
                createStaff
              }
              className="grid md:grid-cols-2 gap-5 mt-6"
            >
              <label>
                <span className="block text-sm font-semibold mb-2">
                  ชื่อพนักงาน
                </span>

                <input
                  value={
                    createName
                  }
                  onChange={(
                    event
                  ) =>
                    setCreateName(
                      event.target.value
                    )
                  }
                  className="w-full border rounded-xl px-4 py-3"
                  placeholder="เช่น สมชาย ใจดี"
                  required
                />
              </label>

              <label>
                <span className="block text-sm font-semibold mb-2">
                  ประเภทบัญชี
                </span>

                <select
                  value={
                    createRole
                  }
                  onChange={(
                    event
                  ) =>
                    setCreateRole(
                      event.target.value as
                        | "staff"
                        | "manager"
                    )
                  }
                  className="w-full border rounded-xl px-4 py-3 bg-white"
                >
                  <option value="staff">
                    Staff
                  </option>

                  <option value="manager">
                    Manager
                  </option>
                </select>
              </label>

              <label>
                <span className="block text-sm font-semibold mb-2">เบอร์โทรศัพท์</span>
                <input type="tel" inputMode="tel" autoComplete="tel"
                  value={createPhone} onChange={(event) => setCreatePhone(event.target.value)}
                  placeholder="เช่น 0812345678" className="w-full border rounded-xl px-4 py-3" />
              </label>

              <div className="md:col-span-2 border rounded-xl p-4">
                <p className="font-semibold">
                  งานที่พร้อมรับ / ให้เรียกพนักงาน
                </p>

                <p className="text-sm text-gray-500 mt-1">
                  เลือกงานที่พร้อมรับและให้เพื่อนร่วมงานเรียกได้ (Manager เลือกงานของตัวเองได้)
                </p>

                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-4">
                    {TASK_OPTIONS.map(
                      (option) => (
                        <label
                          key={option.stage}
                          className="flex items-center gap-3 border rounded-xl px-4 py-3 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={
                              createPermissions.includes(
                                option.stage
                              )
                            }
                            onChange={(event) =>
                              setCreatePermissions(
                                (current) =>
                                  event.target.checked
                                    ? Array.from(
                                        new Set([
                                          ...current,
                                          option.stage,
                                        ])
                                      )
                                    : current.filter(
                                        (stage) =>
                                          stage !== option.stage
                                      )
                              )
                            }
                            className="h-4 w-4"
                          />
                          <span className="text-sm font-medium">
                            {option.label}
                          </span>
                        </label>
                      )
                    )}
                  </div>
              </div>

              <div className="md:col-span-2 bg-gray-50 border rounded-xl p-4">
                <p className="font-semibold">
                  การเข้าสู่ระบบ
                </p>

                <p className="text-sm text-gray-600 mt-1">
                  หลังสร้างพนักงานแล้ว ไปที่หน้า “สิทธิ์ LINE” เพื่อเชื่อมบัญชี LINE จริงของพนักงานกับรหัส S00x นี้ จากนั้นพนักงานจะเข้า OMS ผ่าน LINE เท่านั้น
                </p>

                <Link
                  href="/line-access"
                  className="inline-block mt-3 text-sm font-semibold underline"
                >
                  ไปที่สิทธิ์ LINE →
                </Link>
              </div>

              <div className="md:col-span-2 flex justify-end">
                <button
                  type="submit"
                  disabled={
                    creating
                  }
                  className="bg-black text-white rounded-xl px-7 py-3 font-semibold disabled:opacity-40"
                >
                  {creating
                    ? "กำลังสร้าง..."
                    : "สร้างพนักงาน"}
                </button>
              </div>
            </form>
          </section>
        )}

        {message && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4">
            {message}
          </div>
        )}

        {success && (
          <div className="bg-green-50 border border-green-200 text-green-800 rounded-xl p-4">
            {success}

            <div className="mt-3">
              <Link
                href="/line-access"
                className="font-semibold underline"
              >
                ไปเชื่อมสิทธิ์ LINE →
              </Link>
            </div>
          </div>
        )}

        <section className="bg-white border rounded-2xl overflow-hidden">
          <div className="p-5 border-b">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold">
                  รายชื่อพนักงาน
                </h2>

                <p className="text-sm text-gray-500 mt-1">
                  กำหนดประเภทบัญชี งานที่พร้อมรับ และสถานะการใช้งานของพนักงานแต่ละคน
                </p>
              </div>

              <input
                value={
                  search
                }
                onChange={(
                  event
                ) =>
                  setSearch(
                    event.target.value
                  )
                }
                className="border rounded-xl px-4 py-2.5 md:w-72"
                placeholder="ค้นหาชื่อหรือรหัสพนักงาน"
              />
            </div>

            <div className="flex gap-2 flex-wrap mt-4">
              {[
                {
                  value:
                    "active",
                  label:
                    "ใช้งานอยู่",
                },
                {
                  value:
                    "inactive",
                  label:
                    "ปิดใช้งาน",
                },
                {
                  value:
                    "all",
                  label:
                    "ทั้งหมด",
                },
              ].map(
                (option) => (
                  <button
                    type="button"
                    key={
                      option.value
                    }
                    onClick={() =>
                      setFilter(
                        option.value as
                          | "active"
                          | "inactive"
                          | "all"
                      )
                    }
                    className={`rounded-full px-4 py-2 text-sm font-semibold border ${
                      filter ===
                      option.value
                        ? "bg-black text-white border-black"
                        : "bg-white"
                    }`}
                  >
                    {
                      option.label
                    }
                  </button>
                )
              )}
            </div>
          </div>

          <div className="divide-y">
            {visibleStaff.length ===
            0 ? (
              <div className="p-8 text-center text-gray-500">
                ไม่พบพนักงาน
              </div>
            ) : (
              visibleStaff.map(
                (item) => {
                  const editing =
                    editingId ===
                    item.id;

                  return (
                    <div
                      key={
                        item.id
                      }
                      className="p-5"
                    >
                      {editing ? (
                        <div className="grid md:grid-cols-[1fr_180px_auto] gap-3 items-end">
                          <label>
                            <span className="block text-xs text-gray-500 mb-1">
                              ชื่อพนักงาน
                            </span>

                            <input
                              value={
                                editName
                              }
                              onChange={(
                                event
                              ) =>
                                setEditName(
                                  event.target.value
                                )
                              }
                              className="w-full border rounded-xl px-4 py-3"
                            />
                          </label>

                          <label>
                            <span className="block text-xs text-gray-500 mb-1">
                              ประเภทบัญชี
                            </span>

                            <select
                              value={
                                editRole
                              }
                              onChange={(
                                event
                              ) =>
                                setEditRole(
                                  event.target.value as
                                    | "staff"
                                    | "manager"
                                )
                              }
                              disabled={
                                item.isCurrentUser
                              }
                              className="w-full border rounded-xl px-4 py-3 bg-white disabled:bg-gray-100"
                            >
                              <option value="staff">
                                Staff
                              </option>

                              <option value="manager">
                                Manager
                              </option>
                            </select>
                          </label>

                          <label>
                            <span className="block text-xs text-gray-500 mb-1">เบอร์โทรศัพท์</span>
                            <input type="tel" inputMode="tel" autoComplete="tel"
                              value={editPhone} onChange={(event) => setEditPhone(event.target.value)}
                              placeholder="0812345678" className="w-full border rounded-xl px-4 py-3" />
                          </label>

                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                void saveEdit(
                                  item
                                )
                              }
                              disabled={
                                savingId ===
                                item.id
                              }
                              className="bg-black text-white rounded-xl px-5 py-3 font-semibold disabled:opacity-40"
                            >
                              บันทึก
                            </button>

                            <button
                              type="button"
                              onClick={() =>
                                setEditingId(
                                  null
                                )
                              }
                              className="border rounded-xl px-5 py-3"
                            >
                              ยกเลิก
                            </button>
                          </div>

                          <div className="md:col-span-3 border rounded-xl p-4">
                            <p className="text-sm font-semibold">
                              งานที่พร้อมรับ / ให้เรียกพนักงาน
                            </p>

                            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-3">
                                {TASK_OPTIONS.map(
                                  (option) => (
                                    <label
                                      key={option.stage}
                                      className="flex items-center gap-3 border rounded-xl px-3 py-2.5 cursor-pointer"
                                    >
                                      <input
                                        type="checkbox"
                                        checked={
                                          editPermissions.includes(
                                            option.stage
                                          )
                                        }
                                        onChange={(event) =>
                                          setEditPermissions(
                                            (current) =>
                                              event.target.checked
                                                ? Array.from(
                                                    new Set([
                                                      ...current,
                                                      option.stage,
                                                    ])
                                                  )
                                                : current.filter(
                                                    (stage) =>
                                                      stage !== option.stage
                                                  )
                                          )
                                        }
                                        className="h-4 w-4"
                                      />
                                      <span className="text-sm">
                                        {option.label}
                                      </span>
                                    </label>
                                  )
                                )}
                              </div>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-bold text-lg">
                                {
                                  item.staffCode
                                }{" "}
                                {
                                  item.staffName
                                }
                              </span>

                              <span className="text-xs font-semibold border rounded-full px-2 py-1">
                                {accountLabel(
                                  item.accountType
                                )}
                              </span>

                              <span
                                className={`text-xs font-semibold rounded-full px-2 py-1 ${
                                  item.isActive
                                    ? "bg-green-50 text-green-700"
                                    : "bg-gray-100 text-gray-500"
                                }`}
                              >
                                {item.isActive
                                  ? "ใช้งานอยู่"
                                  : "ปิดใช้งาน"}
                              </span>

                              {item.isCurrentUser && (
                                <span className="text-xs font-semibold bg-blue-50 text-blue-700 rounded-full px-2 py-1">
                                  บัญชีของคุณ
                                </span>
                              )}
                            </div>

                            <p className="text-sm text-gray-600 mt-2">
                              โทร: {item.phone || "ยังไม่มีเบอร์โทรศัพท์"}
                            </p>
                            <p className="text-sm text-gray-600 mt-2">
                              เข้าสู่ระบบผ่าน LINE
                            </p>

                            <div className="flex flex-wrap gap-1.5 mt-3">
                              {item.taskPermissions.length === 0 ? (
                                <span className="text-xs border border-amber-200 text-amber-700 rounded-full px-2.5 py-1 bg-amber-50">
                                  ยังไม่ได้เลือกงานที่พร้อมรับ
                                </span>
                              ) : (
                                TASK_OPTIONS.filter(
                                  (option) =>
                                    item.taskPermissions.includes(
                                      option.stage
                                    )
                                ).map(
                                  (option) => (
                                    <span
                                      key={option.stage}
                                      className="text-xs border rounded-full px-2.5 py-1 bg-gray-50"
                                    >
                                      {option.label}
                                    </span>
                                  )
                                )
                              )}
                            </div>

                            <p className="text-xs text-gray-400 mt-2">
                              เข้าสู่ระบบล่าสุด:{" "}
                              {formatDateTime(
                                item.lastSignInAt
                              )}
                            </p>
                          </div>

                          <div className="flex gap-2 flex-wrap">
                            <Link
                              href="/line-access"
                              className="border rounded-xl px-4 py-2.5 font-semibold"
                            >
                              สิทธิ์ LINE
                            </Link>

                            <button
                              type="button"
                              onClick={() =>
                                beginEdit(
                                  item
                                )
                              }
                              className="border rounded-xl px-4 py-2.5 font-semibold"
                            >
                              แก้ไข
                            </button>

                            {!item.isCurrentUser && (
                              <button
                                type="button"
                                onClick={() =>
                                  void toggleActive(
                                    item
                                  )
                                }
                                disabled={
                                  savingId ===
                                  item.id
                                }
                                className={
                                  item.isActive
                                    ? "border border-red-300 text-red-700 rounded-xl px-4 py-2.5 font-semibold disabled:opacity-40"
                                    : "border border-green-300 text-green-700 rounded-xl px-4 py-2.5 font-semibold disabled:opacity-40"
                                }
                              >
                                {savingId ===
                                item.id
                                  ? "กำลังบันทึก..."
                                  : item.isActive
                                  ? "ปิดใช้งาน"
                                  : "เปิดใช้งาน"}
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                }
              )
            )}
          </div>
        </section>
          </>
        ) : (
          <StaffResponsibilities staff={staff} />
        )}
      </div>
    </main>
  );
}
