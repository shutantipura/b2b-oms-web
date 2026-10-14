"use client";



import {

  useEffect,

  useMemo,

  useState,

} from "react";



import {

  useRouter,

} from "next/navigation";



// =======================================================

// TYPES

// =======================================================



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



  imageUrl:

    | string

    | null;



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



// =======================================================

// HELPERS

// =======================================================



function getQuantityStep(

  unit: string

) {

  const normalized =

    unit

      .trim()

      .toLowerCase();



  if (

    normalized.includes(

      "kg"

    ) ||

    normalized.includes(

      "กก"

    ) ||

    normalized.includes(

      "กิโล"

    )

  ) {

    return 0.1;

  }



  return 1;

}



function roundQuantity(

  value: number

) {

  return Math.round(

    value * 1000

  ) / 1000;

}



function formatQuantity(

  value: number

) {

  return new Intl.NumberFormat(

    "th-TH",

    {

      maximumFractionDigits:

        3,

    }

  ).format(

    value

  );

}



function formatPrice(

  value: number

) {

  return new Intl.NumberFormat(

    "th-TH",

    {

      minimumFractionDigits:

        0,



      maximumFractionDigits:

        2,

    }

  ).format(

    value

  );

}



// =======================================================

// PAGE

// =======================================================



export default function MiniAppShopPage() {

  const router =

    useRouter();



  const [

    customer,

    setCustomer,

  ] =

    useState<

      Customer | null

    >(

      null

    );



  const [

    products,

    setProducts,

  ] =

    useState<

      Product[]

    >(

      []

    );



  const [

    cart,

    setCart,

  ] =

    useState<Cart>(

      {}

    );



  // Keep the text being typed separate from the saved cart quantity.
  // This lets the input temporarily be blank or "0" without the
  // quantity control disappearing before the customer finishes typing.
  const [

    quantityInputs,

    setQuantityInputs,

  ] =

    useState<Record<string, string>>(

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

    >(

      "favourites"

    );



  const [

    selectedCategory,

    setSelectedCategory,

  ] =

    useState("all");



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

    useState<

      Set<string>

    >(

      new Set()

    );



  // =====================================================

  // CUSTOMER HOME

  // =====================================================



  function goCustomerHome() {

    const code =

      customer?.customerCode ??

      new URLSearchParams(

        window.location.search

      )

        .get(

          "customer"

        )

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



        const customerCode =

          (

            params.get(

              "customer"

            ) ??

            ""

          )

            .trim()

            .toUpperCase();



        if (

          !customerCode

        ) {

          throw new Error(

            "ไม่ได้เลือกลูกค้า"

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

                JSON.stringify(

                  {

                    idToken:

                      token,



                    customerCode,

                  }

                ),

            }

          );



        const data =

          (await response.json()) as APIResponse;



        if (

          !response.ok

        ) {

          throw new Error(

            data.error ??

              "ไม่สามารถโหลดสินค้าได้"

          );

        }



        if (

          !data.customer

        ) {

          throw new Error(

            "ไม่พบข้อมูลลูกค้า"

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



        setCustomer(

          data.customer

        );



        setProducts(

          data.products ??

            []

        );



        // ---------------------------------------------

        // LOAD CART

        // ---------------------------------------------



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

        if (

          cancelled

        ) {

          return;

        }



        setMessage(

          error instanceof Error

            ? error.message

            : "ไม่สามารถโหลดสินค้าได้"

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

  // FAVOURITES

  // =====================================================



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



    // ---------------------------------------------

    // OPTIMISTIC UI

    // ---------------------------------------------



    setProducts(

      (

        current

      ) =>

        current.map(

          (

            item

          ) =>

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

      (

        current

      ) => {

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

              JSON.stringify(

                {

                  idToken,



                  customerCode:

                    customer.customerCode,



                  productId:

                    product.id,



                  isFavourite:

                    nextFavourite,

                }

              ),

          }

        );



      const result =

        (await response.json()) as FavouriteResponse;



      if (

        !response.ok

      ) {

        throw new Error(

          result.error ??

            "ไม่สามารถอัปเดตรายการโปรดได้"

        );

      }



      setProducts(

        (

          current

        ) =>

          current.map(

            (

              item

            ) =>

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

      // Roll back



      setProducts(

        (

          current

        ) =>

          current.map(

            (

              item

            ) =>

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

          : "ไม่สามารถอัปเดตรายการโปรดได้"

      );

    } finally {

      setSavingFavouriteIds(

        (

          current

        ) => {

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



  // =====================================================

  // CART

  // =====================================================



  function saveCart(

    newCart: Cart

  ) {

    setCart(

      newCart

    );



    if (

      !customer

    ) {

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

    // Always preserve exactly what the customer is typing.
    setQuantityInputs(
      (current) => ({
        ...current,
        [productId]: rawValue,
      })
    );



    // An empty field (or a temporary zero such as the first character
    // of "0.5") must NOT remove the item while the user is typing.
    if (
      rawValue ===
      ""
    ) {
      return;
    }



    const quantity =
      Number(
        rawValue
      );



    if (
      Number.isNaN(
        quantity
      ) ||
      quantity <= 0
    ) {
      return;
    }



    const newCart = {
      ...cart,
      [productId]:
        roundQuantity(
          quantity
        ),
    };



    saveCart(
      newCart
    );

  }



  function finishQuantityEdit(

    productId: string

  ) {

    const rawValue =
      quantityInputs[
        productId
      ];



    if (
      rawValue ===
      undefined
    ) {
      return;
    }



    const trimmed =
      rawValue.trim();



    const newCart = {
      ...cart,
    };



    if (
      trimmed ===
      ""
    ) {
      delete newCart[
        productId
      ];
    } else {
      const quantity =
        Number(
          trimmed
        );



      if (
        !Number.isNaN(
          quantity
        )
      ) {
        if (
          quantity <= 0
        ) {
          delete newCart[
            productId
          ];
        } else {
          newCart[
            productId
          ] =
            roundQuantity(
              quantity
            );
        }
      }
    }



    saveCart(
      newCart
    );



    setQuantityInputs(
      (current) => {
        const next = {
          ...current,
        };



        delete next[
          productId
        ];



        return next;
      }
    );

  }



  function changeQuantity(

    product: Product,

    direction:
      | 1
      | -1

  ) {

    const step =
      getQuantityStep(
        product.unit
      );



    const current =
      Number(
        cart[
          product.id
        ] ??
          0
      );



    const next =
      roundQuantity(
        Math.max(
          0,
          current +
            direction *
              step
        )
      );



    const nextCart = {
      ...cart,
    };



    if (
      next <= 0
    ) {
      delete nextCart[
        product.id
      ];
    } else {
      nextCart[
        product.id
      ] =
        next;
    }



    setQuantityInputs(
      (currentInputs) => {
        const nextInputs = {
          ...currentInputs,
        };



        delete nextInputs[
          product.id
        ];



        return nextInputs;
      }
    );



    saveCart(
      nextCart
    );

  }



  // =====================================================

  // CATEGORIES

  // =====================================================



  const categories =

    useMemo(

      () => {

        const values =

          products

            .map(

              (

                product

              ) =>

                product.category

                  ?.trim()

            )

            .filter(

              (

                value

              ): value is string =>

                Boolean(

                  value

                )

            );



        return Array.from(

          new Set(

            values

          )

        ).sort(

          (

            a,

            b

          ) =>

            a.localeCompare(

              b,

              "th"

            )

        );

      },

      [

        products,

      ]

    );



  // =====================================================

  // FILTER PRODUCTS

  // =====================================================



  const displayedProducts =

    useMemo(() => {

      const query =

        search

          .trim()

          .toLowerCase();



      let list =

        products.filter(

          (

            product

          ) => {

            if (

              tab ===

                "favourites" &&

              !product.isFavourite

            ) {

              return false;

            }



            if (

              selectedCategory !==

                "all" &&

              product.category !==

                selectedCategory

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

          (

            a,

            b

          ) =>

            (

              a.favouriteOrder ??

              999999

            ) -

            (

              b.favouriteOrder ??

              999999

            )

        );

      } else {

        list = [

          ...list,

        ].sort(

          (

            a,

            b

          ) =>

            a.productName.localeCompare(

              b.productName,

              "th"

            )

        );

      }



      return list;

    }, [

      products,

      search,

      tab,

      selectedCategory,

    ]);



  // =====================================================

  // CART DETAILS

  // =====================================================



  const cartProducts =

    useMemo(

      () =>

        products

          .filter(

            (

              product

            ) =>

              Number(

                cart[

                  product.id

                ] ??

                  0

              ) >

              0

          )

          .map(

            (

              product

            ) => ({

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



  // =====================================================

  // LOADING

  // =====================================================



  if (

    loading

  ) {

    return (

      <main className="min-h-screen bg-gray-50 flex items-center justify-center p-5">



        <div className="text-center">



          <div className="w-12 h-12 rounded-full border-4 border-gray-200 border-t-black animate-spin mx-auto" />



          <p className="font-bold text-lg mt-5">

            LOTUS&apos;S B2B

          </p>



          <p className="text-gray-500 mt-2">

            กำลังโหลดสินค้า...

          </p>



        </div>



      </main>

    );

  }



  // =====================================================

  // ERROR

  // =====================================================



  if (

    !customer

  ) {

    return (

      <main className="min-h-screen bg-gray-50 p-5">



        <div className="max-w-md mx-auto">



          <button

            type="button"

            onClick={

              goCustomerHome

            }

            className="text-gray-500"

          >

            ← กลับหน้าหลัก

          </button>



          <div className="bg-white border rounded-2xl p-6 mt-5">



            <h1 className="text-xl font-bold">

              ไม่สามารถโหลดสินค้าได้

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

  // PAGE

  // =====================================================



  return (

    <main className="min-h-screen bg-gray-50 pb-28">



      {/* ================================================= */}

      {/* HEADER */}

      {/* ================================================= */}



      <header className="bg-white border-b sticky top-0 z-30">



        <div className="max-w-2xl mx-auto px-4 pt-3 pb-4">



          <div className="flex justify-between items-center gap-3">



            <button

              type="button"

              onClick={

                goCustomerHome

              }

              className="text-sm text-gray-500"

            >

              ← หน้าแรก

            </button>



            {cartItemCount >

              0 && (



              <button

                type="button"

                onClick={() =>

                  setShowCart(

                    true

                  )

                }

                className="relative border rounded-full w-10 h-10 flex items-center justify-center bg-white"

                aria-label="เปิดตะกร้า"

              >

                🛒



                <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-black text-white text-[11px] flex items-center justify-center">

                  {

                    cartItemCount

                  }

                </span>



              </button>



            )}



          </div>



          <div className="mt-3">



            <h1 className="text-2xl font-bold">

              สั่งสินค้า

            </h1>



            <p className="text-sm text-gray-500 mt-1">

              {

                customer.customerName

              }

            </p>



          </div>



          {/* SEARCH */}



          <div className="relative mt-4">



            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">

              🔍

            </span>



            <input

              value={

                search

              }

              onChange={(event) =>

                setSearch(

                  event.target

                    .value

                )

              }

              placeholder="ค้นหาสินค้า หรือ SKU"

              className="w-full bg-gray-100 rounded-xl pl-11 pr-4 py-3 outline-none focus:ring-2 focus:ring-gray-300"

            />



          </div>



        </div>



      </header>



      {/* ================================================= */}

      {/* CONTENT */}

      {/* ================================================= */}



      <div className="max-w-2xl mx-auto">



        {/* TABS */}



        <div className="bg-white px-4 pt-4">



          <div className="grid grid-cols-2 bg-gray-100 rounded-xl p-1">



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

                  ? "bg-white rounded-lg px-3 py-2.5 font-semibold shadow-sm"

                  : "px-3 py-2.5 font-semibold text-gray-500"

              }

            >

              ★ ซื้อประจำ

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

                  ? "bg-white rounded-lg px-3 py-2.5 font-semibold shadow-sm"

                  : "px-3 py-2.5 font-semibold text-gray-500"

              }

            >

              สินค้าทั้งหมด

            </button>



          </div>



        </div>



        {/* CATEGORY FILTER */}



        {categories.length >

          0 && (



          <div className="bg-white px-4 py-4 border-b">



            <div className="flex gap-2 overflow-x-auto pb-1">



              <button

                type="button"

                onClick={() =>

                  setSelectedCategory(

                    "all"

                  )

                }

                className={

                  selectedCategory ===

                  "all"

                    ? "whitespace-nowrap bg-black text-white rounded-full px-4 py-2 text-sm font-semibold"

                    : "whitespace-nowrap bg-gray-100 rounded-full px-4 py-2 text-sm"

                }

              >

                ทั้งหมด

              </button>



              {categories.map(

                (

                  category

                ) => (



                <button

                  type="button"

                  key={

                    category

                  }

                  onClick={() =>

                    setSelectedCategory(

                      category

                    )

                  }

                  className={

                    selectedCategory ===

                    category

                      ? "whitespace-nowrap bg-black text-white rounded-full px-4 py-2 text-sm font-semibold"

                      : "whitespace-nowrap bg-gray-100 rounded-full px-4 py-2 text-sm"

                  }

                >

                  {

                    category

                  }

                </button>



              ))}



            </div>



          </div>



        )}



        {/* MESSAGE */}



        {message && (



          <div className="mx-4 mt-4 bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm">

            {

              message

            }

          </div>



        )}



        {/* TAB HELP */}



        <div className="px-4 pt-4">



          <p className="text-xs text-gray-500">



            {tab ===

            "favourites"

              ? "สินค้าที่คุณซื้อประจำ กด ★ เพื่อเอาออกจากรายการ"

              : "กด ☆ ที่รูปสินค้าเพื่อเพิ่มไว้ในรายการซื้อประจำ"}



          </p>



        </div>



        {/* ================================================= */}

        {/* PRODUCTS */}

        {/* ================================================= */}



        <div className="p-4">



          {displayedProducts.length ===

          0 ? (



            <div className="bg-white border rounded-2xl p-8 text-center">



              <p className="font-semibold">

                {tab ===

                "favourites"

                  ? "ยังไม่มีสินค้าซื้อประจำ"

                  : "ไม่พบสินค้า"}

              </p>



              <p className="text-sm text-gray-500 mt-2">

                {tab ===

                "favourites"

                  ? "เลือกสินค้าจากหน้าสินค้าทั้งหมดแล้วกด ☆ เพื่อเพิ่มรายการโปรด"

                  : "ลองค้นหาด้วยชื่อสินค้า หรือ SKU อื่น"}

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

                  className="mt-5 bg-black text-white rounded-xl px-5 py-3 font-semibold"

                >

                  ดูสินค้าทั้งหมด

                </button>



              )}



            </div>



          ) : (



            <div className="grid grid-cols-2 gap-3">



              {displayedProducts.map(

                (

                  product

                ) => {

                  const step =

                    getQuantityStep(

                      product.unit

                    );



                  const quantity =

                    Number(

                      cart[

                        product.id

                      ] ??

                        0

                    );



                  const favouriteBusy =

                    savingFavouriteIds.has(

                      product.id

                    );



                  return (

                    <article

                      key={

                        product.id

                      }

                      className="bg-white border rounded-2xl overflow-hidden flex flex-col"

                    >



                      {/* IMAGE */}



                      <div className="relative aspect-square bg-gray-50">



                        {product.imageUrl ? (



                          <img

                            src={

                              product.imageUrl

                            }

                            alt={

                              product.productName

                            }

                            className="w-full h-full object-contain p-2"

                            loading="lazy"

                            onError={(event) => {

                              event.currentTarget.style.display =

                                "none";

                            }}

                          />



                        ) : (



                          <div className="w-full h-full flex flex-col items-center justify-center text-gray-300 p-4">



                            <span className="text-4xl">

                              📦

                            </span>



                            <span className="text-xs mt-2">

                              ไม่มีรูปสินค้า

                            </span>



                          </div>



                        )}



                        {/* FAVOURITE */}



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

                              ? `นำ ${product.productName} ออกจากรายการโปรด`

                              : `เพิ่ม ${product.productName} ในรายการโปรด`

                          }

                          className="absolute top-2 right-2 w-10 h-10 rounded-full bg-white/95 shadow flex items-center justify-center text-2xl disabled:opacity-50"

                        >

                          {favouriteBusy

                            ? "…"

                            : product.isFavourite

                            ? "★"

                            : "☆"}

                        </button>



                        {/* SPECIAL PRICE */}



                        {product.hasSpecialPrice && (



                          <span className="absolute left-2 top-2 bg-black text-white rounded-full px-2.5 py-1 text-[10px] font-semibold">

                            ราคาพิเศษ

                          </span>



                        )}



                      </div>



                      {/* INFO */}



                      <div className="p-3 flex flex-col flex-1">



                        <p className="font-semibold text-sm leading-5 line-clamp-2 min-h-10">

                          {

                            product.productName

                          }

                        </p>



                        <p className="text-[11px] text-gray-400 mt-1 truncate">

                          SKU{" "}

                          {

                            product.sku

                          }

                        </p>



                        {/* PRICE */}



                        <div className="mt-3">



                          <div className="flex items-end gap-1 flex-wrap">



                            <span className="font-bold text-lg leading-none">

                              ฿

                              {formatPrice(

                                product.effectivePrice

                              )}

                            </span>



                            <span className="text-xs text-gray-500">

                              /{" "}

                              {

                                product.unit

                              }

                            </span>



                          </div>



                          {product.hasSpecialPrice && (



                            <p className="text-xs text-gray-400 line-through mt-1">

                              ปกติ ฿

                              {formatPrice(

                                product.normalPrice

                              )}

                            </p>



                          )}



                        </div>



                        {/* QUANTITY */}



                        <div className="mt-auto pt-4">



                          {quantity >

                          0 ? (



                            <div className="flex items-center border rounded-xl overflow-hidden">



                              <button

                                type="button"

                                onClick={() =>

                                  changeQuantity(

                                    product,

                                    -1

                                  )

                                }

                                className="w-9 h-10 flex items-center justify-center text-lg font-bold bg-gray-50"

                              >

                                −

                              </button>



                              <input

                                type="number"

                                min="0"

                                step={

                                  step

                                }

                                inputMode="decimal"

                                placeholder="0"

                                value={

                                  quantityInputs[

                                    product.id

                                  ] ??

                                  String(

                                    quantity

                                  )

                                }

                                onFocus={() =>

                                  setQuantityInputs(

                                    (current) => ({

                                      ...current,

                                      [product.id]:

                                        String(

                                          quantity

                                        ),

                                    })

                                  )

                                }

                                onChange={(event) =>

                                  updateQuantity(

                                    product.id,

                                    event

                                      .target

                                      .value

                                  )

                                }

                                onBlur={() =>

                                  finishQuantityEdit(

                                    product.id

                                  )

                                }

                                onKeyDown={(event) => {

                                  if (

                                    event.key ===

                                    "Enter"

                                  ) {

                                    event.currentTarget.blur();

                                  }

                                }}

                                className="min-w-0 flex-1 w-full h-10 text-center text-sm font-semibold outline-none"

                              />



                              <button

                                type="button"

                                onClick={() =>

                                  changeQuantity(

                                    product,

                                    1

                                  )

                                }

                                className="w-9 h-10 flex items-center justify-center text-lg font-bold bg-emerald-600 text-white"

                              >

                                +

                              </button>



                            </div>



                          ) : (



                            <button

                              type="button"

                              onClick={() =>

                                changeQuantity(

                                  product,

                                  1

                                )

                              }

                              className="w-full bg-emerald-600 text-white rounded-xl py-2.5 text-sm font-semibold"

                            >

                              + เพิ่ม

                            </button>



                          )}



                        </div>



                      </div>



                    </article>

                  );

                }

              )}



            </div>



          )}



        </div>



      </div>



      {/* ================================================= */}

      {/* CART BAR */}

      {/* ================================================= */}



      {cartItemCount >

        0 && (



        <div className="fixed bottom-0 left-0 right-0 bg-white border-t p-3 z-40">



          <div className="max-w-2xl mx-auto">



            <button

              type="button"

              onClick={() =>

                setShowCart(

                  true

                )

              }

              className="w-full bg-black text-white rounded-2xl px-5 py-4 flex justify-between items-center"

            >



              <div className="text-left">



                <p className="font-semibold">

                  ดูตะกร้า{" "}

                  {

                    cartItemCount

                  }{" "}

                  รายการ

                </p>



                <p className="text-xs text-white/60 mt-0.5">

                  แตะเพื่อตรวจสอบรายการ

                </p>



              </div>



              <span className="font-bold text-lg">

                ~฿

                {formatPrice(

                  estimatedTotal

                )}

              </span>



            </button>



          </div>



        </div>



      )}



      {/* ================================================= */}

      {/* CART MODAL */}

      {/* ================================================= */}



      {showCart && (



        <div className="fixed inset-0 bg-black/40 z-50 flex items-end">



          <button

            type="button"

            aria-label="ปิดตะกร้า"

            className="absolute inset-0 w-full h-full"

            onClick={() =>

              setShowCart(

                false

              )

            }

          />



          <div className="relative bg-white w-full max-h-[88vh] rounded-t-3xl overflow-y-auto">



            <div className="max-w-2xl mx-auto p-5">



              <div className="flex justify-between items-start gap-4">



                <div>



                  <h2 className="text-2xl font-bold">

                    ตะกร้าสินค้า

                  </h2>



                  <p className="text-sm text-gray-500 mt-1">

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

                  className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center text-xl"

                >

                  ×

                </button>



              </div>



              {/* ITEMS */}



              <div className="mt-5 divide-y">



                {cartProducts.map(

                  (

                    product

                  ) => (



                  <div

                    key={

                      product.id

                    }

                    className="py-4"

                  >



                    <div className="flex gap-3">



                      <div className="w-16 h-16 rounded-xl bg-gray-50 overflow-hidden shrink-0">



                        {product.imageUrl ? (



                          <img

                            src={

                              product.imageUrl

                            }

                            alt={

                              product.productName

                            }

                            className="w-full h-full object-contain p-1"

                            loading="lazy"

                          />



                        ) : (



                          <div className="w-full h-full flex items-center justify-center">

                            📦

                          </div>



                        )}



                      </div>



                      <div className="min-w-0 flex-1">



                        <p className="font-semibold text-sm">

                          {

                            product.productName

                          }

                        </p>



                        <p className="text-sm text-gray-500 mt-1">

                          {formatQuantity(

                            product.quantity

                          )}{" "}

                          {

                            product.unit

                          }{" "}

                          × ฿

                          {formatPrice(

                            product.effectivePrice

                          )}

                        </p>



                      </div>



                      <p className="font-bold whitespace-nowrap">

                        ฿

                        {formatPrice(

                          product.quantity *

                            product.effectivePrice

                        )}

                      </p>



                    </div>



                  </div>



                ))}



              </div>



              {/* TOTAL */}



              <div className="flex justify-between items-end border-t pt-5 mt-2">



                <div>



                  <p className="text-sm text-gray-500">

                    ยอดประมาณการ

                  </p>



                  <p className="text-xs text-gray-400 mt-1">

                    จำนวนจริงอาจเปลี่ยนหลังหยิบสินค้า

                  </p>



                </div>



                <span className="text-2xl font-bold">

                  ฿

                  {formatPrice(

                    estimatedTotal

                  )}

                </span>



              </div>



              {/* CHECKOUT */}



              <button

                type="button"

                onClick={() =>

                  router.push(

                    `/miniapp/checkout?customer=${encodeURIComponent(

                      customer.customerCode

                    )}`

                  )

                }

                className="w-full bg-black text-white rounded-xl px-5 py-4 font-semibold mt-6"

              >

                ดำเนินการสั่งซื้อ

              </button>



              {/* CLEAR */}



              <button

                type="button"

                onClick={() => {

                  const confirmed =

                    window.confirm(

                      "ต้องการล้างสินค้าทั้งหมดในตะกร้าหรือไม่?"

                    );



                  if (

                    !confirmed

                  ) {

                    return;

                  }



                  saveCart(

                    {}

                  );



                  setQuantityInputs(

                    {}

                  );



                  setShowCart(

                    false

                  );

                }}

                className="w-full border rounded-xl px-5 py-3 mt-3 text-gray-600"

              >

                ล้างตะกร้า

              </button>



            </div>



          </div>



        </div>



      )}



    </main>

  );

}