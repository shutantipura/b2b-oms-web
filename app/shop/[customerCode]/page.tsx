"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "../../../lib/supabase";

type Customer = {
  id: string;
  customer_code: string;
  customer_name: string;
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
  is_active: boolean;
};

type Favourite = {
  product_id: string;
  sort_order: number | null;
};

type CatalogueProduct = Product & {
  effective_price: number;
  has_special_price: boolean;
  is_favourite: boolean;
  sort_order: number | null;
};

type Cart = Record<string, number>;

function quantityStep(unit: string) {
  const normalized =
    unit.trim().toLowerCase();

  if (
    normalized === "kg" ||
    normalized.includes("กก")
  ) {
    return 0.1;
  }

  return 1;
}

function cleanQuantity(value: number) {
  return Number(
    Math.max(0, value).toFixed(2)
  );
}

export default function CustomerShopPage() {
  const params = useParams();

  const customerCode =
    String(params.customerCode)
      .trim()
      .toUpperCase();

  const [customer, setCustomer] =
    useState<Customer | null>(null);

  const [products, setProducts] =
    useState<CatalogueProduct[]>([]);

  const [cart, setCart] =
    useState<Cart>({});

const [quantityInputs, setQuantityInputs] =
  useState<Record<string, string>>({});

  const [view, setView] =
    useState<"favourites" | "all">(
      "favourites"
    );

  const [search, setSearch] =
    useState("");

  const [cartOpen, setCartOpen] =
    useState(false);

  const [loading, setLoading] =
    useState(true);

  const [message, setMessage] =
    useState("");

  async function loadCatalogue() {
    setLoading(true);
    setMessage("");

    // ==========================================
    // 1. CUSTOMER
    // ==========================================

    const {
      data: customerData,
      error: customerError,
    } = await supabase
      .from("customers")
      .select(`
        id,
        customer_code,
        customer_name,
        is_active
      `)
      .eq(
        "customer_code",
        customerCode
      )
      .single();

    if (customerError) {
      setMessage(
        "Customer account could not be found."
      );

      setLoading(false);
      return;
    }

    const loadedCustomer =
      customerData as Customer;

    setCustomer(loadedCustomer);

    if (!loadedCustomer.is_active) {
      setMessage(
        "This customer account is currently inactive."
      );

      setLoading(false);
      return;
    }

    // ==========================================
    // 2. PRODUCTS
    // ==========================================

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
      .order(
        "product_name",
        {
          ascending: true,
        }
      );

    if (productError) {
      setMessage(
        "Could not load products: " +
          productError.message
      );

      setLoading(false);
      return;
    }

    const loadedProducts =
      (productData ??
        []) as Product[];

    // ==========================================
    // 3. CUSTOMER SPECIAL PRICES
    // ==========================================

    const {
      data: priceData,
      error: priceError,
    } = await supabase
      .from("customer_prices")
      .select(`
        product_id,
        agreed_price,
        is_active
      `)
      .eq(
        "customer_id",
        loadedCustomer.id
      )
      .eq(
        "is_active",
        true
      );

    if (priceError) {
      setMessage(
        "Could not load customer prices: " +
          priceError.message
      );

      setLoading(false);
      return;
    }

    const customerPrices =
      (priceData ??
        []) as CustomerPrice[];

    const priceMap =
      new Map<
        string,
        CustomerPrice
      >();

    customerPrices.forEach(
      (price) => {
        priceMap.set(
          price.product_id,
          price
        );
      }
    );

    // ==========================================
    // 4. FAVOURITES
    // ==========================================

    const {
      data: favouriteData,
      error: favouriteError,
    } = await supabase
      .from("favourites")
      .select(`
        product_id,
        sort_order
      `)
      .eq(
        "customer_id",
        loadedCustomer.id
      );

    if (favouriteError) {
      setMessage(
        "Could not load favourites: " +
          favouriteError.message
      );

      setLoading(false);
      return;
    }

    const favourites =
      (favouriteData ??
        []) as Favourite[];

    const favouriteMap =
      new Map<
        string,
        number | null
      >();

    favourites.forEach(
      (favourite) => {
        favouriteMap.set(
          favourite.product_id,
          favourite.sort_order
        );
      }
    );

    // ==========================================
    // 5. COMBINE EVERYTHING
    // ==========================================

    const catalogue =
      loadedProducts.map(
        (
          product
        ): CatalogueProduct => {
          const specialPrice =
            priceMap.get(
              product.id
            );

          const isFavourite =
            favouriteMap.has(
              product.id
            );

          return {
            ...product,

            effective_price:
              specialPrice
                ? Number(
                    specialPrice.agreed_price
                  )
                : Number(
                    product.normal_price
                  ),

            has_special_price:
              Boolean(
                specialPrice
              ),

            is_favourite:
              isFavourite,

            sort_order:
              isFavourite
                ? favouriteMap.get(
                    product.id
                  ) ?? null
                : null,
          };
        }
      );

    setProducts(catalogue);

    setLoading(false);
  }

  useEffect(() => {
    loadCatalogue();
  }, [customerCode]);

  // ==========================================
  // PRODUCT LIST
  // ==========================================

  const displayedProducts =
    useMemo(() => {
      const text =
        search
          .trim()
          .toLowerCase();

      let result =
        products.filter(
          (product) =>
            view === "all" ||
            product.is_favourite
        );

      if (text) {
        result =
          result.filter(
            (product) =>
              product.product_name
                .toLowerCase()
                .includes(text) ||
              product.sku
                .toLowerCase()
                .includes(text)
          );
      }

      if (
        view ===
        "favourites"
      ) {
        result.sort(
          (a, b) =>
            (a.sort_order ??
              999999) -
            (b.sort_order ??
              999999)
        );
      }

      return result;
    }, [
      products,
      search,
      view,
    ]);

  // ==========================================
  // CART FUNCTIONS
  // ==========================================

  function updateQuantity(
    product: CatalogueProduct,
    quantity: number
  ) {
    const cleaned =
      cleanQuantity(
        quantity
      );

    setCart(
      (current) => {
        const next = {
          ...current,
        };

        if (cleaned <= 0) {
          delete next[
            product.id
          ];
        } else {
          next[
            product.id
          ] = cleaned;
        }

        return next;
      }
    );
  }

  function increaseQuantity(
    product: CatalogueProduct
  ) {
    const current =
      cart[product.id] ??
      0;

    const step =
      quantityStep(
        product.unit
      );

    updateQuantity(
      product,
      current + step
    );
  }

  function decreaseQuantity(
    product: CatalogueProduct
  ) {
    const current =
      cart[product.id] ??
      0;

    const step =
      quantityStep(
        product.unit
      );

    updateQuantity(
      product,
      current - step
    );
  }

  // ==========================================
  // CART CALCULATIONS
  // ==========================================

  const cartItems =
    products.filter(
      (product) =>
        (cart[
          product.id
        ] ?? 0) > 0
    );

  const cartItemCount =
    cartItems.length;

  const cartTotal =
    cartItems.reduce(
      (total, product) => {
        const quantity =
          cart[
            product.id
          ] ?? 0;

        return (
          total +
          quantity *
            product.effective_price
        );
      },
      0
    );

  // ==========================================
  // LOADING / ERRORS
  // ==========================================

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-100 p-5">
        Loading catalogue...
      </main>
    );
  }

  if (!customer) {
    return (
      <main className="min-h-screen bg-gray-100 p-5">
        <div className="max-w-xl mx-auto bg-white border rounded-2xl p-6">
          {message ||
            "Customer not found."}
        </div>
      </main>
    );
  }

  if (
    !customer.is_active
  ) {
    return (
      <main className="min-h-screen bg-gray-100 p-5">

        <div className="max-w-xl mx-auto bg-white border rounded-2xl p-6">

          <h1 className="text-xl font-bold">
            {
              customer.customer_name
            }
          </h1>

          <p className="text-red-600 mt-3">
            This customer account is currently inactive and cannot place new orders.
          </p>

        </div>

      </main>
    );
  }

  // ==========================================
  // PAGE
  // ==========================================

  return (
    <main className="min-h-screen bg-gray-100 pb-28">

      {/* HEADER */}

      <header className="bg-white border-b sticky top-0 z-20">

        <div className="max-w-3xl mx-auto px-4 py-4">

          <p className="text-xs text-gray-500">
            B2B ORDERING
          </p>

          <div className="flex justify-between items-center gap-4">

            <div>

              <h1 className="text-xl font-bold">
                {
                  customer.customer_name
                }
              </h1>

              <p className="text-sm text-gray-500">
                {
                  customer.customer_code
                }
              </p>

            </div>

            <button
              onClick={() =>
                setCartOpen(
                  true
                )
              }
              className="bg-black text-white rounded-xl px-4 py-3 font-semibold"
            >
              CART ({cartItemCount})
            </button>

          </div>

        </div>

      </header>

      <div className="max-w-3xl mx-auto p-4">

        {/* TABS */}

        <div className="grid grid-cols-2 bg-white border rounded-xl overflow-hidden mb-4">

          <button
            onClick={() =>
              setView(
                "favourites"
              )
            }
            className={
              view ===
              "favourites"
                ? "bg-black text-white px-4 py-3 font-semibold"
                : "px-4 py-3 font-semibold"
            }
          >
            ★ Favourites
          </button>

          <button
            onClick={() =>
              setView(
                "all"
              )
            }
            className={
              view ===
              "all"
                ? "bg-black text-white px-4 py-3 font-semibold"
                : "px-4 py-3 font-semibold"
            }
          >
            All Products
          </button>

        </div>

        {/* SEARCH */}

        <div className="mb-5">

          <input
            value={search}
            onChange={(
              event
            ) =>
              setSearch(
                event.target
                  .value
              )
            }
            placeholder="Search products or SKU"
            className="w-full bg-white border rounded-xl px-4 py-3"
          />

        </div>

        {message && (
          <div className="bg-white border rounded-xl p-4 mb-5 text-red-600">
            {message}
          </div>
        )}

        {/* EMPTY FAVOURITES */}

        {view ===
          "favourites" &&
          displayedProducts.length ===
            0 &&
          !search && (
            <div className="bg-white border rounded-2xl p-8 text-center">

              <p className="font-semibold">
                No favourite products yet.
              </p>

              <p className="text-gray-500 mt-2">
                Browse all products to place an order.
              </p>

              <button
                onClick={() =>
                  setView(
                    "all"
                  )
                }
                className="bg-black text-white rounded-lg px-5 py-3 mt-5 font-semibold"
              >
                VIEW ALL PRODUCTS
              </button>

            </div>
          )}

        {/* PRODUCTS */}

        <div className="space-y-3">

          {displayedProducts.map(
            (product) => {
              const quantity =
                cart[
                  product.id
                ] ?? 0;

              const step =
                quantityStep(
                  product.unit
                );

                const isEditingQuantity =
  Object.prototype.hasOwnProperty.call(
    quantityInputs,
    product.id
  );

              return (
                <div
                  key={
                    product.id
                  }
                  className="bg-white border rounded-2xl p-5"
                >

                  <div className="flex justify-between gap-4">

                    <div className="min-w-0">

                      <div className="flex items-center gap-2">

                        <h2 className="font-bold text-lg">
                          {
                            product.product_name
                          }
                        </h2>

                        {product.is_favourite && (
                          <span title="Favourite">
                            ★
                          </span>
                        )}

                      </div>

                      <p className="text-sm text-gray-500 mt-1">
                        SKU{" "}
                        {
                          product.sku
                        }
                      </p>

                      <div className="mt-3">

                        <span className="text-xl font-bold">
                          ฿
                          {product.effective_price.toFixed(
                            2
                          )}
                        </span>

                        <span className="text-gray-500 ml-1">
                          /{" "}
                          {
                            product.unit
                          }
                        </span>

                      </div>

                      {product.has_special_price && (
                        <div className="mt-1">

                          <span className="text-xs border rounded-full px-2 py-1">
                            Your special price
                          </span>

                          {Number(
                            product.normal_price
                          ) !==
                            product.effective_price && (
                            <span className="text-xs text-gray-400 line-through ml-2">
                              ฿
                              {Number(
                                product.normal_price
                              ).toFixed(
                                2
                              )}
                            </span>
                          )}

                        </div>
                      )}

                    </div>

                    {/* QUANTITY */}

                    <div className="flex flex-col items-end justify-center">

                      {quantity <= 0 &&
                    !isEditingQuantity ? (
                        <button
                          onClick={() =>
                            increaseQuantity(
                              product
                            )
                          }
                          className="bg-black text-white rounded-xl px-5 py-3 font-semibold whitespace-nowrap"
                        >
                          + ADD
                        </button>
                      ) : (
                        <div>

                          <div className="flex items-center border rounded-xl overflow-hidden">

                            <button
                              onClick={() =>
                                decreaseQuantity(
                                  product
                                )
                              }
                              className="px-4 py-3 text-xl"
                            >
                              −
                            </button>

                            <input
  type="number"
  min="0"
  step={step}
  value={
    isEditingQuantity
      ? quantityInputs[product.id]
      : quantity
  }
  onFocus={() => {
    setQuantityInputs(
      (current) => ({
        ...current,
        [product.id]:
          String(quantity),
      })
    );
  }}
  onChange={(event) => {
    const raw =
      event.target.value;

    setQuantityInputs(
      (current) => ({
        ...current,
        [product.id]:
          raw,
      })
    );

    // Allow temporary blank input
    // while the customer is typing.
    if (raw === "") {
      return;
    }

    const parsed =
      Number(raw);

    if (
      !Number.isNaN(parsed) &&
      parsed >= 0
    ) {
      updateQuantity(
        product,
        parsed
      );
    }
  }}
  onBlur={() => {
    const raw =
      quantityInputs[
        product.id
      ];

    if (
      raw === undefined
    ) {
      return;
    }

    if (
      raw.trim() === ""
    ) {
      updateQuantity(
        product,
        0
      );
    } else {
      const parsed =
        Number(raw);

      if (
        !Number.isNaN(parsed)
      ) {
        updateQuantity(
          product,
          parsed
        );
      }
    }

    setQuantityInputs(
      (current) => {
        const next = {
          ...current,
        };

        delete next[
          product.id
        ];

        return next;
      }
    );
  }}
  className="w-20 text-center py-3 outline-none"
/>

                            <button
                              onClick={() =>
                                increaseQuantity(
                                  product
                                )
                              }
                              className="px-4 py-3 text-xl"
                            >
                              +
                            </button>

                          </div>

                          <p className="text-xs text-gray-500 text-center mt-2">
                            {
                              product.unit
                            }
                          </p>

                        </div>
                      )}

                    </div>

                  </div>

                  {quantity > 0 && (
                    <div className="border-t mt-4 pt-3 flex justify-between">

                      <span className="text-sm text-gray-500">
                        Estimated
                      </span>

                      <span className="font-semibold">
                        ฿
                        {(
                          quantity *
                          product.effective_price
                        ).toFixed(
                          2
                        )}
                      </span>

                    </div>
                  )}

                </div>
              );
            }
          )}

        </div>

      </div>

      {/* BOTTOM CART BAR */}

      {cartItemCount >
        0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t p-3 z-30">

          <div className="max-w-3xl mx-auto">

            <button
              onClick={() =>
                setCartOpen(
                  true
                )
              }
              className="w-full bg-black text-white rounded-xl px-5 py-4 flex justify-between items-center font-semibold"
            >

              <span>
                View Cart ·{" "}
                {cartItemCount}{" "}
                item
                {cartItemCount ===
                1
                  ? ""
                  : "s"}
              </span>

              <span>
                ฿
                {cartTotal.toFixed(
                  2
                )}
              </span>

            </button>

          </div>

        </div>
      )}

      {/* CART PANEL */}

      {cartOpen && (
        <div className="fixed inset-0 bg-black/30 z-40 flex items-end md:items-center justify-center">

          <div className="bg-white w-full md:max-w-xl md:rounded-2xl rounded-t-2xl max-h-[90vh] overflow-y-auto">

            <div className="p-5 border-b flex justify-between items-center sticky top-0 bg-white">

              <div>

                <h2 className="text-xl font-bold">
                  Your Cart
                </h2>

                <p className="text-sm text-gray-500">
                  {
                    customer.customer_name
                  }
                </p>

              </div>

              <button
                onClick={() =>
                  setCartOpen(
                    false
                  )
                }
                className="border rounded-lg px-4 py-2"
              >
                CLOSE
              </button>

            </div>

            {cartItems.length ===
            0 ? (
              <div className="p-8 text-center text-gray-500">
                Your cart is empty.
              </div>
            ) : (
              <>

                <div>

                  {cartItems.map(
                    (product) => {
                      const quantity =
                        cart[
                          product.id
                        ] ?? 0;

                      return (
                        <div
                          key={
                            product.id
                          }
                          className="p-5 border-b"
                        >

                          <div className="flex justify-between gap-4">

                            <div>

                              <p className="font-semibold">
                                {
                                  product.product_name
                                }
                              </p>

                              <p className="text-sm text-gray-500">
                                ฿
                                {product.effective_price.toFixed(
                                  2
                                )}
                                {" / "}
                                {
                                  product.unit
                                }
                              </p>

                            </div>

                            <p className="font-semibold">
                              ฿
                              {(
                                quantity *
                                product.effective_price
                              ).toFixed(
                                2
                              )}
                            </p>

                          </div>

                          <div className="flex items-center mt-4 border rounded-xl w-fit overflow-hidden">

                            <button
                              onClick={() =>
                                decreaseQuantity(
                                  product
                                )
                              }
                              className="px-4 py-2 text-xl"
                            >
                              −
                            </button>

                            <span className="min-w-20 text-center">
                              {quantity}{" "}
                              {
                                product.unit
                              }
                            </span>

                            <button
                              onClick={() =>
                                increaseQuantity(
                                  product
                                )
                              }
                              className="px-4 py-2 text-xl"
                            >
                              +
                            </button>

                          </div>

                        </div>
                      );
                    }
                  )}

                </div>

                <div className="p-5">

                  <div className="flex justify-between text-lg">

                    <span>
                      Estimated Total
                    </span>

                    <span className="font-bold">
                      ฿
                      {cartTotal.toFixed(
                        2
                      )}
                    </span>

                  </div>

                  <p className="text-xs text-gray-500 mt-2">
                    Final charged quantity may change for variable-weight products after picking.
                  </p>

                  <button
                    disabled
                    className="w-full bg-black text-white rounded-xl px-5 py-4 font-semibold mt-5 opacity-40"
                  >
                    CHECKOUT — COMING NEXT
                  </button>

                </div>

              </>
            )}

          </div>

        </div>
      )}

    </main>
  );
}