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

  code?: string;

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

  // A LINE in-app browser can be slow to establish a Supabase session.
  // Show which step is taking time and never leave the button spinning forever.
  const [staffLoginStep, setStaffLoginStep] = useState("");

  async function openStaffOms() {
    if (openingStaff) return;
    if (!lineIdToken) {
      setMessage("เซสชัน LINE ยังไม่พร้อมใช้งาน กรุณาลองเปิด MINI App อีกครั้ง");
      return;
    }

    setOpeningStaff(true);
    setStaffLoginStep("กำลังตรวจสอบบัญชีพนักงาน...");
    setMessage("");
    const startedAt = performance.now();
    let currentStage = "staff-session";
    const controller = new AbortController();
    const serverTimeout = setTimeout(() => controller.abort(), 15000);

    try {
      const response = await fetch("/api/line/staff-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken: lineIdToken }),
        cache: "no-store",
        signal: controller.signal,
      });
      clearTimeout(serverTimeout);

      const result = (await response.json()) as StaffSessionResponse;
      const serverMs = Math.round(performance.now() - startedAt);
      console.info("[LINE Staff Login] Staff-session response", {
        status: response.status,
        durationMs: serverMs,
        serverTiming: response.headers.get("Server-Timing"),
      });

      if (!response.ok || !result.tokenHash) {
        throw new Error(result.error ?? "ไม่สามารถสร้างเซสชันสำหรับพนักงานได้");
      }

      currentStage = "verify-otp";
      setStaffLoginStep("กำลังเชื่อมต่อ Supabase...");
      const verifyStartedAt = performance.now();
      let verifyTimeout: ReturnType<typeof setTimeout> | undefined;
      // Promise.race bounds the UI wait; it does not cancel Supabase's
      // underlying request. On timeout, reload before attempting again.
      const verification = await Promise.race([
        supabase.auth.verifyOtp({
          token_hash: result.tokenHash,
          type: "magiclink",
        }),
        new Promise<never>((_, reject) => {
          verifyTimeout = setTimeout(
            () => reject(new Error("Supabase ใช้เวลาตรวจสอบเซสชันนานเกิน 15 วินาที กรุณาปิดแล้วเปิด MINI App ใหม่")),
            15000
          );
        }),
      ]).finally(() => {
        if (verifyTimeout) clearTimeout(verifyTimeout);
      });

      console.info("[LINE Staff Login] Supabase verification", {
        durationMs: Math.round(performance.now() - verifyStartedAt),
      });
      if (verification.error) throw new Error(verification.error.message);
      if (!verification.data.session || !verification.data.user) {
        throw new Error("ไม่สามารถสร้างเซสชันเข้าสู่ระบบพนักงานได้");
      }

      setStaffLoginStep("กำลังเปิดระบบ OMS...");
      window.location.assign("/tasks");
    } catch (error) {
      clearTimeout(serverTimeout);
      console.error("[LINE Staff Login]", {
        stage: currentStage,
        elapsedMs: Math.round(performance.now() - startedAt),
        error,
      });
      const isAbort = error instanceof Error && error.name === "AbortError";
      setMessage(isAbort
        ? "การตรวจสอบบัญชีพนักงานใช้เวลานานเกิน 15 วินาที กรุณาลองใหม่อีกครั้ง"
        : error instanceof Error
          ? error.message
          : "ไม่สามารถเข้าสู่ระบบ OMS สำหรับพนักงานได้");
      setStaffLoginStep("");
      setOpeningStaff(false);
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

            "ไม่พบ LINE LIFF ID"

          );

        }

        try {

  await liff.init({

    liffId,

    withLoginOnExternalBrowser:

      true,

  });

} catch (error) {

  throw new Error(

    `LIFF init failed for ${liffId}: ${

      error instanceof Error

        ? error.message

        : String(error)

    }`

  );

}

        if (!liff.isLoggedIn()) {
          // Desktop browsers must authenticate through the LIFF endpoint,
          // not the miniapp.line.me mobile-only launch URL.
          liff.login({ redirectUri: window.location.origin + "/miniapp" });
          return;
        }

        const idToken =

          liff.getIDToken();

        if (!idToken) {

          throw new Error(

            "ไม่สามารถอ่าน LINE ID token ได้"

          );

        }

        // -----------------------------------------------

        // LOAD CUSTOMER + ระบบพนักงาน

        // -----------------------------------------------

        const controller = new AbortController();
        const customerTimeout = setTimeout(() => controller.abort(), 15000);
        let response: Response;
        try {
          response = await fetch("/api/line/customer", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ idToken }),
            cache: "no-store",
            signal: controller.signal,
          });
        } finally {
          clearTimeout(customerTimeout);
        }

        const data =

          (await response.json()) as AccessResponse;

        if (!response.ok) {
          // A stale desktop LIFF session can return an expired ID token.
          // Reauthenticate ONCE; never loop indefinitely on a bad channel setup.
          const retryKey = "lotus_b2b_desktop_line_reauth_once";
          const externalBrowser = !liff.isInClient();
          if (
            response.status === 401 &&
            data.code === "LINE_ID_TOKEN_INVALID" &&
            externalBrowser &&
            window.sessionStorage.getItem(retryKey) !== "1"
          ) {
            window.sessionStorage.setItem(retryKey, "1");
            liff.logout();
            liff.login({ redirectUri: window.location.origin + "/miniapp" });
            return;
          }
          if (response.status === 401 && externalBrowser) {
            throw new Error(
              (data.error ?? "LINE ไม่สามารถยืนยันตัวตนได้") +
              " กรุณาตรวจสอบว่า LINE Login Channel ID ตรงกับช่องทางของ LIFF และลองเข้าสู่ระบบใหม่"
            );
          }
          throw new Error(data.error ?? "ไม่สามารถตรวจสอบบัญชี LINE ได้");
        }
        if (!liff.isInClient()) {
          window.sessionStorage.removeItem("lotus_b2b_desktop_line_reauth_once");
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

            : "ไม่สามารถเชื่อมต่อกับ LINE ได้"

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

            กำลังตรวจสอบสิทธิ์การใช้งาน LINE...

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

              ไม่สามารถเปิด MINI App ได้

            </h1>

            <p className="text-red-600 mt-3">

              {

                message

              }

            </p>

            <button
              type="button"
              onClick={async () => {
                const liffModule = await import("@line/liff");
                const liff = liffModule.default;
                window.sessionStorage.removeItem("lotus_b2b_desktop_line_reauth_once");
                try { liff.logout(); } catch { /* LIFF may not be initialized */ }
                window.location.assign("/miniapp");
              }}
              className="w-full bg-black text-white rounded-xl px-5 py-3 font-semibold mt-5"
            >
              เข้าสู่ระบบ LINE ใหม่
            </button>

            <button

              type="button"

              onClick={() =>

                window.location.reload()

              }

              className="w-full border rounded-xl px-5 py-3 font-semibold mt-5"

            >

              ลองอีกครั้ง

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

              ไม่สามารถโหลดสิทธิ์การใช้งานได้

            </h1>

            <p className="text-gray-500 mt-3">

              ไม่สามารถโหลดข้อมูลสิทธิ์ของบัญชี LINE นี้ได้

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

              รอการอนุมัติสิทธิ์

            </h1>

            <p className="text-gray-500 mt-3">

              บัญชี LINE ของคุณลงทะเบียนแล้ว แต่ยังไม่ได้รับสิทธิ์ให้ใช้งานในฐานะลูกค้าหรือพนักงาน

            </p>

            {access.displayName && (

              <p className="font-semibold mt-5">

                {

                  access.displayName

                }

              </p>

            )}

            <p className="text-sm text-gray-400 mt-2">

              กรุณาติดต่อผู้จัดการหรือพนักงานขายเพื่อขอสิทธิ์ใช้งาน

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

              เลือกประเภทการใช้งาน

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

                  ลูกค้า

                </p>

                <p className="text-gray-500 mt-2">

                  สั่งสินค้าและดูคำสั่งซื้อ

                </p>

                <p className="font-semibold mt-4">

                  เข้าสู่หน้าลูกค้า →

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

                  พนักงาน / ผู้จัดการ

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

                    ? (staffLoginStep || "กำลังเข้าสู่ระบบ...")

                    : "เข้าสู่ระบบพนักงาน →"}

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

              ← เลือกประเภทการใช้งาน

            </button>

          )}

          <div className="bg-white border rounded-2xl p-6 mt-6">

            <p className="text-sm text-gray-500">

              ระบบพนักงาน

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

                ? (staffLoginStep || "กำลังเข้าสู่ระบบ...")

                : "เข้าสู่ระบบพนักงาน"}

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

              ← เลือกประเภทการใช้งาน

            </button>

          )}

          <h1 className="text-2xl font-bold mt-6">

            เลือกลูกค้า

          </h1>

          <p className="text-gray-500 mt-1 mb-5">

            เลือกบัญชีลูกค้าที่ต้องการใช้งาน

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

                ← เปลี่ยนลูกค้า

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

                เปลี่ยนประเภทการใช้งาน

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

                สั่งสินค้า

              </p>

              <p className="text-sm opacity-70 mt-1">

                เลือกสินค้าและสร้างคำสั่งซื้อใหม่

              </p>

            </button>

            {/* ORDERS */}

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

                คำสั่งซื้อ

              </p>

              <p className="text-sm text-gray-500 mt-1">

                ติดตามสถานะคำสั่งซื้อปัจจุบันและดูประวัติคำสั่งซื้อ

              </p>

            </button>

          </div>

        </div>

      </main>

    );

  }

  return null;

}