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

type LineUser = {
  line_user_row_id: string;
  line_user_id: string;

  display_name:
    | string
    | null;

  is_active: boolean;

  created_at: string;

  customer_codes:
    string[];
};

type Customer = {
  id: string;
  customer_code: string;
  customer_name: string;
  is_active: boolean;
};

export default function CustomerLineAccessPage() {
  const [
    lineUsers,
    setLineUsers,
  ] =
    useState<
      LineUser[]
    >([]);

  const [
    customers,
    setCustomers,
  ] =
    useState<
      Customer[]
    >([]);

  const [
    selectedCustomer,
    setSelectedCustomer,
  ] =
    useState("");

  const [
    selectedLineUser,
    setSelectedLineUser,
  ] =
    useState("");

  const [
    loading,
    setLoading,
  ] =
    useState(true);

  const [
    working,
    setWorking,
  ] =
    useState(false);

  const [
    message,
    setMessage,
  ] =
    useState("");

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

    // ---------------------------------------------
    // Manager-only RPC
    // ---------------------------------------------

    const {
      data:
        lineData,
      error:
        lineError,
    } =
      await supabase.rpc(
        "get_customer_line_users"
      );

    if (lineError) {
      setMessage(
        "Could not load LINE users: " +
          lineError.message
      );

      setLoading(
        false
      );

      return;
    }

    // ---------------------------------------------
    // Customers
    // ---------------------------------------------

    const {
      data:
        customerData,
      error:
        customerError,
    } =
      await supabase
        .from(
          "customers"
        )
        .select(`
          id,
          customer_code,
          customer_name,
          is_active
        `)
        .eq(
          "is_active",
          true
        )
        .order(
          "customer_code",
          {
            ascending:
              true,
          }
        );

    if (
      customerError
    ) {
      setMessage(
        "Could not load customers: " +
          customerError.message
      );

      setLoading(
        false
      );

      return;
    }

    const loadedLines =
      (
        lineData ??
        []
      ) as LineUser[];

    const loadedCustomers =
      (
        customerData ??
        []
      ) as Customer[];

    setLineUsers(
      loadedLines
    );

    setCustomers(
      loadedCustomers
    );

    if (
      !selectedCustomer &&
      loadedCustomers[0]
    ) {
      setSelectedCustomer(
        loadedCustomers[0]
          .customer_code
      );
    }

    setLoading(
      false
    );
  }

  useEffect(() => {
    loadData();
  }, []);

  // =====================================================
  // PENDING
  // =====================================================

  const pendingUsers =
    useMemo(
      () =>
        lineUsers.filter(
          (user) =>
            user.is_active &&
            (
              user.customer_codes ??
              []
            ).length ===
              0
        ),
      [lineUsers]
    );

  // =====================================================
  // AUTHORIZED LINKS
  // =====================================================

  const linkedUsers =
    useMemo(
      () =>
        lineUsers.filter(
          (user) =>
            (
              user.customer_codes ??
              []
            ).length >
            0
        ),
      [lineUsers]
    );

  // =====================================================
  // AUTHORIZE
  // =====================================================

  async function authorize() {
    if (
      !selectedCustomer ||
      !selectedLineUser
    ) {
      setMessage(
        "Select a customer and LINE user first."
      );

      return;
    }

    setWorking(
      true
    );

    setMessage(
      ""
    );

    const {
      error,
    } =
      await supabase.rpc(
        "authorize_customer_line_user",
        {
          p_customer_code:
            selectedCustomer,

          p_line_user_row_id:
            selectedLineUser,
        }
      );

    if (error) {
      setMessage(
        "Authorization failed: " +
          error.message
      );

      setWorking(
        false
      );

      return;
    }

    setMessage(
      "LINE account authorized successfully."
    );

    setSelectedLineUser(
      ""
    );

    await loadData();

    setWorking(
      false
    );
  }

  // =====================================================
  // REVOKE
  // =====================================================

  async function revoke(
    lineUserRowId: string,
    customerCode: string,
    displayName: string
  ) {
    const confirmed =
      window.confirm(
        `Remove ${displayName}'s access to ${customerCode}?`
      );

    if (!confirmed) {
      return;
    }

    setWorking(
      true
    );

    setMessage(
      ""
    );

    const {
      error,
    } =
      await supabase.rpc(
        "revoke_customer_line_user",
        {
          p_customer_code:
            customerCode,

          p_line_user_row_id:
            lineUserRowId,
        }
      );

    if (error) {
      setMessage(
        "Could not revoke access: " +
          error.message
      );

      setWorking(
        false
      );

      return;
    }

    setMessage(
      "Customer access removed."
    );

    await loadData();

    setWorking(
      false
    );
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-100 p-8">
        Loading Customer LINE Access...
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-100 p-4 md:p-8">

      <div className="max-w-6xl mx-auto">

        {/* HEADER */}

        <div className="flex flex-col md:flex-row md:justify-between md:items-start gap-4 mb-8">

          <div>

            <Link
              href="/"
              className="text-gray-500"
            >
              ← Back
            </Link>

            <h1 className="text-3xl font-bold mt-3">
              Customer LINE Access
            </h1>

            <p className="text-gray-500 mt-1">
              Authorize LINE accounts to order for customer accounts.
            </p>

          </div>

          <button
            onClick={
              loadData
            }
            className="border bg-white rounded-lg px-5 py-2"
          >
            REFRESH
          </button>

        </div>

        {message && (
          <div className="bg-white border rounded-xl p-4 mb-6">
            {
              message
            }
          </div>
        )}

        {/* ================================================= */}
        {/* AUTHORIZE */}
        {/* ================================================= */}

        <section className="bg-white border rounded-2xl p-6 mb-6">

          <h2 className="text-xl font-bold">
            Authorize LINE Account
          </h2>

          <p className="text-sm text-gray-500 mt-1">
            The LINE user must open the MINI App once before appearing here.
          </p>

          <div className="grid md:grid-cols-2 gap-4 mt-6">

            <label>

              <span className="text-sm font-semibold">
                Customer
              </span>

              <select
                value={
                  selectedCustomer
                }
                onChange={(
                  event
                ) =>
                  setSelectedCustomer(
                    event.target
                      .value
                  )
                }
                className="w-full border rounded-xl px-4 py-3 bg-white mt-2"
              >

                {customers.map(
                  (
                    customer
                  ) => (

                  <option
                    key={
                      customer.id
                    }
                    value={
                      customer.customer_code
                    }
                  >
                    {
                      customer.customer_code
                    }
                    {" · "}
                    {
                      customer.customer_name
                    }
                  </option>

                ))}

              </select>

            </label>

            <label>

              <span className="text-sm font-semibold">
                LINE User
              </span>

              <select
                value={
                  selectedLineUser
                }
                onChange={(
                  event
                ) =>
                  setSelectedLineUser(
                    event.target
                      .value
                  )
                }
                className="w-full border rounded-xl px-4 py-3 bg-white mt-2"
              >

                <option value="">
                  Select LINE user
                </option>

                {lineUsers
                  .filter(
                    (user) =>
                      user.is_active
                  )
                  .map(
                    (user) => (

                    <option
                      key={
                        user.line_user_row_id
                      }
                      value={
                        user.line_user_row_id
                      }
                    >
                      {
                        user.display_name ??
                        "LINE User"
                      }
                      {" · "}
                      {
                        (
                          user.customer_codes ??
                          []
                        ).length ===
                        0
                          ? "Unlinked"
                          : `Access: ${user.customer_codes.join(
                              ", "
                            )}`
                      }
                    </option>

                  ))}

              </select>

            </label>

          </div>

          <button
            type="button"
            onClick={
              authorize
            }
            disabled={
              working ||
              !selectedCustomer ||
              !selectedLineUser
            }
            className="bg-black text-white rounded-xl px-6 py-3 font-semibold mt-5 disabled:opacity-40"
          >
            AUTHORIZE
          </button>

        </section>

        {/* ================================================= */}
        {/* PENDING */}
        {/* ================================================= */}

        <section className="bg-white border rounded-2xl overflow-hidden mb-6">

          <div className="p-6 border-b">

            <div className="flex justify-between items-center">

              <div>

                <h2 className="text-xl font-bold">
                  Pending / Unlinked LINE Users
                </h2>

                <p className="text-sm text-gray-500 mt-1">
                  These users opened the MINI App but currently have no customer access.
                </p>

              </div>

              <span className="bg-gray-100 rounded-full px-3 py-1 font-semibold">
                {
                  pendingUsers.length
                }
              </span>

            </div>

          </div>

          {pendingUsers.length ===
          0 ? (

            <div className="p-6 text-gray-500">
              No unlinked LINE users.
            </div>

          ) : (

            <div className="divide-y">

              {pendingUsers.map(
                (user) => (

                <div
                  key={
                    user.line_user_row_id
                  }
                  className="p-5 flex flex-col md:flex-row md:justify-between gap-3"
                >

                  <div>

                    <p className="font-bold">
                      {
                        user.display_name ??
                        "LINE User"
                      }
                    </p>

                    <p className="text-xs text-gray-500 mt-1 break-all">
                      {
                        user.line_user_id
                      }
                    </p>

                    <p className="text-xs text-gray-400 mt-1">
                      First seen{" "}
                      {new Date(
                        user.created_at
                      ).toLocaleString()}
                    </p>

                  </div>

                  <button
                    onClick={() =>
                      setSelectedLineUser(
                        user.line_user_row_id
                      )
                    }
                    className="border rounded-lg px-4 py-2 font-semibold"
                  >
                    SELECT
                  </button>

                </div>

              ))}

            </div>

          )}

        </section>

        {/* ================================================= */}
        {/* CURRENT LINKS */}
        {/* ================================================= */}

        <section className="bg-white border rounded-2xl overflow-hidden">

          <div className="p-6 border-b">

            <h2 className="text-xl font-bold">
              Authorized LINE Accounts
            </h2>

            <p className="text-sm text-gray-500 mt-1">
              One LINE account can be authorized for multiple customers.
            </p>

          </div>

          {linkedUsers.length ===
          0 ? (

            <div className="p-6 text-gray-500">
              No LINE accounts are currently authorized.
            </div>

          ) : (

            <div className="divide-y">

              {linkedUsers.map(
                (user) => (

                <div
                  key={
                    user.line_user_row_id
                  }
                  className="p-5"
                >

                  <div className="mb-4">

                    <p className="font-bold">
                      {
                        user.display_name ??
                        "LINE User"
                      }
                    </p>

                    <p className="text-xs text-gray-500 mt-1 break-all">
                      {
                        user.line_user_id
                      }
                    </p>

                  </div>

                  <div className="flex flex-wrap gap-2">

                    {(
                      user.customer_codes ??
                      []
                    ).map(
                      (
                        customerCode
                      ) => (

                      <div
                        key={
                          customerCode
                        }
                        className="border rounded-xl px-3 py-2 flex items-center gap-3"
                      >

                        <span className="font-semibold">
                          {
                            customerCode
                          }
                        </span>

                        <button
                          type="button"
                          onClick={() =>
                            revoke(
                              user.line_user_row_id,
                              customerCode,
                              user.display_name ??
                                "LINE user"
                            )
                          }
                          disabled={
                            working
                          }
                          className="text-sm underline text-gray-500"
                        >
                          Remove
                        </button>

                      </div>

                    ))}

                  </div>

                </div>

              ))}

            </div>

          )}

        </section>

      </div>

    </main>
  );
}