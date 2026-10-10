"use client";

import {
  useEffect,
  useState,
} from "react";

import Link from "next/link";

import {
  supabase,
} from "../lib/supabase";

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
    setLoading(
      true
    );

    const {
      data: { user },
    } =
      await supabase.auth.getUser();

    // No Supabase staff session:
    // send user back to LINE entry point.
    if (!user) {
      window.location.replace(
        "/miniapp?portal=access"
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

    if (
      error ||
      !data
    ) {
      console.error(
        error
      );

      setMessage(
        "Your authenticated account is not linked to an active OMS staff profile."
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

        <div className="text-center">

          <p className="text-xl font-bold">
            B2B OMS
          </p>

          <p className="text-gray-500 mt-2">
            Loading...
          </p>

        </div>

      </main>
    );
  }

  // =====================================================
  // INVALID STAFF PROFILE
  // =====================================================

  if (
    message ||
    !staff
  ) {
    return (
      <main className="min-h-screen bg-gray-100 flex items-center justify-center p-6">

        <div className="w-full max-w-md bg-white border rounded-2xl p-8">

          <h1 className="text-2xl font-bold">
            Staff Access Error
          </h1>

          <p className="text-red-600 mt-4">
            {
              message ||
              "Staff profile could not be loaded."
            }
          </p>

          <button
            type="button"
            onClick={
              handleSignOut
            }
            className="w-full bg-black text-white rounded-lg py-3 font-semibold mt-6"
          >
            RETURN TO LINE
          </button>

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
  // OMS HOME
  // =====================================================

  return (
    <main className="min-h-screen bg-gray-100 p-6 md:p-8">

      <div className="max-w-6xl mx-auto">

        {/* HEADER */}

        <div className="flex justify-between items-start gap-4 mb-10">

          <div>

            <p className="text-sm text-gray-500">
              B2B OMS
            </p>

            <h1 className="text-3xl font-bold mt-1">
              Hello,{" "}
              {
                staff.staff_name
              }
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

        {/* NAVIGATION */}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

          {navigation.map(
            (item) => {

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

      </div>

    </main>
  );
}