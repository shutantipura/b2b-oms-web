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
  ] = useState("");

  const [
    password,
    setPassword,
  ] = useState("");

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
  ] = useState(0);

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    message,
    setMessage,
  ] = useState("");

  // =====================================================
  // ACTIVE ORDERS
  // =====================================================

  async function loadActiveOrderCount() {
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
        .not(
          "status",
          "in",
          '("completed","cancelled")'
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

      setLoading(
        false
      );

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
          account_type
        `)
        .eq(
          "auth_user_id",
          user.id
        )
        .single();

    if (error) {
      console.error(
        error
      );

      setMessage(
        "Login worked, but your staff profile could not be loaded: " +
          error.message
      );

      setStaff(
        null
      );

      setLoading(
        false
      );

      return;
    }

    setStaff(
      data
    );

    setMessage(
      ""
    );

    await loadActiveOrderCount();

    setLoading(
      false
    );
  }

  useEffect(() => {
    loadStaff();
  }, []);

  // =====================================================
  // FALLBACK EMAIL/PASSWORD SIGN IN
  // =====================================================

  async function handleSignIn(
    event:
      FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    setMessage(
      "Signing in..."
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
  //
  // Clear Supabase staff session,
  // then return to LINE access chooser.
  // =====================================================

  async function handleSignOut() {
    const {
      error,
    } =
      await supabase.auth.signOut();

    if (error) {
      console.error(
        "Sign out error:",
        error
      );
    }

    setStaff(
      null
    );

    setActiveOrderCount(
      0
    );

    setEmail(
      ""
    );

    setPassword(
      ""
    );

    setMessage(
      ""
    );

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
          Loading B2B OMS...
        </p>

      </main>
    );
  }

  // =====================================================
  // FALLBACK LOGIN
  //
  // Normally LINE users should never need this.
  // It remains available for direct browser access.
  // =====================================================

  if (!staff) {
    return (
      <main className="min-h-screen bg-gray-100 flex items-center justify-center p-6">

        <div className="w-full max-w-md bg-white rounded-2xl shadow p-8">

          <h1 className="text-3xl font-bold mb-2">
            B2B OMS
          </h1>

          <p className="text-gray-500 mb-8">
            Staff & Manager Login
          </p>

          <form
            onSubmit={
              handleSignIn
            }
            className="space-y-5"
          >

            <div>

              <label className="block mb-2 font-medium">
                Email
              </label>

              <input
                type="email"
                value={
                  email
                }
                onChange={(event) =>
                  setEmail(
                    event.target.value
                  )
                }
                className="w-full border rounded-lg px-4 py-3"
                required
              />

            </div>

            <div>

              <label className="block mb-2 font-medium">
                Password
              </label>

              <input
                type="password"
                value={
                  password
                }
                onChange={(event) =>
                  setPassword(
                    event.target.value
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
              SIGN IN
            </button>

          </form>

          {message && (
            <p className="mt-5 text-sm text-red-600">
              {
                message
              }
            </p>
          )}

          <Link
            href="/miniapp?portal=access"
            className="block text-center text-sm text-gray-500 mt-6 underline"
          >
            Return to LINE access
          </Link>

        </div>

      </main>
    );
  }

  // =====================================================
  // MANAGER NAVIGATION
  // =====================================================

  const managerNavigation:
    NavigationItem[] =
    [
      {
        name:
          "Tasks",

        href:
          "/tasks",

        description:
          "Operational work queue",
      },

      {
        name:
          "Orders",

        href:
          "/orders",

        description:
          "All B2B orders",
      },

      {
        name:
          "Control Tower",

        href:
          "/control-tower",

        description:
          "Today's operation",
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
          "Customers",

        href:
          "/customers",

        description:
          "Customer management",
      },

      {
        name:
          "Pricing",

        href:
          "/pricing",

        description:
          "Products & customer prices",
      },

      {
  name:
    "LINE Access",

  href:
    "/line-access",

  description:
    "Manage customer & staff LINE authorization",
},
    ];

  // =====================================================
  // STAFF NAVIGATION
  // =====================================================

  const staffNavigation:
    NavigationItem[] =
    [
      {
        name:
          "Tasks",

        href:
          "/tasks",

        description:
          "Operational work queue",
      },

      {
        name:
          "Orders",

        href:
          "/orders",

        description:
          "B2B orders",
      },

      {
        name:
          "Control Tower",

        href:
          "/control-tower",

        description:
          "Today's operation",
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
    <main className="min-h-screen bg-gray-100 p-8">

      <div className="max-w-6xl mx-auto">

        {/* HEADER */}

        <div className="flex justify-between items-start mb-10">

          <div>

            <h1 className="text-3xl font-bold">
              Hello,{" "}
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
            type="button"
            onClick={
              handleSignOut
            }
            className="bg-white border rounded-lg px-4 py-2"
          >
            Sign Out
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
                item.name ===
                "Tasks"
              ) {
                return (
                  <Link
                    key={
                      item.name
                    }
                    href={
                      item.href
                    }
                    className="bg-white border rounded-xl p-7 hover:shadow transition"
                  >

                    <div className="flex justify-between items-start gap-4">

                      <div>

                        <p className="font-semibold text-lg">
                          Tasks
                        </p>

                        <p className="text-sm text-gray-500 mt-2">

                          {activeOrderCount ===
                          0
                            ? "No active orders"
                            : `${activeOrderCount} active ${
                                activeOrderCount ===
                                1
                                  ? "order"
                                  : "orders"
                              }`}

                        </p>

                      </div>

                      <div className="min-w-12 h-12 px-3 bg-black text-white rounded-full flex items-center justify-center font-bold text-lg">

                        {
                          activeOrderCount
                        }

                      </div>

                    </div>

                    <p className="text-sm font-medium mt-6">
                      View task queue →
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
                    item.name
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
            Supabase connection successful.
          </p>

          <p className="text-gray-500 mt-2">
            Your authenticated account is linked to the OMS staff database.
          </p>

        </div>

      </div>

    </main>
  );
}