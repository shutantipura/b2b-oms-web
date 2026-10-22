"use client";

import {

  useEffect,

  useRef,

  useState,

} from "react";

import {

  useRouter,

} from "next/navigation";

import {

  supabase,

} from "../../lib/supabase";

import LotusLoading from "../../components/LotusLoading";

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

function NavigationArrow({ light = false }: { light?: boolean }) {
  return (
    <span className={`grid h-9 w-9 place-items-center rounded-full ${light ? "bg-white/15 text-white" : "bg-[#EAF8F5] text-[#009F9D]"}`}>
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M5 12h14" />
        <path d="m13 6 6 6-6 6" />
      </svg>
    </span>
  );
}

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

  const [customerSearch, setCustomerSearch] = useState("");

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
  const autoStaffLoginAttempted = useRef(false);

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

        // Both customer and staff access: always show the account-type
        // chooser by default. Explicit portal links are handled above.
        if (

          data.hasCustomerAccess &&

          data.hasStaffAccess

        ) {

          setPortal("choose");

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

            router.replace(
              `/miniapp?portal=customer&customer=${encodeURIComponent(customers[0].customerCode)}`
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

  // Staff/manager-only LINE accounts enter OMS automatically.
  // The guard avoids repeated login attempts after a timeout or failure.
  useEffect(() => {
    if (
      loading ||
      !access?.hasStaffAccess ||
      access.hasCustomerAccess ||
      portal !== "staff" ||
      !lineIdToken ||
      autoStaffLoginAttempted.current
    ) return;

    autoStaffLoginAttempted.current = true;
    void openStaffOms();
  }, [loading, access?.hasStaffAccess, access?.hasCustomerAccess, portal, lineIdToken]);

  // =====================================================

  // LOADING

  // =====================================================

  if (loading) {

    return <LotusLoading message="กำลังตรวจสอบสิทธิ์การใช้งาน LINE..." />;

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
    portal === "customer" &&
    !selectedCustomer &&
    (access.customers ?? []).length > 1
  ) {
    const availableCustomers = access.customers ?? [];
    const query = customerSearch.trim().toLocaleLowerCase();
    const filteredCustomers = query
      ? availableCustomers.filter((customer) =>
          customer.customerName.toLocaleLowerCase().includes(query) ||
          customer.customerCode.toLocaleLowerCase().includes(query)
        )
      : availableCustomers;

    return (
      <main className="min-h-screen bg-[#F7FAFA] pb-16 text-[#173E31]">
        <header className="sticky top-0 z-20 border-b border-[#E2ECE7] bg-white/95 backdrop-blur-md">
          <div className="mx-auto flex max-w-xl items-center justify-center px-4 py-3">
            <div className="text-center">
              <p className="text-xl font-black tracking-tight text-[#02B0AF]">
                Lotus<span className="text-[#FDBC16]">’s</span>
                <span className="ml-1 text-base text-[#17453F]">B2B</span>
              </p>
              <p className="text-[10px] font-medium text-[#79988B]">เพื่อธุรกิจที่ไปได้ไกลกว่า</p>
            </div>
          </div>
        </header>

        <div className="mx-auto max-w-xl space-y-5 px-4 pt-5 sm:px-6">
          {access.hasStaffAccess && (
            <button
              type="button"
              onClick={showAccessChooser}
              className="inline-flex min-h-11 items-center gap-1 rounded-xl px-1 text-sm font-bold text-[#558075]"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m15 18-6-6 6-6" />
              </svg>
              เลือกประเภทการใช้งาน
            </button>
          )}

          <div className="rounded-[24px] border border-[#D7E9E3] bg-white p-5 shadow-[0_4px_18px_rgba(0,105,100,0.05)] sm:p-6">
            <div className="mb-4 h-1 w-10 rounded-full bg-[#FDBC16]" />
            <p className="text-xs font-extrabold tracking-wide text-[#008F8D]">LOTUS’S FOR BUSINESS</p>
            <h1 className="mt-2 text-[26px] font-black leading-tight tracking-tight sm:text-3xl">เลือกบัญชีลูกค้า</h1>
            <p className="mt-2 text-sm leading-6 text-[#6D8D7E]">
              คุณต้องการสั่งซื้อสินค้าให้ร้านใด?
              เลือกบัญชีเพื่อดูสินค้าและราคาของร้านนั้น
            </p>
            <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-[#EAF8F5] px-3 py-1.5 text-xs font-bold text-[#008F8D]">
              <span className="h-2 w-2 rounded-full bg-[#02B0AF]" />
              {availableCustomers.length} บัญชีที่ได้รับอนุญาต
            </div>
          </div>

          {availableCustomers.length >= 4 && (
            <div className="rounded-2xl border-2 border-[#B6DDD5] bg-white px-4 py-3 shadow-sm focus-within:border-[#02B0AF] focus-within:ring-2 focus-within:ring-[#02B0AF]/15">
              <label htmlFor="customer-account-search" className="flex items-center gap-3">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#008F8D" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <circle cx="10.8" cy="10.8" r="7.3" />
                  <path d="m16.3 16.3 4.2 4.2" />
                </svg>
                <span className="sr-only">ค้นหาชื่อร้านหรือรหัสลูกค้า</span>
                <input
                  id="customer-account-search"
                  type="search"
                  value={customerSearch}
                  onChange={(event) => setCustomerSearch(event.target.value)}
                  placeholder="ค้นหาชื่อร้าน หรือรหัสลูกค้า"
                  className="min-h-7 w-full min-w-0 bg-transparent text-sm font-medium text-[#173E31] outline-none placeholder:text-[#91A89A]"
                />
              </label>
            </div>
          )}

          <section aria-label="บัญชีลูกค้าที่เลือกได้">
            <div className="mb-3 flex items-center justify-between gap-2 px-1">
              <h2 className="text-sm font-extrabold text-[#476B5C]">บัญชีลูกค้าของคุณ</h2>
              {availableCustomers.length >= 4 && (
                <p className="text-xs font-semibold text-[#849F91]">
                  แสดง {filteredCustomers.length} จาก {availableCustomers.length} บัญชี
                </p>
              )}
            </div>

            {filteredCustomers.length > 0 ? (
              <div className="space-y-3">
                {filteredCustomers.map((customer) => (
                  <button
                    key={customer.id}
                    type="button"
                    onClick={() => openCustomer(customer)}
                    className="group flex min-h-[92px] w-full items-center gap-3 rounded-2xl border-2 border-[#D5E7E0] bg-white p-4 text-left shadow-[0_3px_12px_rgba(0,105,100,0.05)] transition hover:border-[#02B0AF] hover:bg-[#F8FDFC] active:scale-[0.99] sm:p-5"
                  >
                    <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[#E9F8F4] p-2.5 text-[#008F8D]">
                      <svg width="29" height="29" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M3.5 10h17l-1.3-5H4.8L3.5 10Z" />
                        <path d="M4.5 10v9h15v-9" />
                        <path d="M9 19v-6h6v6" />
                        <path d="M3.5 10c0 1.6 1.4 2.5 2.8 2.5 1.4 0 2.4-.9 2.4-2.5 0 1.6 1.4 2.5 3.3 2.5s3.3-.9 3.3-2.5c0 1.6 1.1 2.5 2.4 2.5 1.5 0 2.8-.9 2.8-2.5" />
                      </svg>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block break-words text-base font-extrabold leading-6 text-[#244D3F]">{customer.customerName}</span>
                      <span className="mt-1 block text-xs font-medium text-[#859D91]">
                        รหัสลูกค้า <span className="font-bold tabular-nums text-[#557E70]">{customer.customerCode}</span>
                      </span>
                    </span>
                    <span className="shrink-0 transition group-hover:translate-x-0.5">
                      <NavigationArrow />
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-[#C9DED4] bg-white px-5 py-10 text-center">
                <p className="text-base font-extrabold text-[#4C7565]">ไม่พบบัญชีลูกค้า</p>
                <p className="mt-2 text-sm text-[#88A095]">ลองค้นหาด้วยชื่อร้านหรือรหัสลูกค้าอีกครั้ง</p>
                <button type="button" onClick={() => setCustomerSearch("")} className="mt-4 min-h-10 rounded-xl bg-[#E7F8F3] px-5 text-sm font-extrabold text-[#008F8D]">
                  ล้างคำค้นหา
                </button>
              </div>
            )}
          </section>

          <div className="rounded-2xl bg-[#EAF7F2] px-4 py-4 text-xs leading-5 text-[#628475]">
            <span className="font-bold text-[#008F8D]">หมายเหตุ:</span> สินค้า ราคา และคำสั่งซื้อจะเปลี่ยนตามบัญชีลูกค้าที่คุณเลือก
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

      <main className="min-h-screen bg-[#F7FAFA] p-4 pb-12 text-[#173E31] sm:p-6">

        <div className="max-w-lg mx-auto">

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

                className="rounded-xl px-2 py-3 text-sm font-bold text-[#426559]"

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

                className="rounded-xl px-2 py-3 text-xs font-semibold text-[#008F8D]"

              >

                เปลี่ยนประเภทการใช้งาน

              </button>

            )}

          </div>

          <div className="mt-5 rounded-2xl border border-[#DDECE5] bg-white px-5 py-6 text-center shadow-sm">

            <h1 className="text-3xl font-black tracking-tight text-[#02B0AF]">Lotus<span className="text-[#FDBC16]">’s</span><span className="ml-2 text-xl text-[#17453F]">B2B</span></h1>

            <p className="mt-1 text-xs font-semibold text-[#82968D]">สั่งซื้อง่าย เพื่อธุรกิจของคุณ</p>

            <p className="mt-5 truncate text-base font-extrabold text-[#315E4C]">

              {

                selectedCustomer.customerName

              }

            </p>

            <p className="mt-1 text-xs text-[#8B9D91]">

              {

                selectedCustomer.customerCode

              }

            </p>

          </div>

          <div className="space-y-3 mt-5">

            {/* ORDER PRODUCTS */}

            <button

              type="button"

              onClick={() =>

                router.push(

                  `/miniapp/shop?customer=${selectedCustomer.customerCode}`

                )

              }

              className="group relative w-full overflow-hidden rounded-2xl bg-[#02B0AF] p-5 text-left text-white shadow-[0_8px_24px_rgba(2,176,175,0.20)] transition hover:bg-[#009C9A]"

            >

              <div className="mb-4 flex items-center justify-between"><span className="grid h-12 w-12 place-items-center rounded-xl bg-white/20 text-2xl">🛒</span><NavigationArrow light /></div>

              <p className="font-extrabold text-xl"><span className="mr-2 inline-block h-2 w-2 rounded-full bg-[#FDBC16] align-middle" />

                เลือกซื้อสินค้า

              </p>

              <p className="text-sm text-white/85 mt-1">

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

              className="w-full rounded-2xl border-2 border-[#C7E7DD] bg-white p-5 text-left shadow-sm transition hover:border-[#02B0AF]"

            >

              <div className="mb-3 flex items-center justify-between"><span className="grid h-11 w-11 place-items-center rounded-xl bg-[#E8F8F5] text-xl">📋</span><NavigationArrow /></div>

              <p className="font-extrabold text-lg text-[#173E31]">

                คำสั่งซื้อของฉัน

              </p>

              <p className="text-sm text-[#82968D] mt-1">

                ติดตามสถานะคำสั่งซื้อที่กำลังดำเนินการ

              </p>

            </button>

            {/* ORDER HISTORY */}
            <button
              type="button"
              onClick={() => router.push(`/miniapp/orders?customer=${encodeURIComponent(selectedCustomer.customerCode)}&view=history`)}
              className="w-full rounded-2xl border-2 border-[#C7E7DD] bg-white p-5 text-left shadow-sm transition hover:border-[#02B0AF]"
            >
              <div className="mb-3 flex items-center justify-between"><span className="grid h-11 w-11 place-items-center rounded-xl bg-[#FFF3D2] text-xl">🕒</span><NavigationArrow /></div>
              <p className="text-lg font-extrabold text-[#173E31]">ประวัติคำสั่งซื้อ</p>
              <p className="mt-1 text-sm text-[#82968D]">ดูคำสั่งซื้อที่เสร็จสิ้นหรือถูกยกเลิก</p>
            </button>

          </div>

        </div>

      </main>

    );

  }

  return null;

}
