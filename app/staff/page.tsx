"use client";

import {
  FormEvent,
  useEffect,
  useMemo,
  useState,
} from "react";

import Link from "next/link";

import {
  supabase,
} from "../../lib/supabase";

type StaffRow = {
  id: string;
  staffCode: string;
  staffName: string;
  accountType:
    | "staff"
    | "manager";
  authUserId:
    | string
    | null;
  isActive: boolean;
  email:
    | string
    | null;
  lastSignInAt:
    | string
    | null;
  isCurrentUser: boolean;
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

function makeTemporaryPassword() {
  const alphabet =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$";

  const values =
    new Uint32Array(14);

  window.crypto.getRandomValues(
    values
  );

  return Array.from(
    values,
    (value) =>
      alphabet[
        value %
          alphabet.length
      ]
  ).join("");
}

export default function StaffManagementPage() {
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

  const [
    createEmail,
    setCreateEmail,
  ] =
    useState("");

  const [
    createPassword,
    setCreatePassword,
  ] =
    useState("");

  const [
    createRole,
    setCreateRole,
  ] =
    useState<
      | "staff"
      | "manager"
    >("staff");

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

  const [
    editRole,
    setEditRole,
  ] =
    useState<
      | "staff"
      | "manager"
    >("staff");

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
    input:
      RequestInfo,
    init:
      RequestInit =
        {}
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
          ...(
            init.headers ??
            {}
          ),
        },
      }
    );
  }

  // =====================================================
  // LOAD STAFF
  // =====================================================

  async function loadStaff() {
    setLoading(
      true
    );

    setMessage(
      ""
    );

    try {
      const response =
        await authorizedFetch(
          "/api/admin/staff",
          {
            method:
              "GET",
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
      setLoading(
        false
      );
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
              item.email ??
                "",
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
    setShowCreate(
      true
    );

    setCreateName(
      ""
    );

    setCreateEmail(
      ""
    );

    setCreateRole(
      "staff"
    );

    setCreatePassword(
      makeTemporaryPassword()
    );

    setMessage(
      ""
    );

    setSuccess(
      ""
    );
  }

  async function createStaff(
    event:
      FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    setMessage(
      ""
    );

    setSuccess(
      ""
    );

    if (
      createPassword.length <
      8
    ) {
      setMessage(
        "รหัสผ่านชั่วคราวต้องมีอย่างน้อย 8 ตัวอักษร"
      );

      return;
    }

    setCreating(
      true
    );

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
                  email:
                    createEmail,
                  password:
                    createPassword,
                  accountType:
                    createRole,
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
        `สร้าง ${createdCode} ${createdName} เรียบร้อยแล้ว — ใช้อีเมล ${createEmail.trim().toLowerCase()} และรหัสผ่านชั่วคราวที่กำหนดเพื่อเข้าสู่ระบบ`
      );

      setShowCreate(
        false
      );

      setCreateName(
        ""
      );

      setCreateEmail(
        ""
      );

      setCreatePassword(
        ""
      );

      setCreateRole(
        "staff"
      );

      await loadStaff();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "ไม่สามารถสร้างพนักงานได้"
      );
    } finally {
      setCreating(
        false
      );
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

    setEditRole(
      item.accountType
    );

    setMessage(
      ""
    );

    setSuccess(
      ""
    );
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

    setMessage(
      ""
    );

    setSuccess(
      ""
    );

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
                  accountType:
                    editRole,
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
          : `ปิดใช้งาน ${item.staffCode} ${item.staffName}?\n\nพนักงานคนนี้จะไม่สามารถเข้าสู่ระบบ OMS ได้ แต่ประวัติงานเดิมจะยังคงอยู่`
      );

    if (!confirmed) {
      return;
    }

    setSavingId(
      item.id
    );

    setMessage(
      ""
    );

    setSuccess(
      ""
    );

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
                  accountType:
                    item.accountType,
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

  // =====================================================
  // LOADING
  // =====================================================

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-100 flex items-center justify-center p-6">
        <div className="bg-white border rounded-2xl p-6">
          กำลังโหลดข้อมูลพนักงาน...
        </div>
      </main>
    );
  }

  // =====================================================
  // PAGE
  // =====================================================

  return (
    <main className="min-h-screen bg-gray-100">
      <header className="bg-white border-b">
        <div className="max-w-5xl mx-auto px-5 py-6">
          <Link
            href="/"
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
                หนึ่งบัญชีต่อหนึ่งพนักงาน เพื่อให้ประวัติออเดอร์ระบุผู้ปฏิบัติงานได้จริง
              </p>
            </div>

            <button
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
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto p-5 space-y-6">
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
              ระบบจะสร้างรหัส S00x ถัดไปให้อัตโนมัติ พร้อมสร้างบัญชีเข้าสู่ระบบ
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
                <span className="block text-sm font-semibold mb-2">
                  อีเมลสำหรับเข้าสู่ระบบ
                </span>

                <input
                  type="email"
                  value={
                    createEmail
                  }
                  onChange={(
                    event
                  ) =>
                    setCreateEmail(
                      event.target.value
                    )
                  }
                  className="w-full border rounded-xl px-4 py-3"
                  placeholder="staff@example.com"
                  required
                />
              </label>

              <label>
                <span className="block text-sm font-semibold mb-2">
                  รหัสผ่านชั่วคราว
                </span>

                <div className="flex gap-2">
                  <input
                    type="text"
                    value={
                      createPassword
                    }
                    onChange={(
                      event
                    ) =>
                      setCreatePassword(
                        event.target.value
                      )
                    }
                    className="min-w-0 flex-1 border rounded-xl px-4 py-3"
                    minLength={8}
                    required
                  />

                  <button
                    type="button"
                    onClick={() =>
                      setCreatePassword(
                        makeTemporaryPassword()
                      )
                    }
                    className="border rounded-xl px-4 py-3 text-sm font-semibold"
                  >
                    สุ่มใหม่
                  </button>
                </div>

                <p className="text-xs text-gray-500 mt-2">
                  อย่างน้อย 8 ตัวอักษร กรุณาส่งอีเมลและรหัสผ่านนี้ให้พนักงานโดยตรง
                </p>
              </label>

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
                  ปิดใช้งานแทนการลบ เพื่อเก็บประวัติงานเก่าไว้ครบถ้วน
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
                placeholder="ค้นหาชื่อ รหัส หรืออีเมล"
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
                              {item.email ??
                                "ยังไม่มีบัญชี Auth เชื่อมอยู่"}
                            </p>

                            <p className="text-xs text-gray-400 mt-1">
                              เข้าสู่ระบบล่าสุด:{" "}
                              {formatDateTime(
                                item.lastSignInAt
                              )}
                            </p>
                          </div>

                          <div className="flex gap-2 flex-wrap">
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
      </div>
    </main>
  );
}
