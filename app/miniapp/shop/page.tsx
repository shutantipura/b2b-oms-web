"use client";



import {

  useEffect,

  useMemo,

  useRef,

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

  imageUrl: string | null;

  category: string | null;

  unit: string;

  normalPrice: number;

  effectivePrice: number;

  hasSpecialPrice: boolean;

  isFavourite: boolean;

  favouriteOrder: number | null;

};



type Cart =

  Record<string, number>;



type CategoryFacet = {

  category: string;

  count: number;

};



type APIResponse = {

  customer?: Customer;

  products?: Product[];

  favourites?: Product[];

  cartProducts?: Product[];

  total?: number;

  nextOffset?: number;

  hasMore?: boolean;

  pageSize?: number;

  search?: string;

  category?: string;

  categoryFacets?: CategoryFacet[];

  searchTotal?: number;

  error?: string;

};



type FavouriteResponse = {

  success?: boolean;

  isFavourite?: boolean;

  favouriteOrder?: number | null;

  error?: string;

};



function isLiquorTobaccoCategory(

  category: string | null

) {

  return (

    category?.trim() ===

    "สุราและยาสูบ"

  );

}



const PAGE_SIZE = 30;

const SEARCH_DEBOUNCE_MS = 350;



function categoryLabel(category: string) {
  const label = category.trim();

  // Category values are now supplied directly in Thai by the
  // Visible Products import. Do not translate or reinterpret them.
  return label || "อื่นๆ";
}

function getQuantityStep(

  unit: string

) {

  const normalized =

    unit

      .trim()

      .toLowerCase();



  if (

    normalized.includes("kg") ||

    normalized.includes("กก") ||

    normalized.includes("กิโล")

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

      maximumFractionDigits: 3,

    }

  ).format(value);

}



function formatPrice(

  value: number

) {

  return new Intl.NumberFormat(

    "th-TH",

    {

      minimumFractionDigits: 0,

      maximumFractionDigits: 2,

    }

  ).format(value);

}



function mergeProducts(

  current: Product[],

  ...lists: Array<Product[] | undefined>

) {

  const map =

    new Map<string, Product>();



  current.forEach(

    (product) =>

      map.set(

        product.id,

        product

      )

  );



  lists.forEach(

    (list) => {

      (list ?? []).forEach(

        (product) =>

          map.set(

            product.id,

            product

          )

      );

    }

  );



  return [...map.values()];

}



function uniqueIds(

  ids: string[]

) {

  return [...new Set(ids)];

}



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



  // Product cache. This keeps products already seen in search,

  // favourites and the cart, even when the current search changes.

  const [

    products,

    setProducts,

  ] =

    useState<Product[]>([]);



  const [

    allProductIds,

    setAllProductIds,

  ] =

    useState<string[]>([]);



  const [

    favouriteProductIds,

    setFavouriteProductIds,

  ] =

    useState<string[]>([]);



  const [

    cart,

    setCart,

  ] =

    useState<Cart>({});



  // Keep typed text separate from the saved quantity so "" and

  // temporary values such as "0" do not immediately remove the item.

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

    debouncedSearch,

    setDebouncedSearch,

  ] =

    useState("");



  const [

    loadedSearch,

    setLoadedSearch,

  ] =

    useState("");



  const [

    selectedCategory,

    setSelectedCategory,

  ] =

    useState("");



  const [

    loadedCategory,

    setLoadedCategory,

  ] =

    useState("");



  const [

    categoryFacets,

    setCategoryFacets,

  ] =

    useState<CategoryFacet[]>(

      []

    );



  const [

    searchTotal,

    setSearchTotal,

  ] =

    useState(0);



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

    loadingProducts,

    setLoadingProducts,

  ] =

    useState(false);



  const [

    loadingMore,

    setLoadingMore,

  ] =

    useState(false);



  const [

    hasMore,

    setHasMore,

  ] =

    useState(false);



  const [

    totalProducts,

    setTotalProducts,

  ] =

    useState(0);



  const [

    nextOffset,

    setNextOffset,

  ] =

    useState(PAGE_SIZE);



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

    catalogueReady,

    setCatalogueReady,

  ] =

    useState(false);



  const [

    savingFavouriteIds,

    setSavingFavouriteIds,

  ] =

    useState<Set<string>>(

      new Set()

    );



  const catalogueRequestRef =

    useRef(0);



  // =====================================================

  // CUSTOMER HOME

  // =====================================================



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



  // =====================================================

  // INITIALIZE LINE + FIRST 30 PRODUCTS

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

            params.get("customer") ??

            ""

          )

            .trim()

            .toUpperCase();



        if (!customerCode) {

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



        if (!liff.isLoggedIn()) {

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



        let storedCart: Cart =

          {};



        const stored =

          localStorage.getItem(

            `b2b-cart-${customerCode}`

          );



        if (stored) {

          try {

            const parsed =

              JSON.parse(stored) as Cart;



            storedCart =

              Object.fromEntries(

                Object.entries(parsed)

                  .filter(

                    ([, quantity]) =>

                      Number(quantity) > 0

                  )

              );

          } catch {

            localStorage.removeItem(

              `b2b-cart-${customerCode}`

            );

          }

        }



        const response =

          await fetch(

            "/api/line/catalog",

            {

              method: "POST",

              headers: {

                "Content-Type":

                  "application/json",

              },

              body:

                JSON.stringify({

                  idToken:

                    token,

                  customerCode,

                  search: "",

                  category: "",

                  offset: 0,

                  limit:

                    PAGE_SIZE,

                  includeContext:

                    true,

                  cartProductIds:

                    Object.keys(

                      storedCart

                    ),

                }),

            }

          );



        const data =

          (await response.json()) as APIResponse;



        if (!response.ok) {

          throw new Error(

            data.error ??

            "ไม่สามารถโหลดสินค้าได้"

          );

        }



        if (!data.customer) {

          throw new Error(

            "ไม่พบข้อมูลลูกค้า"

          );

        }



        if (cancelled) {

          return;

        }



        const firstPage =

          data.products ??

          [];



        const favourites =

          data.favourites ??

          [];



        const returnedCartProducts =

          data.cartProducts ??

          [];



        setIdToken(token);

        setCustomer(

          data.customer

        );



        setProducts(

          mergeProducts(

            [],

            firstPage,

            favourites,

            returnedCartProducts

          )

        );



        setAllProductIds(

          firstPage.map(

            (product) =>

              product.id

          )

        );



        setFavouriteProductIds(

          favourites

            .slice()

            .sort(

              (a, b) =>

                (

                  a.favouriteOrder ??

                  999999

                ) -

                (

                  b.favouriteOrder ??

                  999999

                )

            )

            .map(

              (product) =>

                product.id

            )

        );



        const validCartIds =

          new Set(

            returnedCartProducts.map(

              (product) =>

                product.id

            )

          );



        const cleanedCart =

          Object.fromEntries(

            Object.entries(

              storedCart

            ).filter(

              ([productId, quantity]) =>

                Number(quantity) > 0 &&

                validCartIds.has(

                  productId

                )

            )

          );



        setCart(

          cleanedCart

        );



        if (

          Object.keys(cleanedCart).length !==

          Object.keys(storedCart).length

        ) {

          localStorage.setItem(

            `b2b-cart-${data.customer.customerCode}`,

            JSON.stringify(

              cleanedCart

            )

          );

        }



        setTotalProducts(

          data.total ??

          firstPage.length

        );



        setNextOffset(

          data.nextOffset ??

          firstPage.length

        );



        setHasMore(

          Boolean(

            data.hasMore

          )

        );



        setCategoryFacets(

          data.categoryFacets ??

          []

        );



        setSearchTotal(

          data.searchTotal ??

          data.total ??

          firstPage.length

        );



        setSelectedCategory("");

        setLoadedCategory("");

        setLoadedSearch("");

        setCatalogueReady(true);

        setLoading(false);

      } catch (error) {

        if (cancelled) {

          return;

        }



        setMessage(

          error instanceof Error

            ? error.message

            : "ไม่สามารถโหลดสินค้าได้"

        );



        setLoading(false);

      }

    }



    initialize();



    return () => {

      cancelled =

        true;

    };

  }, []);



  // =====================================================

  // DEBOUNCED SEARCH

  // =====================================================



  useEffect(() => {

    const timer =

      window.setTimeout(

        () => {

          setDebouncedSearch(

            search.trim()

          );

        },

        SEARCH_DEBOUNCE_MS

      );



    return () =>

      window.clearTimeout(

        timer

      );

  }, [search]);



  // =====================================================

  // LOAD / SEARCH ALL PRODUCTS ON THE SERVER

  // =====================================================



  async function loadAllProducts(

    query: string,

    offset: number,

    append: boolean,

    category: string =

      selectedCategory

  ) {

    if (

      !customer ||

      !idToken

    ) {

      return;

    }



    const requestId =

      ++catalogueRequestRef.current;



    if (append) {

      setLoadingMore(true);

    } else {

      setLoadingProducts(true);

      setMessage("");

    }



    try {

      const response =

        await fetch(

          "/api/line/catalog",

          {

            method: "POST",

            headers: {

              "Content-Type":

                "application/json",

            },

            body:

              JSON.stringify({

                idToken,

                customerCode:

                  customer.customerCode,

                search:

                  query,

                category,

                offset,

                limit:

                  PAGE_SIZE,

                includeContext:

                  false,

              }),

          }

        );



      const data =

        (await response.json()) as APIResponse;



      if (!response.ok) {

        throw new Error(

          data.error ??

          "ไม่สามารถโหลดสินค้าได้"

        );

      }



      // Ignore an older request if a newer search started meanwhile.

      if (

        requestId !==

        catalogueRequestRef.current

      ) {

        return;

      }



      const incoming =

        data.products ??

        [];



      setProducts(

        (current) =>

          mergeProducts(

            current,

            incoming

          )

      );



      if (append) {

        setAllProductIds(

          (current) =>

            uniqueIds([

              ...current,

              ...incoming.map(

                (product) =>

                  product.id

              ),

            ])

        );

      } else {

        setAllProductIds(

          incoming.map(

            (product) =>

              product.id

          )

        );



        setLoadedSearch(

          query

        );



        setLoadedCategory(

          category

        );



        setCategoryFacets(

          data.categoryFacets ??

          []

        );



        setSearchTotal(

          data.searchTotal ??

          data.total ??

          incoming.length

        );

      }



      setTotalProducts(

        data.total ??

        incoming.length

      );



      setNextOffset(

        data.nextOffset ??

        offset +

        incoming.length

      );



      setHasMore(

        Boolean(

          data.hasMore

        )

      );

    } catch (error) {

      if (

        requestId !==

        catalogueRequestRef.current

      ) {

        return;

      }



      setMessage(

        error instanceof Error

          ? error.message

          : "ไม่สามารถโหลดสินค้าได้"

      );

    } finally {

      if (

        requestId ===

        catalogueRequestRef.current

      ) {

        setLoadingProducts(false);

        setLoadingMore(false);

      }

    }

  }



  useEffect(() => {

    if (

      !catalogueReady ||

      tab !== "all"

    ) {

      return;

    }



    if (

      debouncedSearch ===

        loadedSearch

    ) {

      return;

    }



    setSelectedCategory(

      ""

    );



    void loadAllProducts(

      debouncedSearch,

      0,

      false,

      ""

    );

  }, [

    debouncedSearch,

    tab,

    catalogueReady,

    loadedSearch,

  ]);



  async function selectCategory(

    category: string

  ) {

    if (

      tab !== "all" ||

      !catalogueReady

    ) {

      return;

    }



    if (

      category ===

      selectedCategory

    ) {

      return;

    }



    setSelectedCategory(

      category

    );



    await loadAllProducts(

      debouncedSearch,

      0,

      false,

      category

    );

  }



  // =====================================================

  // FAVOURITES

  // =====================================================



  async function toggleFavourite(

    product: Product

  ) {

    if (

      !customer ||

      !idToken ||

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



    const highestOrder =

      favouriteProductIds.reduce(

        (highest, id) => {

          const item =

            products.find(

              (candidate) =>

                candidate.id ===

                id

            );



          return Math.max(

            highest,

            Number(

              item?.favouriteOrder ??

              0

            )

          );

        },

        0

      );



    const optimisticOrder =

      nextFavourite

        ? highestOrder +

          1

        : null;



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



    setFavouriteProductIds(

      (current) =>

        nextFavourite

          ? uniqueIds([

              ...current,

              product.id,

            ])

          : current.filter(

              (id) =>

                id !==

                product.id

            )

    );



    setSavingFavouriteIds(

      (current) => {

        const next =

          new Set(current);



        next.add(

          product.id

        );



        return next;

      }

    );



    setMessage("");



    try {

      const response =

        await fetch(

          "/api/line/favourites",

          {

            method: "POST",

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



      if (!response.ok) {

        throw new Error(

          result.error ??

          "ไม่สามารถอัปเดตรายการโปรดได้"

        );

      }



      const confirmedFavourite =

        Boolean(

          result.isFavourite

        );



      setProducts(

        (current) =>

          current.map(

            (item) =>

              item.id ===

              product.id

                ? {

                    ...item,

                    isFavourite:

                      confirmedFavourite,

                    favouriteOrder:

                      result.favouriteOrder ??

                      null,

                  }

                : item

          )

      );



      setFavouriteProductIds(

        (current) =>

          confirmedFavourite

            ? uniqueIds([

                ...current,

                product.id,

              ])

            : current.filter(

                (id) =>

                  id !==

                  product.id

              )

      );

    } catch (error) {

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



      setFavouriteProductIds(

        (current) =>

          previousFavourite

            ? uniqueIds([

                ...current,

                product.id,

              ])

            : current.filter(

                (id) =>

                  id !==

                  product.id

              )

      );



      setMessage(

        error instanceof Error

          ? error.message

          : "ไม่สามารถอัปเดตรายการโปรดได้"

      );

    } finally {

      setSavingFavouriteIds(

        (current) => {

          const next =

            new Set(current);



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

    setCart(newCart);



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

    setQuantityInputs(

      (current) => ({

        ...current,

        [productId]:

          rawValue,

      })

    );



    if (rawValue === "") {

      return;

    }



    const quantity =

      Number(rawValue);



    if (

      Number.isNaN(quantity) ||

      quantity <= 0

    ) {

      return;

    }



    saveCart({

      ...cart,

      [productId]:

        roundQuantity(

          quantity

        ),

    });

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



    if (trimmed === "") {

      delete newCart[

        productId

      ];

    } else {

      const quantity =

        Number(trimmed);



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



    if (next <= 0) {

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

  // DISPLAY DATA

  // =====================================================



  const productById =

    useMemo(() => {

      const map =

        new Map<string, Product>();



      products.forEach(

        (product) =>

          map.set(

            product.id,

            product

          )

      );



      return map;

    }, [products]);



  const displayedProducts =

    useMemo(() => {

      if (tab === "all") {

        return allProductIds

          .map(

            (id) =>

              productById.get(id)

          )

          .filter(

            (

              product

            ): product is Product =>

              Boolean(product)

          );

      }



      const query =

        search

          .trim()

          .toLowerCase();



      return favouriteProductIds

        .map(

          (id) =>

            productById.get(id)

        )

        .filter(

          (

            product

          ): product is Product =>

            Boolean(product)

        )

        .filter(

          (product) => {

            if (!query) {

              return true;

            }



            return (

              product.productName

                .toLowerCase()

                .includes(query) ||

              product.sku

                .toLowerCase()

                .includes(query)

            );

          }

        );

    }, [

      tab,

      allProductIds,

      favouriteProductIds,

      productById,

      search,

    ]);



  const cartProducts =

    useMemo(

      () =>

        Object.entries(cart)

          .map(

            ([productId, quantity]) => {

              const product =

                productById.get(

                  productId

                );



              if (

                !product ||

                Number(quantity) <= 0

              ) {

                return null;

              }



              return {

                ...product,

                quantity:

                  Number(quantity),

              };

            }

          )

          .filter(

            (

              product

            ): product is Product & {

              quantity: number;

            } =>

              Boolean(product)

          ),

      [

        cart,

        productById,

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

  // LOADING / ERROR

  // =====================================================



  if (loading) {

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



  if (!customer) {

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

              {message}

            </p>

          </div>

        </div>

      </main>

    );

  }



  return (

    <main className="min-h-screen bg-gray-50 pb-28">

      {/* HEADER */}

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



            {cartItemCount > 0 && (

              <button

                type="button"

                onClick={() =>

                  setShowCart(true)

                }

                className="relative border rounded-full w-10 h-10 flex items-center justify-center bg-white"

                aria-label="เปิดตะกร้า"

              >

                🛒

                <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-black text-white text-[11px] flex items-center justify-center">

                  {cartItemCount}

                </span>

              </button>

            )}

          </div>



          <div className="mt-3">

            <h1 className="text-2xl font-bold">

              สั่งสินค้า

            </h1>

            <p className="text-sm text-gray-500 mt-1">

              {customer.customerName}

            </p>

          </div>



          {/* SEARCH */}

          <div className="relative mt-4">

            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">

              🔍

            </span>

            <input

              value={search}

              onChange={(event) =>

                setSearch(

                  event.target.value

                )

              }

              placeholder="ค้นหาชื่อสินค้า หรือ SKU"

              className="w-full bg-gray-100 rounded-xl pl-11 pr-10 py-3 outline-none focus:ring-2 focus:ring-gray-300"

            />



            {search && (

              <button

                type="button"

                onClick={() => {

                  setSearch("");

                  setSelectedCategory("");

                }}

                aria-label="ล้างการค้นหา"

                className="absolute right-3 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-gray-200 text-gray-500"

              >

                ×

              </button>

            )}

          </div>



          {tab === "all" &&

            debouncedSearch &&

            (categoryFacets.length >

              0 ||

              searchTotal >

                0) && (

            <div className="mt-3">

              <p className="text-xs text-gray-500 mb-2">

                กรองตามหมวดหมู่

              </p>

              <div className="flex gap-2 overflow-x-auto pb-1">

                <button

                  type="button"

                  onClick={() =>

                    void selectCategory(

                      ""

                    )

                  }

                  className={

                    selectedCategory ===

                    ""

                      ? "shrink-0 bg-black text-white rounded-full px-3 py-2 text-xs font-semibold"

                      : "shrink-0 bg-gray-100 text-gray-700 rounded-full px-3 py-2 text-xs font-semibold"

                  }

                >

                  ทั้งหมด{" "}

                  {searchTotal.toLocaleString()}

                </button>



                {categoryFacets.map(

                  (

                    facet

                  ) => (

                    <button

                      type="button"

                      key={

                        facet.category

                      }

                      onClick={() =>

                        void selectCategory(

                          facet.category

                        )

                      }

                      className={

                        selectedCategory ===

                        facet.category

                          ? "shrink-0 bg-black text-white rounded-full px-3 py-2 text-xs font-semibold"

                          : "shrink-0 bg-gray-100 text-gray-700 rounded-full px-3 py-2 text-xs font-semibold"

                      }

                    >

                      {

                        categoryLabel(
                          facet.category
                        )

                      }{" "}

                      {

                        facet.count.toLocaleString()

                      }

                    </button>

                  )

                )}

              </div>

            </div>

          )}
        </div>
      </header>



      {/* CONTENT */}

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

                setTab("all")

              }

              className={

                tab === "all"

                  ? "bg-white rounded-lg px-3 py-2.5 font-semibold shadow-sm"

                  : "px-3 py-2.5 font-semibold text-gray-500"

              }

            >

              สินค้าทั้งหมด

            </button>

          </div>

        </div>



        {/* MESSAGE */}

        {message && (

          <div className="mx-4 mt-4 bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm">

            {message}

          </div>

        )}



        {/* HELP + RESULT COUNT */}

        <div className="px-4 pt-4 flex items-end justify-between gap-3">

          <p className="text-xs text-gray-500">

            {tab === "favourites"

              ? "สินค้าที่คุณซื้อประจำ กด ★ เพื่อเอาออกจากรายการ"

              : search.trim()

              ? selectedCategory

                ? `ผลการค้นหา “${debouncedSearch}” · ${categoryLabel(selectedCategory)}`

                : `ผลการค้นหา “${debouncedSearch}”`

              : "สินค้าขายดีจะแสดงก่อน และโหลดเพิ่มทีละ 30 รายการ"}

          </p>



          {tab === "all" && (

            <p className="text-xs text-gray-400 whitespace-nowrap">

              {totalProducts.toLocaleString()} รายการ

            </p>

          )}

        </div>



        {/* SEARCH LOADING */}

        {tab === "all" &&

          loadingProducts && (

          <div className="mx-4 mt-4 bg-white border rounded-xl p-4 text-sm text-gray-500 flex items-center gap-3">

            <div className="w-5 h-5 rounded-full border-2 border-gray-200 border-t-black animate-spin" />

            กำลังค้นหาสินค้า...

          </div>

        )}



        {/* PRODUCTS */}

        <div className="p-4">

          {!loadingProducts &&

          displayedProducts.length === 0 ? (

            <div className="bg-white border rounded-2xl p-8 text-center">

              <p className="font-semibold">

                {tab === "favourites"

                  ? "ยังไม่มีสินค้าซื้อประจำ"

                  : "ไม่พบสินค้า"}

              </p>



              <p className="text-sm text-gray-500 mt-2">

                {tab === "favourites"

                  ? "เลือกสินค้าจากหน้าสินค้าทั้งหมดแล้วกด ☆ เพื่อเพิ่มรายการโปรด"

                  : "ลองค้นหาด้วยชื่อสินค้า หรือ SKU อื่น"}

              </p>



              {tab === "favourites" && (

                <button

                  type="button"

                  onClick={() =>

                    setTab("all")

                  }

                  className="mt-5 bg-black text-white rounded-xl px-5 py-3 font-semibold"

                >

                  ดูสินค้าทั้งหมด

                </button>

              )}

            </div>

          ) : (

            <>

              <div className="grid grid-cols-2 gap-3">

                {displayedProducts.map(

                  (product) => {

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

                          {/* FALLBACK IMAGE AREA */}

                          <div className="absolute inset-0 flex items-center justify-center">

                            {isLiquorTobaccoCategory(

                              product.category

                            ) ? (

                              <div className="w-full h-full flex flex-col items-center justify-center text-center px-5">

                                <div className="w-12 h-12 rounded-full border-2 border-gray-300 flex items-center justify-center text-xl font-bold text-gray-500">

                                  i

                                </div>

                                <p className="text-sm font-bold text-gray-700 mt-3">

                                  สุราและยาสูบ

                                </p>

                                <p className="text-xs text-gray-500 mt-1">

                                  ภาพสินค้าไม่แสดงสำหรับหมวดนี้

                                </p>

                                <p className="text-[11px] leading-4 text-gray-400 mt-2">

                                  โปรดตรวจสอบชื่อสินค้าและขนาดก่อนสั่งซื้อ

                                </p>

                              </div>

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

                          </div>



                          {/* PRODUCT IMAGE, WHEN AVAILABLE */}

                          {product.imageUrl &&
                            !isLiquorTobaccoCategory(
                              product.category
                            ) && (

                            <img

                              src={

                                product.imageUrl

                              }

                              alt={

                                product.productName

                              }

                              className="absolute inset-0 w-full h-full object-contain p-2 bg-white"

                              loading="lazy"

                              decoding="async"

                              onError={(event) => {

                                event.currentTarget.style.display =

                                  "none";

                              }}

                            />

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



                          {product.hasSpecialPrice && (

                            <span className="absolute left-2 top-2 bg-black text-white rounded-full px-2.5 py-1 text-[10px] font-semibold">

                              ราคาพิเศษ

                            </span>

                          )}

                        </div>



                        {/* INFO */}

                        <div className="p-3 flex flex-col flex-1">

                          <p className="font-semibold text-sm leading-5 line-clamp-2 min-h-10">

                            {product.productName}

                          </p>



                          <p className="text-[11px] text-gray-400 mt-1 truncate">

                            SKU {product.sku}

                          </p>



                          <div className="mt-3">

                            <div className="flex items-end gap-1 flex-wrap">

                              <span className="font-bold text-lg leading-none">

                                ฿{formatPrice(

                                  product.effectivePrice

                                )}

                              </span>

                              <span className="text-xs text-gray-500">

                                / {product.unit}

                              </span>

                            </div>



                            {product.hasSpecialPrice && (

                              <p className="text-xs text-gray-400 line-through mt-1">

                                ปกติ ฿{formatPrice(

                                  product.normalPrice

                                )}

                              </p>

                            )}

                          </div>



                          {/* QUANTITY */}

                          <div className="mt-auto pt-4">

                            {quantity > 0 ? (

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

                                  step={step}

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

                                      event.target.value

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



              {/* SERVER-SIDE PAGINATION */}

              {tab === "all" &&

                displayedProducts.length > 0 && (

                <div className="mt-6">

                  <p className="text-center text-xs text-gray-400 mb-3">

                    แสดง {displayedProducts.length.toLocaleString()} จาก {totalProducts.toLocaleString()} รายการ

                  </p>



                  {hasMore ? (

                    <button

                      type="button"

                      disabled={

                        loadingMore ||

                        loadingProducts

                      }

                      onClick={() =>

                        loadAllProducts(

                          loadedSearch,

                          nextOffset,

                          true,

                          loadedCategory

                        )

                      }

                      className="w-full bg-white border rounded-xl px-5 py-4 font-semibold disabled:opacity-50"

                    >

                      {loadingMore

                        ? "กำลังโหลด..."

                        : "โหลดสินค้าเพิ่ม 30 รายการ"}

                    </button>

                  ) : (

                    <p className="text-center text-sm text-gray-400 py-2">

                      แสดงสินค้าครบแล้ว

                    </p>

                  )}

                </div>

              )}

            </>

          )}

        </div>

      </div>



      {/* CART BAR */}

      {cartItemCount > 0 && (

        <div className="fixed bottom-0 left-0 right-0 bg-white border-t p-3 z-40">

          <div className="max-w-2xl mx-auto">

            <button

              type="button"

              onClick={() =>

                setShowCart(true)

              }

              className="w-full bg-black text-white rounded-2xl px-5 py-4 flex justify-between items-center"

            >

              <div className="text-left">

                <p className="font-semibold">

                  ดูตะกร้า {cartItemCount} รายการ

                </p>

                <p className="text-xs text-white/60 mt-0.5">

                  แตะเพื่อตรวจสอบรายการ

                </p>

              </div>



              <span className="font-bold text-lg">

                ~฿{formatPrice(

                  estimatedTotal

                )}

              </span>

            </button>

          </div>

        </div>

      )}



      {/* CART MODAL */}

      {showCart && (

        <div className="fixed inset-0 bg-black/40 z-50 flex items-end">

          <button

            type="button"

            aria-label="ปิดตะกร้า"

            className="absolute inset-0 w-full h-full"

            onClick={() =>

              setShowCart(false)

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

                    {customer.customerName}

                  </p>

                </div>



                <button

                  type="button"

                  onClick={() =>

                    setShowCart(false)

                  }

                  className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center text-xl"

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

                      <div className="flex gap-3">

                        <div className="relative w-16 h-16 rounded-xl bg-gray-50 overflow-hidden shrink-0">

                          <div className="absolute inset-0 flex items-center justify-center">

                            {isLiquorTobaccoCategory(

                              product.category

                            ) ? (

                              <div className="text-center px-1">

                                <div className="mx-auto w-7 h-7 rounded-full border border-gray-300 flex items-center justify-center text-xs font-bold text-gray-500">

                                  i

                                </div>

                                <p className="text-[9px] leading-3 font-semibold text-gray-500 mt-1">

                                  สุราและยาสูบ

                                </p>

                              </div>

                            ) : (

                              <span>

                                📦

                              </span>

                            )}

                          </div>



                          {product.imageUrl &&
                            !isLiquorTobaccoCategory(
                              product.category
                            ) && (

                            <img

                              src={

                                product.imageUrl

                              }

                              alt={

                                product.productName

                              }

                              className="absolute inset-0 w-full h-full object-contain p-1 bg-white"

                              loading="lazy"

                              decoding="async"

                              onError={(event) => {

                                event.currentTarget.style.display =

                                  "none";

                              }}

                            />

                          )}

                        </div>



                        <div className="min-w-0 flex-1">

                          <p className="font-semibold text-sm">

                            {product.productName}

                          </p>

                          <p className="text-sm text-gray-500 mt-1">

                            {formatQuantity(

                              product.quantity

                            )} {product.unit} × ฿{formatPrice(

                              product.effectivePrice

                            )}

                          </p>

                        </div>



                        <p className="font-bold whitespace-nowrap">

                          ฿{formatPrice(

                            product.quantity *

                            product.effectivePrice

                          )}

                        </p>

                      </div>

                    </div>

                  )

                )}

              </div>



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

                  ฿{formatPrice(

                    estimatedTotal

                  )}

                </span>

              </div>



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



              <button

                type="button"

                onClick={() => {

                  const confirmed =

                    window.confirm(

                      "ต้องการล้างสินค้าทั้งหมดในตะกร้าหรือไม่?"

                    );



                  if (!confirmed) {

                    return;

                  }



                  saveCart({});

                  setQuantityInputs({});

                  setShowCart(false);

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
