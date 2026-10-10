"use client";

import {
  useEffect,
  useState,
} from "react";

import {
  useRouter,
} from "next/navigation";

import {
  supabase,
} from "../../lib/supabase";

type Customer = {
  id: string;
  customerCode: string;
  customerName: string;
};

type StaffAccess = {
  staffId: string;
  staffCode: string;
  staffName: string;
  accountType: string;
};

type AccessResponse = {
  linked?: boolean;
  pendingAuthorization?: boolean;
  inactive?: boolean;

  lineUserId?: string;
  displayName?: string;

  hasCustomerAccess?: boolean;
  hasStaffAccess?: boolean;

  customers?: Customer[];

  staff?: StaffAccess | null;

  error?: string;
};

type StaffSessionResponse = {
  tokenHash?: string;

  staff?: {
    staffCode: string;
    staffName: string;
    accountType: string;
  };

  error?: string;
};

export default function MiniAppHomePage() {
  const router =
    useRouter();

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
    access,
    setAccess,
  ] =
    useState<AccessResponse | null>(
      null
    );

  const [
    portal,
    setPortal,
  ] =
    useState<
      | "choose"
      | "customer"
      | "staff"
    >("choose");

  const [
    selectedCustomer,
    setSelectedCustomer,
  ] =
    useState<Customer | null>(
      null
    );

  const [
    lineIdToken,
    setLineIdToken,
  ] =
    useState("");

  const [
    openingStaff,
    setOpeningStaff,
  ] =
    useState(false);

  // =====================================================
  // CUSTOMER NAVIGATION
  // =====================================================

  function openCustomer(
    customer: Customer
  ) {
    setPortal(
      "customer"
    );

    setSelectedCustomer(
      customer
    );

    router.replace(
      `/miniapp?portal=customer&customer=${customer.customerCode}`
    );
  }

  function enterCustomerPortal() {
    if (!access) {
      return;
    }

    const customers =
      access.customers ??
      [];

    setPortal(
      "customer"
    );

    if (
      customers.length ===
      1
    ) {
      openCustomer(
        customers[0]
      );

      return;
    }

    setSelectedCustomer(
      null
    );

    router.replace(
      "/miniapp?portal=customer"
    );
  }

  function showAccessChooser() {
    setSelectedCustomer(
      null
    );

    setPortal(
      "choose"
    );

    router.replace(
      "/miniapp?portal=access"
    );
  }

  function changeCustomer() {
    setSelectedCustomer(
      null
    );

    setPortal(
      "customer"
    );

    router.replace(
      "/miniapp?portal=customer"
    );
  }

  // =====================================================
  // LINE → SUPABASE STAFF LOGIN
  // =====================================================

  async function openStaffOms() {
    if (!lineIdToken) {
      setMessage(
        "LINE session is not ready."
      );

      return;
    }

    setOpeningStaff(
      true
    );

    setMessage(
      ""
    );

    try {
      // -------------------------------------------------
      // 1. Ask server to verify LINE identity
      //    and create a one-time Supabase login token
      // -------------------------------------------------

      const response =
        await fetch(
          "/api/line/staff-session",
          {
            method:
              "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify({
                idToken:
                  lineIdToken,
              }),
          }
        );

      const result =
        (await response.json()) as StaffSessionResponse;

      if (
        !response.ok ||
        !result.tokenHash
      ) {
        throw new Error(
          result.error ??
            "Could not create staff session."
        );
      }

      // -------------------------------------------------
      // 2. Convert one-time token into normal
      //    Supabase browser session
      // -------------------------------------------------

      const {
        data,
        error,
      } =
        await supabase.auth
          .verifyOtp({
            token_hash:
              result.tokenHash,

            type:
              "magiclink",
          });

      if (error) {
        throw new Error(
          error.message
        );
      }

      if (
        !data.session ||
        !data.user
      ) {
        throw new Error(
          "Staff login session was not created."
        );
      }

      // -------------------------------------------------
      // 3. Full navigation to OMS
      //
      // We deliberately bypass the old login screen.
      // -------------------------------------------------

      window.location.assign(
        "/tasks"
      );
    } catch (error) {
      console.error(
        "Staff LINE login:",
        error
      );

      setMessage(
        error instanceof
          Error
          ? error.message
          : "Could not sign in to the staff OMS."
      );

      setOpeningStaff(
        false
      );
    }
  }

  // =====================================================
  // INITIALIZE LINE
  // =====================================================

  useEffect(() => {
    let cancelled =
      false;

    async function initialize() {
      try {
        const params =
          new URLSearchParams(
            window.location.search
          );

        const requestedPortal =
          params.get(
            "portal"
          );

        const requestedCustomerCode =
          (
            params.get(
              "customer"
            ) ??
            ""
          )
            .trim()
            .toUpperCase();

        // -----------------------------------------------
        // LIFF
        // -----------------------------------------------

        const liffModule =
          await import(
            "@line/liff"
          );

        const liff =
          liffModule.default;

        const liffId =
          process.env
            .NEXT_PUBLIC_LINE_LIFF_ID;

        if (!liffId) {
          throw new Error(
            "LINE LIFF ID is missing."
          );
        }

        await liff.init({
          liffId,

          withLoginOnExternalBrowser:
            true,
        });

        if (
          !liff.isLoggedIn()
        ) {
          liff.login();

          return;
        }

        const idToken =
          liff.getIDToken();

        if (!idToken) {
          throw new Error(
            "LINE ID token was not available."
          );
        }

        // -----------------------------------------------
        // LOAD CUSTOMER + STAFF ACCESS
        // -----------------------------------------------

        const response =
          await fetch(
            "/api/line/customer",
            {
              method:
                "POST",

              headers: {
                "Content-Type":
                  "application/json",
              },

              body:
                JSON.stringify({
                  idToken,
                }),
            }
          );

        const data =
          (await response.json()) as AccessResponse;

        if (
          !response.ok
        ) {
          throw new Error(
            data.error ??
              "Could not check LINE account."
          );
        }

        if (cancelled) {
          return;
        }

        setLineIdToken(
          idToken
        );

        setAccess(
          data
        );

        const customers =
          data.customers ??
          [];

        // ===============================================
        // EXPLICIT CUSTOMER HOME
        //
        // /miniapp?portal=customer&customer=C001
        // ===============================================

        if (
          requestedPortal ===
            "customer" &&
          data.hasCustomerAccess
        ) {
          setPortal(
            "customer"
          );

          if (
            requestedCustomerCode
          ) {
            const requestedCustomer =
              customers.find(
                (customer) =>
                  customer.customerCode ===
                  requestedCustomerCode
              );

            if (
              requestedCustomer
            ) {
              setSelectedCustomer(
                requestedCustomer
              );
            } else if (
              customers.length ===
              1
            ) {
              setSelectedCustomer(
                customers[0]
              );
            }
          } else if (
            customers.length ===
            1
          ) {
            setSelectedCustomer(
              customers[0]
            );
          }

          setLoading(
            false
          );

          return;
        }

        // ===============================================
        // EXPLICIT ACCESS CHOOSER
        // ===============================================

        if (
          requestedPortal ===
            "access" &&
          data.hasCustomerAccess &&
          data.hasStaffAccess
        ) {
          setPortal(
            "choose"
          );

          setLoading(
            false
          );

          return;
        }

        // ===============================================
        // EXPLICIT STAFF
        // ===============================================

        if (
          requestedPortal ===
            "staff" &&
          data.hasStaffAccess
        ) {
          setPortal(
            "staff"
          );

          setLoading(
            false
          );

          return;
        }

        // ===============================================
        // DEFAULT ROUTING
        // ===============================================

        if (
          data.hasCustomerAccess &&
          data.hasStaffAccess
        ) {
          setPortal(
            "choose"
          );
        } else if (
          data.hasCustomerAccess
        ) {
          setPortal(
            "customer"
          );

          if (
            customers.length ===
            1
          ) {
            setSelectedCustomer(
              customers[0]
            );
          }
        } else if (
          data.hasStaffAccess
        ) {
          setPortal(
            "staff"
          );
        }

        setLoading(
          false
        );
      } catch (error) {
        if (cancelled) {
          return;
        }

        console.error(
          "MINI App initialization:",
          error
        );

        setMessage(
          error instanceof
            Error
            ? error.message
            : "Could not connect to LINE."
        );

        setLoading(
          false
        );
      }
    }

    initialize();

    return () => {
      cancelled =
        true;
    };
  }, []);

  // =====================================================
  // LOADING
  // =====================================================

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-100 flex items-center justify-center p-6">

        <div className="text-center">

          <p className="text-xl font-bold">
            LOTUS&apos;S B2B
          </p>

          <p className="text-gray-500 mt-3">
            Checking your LINE access...
          </p>

        </div>

      </main>
    );
  }

  // =====================================================
  // ERROR
  // =====================================================

  if (message) {
    return (
      <main className="min-h-screen bg-gray-100 p-5">

        <div className="max-w-md mx-auto">

          <div className="bg-white border rounded-2xl p-6 mt-8">

            <h1 className="text-xl font-bold">
              Could Not Open MINI App
            </h1>

            <p className="text-red-600 mt-3">
              {
                message
              }
            </p>

            <button
              type="button"
              onClick={() =>
                window.location.reload()
              }
              className="w-full border rounded-xl px-5 py-3 font-semibold mt-5"
            >
              TRY AGAIN
            </button>

          </div>

        </div>

      </main>
    );
  }

  // =====================================================
  // NO ACCESS PROFILE
  // =====================================================

  if (!access) {
    return (
      <main className="min-h-screen bg-gray-100 p-5">

        <div className="max-w-md mx-auto">

          <div className="bg-white border rounded-2xl p-6 mt-8">

            <h1 className="text-xl font-bold">
              Could Not Load Access
            </h1>

            <p className="text-gray-500 mt-3">
              Your LINE access profile could not be loaded.
            </p>

          </div>

        </div>

      </main>
    );
  }

  // =====================================================
  // REGISTERED BUT NOT AUTHORIZED
  // =====================================================

  if (!access.linked) {
    return (
      <main className="min-h-screen bg-gray-100 p-5">

        <div className="max-w-md mx-auto">

          <p className="text-xl font-bold text-center mt-8">
            LOTUS&apos;S B2B
          </p>

          <div className="bg-white border rounded-2xl p-6 mt-6">

            <h1 className="text-xl font-bold">
              Awaiting Authorization
            </h1>

            <p className="text-gray-500 mt-3">
              Your LINE account has been registered, but it has not yet been authorized for a customer or staff account.
            </p>

            {access.displayName && (
              <p className="font-semibold mt-5">
                {
                  access.displayName
                }
              </p>
            )}

            <p className="text-sm text-gray-400 mt-2">
              Please contact your manager or salesperson.
            </p>

          </div>

        </div>

      </main>
    );
  }

  // =====================================================
  // CHOOSE ACCESS
  // =====================================================

  if (
    portal ===
    "choose"
  ) {
    return (
      <main className="min-h-screen bg-gray-100 p-5">

        <div className="max-w-md mx-auto">

          <div className="mt-8">

            <p className="text-sm text-gray-500">
              LOTUS&apos;S B2B
            </p>

            <h1 className="text-3xl font-bold mt-2">
              Choose Access
            </h1>

            {access.displayName && (
              <p className="text-gray-500 mt-1">
                {
                  access.displayName
                }
              </p>
            )}

          </div>

          <div className="space-y-4 mt-7">

            {access.hasCustomerAccess && (

              <button
                type="button"
                onClick={
                  enterCustomerPortal
                }
                className="w-full bg-white border rounded-2xl p-6 text-left"
              >

                <p className="text-xl font-bold">
                  Customer
                </p>

                <p className="text-gray-500 mt-2">
                  Order products, track orders and view order history.
                </p>

                <p className="font-semibold mt-4">
                  OPEN CUSTOMER PORTAL →
                </p>

              </button>

            )}

            {access.hasStaffAccess &&
              access.staff && (

              <button
                type="button"
                onClick={
                  openStaffOms
                }
                disabled={
                  openingStaff
                }
                className="w-full bg-white border rounded-2xl p-6 text-left disabled:opacity-50"
              >

                <p className="text-xl font-bold">
                  Staff / Manager
                </p>

                <p className="text-gray-500 mt-2">
                  {
                    access.staff.staffName
                  }
                  {" · "}
                  {
                    access.staff.accountType
                  }
                </p>

                <p className="font-semibold mt-4">
                  {openingStaff
                    ? "SIGNING IN..."
                    : "OPEN STAFF OMS →"}
                </p>

              </button>

            )}

          </div>

        </div>

      </main>
    );
  }

  // =====================================================
  // STAFF-ONLY ACCESS
  // =====================================================

  if (
    portal ===
      "staff" &&
    access.staff
  ) {
    return (
      <main className="min-h-screen bg-gray-100 p-5">

        <div className="max-w-md mx-auto">

          {access.hasCustomerAccess && (
            <button
              type="button"
              onClick={
                showAccessChooser
              }
              className="text-gray-500"
            >
              ← Choose Access
            </button>
          )}

          <div className="bg-white border rounded-2xl p-6 mt-6">

            <p className="text-sm text-gray-500">
              STAFF ACCESS
            </p>

            <h1 className="text-2xl font-bold mt-2">
              {
                access.staff.staffName
              }
            </h1>

            <p className="text-gray-500 mt-1">
              {
                access.staff.staffCode
              }
              {" · "}
              {
                access.staff.accountType
              }
            </p>

            <button
              type="button"
              onClick={
                openStaffOms
              }
              disabled={
                openingStaff
              }
              className="w-full bg-black text-white rounded-xl px-5 py-4 font-semibold mt-6 disabled:opacity-40"
            >
              {openingStaff
                ? "SIGNING IN..."
                : "OPEN STAFF OMS"}
            </button>

          </div>

        </div>

      </main>
    );
  }

  // =====================================================
  // CHOOSE CUSTOMER
  // =====================================================

  if (
    portal ===
      "customer" &&
    !selectedCustomer &&
    (
      access.customers ??
      []
    ).length >
      1
  ) {
    return (
      <main className="min-h-screen bg-gray-100 p-5">

        <div className="max-w-md mx-auto">

          {access.hasStaffAccess && (
            <button
              type="button"
              onClick={
                showAccessChooser
              }
              className="text-gray-500"
            >
              ← Choose Access
            </button>
          )}

          <h1 className="text-2xl font-bold mt-6">
            Choose Customer
          </h1>

          <p className="text-gray-500 mt-1 mb-5">
            Select the customer account you want to use.
          </p>

          <div className="space-y-3">

            {(
              access.customers ??
              []
            ).map(
              (
                customer
              ) => (

              <button
                key={
                  customer.id
                }
                type="button"
                onClick={() =>
                  openCustomer(
                    customer
                  )
                }
                className="w-full bg-white border rounded-2xl p-5 text-left"
              >

                <p className="font-bold text-lg">
                  {
                    customer.customerName
                  }
                </p>

                <p className="text-gray-500 mt-1">
                  {
                    customer.customerCode
                  }
                </p>

              </button>

            ))}

          </div>

        </div>

      </main>
    );
  }

  // =====================================================
  // CUSTOMER HOME
  // =====================================================

  if (
    portal ===
      "customer" &&
    selectedCustomer
  ) {
    return (
      <main className="min-h-screen bg-gray-100 p-5">

        <div className="max-w-md mx-auto">

          <div className="flex justify-between items-center gap-3">

            {(
              access.customers ??
              []
            ).length >
              1 ? (

              <button
                type="button"
                onClick={
                  changeCustomer
                }
                className="text-gray-500"
              >
                ← Change Customer
              </button>

            ) : (
              <div />
            )}

            {access.hasStaffAccess && (

              <button
                type="button"
                onClick={
                  showAccessChooser
                }
                className="text-gray-500"
              >
                Change Access
              </button>

            )}

          </div>

          <div className="mt-6">

            <p className="text-sm text-gray-500">
              LOTUS&apos;S B2B
            </p>

            <h1 className="text-3xl font-bold mt-2">
              {
                selectedCustomer.customerName
              }
            </h1>

            <p className="text-gray-500">
              {
                selectedCustomer.customerCode
              }
            </p>

          </div>

          <div className="space-y-3 mt-7">

            {/* ORDER PRODUCTS */}

            <button
              type="button"
              onClick={() =>
                router.push(
                  `/miniapp/shop?customer=${selectedCustomer.customerCode}`
                )
              }
              className="w-full bg-black text-white rounded-2xl p-5 text-left"
            >

              <p className="font-bold text-lg">
                Order Products
              </p>

              <p className="text-sm opacity-70 mt-1">
                Browse products and place a new order.
              </p>

            </button>

            {/* TRACK ORDER */}

            <button
              type="button"
              onClick={() =>
                router.push(
                  `/miniapp/orders?customer=${selectedCustomer.customerCode}&view=active`
                )
              }
              className="w-full bg-white border rounded-2xl p-5 text-left"
            >

              <p className="font-bold text-lg">
                Track My Order
              </p>

              <p className="text-sm text-gray-500 mt-1">
                View current orders and payment status.
              </p>

            </button>

            {/* HISTORY */}

            <button
              type="button"
              onClick={() =>
                router.push(
                  `/miniapp/orders?customer=${selectedCustomer.customerCode}&view=history`
                )
              }
              className="w-full bg-white border rounded-2xl p-5 text-left"
            >

              <p className="font-bold text-lg">
                Order History
              </p>

              <p className="text-sm text-gray-500 mt-1">
                View completed orders.
              </p>

            </button>

          </div>

        </div>

      </main>
    );
  }

  return null;
}