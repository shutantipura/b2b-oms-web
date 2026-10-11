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

type Product = {
  id: string;
  sku: string;
  productName: string;

  category:
    | string
    | null;

  unit: string;

  normalPrice: number;
  effectivePrice: number;

  hasSpecialPrice: boolean;

  isFavourite: boolean;

  favouriteOrder:
    | number
    | null;
};

type Cart =
  Record<
    string,
    number
  >;

type APIResponse = {
  customer?: Customer;
  products?: Product[];
  error?: string;
};

type FavouriteResponse = {
  success?: boolean;
  isFavourite?: boolean;

  favouriteOrder?:
    | number
    | null;

  error?: string;
};

export default function MiniAppShopPage() {
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
    products,
    setProducts,
  ] =
    useState<Product[]>(
      []
    );

  const [
    cart,
    setCart,
  ] =
    useState<Cart>(
      {}
    );

  const [
    search,
    setSearch,
  ] =
    useState("");

  const [
    tab,
    setTab,
  ] =
    useState<
      | "favourites"
      | "all"
    >("favourites");

  const [
    showCart,
    setShowCart,
  ] =
    useState(false);

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
    idToken,
    setIdToken,
  ] =
    useState("");

  const [
    savingFavouriteIds,
    setSavingFavouriteIds,
  ] =
    useState<Set<string>>(
      new Set()
    );

  // ================================================
  // CUSTOMER HOME
  // ================================================

  function goCustomerHome() {
    const code =
      customer?.customerCode ??
      new URLSearchParams(
        window.location.search
      )
        .get("customer")
        ?.trim()
        .toUpperCase();

    if (!code) {
      router.push(
        "/miniapp?portal=customer"
      );

      return;
    }

    router.push(
      `/miniapp?portal=customer&customer=${encodeURIComponent(
        code
      )}`
    );
  }

  // ================================================
  // INITIALIZE LINE
  // ================================================

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
            ) ??
            ""
          )
            .trim()
            .toUpperCase();

        if (!customerCode) {
          throw new Error(
            "Customer was not selected."
          );
        }

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

        const response =
          await fetch(
            "/api/line/catalog",
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

                  customerCode,
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
              "Could not load catalogue."
          );
        }

        if (
          !data.customer
        ) {
          throw new Error(
            "Customer could not be loaded."
          );
        }

        if (cancelled) {
          return;
        }

        setIdToken(
          token
        );

        setCustomer(
          data.customer
        );

        setProducts(
          data.products ??
            []
        );

        // ----------------------------
        // Load existing local cart
        // ----------------------------

        const stored =
          localStorage.getItem(
            `b2b-cart-${data.customer.customerCode}`
          );

        if (stored) {
          try {
            setCart(
              JSON.parse(
                stored
              )
            );
          } catch {
            localStorage.removeItem(
              `b2b-cart-${data.customer.customerCode}`
            );
          }
        }

        setLoading(
          false
        );
      } catch (error) {
        if (cancelled) {
          return;
        }

        setMessage(
          error instanceof Error
            ? error.message
            : "Could not load catalogue."
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

  // ================================================
  // FAVOURITES
  // ================================================

  async function toggleFavourite(
    product: Product
  ) {
    if (
      !customer ||
      !idToken
    ) {
      return;
    }

    if (
      savingFavouriteIds.has(
        product.id
      )
    ) {
      return;
    }

    const nextFavourite =
      !product.isFavourite;

    const previousFavourite =
      product.isFavourite;

    const previousOrder =
      product.favouriteOrder;

    const currentHighestOrder =
      products.reduce(
        (
          highest,
          item
        ) =>
          Math.max(
            highest,
            Number(
              item.favouriteOrder ??
                0
            )
          ),
        0
      );

    const optimisticOrder =
      nextFavourite
        ? currentHighestOrder +
          1
        : null;

    // --------------------------------------------
    // Optimistic UI:
    // star changes immediately.
    // --------------------------------------------

    setProducts(
      (current) =>
        current.map(
          (item) =>
            item.id ===
            product.id
              ? {
                  ...item,

                  isFavourite:
                    nextFavourite,

                  favouriteOrder:
                    optimisticOrder,
                }
              : item
        )
    );

    setSavingFavouriteIds(
      (current) => {
        const next =
          new Set(
            current
          );

        next.add(
          product.id
        );

        return next;
      }
    );

    setMessage(
      ""
    );

    try {
      const response =
        await fetch(
          "/api/line/favourites",
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

                customerCode:
                  customer.customerCode,

                productId:
                  product.id,

                isFavourite:
                  nextFavourite,
              }),
          }
        );

      const result =
        (await response.json()) as FavouriteResponse;

      if (
        !response.ok
      ) {
        throw new Error(
          result.error ??
            "Could not update favourite."
        );
      }

      setProducts(
        (current) =>
          current.map(
            (item) =>
              item.id ===
              product.id
                ? {
                    ...item,

                    isFavourite:
                      Boolean(
                        result.isFavourite
                      ),

                    favouriteOrder:
                      result.favouriteOrder ??
                      null,
                  }
                : item
          )
      );
    } catch (error) {
      // Roll back if server update fails.

      setProducts(
        (current) =>
          current.map(
            (item) =>
              item.id ===
              product.id
                ? {
                    ...item,

                    isFavourite:
                      previousFavourite,

                    favouriteOrder:
                      previousOrder,
                  }
                : item
          )
      );

      setMessage(
        error instanceof Error
          ? error.message
          : "Could not update favourite."
      );
    } finally {
      setSavingFavouriteIds(
        (current) => {
          const next =
            new Set(
              current
            );

          next.delete(
            product.id
          );

          return next;
        }
      );
    }
  }

  // ================================================
  // SAVE CART
  // ================================================

  function saveCart(
    newCart: Cart
  ) {
    setCart(
      newCart
    );

    if (!customer) {
      return;
    }

    localStorage.setItem(
      `b2b-cart-${customer.customerCode}`,
      JSON.stringify(
        newCart
      )
    );
  }

  function updateQuantity(
    productId: string,
    rawValue: string
  ) {
    const newCart = {
      ...cart,
    };

    if (
      rawValue ===
      ""
    ) {
      delete newCart[
        productId
      ];

      saveCart(
        newCart
      );

      return;
    }

    const quantity =
      Math.max(
        0,
        Number(
          rawValue
        )
      );

    if (
      !quantity ||
      Number.isNaN(
        quantity
      )
    ) {
      delete newCart[
        productId
      ];
    } else {
      newCart[
        productId
      ] =
        quantity;
    }

    saveCart(
      newCart
    );
  }

  // ================================================
  // FILTER PRODUCTS
  // ================================================

  const displayedProducts =
    useMemo(() => {
      const query =
        search
          .trim()
          .toLowerCase();

      let list =
        products.filter(
          (product) => {
            if (
              tab ===
                "favourites" &&
              !product.isFavourite
            ) {
              return false;
            }

            if (!query) {
              return true;
            }

            return (
              product.productName
                .toLowerCase()
                .includes(
                  query
                ) ||
              product.sku
                .toLowerCase()
                .includes(
                  query
                ) ||
              (
                product.category ??
                ""
              )
                .toLowerCase()
                .includes(
                  query
                )
            );
          }
        );

      if (
        tab ===
        "favourites"
      ) {
        list = [
          ...list,
        ].sort(
          (a, b) =>
            (
              a.favouriteOrder ??
              999999
            ) -
            (
              b.favouriteOrder ??
              999999
            )
        );
      }

      return list;
    }, [
      products,
      search,
      tab,
    ]);

  // ================================================
  // CART DETAILS
  // ================================================

  const cartProducts =
    useMemo(
      () =>
        products
          .filter(
            (product) =>
              Number(
                cart[
                  product.id
                ] ??
                  0
              ) > 0
          )
          .map(
            (product) => ({
              ...product,

              quantity:
                Number(
                  cart[
                    product.id
                  ]
                ),
            })
          ),
      [
        products,
        cart,
      ]
    );

  const cartItemCount =
    cartProducts.length;

  const estimatedTotal =
    cartProducts.reduce(
      (
        total,
        product
      ) =>
        total +
        product.quantity *
          product.effectivePrice,
      0
    );

  // ================================================
  // LOADING
  // ================================================

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-100 flex items-center justify-center p-5">

        <div className="text-center">

          <p className="text-xl font-bold">
            LOTUS&apos;S B2B
          </p>

          <p className="text-gray-500 mt-3">
            Loading products...
          </p>

        </div>

      </main>
    );
  }

  // ================================================
  // ERROR
  // ================================================

  if (!customer) {
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
            ← Customer Home
          </button>

          <div className="bg-white border rounded-2xl p-6 mt-5">

            <h1 className="text-xl font-bold">
              Could Not Load Catalogue
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

  // ================================================
  // PAGE
  // ================================================

  return (
    <main className="min-h-screen bg-gray-100 pb-28">

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
            ← Customer Home
          </button>

          <h1 className="text-2xl font-bold mt-3">
            Order Products
          </h1>

          <p className="text-gray-500">
            {
              customer.customerName
            }
          </p>

        </div>

      </header>

      <div className="max-w-2xl mx-auto p-4">

        {/* TABS */}

        <div className="grid grid-cols-2 bg-white border rounded-xl overflow-hidden mb-4">

          <button
            type="button"
            onClick={() =>
              setTab(
                "favourites"
              )
            }
            className={
              tab ===
              "favourites"
                ? "bg-black text-white px-4 py-3 font-semibold"
                : "px-4 py-3 font-semibold"
            }
          >
            ★ Favourites
          </button>

          <button
            type="button"
            onClick={() =>
              setTab(
                "all"
              )
            }
            className={
              tab ===
              "all"
                ? "bg-black text-white px-4 py-3 font-semibold"
                : "px-4 py-3 font-semibold"
            }
          >
            All Products
          </button>

        </div>

        {/* MESSAGE */}

        {message && (
          <div className="bg-white border rounded-xl p-4 mb-4 text-red-600">
            {
              message
            }
          </div>
        )}

        {/* SEARCH */}

        <input
          value={
            search
          }
          onChange={(event) =>
            setSearch(
              event.target.value
            )
          }
          placeholder="Search product, SKU or category..."
          className="w-full bg-white border rounded-xl px-4 py-3 mb-4"
        />

        {/* FAVOURITES HELP */}

        {tab ===
          "favourites" && (
          <p className="text-sm text-gray-500 mb-4">
            Tap ★ on any favourite to remove it. Add more from All Products.
          </p>
        )}

        {tab ===
          "all" && (
          <p className="text-sm text-gray-500 mb-4">
            Tap ☆ to add products to your favourites for faster ordering.
          </p>
        )}

        {/* PRODUCTS */}

        {displayedProducts.length ===
        0 ? (

          <div className="bg-white border rounded-2xl p-8 text-center">

            <p className="text-gray-500">

              {tab ===
              "favourites"
                ? "You do not have any favourite products yet."
                : "No products found."}

            </p>

            {tab ===
              "favourites" && (

              <button
                type="button"
                onClick={() =>
                  setTab(
                    "all"
                  )
                }
                className="mt-4 underline font-semibold"
              >
                Browse All Products
              </button>

            )}

          </div>

        ) : (

          <div className="space-y-3">

            {displayedProducts.map(
              (product) => {
                const step =
                  product.unit
                    .toLowerCase()
                    .includes(
                      "kg"
                    )
                    ? 0.1
                    : 1;

                const favouriteBusy =
                  savingFavouriteIds.has(
                    product.id
                  );

                return (
                  <div
                    key={
                      product.id
                    }
                    className="bg-white border rounded-2xl p-4"
                  >

                    <div className="flex justify-between gap-3">

                      {/* PRODUCT INFO */}

                      <div className="min-w-0 flex-1">

                        <div className="flex items-start gap-2">

                          <div className="min-w-0 flex-1">

                            <p className="font-bold">
                              {
                                product.productName
                              }
                            </p>

                            <p className="text-xs text-gray-400 mt-1">
                              {
                                product.sku
                              }

                              {product.category
                                ? ` · ${product.category}`
                                : ""}
                            </p>

                          </div>

                          {/* FAVOURITE STAR */}

                          <button
                            type="button"
                            disabled={
                              favouriteBusy
                            }
                            onClick={() =>
                              toggleFavourite(
                                product
                              )
                            }
                            aria-label={
                              product.isFavourite
                                ? `Remove ${product.productName} from favourites`
                                : `Add ${product.productName} to favourites`
                            }
                            title={
                              product.isFavourite
                                ? "Remove from favourites"
                                : "Add to favourites"
                            }
                            className="w-11 h-11 shrink-0 flex items-center justify-center text-3xl leading-none rounded-full disabled:opacity-40"
                          >
                            {favouriteBusy
                              ? "…"
                              : product.isFavourite
                              ? "★"
                              : "☆"}
                          </button>

                        </div>

                        <div className="mt-3">

                          <span className="font-bold text-lg">
                            ฿
                            {product.effectivePrice.toFixed(
                              2
                            )}
                          </span>

                          <span className="text-gray-500 text-sm">
                            {" "}
                            /{" "}
                            {
                              product.unit
                            }
                          </span>

                          {product.hasSpecialPrice && (
                            <>

                              <p className="text-xs font-semibold mt-1">
                                Your special price
                              </p>

                              <p className="text-xs text-gray-400 line-through">
                                Normal ฿
                                {product.normalPrice.toFixed(
                                  2
                                )}
                              </p>

                            </>
                          )}

                        </div>

                      </div>

                      {/* QUANTITY */}

                      <div className="shrink-0">

                        <label className="text-xs text-gray-500">
                          Qty
                        </label>

                        <input
                          type="number"
                          min="0"
                          step={
                            step
                          }
                          value={
                            cart[
                              product.id
                            ] ??
                            ""
                          }
                          onChange={(event) =>
                            updateQuantity(
                              product.id,
                              event
                                .target
                                .value
                            )
                          }
                          className="block w-24 border rounded-lg px-3 py-2 mt-1 text-right"
                        />

                      </div>

                    </div>

                  </div>
                );
              }
            )}

          </div>

        )}

      </div>

      {/* CART BAR */}

      {cartItemCount >
        0 && (

        <div className="fixed bottom-0 left-0 right-0 bg-white border-t p-3 z-30">

          <div className="max-w-2xl mx-auto">

            <button
              type="button"
              onClick={() =>
                setShowCart(
                  true
                )
              }
              className="w-full bg-black text-white rounded-xl px-5 py-4 flex justify-between items-center"
            >

              <span className="font-semibold">
                View Cart (
                {
                  cartItemCount
                }
                )
              </span>

              <span className="font-bold">
                ~฿
                {estimatedTotal.toFixed(
                  2
                )}
              </span>

            </button>

          </div>

        </div>

      )}

      {/* CART MODAL */}

      {showCart && (

        <div className="fixed inset-0 bg-black/40 z-50 flex items-end">

          <div className="bg-white w-full max-h-[85vh] rounded-t-3xl overflow-y-auto">

            <div className="max-w-2xl mx-auto p-5">

              <div className="flex justify-between items-center">

                <div>

                  <h2 className="text-2xl font-bold">
                    Your Cart
                  </h2>

                  <p className="text-gray-500">
                    {
                      customer.customerName
                    }
                  </p>

                </div>

                <button
                  type="button"
                  onClick={() =>
                    setShowCart(
                      false
                    )
                  }
                  className="text-2xl"
                >
                  ×
                </button>

              </div>

              <div className="mt-5 divide-y">

                {cartProducts.map(
                  (product) => (

                  <div
                    key={
                      product.id
                    }
                    className="py-4"
                  >

                    <div className="flex justify-between gap-4">

                      <div>

                        <p className="font-semibold">
                          {
                            product.productName
                          }
                        </p>

                        <p className="text-sm text-gray-500 mt-1">

                          {
                            product.quantity
                          }{" "}

                          {
                            product.unit
                          }

                          {" × "}

                          ฿
                          {product.effectivePrice.toFixed(
                            2
                          )}

                        </p>

                      </div>

                      <p className="font-bold">

                        ฿
                        {(
                          product.quantity *
                          product.effectivePrice
                        ).toFixed(
                          2
                        )}

                      </p>

                    </div>

                  </div>

                ))}

              </div>

              <div className="flex justify-between items-center border-t pt-5 mt-2">

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

              <p className="text-xs text-gray-500 mt-2">
                Final quantity and amount may change after confirmation and picking.
              </p>

              <button
                type="button"
                onClick={() =>
                  router.push(
                    `/miniapp/checkout?customer=${customer.customerCode}`
                  )
                }
                className="w-full bg-black text-white rounded-xl px-5 py-4 font-semibold mt-6"
              >
                CONTINUE TO CHECKOUT
              </button>

              <button
                type="button"
                onClick={() => {
                  const confirmed =
                    window.confirm(
                      "Clear all items from your cart?"
                    );

                  if (!confirmed) {
                    return;
                  }

                  saveCart(
                    {}
                  );

                  setShowCart(
                    false
                  );
                }}
                className="w-full border rounded-xl px-5 py-3 mt-3"
              >
                Reset Cart
              </button>

            </div>

          </div>

        </div>

      )}

    </main>
  );
}