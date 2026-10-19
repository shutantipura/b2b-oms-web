"use client";

import {

  useEffect,

  useState,

} from "react";

import {

  useRouter,

} from "next/navigation";

type Customer = {

  id: string;

  customerCode: string;

  customerName: string;

};

type OrderItem = {

  id: string;

  productName: string;

  unit: string;

  requested:

    | number

    | null;

  confirmed:

    | number

    | null;

  actual:

    | number

    | null;

};

type Order = {

  id: string;

  orderNumber: number;

  status: string;

  createdAt: string;

  deliveryDate:

    | string

    | null;

  deliverySlot:

    | string

    | null;

  deliveryAddress:

    | string

    | null;

  finalAmount:

    | number

    | null;

  items: OrderItem[];

};

type APIResponse = {

  customer?: Customer;

  customers?: Customer[];

  needsCustomerSelection?:

    boolean;

  mode?:

    | "active"

    | "history";

  orders?: Order[];

  error?: string;

};

const TRACKING_STEPS = [

  "ได้รับคำสั่งซื้อ",

  "ยืนยันคำสั่งซื้อ",

  "กำลังเตรียมสินค้า",

  "กำลังจัดส่ง",

  "ชำระเงิน",

  "เสร็จสิ้น",

];

// =====================================================

// STATUS → CUSTOMER TRACKING STEP

// =====================================================

function currentStep(

  status: string

) {

  switch (status) {

    case "awaiting_confirmation":

      return 0;

    case "awaiting_picking":

      return 1;

    case "picking":

    case "awaiting_billing":

    case "ready_for_delivery":

      return 2;

    case "out_for_delivery":

      return 3;

    case "awaiting_payment":

    case "payment_submitted":

      return 4;

    case "completed":

      return 5;

    default:

      return 0;

  }

}

function statusName(

  status: string

) {

  const names:

    Record<

      string,

      string

    > = {

    awaiting_confirmation:

      "ได้รับคำสั่งซื้อ",

    awaiting_picking:

      "ยืนยันคำสั่งซื้อ",

    picking:

      "กำลังเตรียมสินค้า",

    awaiting_billing:

      "กำลังเตรียมสินค้า",

    ready_for_delivery:

      "กำลังเตรียมสินค้า",

    out_for_delivery:

      "กำลังจัดส่ง",

    awaiting_payment:

      "รอชำระเงิน",

    payment_submitted:

      "ส่งหลักฐานการชำระเงินแล้ว",

    completed:

      "เสร็จสิ้น",

    cancelled:

      "ยกเลิก",

  };

  return (

    names[status] ??

    status

  );

}

function formatDate(

  date:

    | string

    | null

) {

  if (!date) {

    return "—";

  }

  const [

    year,

    month,

    day,

  ] =

    date

      .split("-")

      .map(Number);

  return new Intl.DateTimeFormat(

    "th-TH-u-ca-gregory",

    {

      day:

        "numeric",

      month:

        "short",

      year:

        "numeric",

    }

  ).format(

    new Date(

      year,

      month - 1,

      day

    )

  );

}

function quantityText(

  value:

    | number

    | null,

  unit: string

) {

  if (

    value ===

    null

  ) {

    return "—";

  }

  return `${value} ${unit}`;

}

export default function CustomerOrdersPage() {

  const router =

    useRouter();

  const [

    mode,

    setMode,

  ] =

    useState<

      "active" |

      "history"

    >("active");

  const [

    customerCode,

    setCustomerCode,

  ] =

    useState("");

  const [

    customer,

    setCustomer,

  ] =

    useState<Customer | null>(

      null

    );

  const [

    availableCustomers,

    setAvailableCustomers,

  ] =

    useState<

      Customer[]

    >([]);

  const [

    orders,

    setOrders,

  ] =

    useState<

      Order[]

    >([]);

  const [

    idToken,

    setIdToken,

  ] =

    useState("");

  const [

    loading,

    setLoading,

  ] =

    useState(true);

  const [

    refreshing,

    setRefreshing,

  ] =

    useState(false);

  const [

    message,

    setMessage,

  ] =

    useState("");

  const [

    lastUpdated,

    setLastUpdated,

  ] =

    useState<Date | null>(

      null

    );

  // =====================================================

  // CUSTOMER HOME

  // =====================================================

  function goCustomerHome() {

    const code =

      customer?.customerCode ??

      customerCode;

    if (!code) {

      router.push(

        "/miniapp?portal=customer"

      );

      return;

    }

    router.push(

      `/miniapp?portal=customer&customer=${code}`

    );

  }

  // =====================================================

  // LOAD ORDERS FROM SECURE API

  // =====================================================

  async function loadOrders(

    token: string,

    selectedMode:

      | "active"

      | "history",

    selectedCustomerCode:

      string,

    quiet = false

  ) {

    if (!quiet) {

      setRefreshing(

        true

      );

    }

    try {

      const response =

        await fetch(

          "/api/line/orders",

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

                  token,

                mode:

                  selectedMode,

                customerCode:

                  selectedCustomerCode ||

                  undefined,

              }),

          }

        );

      const data =

        (await response.json()) as APIResponse;

      if (

        !response.ok

      ) {

        throw new Error(

          data.error ??

            "ไม่สามารถโหลดคำสั่งซื้อได้"

        );

      }

      if (

        data.needsCustomerSelection

      ) {

        setAvailableCustomers(

          data.customers ??

            []

        );

        setCustomer(

          null

        );

        setOrders(

          []

        );

        setLastUpdated(

          new Date()

        );

        return;

      }

      setCustomer(

        data.customer ??

          null

      );

      setAvailableCustomers(

        data.customers ??

          []

      );

      setOrders(

        data.orders ??

          []

      );

      if (

        data.customer

          ?.customerCode

      ) {

        setCustomerCode(

          data.customer

            .customerCode

        );

      }

      setMessage(

        ""

      );

      setLastUpdated(

        new Date()

      );

    } catch (error) {

      setMessage(

        error instanceof

          Error

          ? error.message

          : "ไม่สามารถโหลดคำสั่งซื้อได้"

      );

    } finally {

      setRefreshing(

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

        const requestedMode =

          params.get(

            "view"

          ) ===

          "history"

            ? "history"

            : "active";

        const requestedCustomer =

          (

            params.get(

              "customer"

            ) ??

            ""

          )

            .trim()

            .toUpperCase();

        setMode(

          requestedMode

        );

        setCustomerCode(

          requestedCustomer

        );

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

        const token =

          liff.getIDToken();

        if (!token) {

          throw new Error(

            "ไม่สามารถอ่าน LINE ID token ได้"

          );

        }

        if (

          cancelled

        ) {

          return;

        }

        setIdToken(

          token

        );

        await loadOrders(

          token,

          requestedMode,

          requestedCustomer,

          true

        );

      } catch (error) {

        if (

          cancelled

        ) {

          return;

        }

        setMessage(

          error instanceof

            Error

            ? error.message

            : "ไม่สามารถเชื่อมต่อกับ LINE ได้"

        );

      } finally {

        if (

          !cancelled

        ) {

          setLoading(

            false

          );

        }

      }

    }

    initialize();

    return () => {

      cancelled =

        true;

    };

  }, []);

  // =====================================================

  // AUTO รีเฟรช ACTIVE ORDERS

  // =====================================================

  useEffect(() => {

    if (

      !idToken ||

      mode !==

        "active" ||

      !customer

    ) {

      return;

    }

    const interval =

      window.setInterval(

        () => {

          loadOrders(

            idToken,

            mode,

            customer.customerCode,

            true

          );

        },

        30_000

      );

    return () =>

      window.clearInterval(

        interval

      );

  }, [

    idToken,

    mode,

    customer?.customerCode,

  ]);

  // =====================================================

  // SWITCH CUSTOMER

  // =====================================================

  async function chooseCustomer(

    selected: Customer

  ) {

    setCustomerCode(

      selected.customerCode

    );

    await loadOrders(

      idToken,

      mode,

      selected.customerCode

    );

    window.history.replaceState(

      {},

      "",

      `/miniapp/orders?customer=${selected.customerCode}&view=${mode}`

    );

  }

  // =====================================================

  // SWITCH ACTIVE / HISTORY

  // =====================================================

  async function changeMode(

    nextMode:

      | "active"

      | "history"

  ) {

    setMode(

      nextMode

    );

    const code =

      customer?.customerCode ??

      customerCode;

    window.history.replaceState(

      {},

      "",

      `/miniapp/orders?view=${nextMode}${

        code

          ? `&customer=${code}`

          : ""

      }`

    );

    if (

      idToken

    ) {

      await loadOrders(

        idToken,

        nextMode,

        code

      );

    }

  }

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

            กำลังโหลดคำสั่งซื้อ...

          </p>

        </div>

      </main>

    );

  }

  // =====================================================

  // ERROR

  // =====================================================

  if (

    message &&

    !customer

  ) {

    return (

      <main className="min-h-screen bg-gray-100 p-5">

        <div className="max-w-md mx-auto">

          <button

            type="button"

            onClick={

              goCustomerHome

            }

            className="text-gray-500"

          >

            ← หน้าหลักลูกค้า

          </button>

          <div className="bg-white border rounded-2xl p-6 mt-5">

            <h1 className="font-bold text-xl">

              ไม่สามารถโหลดคำสั่งซื้อได้

            </h1>

            <p className="text-red-600 mt-3">

              {

                message

              }

            </p>

          </div>

        </div>

      </main>

    );

  }

  // =====================================================

  // MULTIPLE CUSTOMER SELECTION

  // =====================================================

  if (

    !customer &&

    availableCustomers.length >

      1

  ) {

    return (

      <main className="min-h-screen bg-gray-100 p-5">

        <div className="max-w-md mx-auto">

          <button

            type="button"

            onClick={() =>

              router.push(

                "/miniapp?portal=customer"

              )

            }

            className="text-gray-500"

          >

            ← หน้าลูกค้า

          </button>

          <h1 className="text-2xl font-bold mt-5">

            เลือกลูกค้า

          </h1>

          <p className="text-gray-500 mt-1 mb-5">

            เลือกบัญชีลูกค้าที่ต้องการดู

          </p>

          <div className="space-y-3">

            {availableCustomers.map(

              (

                customerOption

              ) => (

                <button

                  key={

                    customerOption.id

                  }

                  type="button"

                  onClick={() =>

                    chooseCustomer(

                      customerOption

                    )

                  }

                  className="w-full bg-white border rounded-2xl p-5 text-left"

                >

                  <p className="font-bold">

                    {

                      customerOption.customerName

                    }

                  </p>

                  <p className="text-sm text-gray-500 mt-1">

                    {

                      customerOption.customerCode

                    }

                  </p>

                </button>

              )

            )}

          </div>

        </div>

      </main>

    );

  }

  // =====================================================

  // PAGE

  // =====================================================

  return (

    <main className="min-h-screen bg-gray-100 pb-10">

      {/* HEADER */}

      <header className="bg-white border-b sticky top-0 z-20">

        <div className="max-w-2xl mx-auto px-4 py-4">

          <button

            type="button"

            onClick={

              goCustomerHome

            }

            className="text-sm text-gray-500"

          >

            ← หน้าหลักลูกค้า

          </button>

          <div className="flex justify-between items-start gap-4 mt-3">

            <div>

              <h1 className="text-2xl font-bold">

                {mode ===

                "active"

                  ? "ติดตามคำสั่งซื้อ"

                  : "ประวัติคำสั่งซื้อ"}

              </h1>

              {customer && (

                <p className="text-gray-500">

                  {

                    customer.customerName

                  }

                </p>

              )}

            </div>

            <button

              type="button"

              onClick={() =>

                loadOrders(

                  idToken,

                  mode,

                  customer?.customerCode ??

                    customerCode

                )

              }

              disabled={

                refreshing

              }

              className="border rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-40"

            >

              {refreshing

                ? "..."

                : "รีเฟรช"}

            </button>

          </div>

          {lastUpdated && (

            <p className="text-xs text-gray-400 mt-2">

              อัปเดตล่าสุด{" "}

              {lastUpdated.toLocaleTimeString(

                "th-TH-u-ca-gregory",

                {

                  hour:

                    "2-digit",

                  minute:

                    "2-digit",

                }

              )}

            </p>

          )}

        </div>

      </header>

      <div className="max-w-2xl mx-auto p-4">

        {/* ACTIVE / HISTORY */}

        <div className="grid grid-cols-2 bg-white border rounded-xl overflow-hidden mb-5">

          <button

            type="button"

            onClick={() =>

              changeMode(

                "active"

              )

            }

            className={

              mode ===

              "active"

                ? "bg-black text-white px-4 py-3 font-semibold"

                : "px-4 py-3 font-semibold"

            }

          >

            คำสั่งซื้อปัจจุบัน

          </button>

          <button

            type="button"

            onClick={() =>

              changeMode(

                "history"

              )

            }

            className={

              mode ===

              "history"

                ? "bg-black text-white px-4 py-3 font-semibold"

                : "px-4 py-3 font-semibold"

            }

          >

            ประวัติคำสั่งซื้อ

          </button>

        </div>

        {/* MESSAGE */}

        {message && (

          <div className="bg-white border rounded-xl p-4 mb-5 text-red-600">

            {

              message

            }

          </div>

        )}

        {/* EMPTY */}

        {orders.length ===

        0 ? (

          <div className="bg-white border rounded-2xl p-8 text-center">

            <p className="text-4xl">

              ✓

            </p>

            <h2 className="text-xl font-bold mt-4">

              {mode ===

              "active"

                ? "No คำสั่งซื้อปัจจุบัน"

                : "ยังไม่มีประวัติคำสั่งซื้อ"}

            </h2>

            <p className="text-gray-500 mt-2">

              {mode ===

              "active"

                ? "ขณะนี้ไม่มีคำสั่งซื้อที่กำลังดำเนินการ"

                : "คำสั่งซื้อที่เสร็จสิ้นแล้วจะแสดงที่นี่"}

            </p>

            {mode ===

              "active" &&

              customer && (

              <button

                type="button"

                onClick={() =>

                  router.push(

                    `/miniapp/shop?customer=${customer.customerCode}`

                  )

                }

                className="bg-black text-white rounded-xl px-6 py-3 font-semibold mt-6"

              >

                สั่งสินค้า

              </button>

            )}

          </div>

        ) : (

          <div className="space-y-5">

            {orders.map(

              (order) => {

                const step =

                  currentStep(

                    order.status

                  );

                return (

                  <section

                    key={

                      order.id

                    }

                    className="bg-white border rounded-2xl overflow-hidden"

                  >

                    {/* ORDER HEADER */}

                    <div className="p-5 border-b">

                      <div className="flex justify-between gap-4">

                        <div>

                          <p className="text-sm text-gray-500">

                            คำสั่งซื้อ

                          </p>

                          <h2 className="text-2xl font-bold">

                            #

                            {

                              order.orderNumber

                            }

                          </h2>

                        </div>

                        <div className="text-right">

                          <span className="inline-block bg-gray-100 rounded-full px-3 py-1 text-sm font-semibold">

                            {statusName(

                              order.status

                            )}

                          </span>

                        </div>

                      </div>

                      <div className="mt-4">

                        <p className="text-sm text-gray-500">

                          การจัดส่ง

                        </p>

                        <p className="font-semibold mt-1">

                          {formatDate(

                            order.deliveryDate

                          )}

                          {order.deliverySlot

                            ? ` · ${order.deliverySlot}`

                            : ""}

                        </p>

                      </div>

                    </div>

                    {/* TRACKING / CANCELLED */}

                    {order.status ===
                    "cancelled" ? (

                      <div className="p-5 border-b">

                        <div className="rounded-xl border border-red-200 bg-red-50 p-4">

                          <p className="font-bold text-red-700">
                            คำสั่งซื้อนี้ถูกยกเลิก
                          </p>

                          <p className="text-sm text-red-600 mt-1">
                            คำสั่งซื้อนี้จะไม่ถูกดำเนินการต่อ และถูกเก็บไว้ในประวัติคำสั่งซื้อ
                          </p>

                        </div>

                      </div>

                    ) : (

                      <>
                      <div className="p-5 border-b">

                        <h3 className="font-bold">

                          สถานะคำสั่งซื้อ

                        </h3>

                        <div className="mt-5 space-y-0">

                          {TRACKING_STEPS.map(

                            (

                              label,

                              index

                            ) => {

                              const done =

                                index <

                                step;

                              const current =

                                index ===

                                step;

                              return (

                                <div

                                  key={

                                    label

                                  }

                                  className="flex gap-4"

                                >

                                  <div className="flex flex-col items-center">

                                    <div

                                      className={

                                        done ||

                                        current

                                          ? "w-8 h-8 rounded-full bg-black text-white flex items-center justify-center text-sm font-bold"

                                          : "w-8 h-8 rounded-full border bg-white flex items-center justify-center text-sm text-gray-400"

                                      }

                                    >

                                      {done

                                        ? "✓"

                                        : current

                                        ? "●"

                                        : ""}

                                    </div>

                                    {index <

                                      TRACKING_STEPS.length -

                                        1 && (

                                      <div

                                        className={

                                          done

                                            ? "w-px h-8 bg-black"

                                            : "w-px h-8 bg-gray-200"

                                        }

                                      />

                                    )}

                                  </div>

                                  <div className="pt-1">

                                    <p

                                      className={

                                        done ||

                                        current

                                          ? "font-semibold"

                                          : "text-gray-400"

                                      }

                                    >

                                      {

                                        label

                                      }

                                    </p>

                                    {current && (

                                      <p className="text-xs text-gray-500 mt-1">

                                        สถานะปัจจุบัน

                                      </p>

                                    )}

                                  </div>

                                </div>

                              );

                            }

                          )}

                        </div>

                      </div>

                      {/* PAYMENT ACTION */}

                      {order.status ===

                        "awaiting_payment" &&

                        customer && (

                        <div className="p-5 border-b bg-gray-50">

                          <button

                            type="button"

                            onClick={() =>

                              router.push(

                                `/miniapp/payment?customer=${customer.customerCode}&order=${order.orderNumber}`

                              )

                            }

                            className="w-full bg-black text-white rounded-xl px-5 py-4 font-bold text-lg"

                          >

                            ชำระเงิน

                          </button>

                          <p className="text-xs text-gray-500 text-center mt-2">

                            ดูบิล QR สำหรับชำระเงิน และหลักฐานการจัดส่ง

                          </p>

                        </div>

                      )}

                      {order.status ===

                        "payment_submitted" &&

                        customer && (

                        <div className="p-5 border-b bg-gray-50">

                          <button

                            type="button"

                            onClick={() =>

                              router.push(

                                `/miniapp/payment?customer=${customer.customerCode}&order=${order.orderNumber}`

                              )

                            }

                            className="w-full border rounded-xl px-5 py-4 font-semibold"

                          >

                            ส่งหลักฐานการชำระเงินแล้ว ✓

                          </button>

                          <p className="text-xs text-gray-500 text-center mt-2">

                            กำลังรอทีมงานตรวจสอบการชำระเงิน

                          </p>

                        </div>

                      )}
                      </>

                    )}

                    {/* ITEMS */}

                    <div className="p-5 border-b">

                      <h3 className="font-bold mb-4">

                        รายการสินค้า

                      </h3>

                      {order.items.length ===

                      0 ? (

                        <p className="text-sm text-gray-500">

                          ไม่มีรายละเอียดสินค้า

                        </p>

                      ) : (

                        <div className="space-y-4">

                          {order.items.map(

                            (

                              item

                            ) => (

                            <div

                              key={

                                item.id

                              }

                              className="border rounded-xl p-4"

                            >

                              <p className="font-semibold">

                                {

                                  item.productName

                                }

                              </p>

                              <div className="grid grid-cols-3 gap-2 mt-4 text-center">

                                <div>

                                  <p className="text-xs text-gray-500">

                                    สั่งซื้อ

                                  </p>

                                  <p className="font-semibold mt-1">

                                    {quantityText(

                                      item.requested,

                                      item.unit

                                    )}

                                  </p>

                                </div>

                                <div>

                                  <p className="text-xs text-gray-500">

                                    ยืนยัน

                                  </p>

                                  <p className="font-semibold mt-1">

                                    {quantityText(

                                      item.confirmed,

                                      item.unit

                                    )}

                                  </p>

                                </div>

                                <div>

                                  <p className="text-xs text-gray-500">

                                    หยิบจริง

                                  </p>

                                  <p className="font-semibold mt-1">

                                    {quantityText(

                                      item.actual,

                                      item.unit

                                    )}

                                  </p>

                                </div>

                              </div>

                            </div>

                          ))}

                        </div>

                      )}

                    </div>

                    {/* FINAL AMOUNT */}

                    <div className="p-5">

                      <div className="flex justify-between items-center gap-4">

                        <div>

                          <p className="text-sm text-gray-500">

                            ยอดสุทธิ

                          </p>

                          {order.finalAmount ===

                            null && (

                            <p className="text-xs text-gray-400 mt-1">

                              จะแสดงหลังออกบิล

                            </p>

                          )}

                        </div>

                        <p className="text-xl font-bold">

                          {order.finalAmount ===

                          null

                            ? "รอออกบิล"

                            : `฿${order.finalAmount.toLocaleString(

                                undefined,

                                {

                                  minimumFractionDigits:

                                    2,

                                  maximumFractionDigits:

                                    2,

                                }

                              )}`}

                        </p>

                      </div>

                    </div>

                  </section>

                );

              }

            )}

          </div>

        )}

        {/* SWITCH CUSTOMER */}

        {availableCustomers.length >

          1 &&

          customer && (

          <button

            type="button"

            onClick={() =>

              router.push(

                "/miniapp?portal=customer"

              )

            }

            className="w-full mt-6 text-gray-500 underline text-sm"

          >

            เปลี่ยนบัญชีลูกค้า

          </button>

        )}

      </div>

    </main>

  );

}