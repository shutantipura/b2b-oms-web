"use client";

import {
  useEffect,
  useMemo,
  useState,
} from "react";

import Link from "next/link";

import {
  useParams,
  useRouter,
} from "next/navigation";

import { supabase } from "../../../../lib/supabase";
import { getAvailableSlots, getEarliestDeliveryDate } from "../../../../lib/deliveryRules";

type Customer = {
  id: string;
  customer_code: string;
  customer_name: string;
  delivery_address: string | null;
  is_active: boolean;
};

type Product = {
  id: string;
  sku: string;
  product_name: string;
  unit: string;
  normal_price: number | string;
};

type CustomerPrice = {
  product_id: string;
  agreed_price: number | string;
};

type CheckoutItem = Product & {
  quantity: number;
  effective_price: number;
  has_special_price: boolean;
};

type Cart = Record<string, number>;

export default function CheckoutPage() {
  const params = useParams();
  const router = useRouter();

  const customerCode =
    String(params.customerCode)
      .trim()
      .toUpperCase();

  // =====================================================
  // STATE
  // =====================================================

  const [customer, setCustomer] =
    useState<Customer | null>(null);

  const [items, setItems] =
    useState<CheckoutItem[]>([]);

  const [
    deliveryDate,
    setDeliveryDate,
  ] = useState("");

  const [
    deliverySlot,
    setDeliverySlot,
  ] = useState("");

  const [
    deliveryAddress,
    setDeliveryAddress,
  ] = useState("");

  const [
    recommendedAddress,
    setRecommendedAddress,
  ] = useState("");

  const [
    notes,
    setNotes,
  ] = useState("");

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    submitting,
    setSubmitting,
  ] = useState(false);

  const [
    message,
    setMessage,
  ] = useState("");

  const [
    createdOrderNumber,
    setCreatedOrderNumber,
  ] =
    useState<number | null>(
      null
    );

  const [clock, setClock] = useState(() => new Date());

  useEffect(() => {
    const interval = window.setInterval(() => setClock(new Date()), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  const today = getEarliestDeliveryDate(clock);
  const availableSlots = getAvailableSlots(deliveryDate, clock);

  // =====================================================
  // LOAD CHECKOUT
  // =====================================================

  async function loadCheckout() {
    setLoading(true);
    setMessage("");

    // ---------------------------------------------------
    // 1. LOAD CART FROM LOCAL STORAGE
    // ---------------------------------------------------

    const stored =
      localStorage.getItem(
        `b2b-cart-${customerCode}`
      );

    if (!stored) {
      setMessage(
        "Your cart is empty."
      );

      setLoading(false);
      return;
    }

    let cart: Cart;

    try {
      cart =
        JSON.parse(stored);
    } catch {
      setMessage(
        "Your cart could not be read."
      );

      setLoading(false);
      return;
    }

    const productIds =
      Object.entries(cart)
        .filter(
          ([, quantity]) =>
            Number(quantity) > 0
        )
        .map(
          ([productId]) =>
            productId
        );

    if (
      productIds.length === 0
    ) {
      setMessage(
        "Your cart is empty."
      );

      setLoading(false);
      return;
    }

    // ---------------------------------------------------
    // 2. CUSTOMER
    // ---------------------------------------------------

    const {
      data: customerData,
      error: customerError,
    } = await supabase
      .from("customers")
      .select(`
        id,
        customer_code,
        customer_name,
        delivery_address,
        is_active
      `)
      .eq(
        "customer_code",
        customerCode
      )
      .single();

    if (
      customerError ||
      !customerData
    ) {
      setMessage(
        "Customer could not be found."
      );

      setLoading(false);
      return;
    }

    const loadedCustomer =
      customerData as Customer;

    if (
      !loadedCustomer.is_active
    ) {
      setMessage(
        "This customer account is currently inactive."
      );

      setLoading(false);
      return;
    }

    setCustomer(
      loadedCustomer
    );

    // ---------------------------------------------------
    // RECOMMENDED / DEFAULT DELIVERY ADDRESS
    // ---------------------------------------------------

    const savedAddress =
      loadedCustomer.delivery_address ??
      "";

    setRecommendedAddress(
      savedAddress
    );

    // Default checkout address is always
    // the customer's saved store location.
    setDeliveryAddress(
      savedAddress
    );

    // ---------------------------------------------------
    // 3. PRODUCTS
    // ---------------------------------------------------

    const {
      data: productData,
      error: productError,
    } = await supabase
      .from("products")
      .select(`
        id,
        sku,
        product_name,
        unit,
        normal_price
      `)
      .in(
        "id",
        productIds
      );

    if (productError) {
      setMessage(
        "Could not load cart products: " +
          productError.message
      );

      setLoading(false);
      return;
    }

    const products =
      (productData ??
        []) as Product[];

    // ---------------------------------------------------
    // 4. CUSTOMER-SPECIFIC PRICES
    // ---------------------------------------------------

    const {
      data: priceData,
      error: priceError,
    } = await supabase
      .from(
        "customer_prices"
      )
      .select(`
        product_id,
        agreed_price
      `)
      .eq(
        "customer_id",
        loadedCustomer.id
      )
      .eq(
        "is_active",
        true
      )
      .in(
        "product_id",
        productIds
      );

    if (priceError) {
      setMessage(
        "Could not load customer pricing: " +
          priceError.message
      );

      setLoading(false);
      return;
    }

    const priceMap =
      new Map<
        string,
        number
      >();

    (
      (priceData ??
        []) as CustomerPrice[]
    ).forEach((price) => {
      priceMap.set(
        price.product_id,
        Number(
          price.agreed_price
        )
      );
    });

    // ---------------------------------------------------
    // 5. BUILD CHECKOUT ITEMS
    // ---------------------------------------------------

    const checkoutItems =
      products.map(
        (
          product
        ): CheckoutItem => {
          const specialPrice =
            priceMap.get(
              product.id
            );

          return {
            ...product,

            quantity:
              Number(
                cart[
                  product.id
                ] ?? 0
              ),

            effective_price:
              specialPrice ??
              Number(
                product.normal_price
              ),

            has_special_price:
              specialPrice !==
              undefined,
          };
        }
      );

    setItems(
      checkoutItems
    );

    setLoading(false);
  }

  useEffect(() => {
    loadCheckout();
  }, [customerCode]);

  // =====================================================
  // TOTAL
  // =====================================================

  const estimatedTotal =
    useMemo(
      () =>
        items.reduce(
          (
            total,
            item
          ) =>
            total +
            item.quantity *
              item.effective_price,
          0
        ),
      [items]
    );

  // =====================================================
  // SUBMIT ORDER
  // =====================================================

  async function submitOrder() {
    if (!customer) {
      return;
    }

    setMessage("");

    if (
      items.length === 0
    ) {
      setMessage(
        "Your cart is empty."
      );
      return;
    }

    if (!deliveryDate) {
      setMessage(
        "Please select a delivery date."
      );
      return;
    }

    if (!deliverySlot) {
      setMessage(
        "Please select a delivery time."
      );
      return;
    }

    // The chosen time may have expired while the checkout page was open.
    if (!getAvailableSlots(deliveryDate, new Date()).some((slot) => slot.value === deliverySlot)) {
      setMessage("Delivery must start at least 2 hours after submitting your order. Please choose a later slot.");
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

    if (!confirmed) {
      return;
    }

    setSubmitting(true);

    // Browser sends only:
    // product ID + requested quantity.
    //
    // The database function determines the
    // true price snapshot itself.

    const orderItems =
      items.map(
        (item) => ({
          product_id:
            item.id,

          quantity:
            item.quantity,
        })
      );

    const {
      data,
      error,
    } =
      await supabase.rpc(
        "create_customer_order",
        {
          p_customer_code:
            customer.customer_code,

          p_delivery_date:
            deliveryDate,

          p_delivery_slot:
            deliverySlot,

          p_delivery_address:
            deliveryAddress.trim(),

          p_customer_notes:
            notes.trim(),

          p_items:
            orderItems,
        }
      );

    if (error) {
      setMessage(
        "Could not submit order: " +
          error.message
      );

      setSubmitting(false);

      // IMPORTANT:
      // We DO NOT clear the cart
      // if submission fails.

      return;
    }

    const orderNumber =
      Number(
        data?.order_number
      );

    if (
      !orderNumber ||
      Number.isNaN(
        orderNumber
      )
    ) {
      setMessage(
        "The order was submitted, but the order number could not be read."
      );

      setSubmitting(false);
      return;
    }

    // ===================================================
    // ONLY CLEAR CART AFTER SUCCESS
    // ===================================================

    localStorage.removeItem(
      `b2b-cart-${customerCode}`
    );

    setCreatedOrderNumber(
      orderNumber
    );

    setSubmitting(false);
  }

  // =====================================================
  // LOADING
  // =====================================================

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-100 p-5">
        Loading checkout...
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

        <div className="max-w-xl mx-auto">

          <div className="bg-white border rounded-2xl p-8 text-center mt-10">

            <div className="text-5xl mb-4">
              ✓
            </div>

            <h1 className="text-2xl font-bold">
              Order Received
            </h1>

            <p className="text-gray-500 mt-2">
              Your order request has been sent to our team for confirmation.
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
                  `/shop/${customerCode}`
                )
              }
              className="w-full bg-black text-white rounded-xl px-5 py-4 font-semibold mt-6"
            >
              CONTINUE SHOPPING
            </button>

          </div>

        </div>

      </main>
    );
  }

  // =====================================================
  // CHECKOUT PAGE
  // =====================================================

  return (
    <main className="min-h-screen bg-gray-100 pb-10">

      {/* HEADER */}

      <header className="bg-white border-b">

        <div className="max-w-3xl mx-auto px-4 py-4">

          <Link
            href={`/shop/${customerCode}`}
            className="text-sm text-gray-500"
          >
            ← Back to Cart
          </Link>

          <h1 className="text-2xl font-bold mt-3">
            Checkout
          </h1>

          {customer && (
            <p className="text-gray-500">
              {
                customer.customer_name
              }
            </p>
          )}

        </div>

      </header>

      <div className="max-w-3xl mx-auto p-4">

        {/* ERROR / MESSAGE */}

        {message && (
          <div className="bg-white border rounded-xl p-4 mb-5 text-red-600">
            {message}
          </div>
        )}

        {/* ============================================== */}
        {/* ORDER SUMMARY */}
        {/* ============================================== */}

        <section className="bg-white border rounded-2xl overflow-hidden mb-5">

          <div className="p-5 border-b">

            <h2 className="font-bold text-lg">
              Order Summary
            </h2>

          </div>

          {items.length ===
          0 ? (
            <div className="p-6 text-gray-500">
              Your cart is empty.
            </div>
          ) : (
            <>

              {items.map(
                (item) => (

                  <div
                    key={
                      item.id
                    }
                    className="p-5 border-b"
                  >

                    <div className="flex justify-between gap-4">

                      <div>

                        <p className="font-semibold">
                          {
                            item.product_name
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
                          {item.effective_price.toFixed(
                            2
                          )}
                        </p>

                        {item.has_special_price && (
                          <p className="text-xs mt-1">
                            Your special price
                          </p>
                        )}

                      </div>

                      <p className="font-semibold">
                        ฿
                        {(
                          item.quantity *
                          item.effective_price
                        ).toFixed(
                          2
                        )}
                      </p>

                    </div>

                  </div>

                )
              )}

              <div className="p-5 flex justify-between text-lg">

                <span>
                  Estimated Total
                </span>

                <span className="font-bold">
                  ฿
                  {estimatedTotal.toFixed(
                    2
                  )}
                </span>

              </div>

            </>
          )}

        </section>

        {/* ============================================== */}
        {/* DELIVERY */}
        {/* ============================================== */}

        <section className="bg-white border rounded-2xl p-6 mb-5">

          <h2 className="font-bold text-lg">
            Delivery
          </h2>

          <p className="text-sm text-gray-500 mt-1 mb-6">
            Choose your delivery date, time and location.
          </p>

          <div className="space-y-6">

            {/* DELIVERY DATE */}

            <div>

              <label className="block font-medium mb-2">
                Delivery Date *
              </label>

              <input
                type="date"
                min={today}
                value={
                  deliveryDate
                }
                onChange={(event) => {
                  setDeliveryDate(event.target.value);
                  setDeliverySlot("");
                }}
                className="w-full border rounded-xl px-4 py-3"
              />

            </div>

            {/* DELIVERY SLOT */}

            <div>

              <label className="block font-medium mb-2">
                Delivery Time *
              </label>

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
                className="w-full border rounded-xl px-4 py-3 bg-white"
              >

                <option value="">
                  Select delivery time
                </option>

                {availableSlots.map((slot) => (
                  <option key={slot.value} value={slot.value}>
                    {slot.label}
                  </option>
                ))}

              </select>
              <p className="mt-2 text-xs text-gray-500">
                Orders can be placed at any time. The selected delivery slot must begin at least 2 hours after submission (Bangkok time).
              </p>
            </div>

            {/* DELIVERY ADDRESS */}

            <div>

              <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 mb-2">

                <label className="font-medium">
                  Delivery Address *
                </label>

                {recommendedAddress &&
                  deliveryAddress !==
                    recommendedAddress && (
                    <button
                      type="button"
                      onClick={() =>
                        setDeliveryAddress(
                          recommendedAddress
                        )
                      }
                      className="border rounded-lg px-3 py-2 text-sm font-semibold"
                    >
                      REVERT TO RECOMMENDED LOCATION
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
                placeholder="Enter delivery address"
                className="w-full border rounded-xl px-4 py-3"
              />

              {recommendedAddress &&
              deliveryAddress ===
                recommendedAddress ? (
                <p className="text-xs text-gray-500 mt-2">
                  ✓ Recommended store location
                </p>
              ) : (
                <p className="text-xs text-gray-500 mt-2">
                  Custom delivery location
                </p>
              )}

            </div>

          </div>

        </section>

        {/* ============================================== */}
        {/* NOTES */}
        {/* ============================================== */}

        <section className="bg-white border rounded-2xl p-6 mb-5">

          <h2 className="font-bold text-lg">
            Order Notes
          </h2>

          <p className="text-sm text-gray-500 mt-1 mb-4">
            Optional instructions for our team.
          </p>

          <textarea
            value={notes}
            onChange={(
              event
            ) =>
              setNotes(
                event.target.value
              )
            }
            rows={4}
            placeholder="e.g. Please call before delivery"
            className="w-full border rounded-xl px-4 py-3"
          />

        </section>

        {/* ============================================== */}
        {/* FINAL SUBMISSION */}
        {/* ============================================== */}

        <section className="bg-white border rounded-2xl p-6">

          <div className="flex justify-between">

            <div>

              <p className="text-gray-500">
                Estimated Total
              </p>

              <p className="text-3xl font-bold mt-1">
                ฿
                {estimatedTotal.toFixed(
                  2
                )}
              </p>

            </div>

            <div className="text-right">

              <p className="text-sm text-gray-500">
                {items.length} product
                {items.length ===
                1
                  ? ""
                  : "s"}
              </p>

            </div>

          </div>

          <div className="border-t mt-5 pt-5">

            <p className="text-sm text-gray-500">
              This is an order request. Our team will confirm product availability and quantities before picking.
            </p>

            <p className="text-sm text-gray-500 mt-2">
              Variable-weight products will be charged according to the actual quantity picked.
            </p>

          </div>

          <button
            onClick={
              submitOrder
            }
            disabled={
              submitting ||
              items.length ===
                0
            }
            className="w-full bg-black text-white rounded-xl px-5 py-4 font-semibold mt-6 disabled:opacity-40"
          >

            {submitting
              ? "SUBMITTING ORDER..."
              : "SUBMIT ORDER"}

          </button>

        </section>

      </div>

    </main>
  );
}