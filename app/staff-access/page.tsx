"use client";

import {
  useEffect,
  useState,
} from "react";

import Link from "next/link";

import { supabase } from "../../lib/supabase";

type Staff = {
  id: string;
  staff_code: string;
  staff_name: string;
  account_type: string;
};

type StaffLineUser = {
  id: string;
  staff_id: string;
  line_user_id: string;

  display_name:
    | string
    | null;

  is_authorized: boolean;

  authorized_at:
    | string
    | null;

  deauthorized_at:
    | string
    | null;
};

type LineInput = {
  lineUserId: string;
  displayName: string;
};

export default function StaffAccessPage() {
  const [
    staff,
    setStaff,
  ] =
    useState<Staff[]>([]);

  const [
    links,
    setLinks,
  ] =
    useState<
      StaffLineUser[]
    >([]);

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
    newStaffName,
    setNewStaffName,
  ] =
    useState("");

  const [
    newAccountType,
    setNewAccountType,
  ] =
    useState<
      "staff" | "manager"
    >("staff");

  const [
    creatingStaff,
    setCreatingStaff,
  ] =
    useState(false);

  const [
    lineInputs,
    setLineInputs,
  ] =
    useState<
      Record<
        string,
        LineInput
      >
    >({});

  const [
    busyStaffId,
    setBusyStaffId,
  ] =
    useState<
      string | null
    >(null);

  // =====================================================
  // LOAD
  // =====================================================

  async function loadData() {
    setLoading(true);
    setMessage("");

    const {
      data: { user },
    } =
      await supabase.auth.getUser();

    if (!user) {
      setMessage(
        "You are not logged in."
      );

      setLoading(false);
      return;
    }

    const {
      data: me,
      error: meError,
    } =
      await supabase
        .from("staff")
        .select(`
          id,
          account_type
        `)
        .eq(
          "auth_user_id",
          user.id
        )
        .single();

    if (
      meError ||
      !me ||
      me.account_type !==
        "manager"
    ) {
      setMessage(
        "Manager access required."
      );

      setLoading(false);
      return;
    }

    const {
      data: staffData,
      error: staffError,
    } =
      await supabase
        .from("staff")
        .select(`
          id,
          staff_code,
          staff_name,
          account_type
        `)
        .order(
          "staff_code",
          {
            ascending: true,
          }
        );

    if (staffError) {
      setMessage(
        staffError.message
      );

      setLoading(false);
      return;
    }

    const {
      data: lineData,
      error: lineError,
    } =
      await supabase
        .from(
          "staff_line_users"
        )
        .select(`
          id,
          staff_id,
          line_user_id,
          display_name,
          is_authorized,
          authorized_at,
          deauthorized_at
        `);

    if (lineError) {
      setMessage(
        lineError.message
      );

      setLoading(false);
      return;
    }

    setStaff(
      (staffData ??
        []) as Staff[]
    );

    setLinks(
      (lineData ??
        []) as StaffLineUser[]
    );

    setLoading(false);
  }

  useEffect(() => {
    loadData();
  }, []);

  // =====================================================
  // CREATE STAFF
  // =====================================================

  async function createStaff() {
    if (
      !newStaffName.trim()
    ) {
      setMessage(
        "Please enter the staff name."
      );

      return;
    }

    setCreatingStaff(
      true
    );

    setMessage(
      "Creating staff account..."
    );

    const {
      data,
      error,
    } =
      await supabase.rpc(
        "create_staff_member",
        {
          p_staff_name:
            newStaffName.trim(),

          p_account_type:
            newAccountType,
        }
      );

    if (error) {
      setMessage(
        "Could not create staff account: " +
          error.message
      );

      setCreatingStaff(
        false
      );

      return;
    }

    const createdCode =
      data?.staff_code ??
      "New staff";

    setNewStaffName(
      ""
    );

    setNewAccountType(
      "staff"
    );

    setMessage(
      `${createdCode} created successfully.`
    );

    setCreatingStaff(
      false
    );

    await loadData();
  }

  // =====================================================
  // LINE INPUT
  // =====================================================

  function updateLineInput(
    staffId: string,
    field:
      | "lineUserId"
      | "displayName",
    value: string
  ) {
    setLineInputs(
      (current) => ({
        ...current,

        [staffId]: {
          lineUserId:
            current[
              staffId
            ]?.lineUserId ??
            "",

          displayName:
            current[
              staffId
            ]?.displayName ??
            "",

          [field]:
            value,
        },
      })
    );
  }

  // =====================================================
  // LINK LINE
  // =====================================================

  async function addLineAccount(
    staffId: string
  ) {
    const input =
      lineInputs[
        staffId
      ];

    if (
      !input?.lineUserId
        ?.trim()
    ) {
      setMessage(
        "Please enter the LINE User ID."
      );

      return;
    }

    setBusyStaffId(
      staffId
    );

    setMessage(
      "Connecting LINE account..."
    );

    const {
      error,
    } =
      await supabase.rpc(
        "link_staff_line_user",
        {
          p_staff_id:
            staffId,

          p_line_user_id:
            input.lineUserId.trim(),

          p_display_name:
            input.displayName.trim(),
        }
      );

    if (error) {
      setMessage(
        "Could not connect LINE account: " +
          error.message
      );

      setBusyStaffId(
        null
      );

      return;
    }

    setLineInputs(
      (current) => ({
        ...current,

        [staffId]: {
          lineUserId: "",
          displayName: "",
        },
      })
    );

    setBusyStaffId(
      null
    );

    await loadData();
  }

  // =====================================================
  // AUTHORIZE / DEAUTHORIZE
  // =====================================================

  async function setAuthorization(
    linkId: string,
    authorized: boolean
  ) {
    const confirmed =
      window.confirm(
        authorized
          ? "Authorize this LINE account for OMS access?"
          : "Deauthorize this LINE account?"
      );

    if (!confirmed) {
      return;
    }

    const {
      error,
    } =
      await supabase.rpc(
        "set_staff_line_authorization",
        {
          p_link_id:
            linkId,

          p_authorized:
            authorized,
        }
      );

    if (error) {
      setMessage(
        error.message
      );

      return;
    }

    await loadData();
  }

  // =====================================================
  // LOADING
  // =====================================================

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-100 p-8">
        Loading staff access...
      </main>
    );
  }

  // =====================================================
  // PAGE
  // =====================================================

  return (
    <main className="min-h-screen bg-gray-100 p-8">

      <div className="max-w-6xl mx-auto">

        <Link
          href="/"
          className="text-gray-500"
        >
          ← Back
        </Link>

        <div className="mt-3 mb-8">

          <h1 className="text-3xl font-bold">
            Staff LINE Access
          </h1>

          <p className="text-gray-500 mt-1">
            Create staff accounts and manage LINE access.
          </p>

        </div>

        {message && (
          <div className="bg-white border rounded-xl p-4 mb-6">
            {message}
          </div>
        )}

        {/* ============================================== */}
        {/* CREATE STAFF */}
        {/* ============================================== */}

        <section className="bg-white border rounded-2xl p-6 mb-8">

          <h2 className="text-xl font-bold">
            Add Staff / Manager
          </h2>

          <p className="text-sm text-gray-500 mt-1">
            Staff codes are generated automatically.
          </p>

          <div className="grid md:grid-cols-[1fr_220px_auto] gap-4 mt-5">

            <input
              value={
                newStaffName
              }
              onChange={(
                event
              ) =>
                setNewStaffName(
                  event.target
                    .value
                )
              }
              placeholder="Staff name"
              className="border rounded-xl px-4 py-3"
            />

            <select
              value={
                newAccountType
              }
              onChange={(
                event
              ) =>
                setNewAccountType(
                  event.target
                    .value as
                    | "staff"
                    | "manager"
                )
              }
              className="border rounded-xl px-4 py-3 bg-white"
            >

              <option value="staff">
                Staff
              </option>

              <option value="manager">
                Manager
              </option>

            </select>

            <button
              onClick={
                createStaff
              }
              disabled={
                creatingStaff
              }
              className="bg-black text-white rounded-xl px-6 py-3 font-semibold disabled:opacity-40"
            >

              {creatingStaff
                ? "CREATING..."
                : "ADD ACCOUNT"}

            </button>

          </div>

        </section>

        {/* ============================================== */}
        {/* STAFF */}
        {/* ============================================== */}

        <div className="space-y-5">

          {staff.map(
            (person) => {
              const personLinks =
                links.filter(
                  (link) =>
                    link.staff_id ===
                    person.id
                );

              const input =
                lineInputs[
                  person.id
                ] ?? {
                  lineUserId:
                    "",
                  displayName:
                    "",
                };

              return (
                <section
                  key={
                    person.id
                  }
                  className="bg-white border rounded-2xl overflow-hidden"
                >

                  {/* HEADER */}

                  <div className="p-5 border-b">

                    <div className="flex justify-between items-start gap-4">

                      <div>

                        <h2 className="font-bold text-lg">
                          {
                            person.staff_name
                          }
                        </h2>

                        <p className="text-sm text-gray-500">
                          {
                            person.staff_code
                          }
                          {" · "}
                          {person.account_type ===
                          "manager"
                            ? "Manager"
                            : "Staff"}
                        </p>

                      </div>

                      <span className="text-xs border rounded-full px-3 py-1">
                        {
                          personLinks.length
                        }{" "}
                        LINE
                      </span>

                    </div>

                  </div>

                  {/* ADD LINE */}

                  <div className="p-5 bg-gray-50 border-b">

                    <p className="font-semibold">
                      Connect LINE Account
                    </p>

                    <p className="text-xs text-gray-500 mt-1">
                      Enter the LINE User ID associated with this staff member.
                    </p>

                    <div className="grid md:grid-cols-[1fr_1fr_auto] gap-3 mt-4">

                      <input
                        value={
                          input.lineUserId
                        }
                        onChange={(
                          event
                        ) =>
                          updateLineInput(
                            person.id,
                            "lineUserId",
                            event.target
                              .value
                          )
                        }
                        placeholder="LINE User ID"
                        className="border rounded-xl px-4 py-3 bg-white"
                      />

                      <input
                        value={
                          input.displayName
                        }
                        onChange={(
                          event
                        ) =>
                          updateLineInput(
                            person.id,
                            "displayName",
                            event.target
                              .value
                          )
                        }
                        placeholder="LINE display name (optional)"
                        className="border rounded-xl px-4 py-3 bg-white"
                      />

                      <button
                        onClick={() =>
                          addLineAccount(
                            person.id
                          )
                        }
                        disabled={
                          busyStaffId ===
                          person.id
                        }
                        className="bg-black text-white rounded-xl px-5 py-3 font-semibold disabled:opacity-40"
                      >

                        {busyStaffId ===
                        person.id
                          ? "CONNECTING..."
                          : "CONNECT"}

                      </button>

                    </div>

                  </div>

                  {/* EXISTING LINE ACCOUNTS */}

                  {personLinks.length ===
                  0 ? (

                    <div className="p-5 text-gray-400">
                      No LINE account linked yet.
                    </div>

                  ) : (

                    personLinks.map(
                      (line) => (

                        <div
                          key={
                            line.id
                          }
                          className="p-5 border-b last:border-b-0 flex flex-col md:flex-row md:justify-between md:items-center gap-5"
                        >

                          <div>

                            <p className="font-semibold">
                              {
                                line.display_name ??
                                "LINE User"
                              }
                            </p>

                            <p className="text-xs text-gray-400 mt-1 break-all">
                              {
                                line.line_user_id
                              }
                            </p>

                            <p className="text-sm mt-2">

                              {line.is_authorized
                                ? "✓ Authorized"
                                : "Not authorized"}

                            </p>

                          </div>

                          {line.is_authorized ? (

                            <button
                              onClick={() =>
                                setAuthorization(
                                  line.id,
                                  false
                                )
                              }
                              className="border rounded-lg px-5 py-3 font-semibold"
                            >
                              DEAUTHORIZE
                            </button>

                          ) : (

                            <button
                              onClick={() =>
                                setAuthorization(
                                  line.id,
                                  true
                                )
                              }
                              className="bg-black text-white rounded-lg px-5 py-3 font-semibold"
                            >
                              AUTHORIZE
                            </button>

                          )}

                        </div>

                      )
                    )
                  )}

                </section>
              );
            }
          )}

        </div>

      </div>

    </main>
  );
}