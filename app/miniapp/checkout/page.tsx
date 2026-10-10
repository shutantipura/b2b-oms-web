"use client";

import {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  useRouter,
} from "next/navigation";

type Customer = {
  id: string;
  customerCode: string;
  customerName: string;
  deliveryAddress: string;
};

type CheckoutItem = {
  id: string;
  sku: string;
  productName: string;
  unit: string;
  quantity: number;
  normalPrice: number;
  effectivePrice: number;
  hasSpecialPrice: boolean;
  estimatedSubtotal: number;
};

type DeliveryOption = {
  date: string;

  slots: {
    value: string;
    label: string;
  }[];
};

type CheckoutResponse = {
  customer?: Customer;

  items?: CheckoutItem[];

  deliveryOptions?: DeliveryOption[];

  success?: boolean;

  orderNumber?: number;

  error?: string;
};

type Cart = Record<
  string,
  number
>;

function prettyDate(
  value: string
) {
  const [
    year,
    month,
    day,
  ] =
    value
      .split("-")
      .map(Number);

  return new Intl.DateTimeFormat(
    "en-GB",
    {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    }
  ).format(
    new Date(
      year,
      month - 1,
      day
    )
  );
}

export default function MiniAppCheckoutPage() {
  const router =
    useRouter();

  const [
    customer,
    setCustomer,
  ] =
    useState<Customer | null>(
      null
    );

  const [
    items,
    setItems,
  ] =
    useState<
      CheckoutItem[]
    >([]);

  const [
    deliveryOptions,
    setDeliveryOptions,
  ] =
    useState<
      DeliveryOption[]
    >([]);

  const [
    deliveryDate,
    setDeliveryDate,
  ] =
    useState("");

  const [
    deliverySlot,
    setDeliverySlot,
  ] =
    useState("");

  const [
    deliveryAddress,
    setDeliveryAddress,
  ] =
    useState("");

  const [
    recommendedAddress,
    setRecommendedAddress,
  ] =
    useState("");

  const [
    notes,
    setNotes,
  ] =
    useState("");

  const [
    idToken,
    setIdToken,
  ] =
    useState("");

  const [
    cart,
    setCart,
  ] =
    useState<Cart>({});

  const [
    loading,
    setLoading,
  ] =
    useState(true);

  const [
    submitting,
    setSubmitting,
  ] =
    useState(false);

  const [
    message,
    setMessage,
  ] =
    useState("");

  const [
    createdOrderNumber,
    setCreatedOrderNumber,
  ] =
    useState<
      number | null
    >(null);

  // =====================================================
  // INITIALIZE LINE + LOAD CHECKOUT
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

        const customerCode =
          (
            params.get(
              "customer"
            ) ?? ""
          )
            .trim()
            .toUpperCase();

        if (
          !customerCode
        ) {
          throw new Error(
            "Customer was not selected."
          );
        }

        // ---------------------------------------------
        // LOAD CART
        // ---------------------------------------------

        const stored =
          localStorage.getItem(
            `b2b-cart-${customerCode}`
          );

        if (!stored) {
          throw new Error(
            "Your cart is empty."
          );
        }

        let loadedCart:
          Cart;

        try {
          loadedCart =
            JSON.parse(
              stored
            ) as Cart;
        } catch {
          throw new Error(
            "Your cart could not be read."
          );
        }

        const hasItems =
          Object.values(
            loadedCart
          ).some(
            (quantity) =>
              Number(
                quantity
              ) > 0
          );

        if (
          !hasItems
        ) {
          throw new Error(
            "Your cart is empty."
          );
        }

        // ---------------------------------------------
        // INITIALIZE LIFF
        // ---------------------------------------------

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

        const token =
          liff.getIDToken();

        if (!token) {
          throw new Error(
            "LINE ID token was not available."
          );
        }

        // ---------------------------------------------
        // SECURE SERVER LOAD
        // ---------------------------------------------

        const response =
          await fetch(
            "/api/line/checkout",
            {
              method:
                "POST",

              headers: {
                "Content-Type":
                  "application/json",
              },

              body:
                JSON.stringify({
                  action:
                    "load",

                  idToken:
                    token,

                  customerCode,

                  cart:
                    loadedCart,
                }),
            }
          );

        const data =
          (await response.json()) as CheckoutResponse;

        if (
          !response.ok
        ) {
          throw new Error(
            data.error ??
              "Checkout could not be loaded."
          );
        }

        if (
          !data.customer
        ) {
          throw new Error(
            "Customer could not be loaded."
          );
        }

        if (
          cancelled
        ) {
          return;
        }

        // ---------------------------------------------
        // SAVE STATE
        // ---------------------------------------------

        setIdToken(
          token
        );

        setCart(
          loadedCart
        );

        setCustomer(
          data.customer
        );

        setItems(
          data.items ??
            []
        );

        const options =
          data.deliveryOptions ??
          [];

        setDeliveryOptions(
          options
        );

        const savedAddress =
          data.customer
            .deliveryAddress ??
          "";

        setRecommendedAddress(
          savedAddress
        );

        setDeliveryAddress(
          savedAddress
        );

        // Default to first available date/slot.

        const firstOption =
          options[0];

        if (
          firstOption
        ) {
          setDeliveryDate(
            firstOption.date
          );

          setDeliverySlot(
            firstOption
              .slots[0]
              ?.value ??
              ""
          );
        }

        setLoading(
          false
        );
      } catch (error) {
        if (
          cancelled
        ) {
          return;
        }

        console.error(
          "Checkout initialization:",
          error
        );

        setMessage(
          error instanceof
            Error
            ? error.message
            : "Could not load checkout."
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
  // CURRENT AVAILABLE SLOTS
  // =====================================================

  const currentSlots =
    useMemo(() => {
      return (
        deliveryOptions.find(
          (option) =>
            option.date ===
            deliveryDate
        )?.slots ??
        []
      );
    }, [
      deliveryOptions,
      deliveryDate,
    ]);

  // =====================================================
  // ESTIMATED TOTAL
  // =====================================================

  const estimatedTotal =
    useMemo(() => {
      return items.reduce(
        (
          total,
          item
        ) =>
          total +
          item.estimatedSubtotal,
        0
      );
    }, [items]);

  // =====================================================
  // DELIVERY DATE CHANGE
  // =====================================================

  function changeDate(
    value: string
  ) {
    setDeliveryDate(
      value
    );

    const option =
      deliveryOptions.find(
        (item) =>
          item.date ===
          value
      );

    setDeliverySlot(
      option
        ?.slots[0]
        ?.value ??
        ""
    );
  }

  // =====================================================
  // SUBMIT ORDER
  // =====================================================

  async function submitOrder() {
    if (
      !customer ||
      !idToken
    ) {
      return;
    }

    setMessage("");

    if (
      !deliveryDate
    ) {
      setMessage(
        "Please select a delivery date."
      );
      return;
    }

    if (
      !deliverySlot
    ) {
      setMessage(
        "Please select a delivery time."
      );
      return;
    }

    if (
      !deliveryAddress.trim()
    ) {
      setMessage(
        "Delivery address is required."
      );
      return;
    }

    const confirmed =
      window.confirm(
        `Submit this order for approximately ฿${estimatedTotal.toFixed(
          2
        )}?`
      );

    if (
      !confirmed
    ) {
      return;
    }

    setSubmitting(
      true
    );

    try {
      const response =
        await fetch(
          "/api/line/checkout",
          {
            method:
              "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify({
                action:
                  "submit",

                idToken,

                customerCode:
                  customer.customerCode,

                cart,

                deliveryDate,

                deliverySlot,

                deliveryAddress:
                  deliveryAddress.trim(),

                notes:
                  notes.trim(),
              }),
          }
        );

      const data =
        (await response.json()) as CheckoutResponse;

      if (
        !response.ok
      ) {
        // Delivery rules may have changed
        // between loading checkout and submitting.

        if (
          data.deliveryOptions
        ) {
          setDeliveryOptions(
            data.deliveryOptions
          );
        }

        throw new Error(
          data.error ??
            "Order could not be submitted."
        );
      }

      if (
        !data.orderNumber
      ) {
        throw new Error(
          "The order was submitted, but its order number could not be read."
        );
      }

      // Only clear cart AFTER confirmed success.

      localStorage.removeItem(
        `b2b-cart-${customer.customerCode}`
      );

      setCreatedOrderNumber(
        data.orderNumber
      );
    } catch (error) {
      console.error(
        "Submit order:",
        error
      );

      setMessage(
        error instanceof
          Error
          ? error.message
          : "Order could not be submitted."
      );
    } finally {
      setSubmitting(
        false
      );
    }
  }

  // =====================================================
  // LOADING
  // =====================================================

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-100 flex items-center justify-center p-5">

        <div className="text-center">

          <p className="text-xl font-bold">
            LOTUS&apos;S B2B
          </p>

          <p className="text-gray-500 mt-3">
            Loading checkout...
          </p>

        </div>

      </main>
    );
  }

  // =====================================================
  // ERROR BEFORE CUSTOMER LOAD
  // =====================================================

  if (
    !customer
  ) {
    return (
      <main className="min-h-screen bg-gray-100 p-5">

        <div className="max-w-md mx-auto">

          <button
            onClick={() =>
              router.push(
                "/miniapp"
              )
            }
            className="text-gray-500"
          >
            ← Home
          </button>

          <div className="bg-white border rounded-2xl p-6 mt-5">

            <h1 className="text-xl font-bold">
              Checkout Unavailable
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
  // SUCCESS SCREEN
  // =====================================================

  if (
    createdOrderNumber !==
    null
  ) {
    return (
      <main className="min-h-screen bg-gray-100 p-5">

        <div className="max-w-md mx-auto">

          <div className="bg-white border rounded-2xl p-7 text-center mt-8">

            <div className="text-5xl">
              ✓
            </div>

            <h1 className="text-2xl font-bold mt-4">
              Order Received
            </h1>

            <p className="text-gray-500 mt-2">
              Your order has been sent to our team for confirmation.
            </p>

            <div className="border rounded-xl p-5 mt-6">

              <p className="text-sm text-gray-500">
                Order Number
              </p>

              <p className="text-3xl font-bold mt-1">
                #
                {
                  createdOrderNumber
                }
              </p>

            </div>

            <p className="text-sm text-gray-500 mt-5">
              Quantities and the final amount may change after confirmation and picking.
            </p>

            <button
              onClick={() =>
                router.push(
                  `/miniapp/orders?customer=${customer.customerCode}&view=active`
                )
              }
              className="w-full bg-black text-white rounded-xl px-5 py-4 font-semibold mt-6"
            >
              TRACK MY ORDER
            </button>

            <button
              onClick={() =>
                router.push(
                  `/miniapp/shop?customer=${customer.customerCode}`
                )
              }
              className="w-full border rounded-xl px-5 py-3 font-semibold mt-3"
            >
              ORDER MORE PRODUCTS
            </button>

            <button
              onClick={() =>
                router.push(
                  "/miniapp"
                )
              }
              className="w-full text-gray-500 text-sm mt-4"
            >
              Back to Home
            </button>

          </div>

        </div>

      </main>
    );
  }

  // =====================================================
  // CHECKOUT
  // =====================================================

  return (
    <main className="min-h-screen bg-gray-100 pb-10">

      {/* HEADER */}

      <header className="bg-white border-b">

        <div className="max-w-2xl mx-auto px-4 py-4">

          <button
            onClick={() =>
              router.push(
                `/miniapp/shop?customer=${customer.customerCode}`
              )
            }
            className="text-sm text-gray-500"
          >
            ← Back to Cart
          </button>

          <h1 className="text-2xl font-bold mt-3">
            Checkout
          </h1>

          <p className="text-gray-500">
            {
              customer.customerName
            }
          </p>

        </div>

      </header>

      <div className="max-w-2xl mx-auto p-4">

        {/* ERROR */}

        {message && (
          <div className="bg-white border border-red-200 rounded-xl p-4 mb-5 text-red-600">
            {
              message
            }
          </div>
        )}

        {/* ORDER SUMMARY */}

        <section className="bg-white border rounded-2xl overflow-hidden mb-5">

          <div className="p-5 border-b">

            <h2 className="font-bold text-lg">
              Order Summary
            </h2>

          </div>

          {items.map(
            (item) => (

            <div
              key={
                item.id
              }
              className="p-5 border-b last:border-b-0"
            >

              <div className="flex justify-between gap-4">

                <div>

                  <p className="font-semibold">
                    {
                      item.productName
                    }
                  </p>

                  <p className="text-sm text-gray-500 mt-1">
                    {
                      item.quantity
                    }{" "}
                    {
                      item.unit
                    }
                    {" × "}
                    ฿
                    {item.effectivePrice.toFixed(
                      2
                    )}
                  </p>

                  {item.hasSpecialPrice && (
                    <p className="text-xs font-semibold mt-1">
                      Your special price
                    </p>
                  )}

                </div>

                <p className="font-bold">
                  ฿
                  {item.estimatedSubtotal.toFixed(
                    2
                  )}
                </p>

              </div>

            </div>

          ))}

          <div className="p-5 bg-gray-50 flex justify-between items-center">

            <span className="text-gray-500">
              Estimated Total
            </span>

            <span className="text-2xl font-bold">
              ฿
              {estimatedTotal.toFixed(
                2
              )}
            </span>

          </div>

        </section>

        {/* DELIVERY */}

        <section className="bg-white border rounded-2xl p-5 mb-5">

          <h2 className="font-bold text-lg">
            Delivery
          </h2>

          <label className="block mt-5">

            <span className="text-sm text-gray-500">
              Delivery Date
            </span>

            <select
              value={
                deliveryDate
              }
              onChange={(
                event
              ) =>
                changeDate(
                  event.target
                    .value
                )
              }
              className="w-full border rounded-xl px-4 py-3 mt-1 bg-white"
            >

              {deliveryOptions.map(
                (option) => (

                <option
                  key={
                    option.date
                  }
                  value={
                    option.date
                  }
                >
                  {prettyDate(
                    option.date
                  )}
                </option>

              ))}

            </select>

          </label>

          <label className="block mt-4">

            <span className="text-sm text-gray-500">
              Delivery Time
            </span>

            <select
              value={
                deliverySlot
              }
              onChange={(
                event
              ) =>
                setDeliverySlot(
                  event.target
                    .value
                )
              }
              className="w-full border rounded-xl px-4 py-3 mt-1 bg-white"
            >

              {currentSlots.map(
                (slot) => (

                <option
                  key={
                    slot.value
                  }
                  value={
                    slot.value
                  }
                >
                  {
                    slot.label
                  }
                </option>

              ))}

            </select>

          </label>

          {currentSlots.length ===
            0 && (

            <p className="text-sm text-red-600 mt-3">
              No delivery times are available for this date.
            </p>

          )}

        </section>

        {/* ADDRESS */}

        <section className="bg-white border rounded-2xl p-5 mb-5">

          <div className="flex justify-between items-start gap-4">

            <h2 className="font-bold text-lg">
              Delivery Address
            </h2>

            {deliveryAddress !==
              recommendedAddress && (

              <button
                type="button"
                onClick={() =>
                  setDeliveryAddress(
                    recommendedAddress
                  )
                }
                className="text-sm underline"
              >
                Use saved address
              </button>

            )}

          </div>

          <textarea
            value={
              deliveryAddress
            }
            onChange={(
              event
            ) =>
              setDeliveryAddress(
                event.target
                  .value
              )
            }
            rows={4}
            className="w-full border rounded-xl px-4 py-3 mt-4"
          />

        </section>

        {/* NOTES */}

        <section className="bg-white border rounded-2xl p-5 mb-5">

          <h2 className="font-bold text-lg">
            Order Notes
          </h2>

          <textarea
            value={
              notes
            }
            onChange={(
              event
            ) =>
              setNotes(
                event.target
                  .value
              )
            }
            rows={3}
            placeholder="Optional"
            className="w-full border rounded-xl px-4 py-3 mt-4"
          />

        </section>

        {/* SUBMIT */}

        <button
          type="button"
          onClick={
            submitOrder
          }
          disabled={
            submitting ||
            !deliveryDate ||
            !deliverySlot ||
            items.length ===
              0
          }
          className="w-full bg-black text-white rounded-xl px-5 py-4 font-semibold disabled:opacity-40"
        >
          {submitting
            ? "SUBMITTING..."
            : `SUBMIT ORDER · ~฿${estimatedTotal.toFixed(
                2
              )}`}
        </button>

        <p className="text-xs text-center text-gray-500 mt-3">
          Final quantity and amount may change after confirmation and picking.
        </p>

      </div>

    </main>
  );
}