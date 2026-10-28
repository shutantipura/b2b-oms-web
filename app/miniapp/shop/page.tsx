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

import LotusLoading from "../../../components/LotusLoading";
import LotusBrand from "@/components/LotusBrand";
import { lineApiFetch } from "../../../lib/lineSession";



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

function isWeightedUnit(unit: string) { return /kg|กก|กิโล/i.test(unit); }

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
  const [pieceProductIds, setPieceProductIds] = useState<string[]>([]);



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

    >("all");



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

          await lineApiFetch(

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



        setCart(cleanedCart);
        try {
          const saved = JSON.parse(localStorage.getItem(
            `b2b-cart-pieces-${data.customer.customerCode}`) ?? "[]");
          setPieceProductIds(Array.isArray(saved)
            ? saved.filter((id: unknown) => typeof id === "string" &&
                validCartIds.has(id) && Number(cleanedCart[id]) > 0)
            : []);
        } catch { setPieceProductIds([]); }



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

        await lineApiFetch(

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

        await lineApiFetch(

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



  function selectOrderUnit(product: Product, pieces: boolean) {
    if (!isWeightedUnit(product.unit) || !customer) return;
    const next = pieces
      ? Array.from(new Set([...pieceProductIds, product.id]))
      : pieceProductIds.filter((id) => id !== product.id);
    setPieceProductIds(next);
    localStorage.setItem(`b2b-cart-pieces-${customer.customerCode}`, JSON.stringify(next));
    if (pieces && Number(cart[product.id]) > 0 && !Number.isInteger(cart[product.id])) {
      saveCart({ ...cart, [product.id]: 1 });
    }
    setQuantityInputs((current) => {
      const result = { ...current };
      delete result[product.id];
      return result;
    });
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
      ...cart, [productId]: pieceProductIds.includes(productId)
        ? Math.max(1, Math.round(quantity)) : roundQuantity(quantity),
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

          newCart[productId] = pieceProductIds.includes(productId)
            ? Math.max(1, Math.round(quantity)) : roundQuantity(quantity);

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

    // Buttons add or remove one whole selling unit (including kg).
    // The number input still uses getQuantityStep, so customers can type 0.1 kg, 1.25 kg, etc.
    const step = 1;



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



  const hasPieceOrders = cartProducts.some(p => pieceProductIds.includes(p.id));
  const estimatedTotal =

    cartProducts.reduce(

      (

        total,

        product

      ) =>

        total +

        (pieceProductIds.includes(product.id) ? 0 : product.quantity * product.effectivePrice),

      0

    );



  // =====================================================

  // LOADING / ERROR

  // =====================================================



  if (loading) {

    return <LotusLoading message="กำลังโหลดสินค้า..." />;

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
    <main className="min-h-screen bg-[#EFF6F5] pb-32 text-[#15372E]">
      {/* CUSTOMER NAVIGATION */}
      <header className="sticky top-0 z-30 border-b border-[#E6EEE9] bg-white/95 backdrop-blur-md">
        <div className="mx-auto max-w-6xl px-4 py-3 sm:px-6">
          <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2">
            <button
              type="button"
              onClick={goCustomerHome}
              className="inline-flex min-h-11 shrink-0 items-center gap-1 whitespace-nowrap rounded-xl px-1.5 text-[13px] font-semibold text-[#426559] hover:bg-[#EDF7F1] sm:gap-2 sm:px-2 sm:text-sm"
              aria-label="กลับหน้าหลัก"
            >
              <span className="text-xl leading-none">‹</span>
              <span>หน้าแรก</span>
            </button>
            <div className="miniapp-nav-brand min-w-0 text-center">
              <LotusBrand size="sm" align="center" />
            </div>
            <button
              type="button"
              onClick={() => setShowCart(true)}
              className="relative grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-[#DFE9E3] bg-[#F6FBF8] text-xl"
              aria-label="เปิดตะกร้าสินค้า"
            >
              🛒
              {cartItemCount > 0 && (
                <span className="absolute -right-1 -top-1 grid min-h-5 min-w-5 place-items-center rounded-full bg-[#FDBC16] px-1 text-[11px] font-extrabold text-[#173A30]">
                  {cartItemCount}
                </span>
              )}
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-3 pt-3 sm:px-6">
        {/* Compact customer search: brand yellow is an accent, not a fill. */}
        <section className="mb-4 rounded-[22px] border border-[#D8E7E2] bg-white px-4 py-4 shadow-[0_4px_16px_rgba(6,71,67,0.08)] sm:px-5">
          <h2 className="mb-3 flex items-center gap-2.5 text-lg font-extrabold text-[#173E31]">
            <span aria-hidden="true" className="h-5 w-1.5 rounded-full bg-[#FDBC16]" />
            สั่งสินค้า
          </h2>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-xl bg-[#FFF1C1] text-[#987100]">
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="h-5 w-5">
                <circle cx="10.5" cy="10.5" r="6.5" />
                <path d="m16 16 5 5" />
              </svg>
            </span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="ค้นหาชื่อสินค้าหรือรหัส SKU"
              aria-label="ค้นหาสินค้า"
              className="min-h-13 w-full rounded-xl border border-[#CADFD8] bg-[#F5F9F7] py-3.5 pl-14 pr-12 text-sm font-medium text-[#173E31] placeholder:text-[#799489] outline-none transition focus:border-[#FDBC16] focus:bg-white focus:ring-2 focus:ring-[#FDBC16]/30 sm:text-base [&::-webkit-search-cancel-button]:hidden"
            />
            {search && (
              <button
                type="button"
                onClick={() => { setSearch(""); setSelectedCategory(""); }}
                aria-label="ล้างการค้นหา"
                className="absolute right-2 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full text-xl text-[#587A70] hover:bg-[#E4EFEB]"
              >×</button>
            )}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-1 rounded-xl bg-[#EEF5F2] p-1">
            <button
              type="button"
              onClick={() => setTab("all")}
              className={`min-h-10 rounded-lg px-3 py-2 text-sm font-bold transition ${tab === "all" ? "bg-[#02B0AF] text-white shadow-[0_2px_8px_rgba(0,126,121,0.20)]" : "text-[#537569] hover:bg-white/80"}`}
            >สินค้าทั้งหมด</button>
            <button
              type="button"
              onClick={() => setTab("favourites")}
              className={`min-h-10 rounded-lg px-3 py-2 text-sm font-bold transition ${tab === "favourites" ? "bg-[#02B0AF] text-white shadow-[0_2px_8px_rgba(0,126,121,0.20)]" : "text-[#537569] hover:bg-white/80"}`}
            >★ ซื้อประจำ <span className="text-xs opacity-75">({favouriteProductIds.length})</span></button>
          </div>

          {tab === "all" && debouncedSearch && (categoryFacets.length > 0 || searchTotal > 0) && (
            <div className="mt-4 border-t border-[#EDF1EE] pt-4">
              <p className="mb-2 text-xs font-bold text-[#4E7663]">กรองหมวดหมู่</p>
              <div className="flex gap-2 overflow-x-auto pb-1">
                <button
                  type="button"
                  onClick={() => void selectCategory("")}
                  className={`shrink-0 rounded-full border px-4 py-2 text-xs font-bold ${selectedCategory === "" ? "border-[#02B0AF] bg-[#02B0AF] text-white" : "border-[#DDE9E2] bg-white text-[#456957]"}`}
                >ทั้งหมด ({searchTotal.toLocaleString()})</button>
                {categoryFacets.map((facet) => (
                  <button
                    key={facet.category}
                    type="button"
                    onClick={() => void selectCategory(facet.category)}
                    className={`shrink-0 rounded-full border px-4 py-2 text-xs font-bold ${selectedCategory === facet.category ? "border-[#02B0AF] bg-[#02B0AF] text-white" : "border-[#DDE9E2] bg-white text-[#456957]"}`}
                  >{categoryLabel(facet.category)} ({facet.count.toLocaleString()})</button>
                ))}
              </div>
            </div>
          )}
        </section>

        {message && (
          <div role="alert" className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{message}</div>
        )}

        {/* Only show a result heading when it adds useful context. */}
        {(tab === "favourites" || search.trim() || selectedCategory) && (
          <div className="mb-3 px-1">
            <h3 className="text-base font-extrabold text-[#173E31]">
              {tab === "favourites" ? "สินค้าซื้อประจำของคุณ" : search.trim() ? "ผลการค้นหา" : categoryLabel(selectedCategory)}
            </h3>
            <p className="mt-1 text-xs text-[#597C70]">
              {tab === "favourites" ? "แตะดาวเพื่อเพิ่มหรือนำสินค้าออกจากรายการโปรด" : selectedCategory ? categoryLabel(selectedCategory) : `คำค้นหา: ${debouncedSearch}`}
            </p>
          </div>
        )}
        {tab === "all" && loadingProducts && (
          <div className="mb-4 flex items-center gap-3 rounded-2xl border border-[#D5E7DB] bg-white p-4 text-sm font-medium text-[#688572]">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#CFE8D9] border-t-[#02B0AF]" />
            กำลังค้นหาสินค้า...
          </div>
        )}

        {/* PRODUCT GRID */}
        {!loadingProducts && displayedProducts.length === 0 ? (
          <div className="rounded-[24px] border border-[#E3EDE6] bg-white px-6 py-14 text-center">
            <div className="mx-auto mb-3 grid h-16 w-16 place-items-center rounded-2xl bg-[#EAF7EF] text-3xl">{tab === "favourites" ? "☆" : "🔎"}</div>
            <p className="text-lg font-extrabold">{tab === "favourites" ? "ยังไม่มีสินค้าซื้อประจำ" : "ไม่พบสินค้า"}</p>
            <p className="mt-2 text-sm text-[#809288]">{tab === "favourites" ? "เลือกสินค้าจากหน้าสินค้าทั้งหมดแล้วแตะดาว" : "ลองค้นหาด้วยชื่อสินค้าหรือรหัส SKU อื่น"}</p>
            {tab === "favourites" && (
              <button type="button" onClick={() => setTab("all")} className="mt-5 rounded-xl bg-[#02B0AF] px-5 py-3 text-sm font-bold text-white">ดูสินค้าทั้งหมด</button>
            )}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 md:grid-cols-4 lg:gap-4">
              {displayedProducts.map((product) => {
                const step = getQuantityStep(product.unit);
                const quantity = Number(cart[product.id] ?? 0);
                const weighted = isWeightedUnit(product.unit);
                const isPiece = pieceProductIds.includes(product.id);
                const favouriteBusy = savingFavouriteIds.has(product.id);
                const hideImage = isLiquorTobaccoCategory(product.category);
                return (
                  <article key={product.id} className="group flex min-w-0 flex-col overflow-hidden rounded-2xl border border-[#B7D7D0] bg-white shadow-[0_5px_16px_rgba(6,71,67,0.14)] transition hover:border-[#02B0AF] hover:shadow-[0_7px_19px_rgba(6,71,67,0.19)]">
                    <div className="relative aspect-[1.42] overflow-hidden border-b border-[#D5E8E3] bg-[#F7FBFA] sm:aspect-square">
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-3 text-center text-[#A4B8A9]">
                        <span className="text-4xl">{hideImage ? "ⓘ" : "📦"}</span>
                        <span className="text-[11px]">{hideImage ? "หมวดสุราและยาสูบ" : "ไม่มีรูปสินค้า"}</span>
                      </div>
                      {product.imageUrl && !hideImage && (
                        <img src={product.imageUrl} alt={product.productName} loading="lazy" decoding="async" className="absolute inset-0 h-full w-full bg-white object-contain p-3 transition duration-300 group-hover:scale-[1.03]" onError={(event) => { event.currentTarget.style.display = "none"; }} />
                      )}
                      {(product.hasSpecialPrice && product.effectivePrice < product.normalPrice) && <span className="absolute left-2 top-2 rounded-lg bg-[#FFF3CF] px-2 py-1 text-[10px] font-extrabold text-[#9D6500]">ราคาพิเศษ</span>}
                      <button
                        type="button"
                        disabled={favouriteBusy}
                        onClick={() => void toggleFavourite(product)}
                        aria-label={product.isFavourite ? `นำ ${product.productName} ออกจากรายการโปรด` : `เพิ่ม ${product.productName} ในรายการโปรด`}
                        className={`absolute right-2 top-2 grid h-9 w-9 place-items-center rounded-full border text-xl shadow-sm disabled:opacity-50 ${product.isFavourite ? "border-[#FFDE8A] bg-[#FFF5D8] text-[#E5A400]" : "border-[#EBEDE8] bg-white/95 text-[#91A69A]"}`}
                      >{favouriteBusy ? "…" : product.isFavourite ? "★" : "☆"}</button>
                    </div>
                    <div className="flex flex-1 flex-col p-2.5 sm:p-3">
                      <p className="mb-1 min-h-10 line-clamp-2 text-[13px] font-bold leading-5 text-[#1D4034] sm:text-sm">{product.productName}</p>
                      <p className="truncate text-[10px] text-[#95A69A]">SKU {product.sku}</p>
                      <div className="mt-2">
                        <p className="text-[18px] font-extrabold leading-tight sm:text-xl"><span className={(product.hasSpecialPrice && product.effectivePrice < product.normalPrice) ? "text-[#DC2626]" : "text-[#009F9D]"}>฿{formatPrice(product.effectivePrice)}</span> <span className="text-[11px] font-semibold text-[#708878]">/ {product.unit}</span></p>
                        {(product.hasSpecialPrice && product.effectivePrice < product.normalPrice) && <p className="mt-1 text-[11px] text-[#9AACA0] line-through">ปกติ ฿{formatPrice(product.normalPrice)}</p>}
                      </div>
                      <div className="mt-auto pt-2.5">
                        {weighted && (
                          <div className="mb-2 flex overflow-hidden rounded-lg border border-[#BCE9E5] bg-[#F4FBF9]">
                            <button type="button" onClick={() => selectOrderUnit(product, false)}
                              className={`min-h-8 flex-1 text-[11px] font-bold ${!isPiece ? "bg-[#02B0AF] text-white" : "text-[#507C70]"}`}>กก.</button>
                            <button type="button" onClick={() => selectOrderUnit(product, true)}
                              className={`min-h-8 flex-1 text-[11px] font-bold ${isPiece ? "bg-[#02B0AF] text-white" : "text-[#507C70]"}`}>ชิ้น</button>
                          </div>
                        )}
                        {isPiece && <p className="mb-2 text-[10px] leading-4 text-[#846419]">ชั่งน้ำหนักจริงก่อนคิดราคา</p>}
                        {quantity > 0 ? (
                          <div className="flex h-10 items-center overflow-hidden rounded-xl border border-[#BCE9E5]">
                            <button type="button" onClick={() => changeQuantity(product, -1)} className="grid h-full w-9 shrink-0 place-items-center bg-[#EFF7F1] text-lg font-bold text-[#009F9D]" aria-label={`ลดจำนวน ${product.productName}`}>−</button>
                            <input
                              type="number" min={isPiece ? "1" : "0"} step={isPiece ? "1" : step < 1 ? "any" : step} inputMode={isPiece ? "numeric" : "decimal"} aria-label={`จำนวน ${product.productName}`}
                              value={quantityInputs[product.id] ?? String(quantity)}
                              onFocus={() => setQuantityInputs((current) => ({ ...current, [product.id]: String(quantity) }))}
                              onChange={(event) => updateQuantity(product.id, event.target.value)}
                              onBlur={() => finishQuantityEdit(product.id)}
                              onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
                              className="h-full w-full min-w-0 flex-1 bg-white text-center text-xs font-extrabold text-[#214937] outline-none"
                            />
                            <button type="button" onClick={() => changeQuantity(product, 1)} className="grid h-full w-9 shrink-0 place-items-center bg-[#02B0AF] text-lg font-bold text-white" aria-label={`เพิ่มจำนวน ${product.productName}`}>+</button>
                          </div>
                        ) : (
                          <button type="button" onClick={() => changeQuantity(product, 1)} className="min-h-10 w-full rounded-xl bg-[#02B0AF] px-2 py-2 text-sm font-bold text-white transition hover:bg-[#008F8B]">+ เพิ่มลงตะกร้า</button>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
            {tab === "all" && displayedProducts.length > 0 && (
              <div className="mx-auto mt-7 max-w-md text-center">
                <p className="mb-3 text-xs text-[#84998C]">แสดง {displayedProducts.length.toLocaleString()} จาก {totalProducts.toLocaleString()} รายการ</p>
                {hasMore ? (
                  <button
                    type="button"
                    disabled={loadingMore || loadingProducts}
                    onClick={() => void loadAllProducts(loadedSearch, nextOffset, true, loadedCategory)}
                    className="min-h-12 w-full rounded-2xl border border-[#BFDCCB] bg-white px-5 py-3 font-bold text-[#009F9D] shadow-sm disabled:opacity-50"
                  >{loadingMore ? "กำลังโหลดสินค้า..." : `โหลดสินค้าเพิ่มอีก ${PAGE_SIZE} รายการ`}</button>
                ) : (
                  <p className="rounded-xl bg-[#E7F4EB] py-3 text-sm font-medium text-[#6A8F75]">แสดงสินค้าครบแล้ว</p>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* STICKY BASKET */}
      {cartItemCount > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-[#D7E9DD] bg-white/95 p-3 shadow-[0_-8px_30px_rgba(15,64,39,0.08)] backdrop-blur-lg">
          <div className="mx-auto max-w-6xl">
            <button type="button" onClick={() => setShowCart(true)} className="miniapp-bottom-cta flex min-h-16 w-full items-center justify-between gap-2 rounded-2xl bg-[#02B0AF] px-3 py-3 text-left text-white shadow-lg shadow-[#007E61]/15 sm:gap-3 sm:px-6">
              <span className="flex min-w-0 items-center gap-2 sm:gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/15 text-lg sm:h-11 sm:w-11 sm:text-xl">🛒</span>
                <span>
                  <span className="block whitespace-nowrap text-[13px] font-extrabold leading-5 sm:text-sm">ดูตะกร้า <span className="ml-1 rounded-full bg-[#FDBC16] px-2 py-0.5 text-[11px] text-[#294631]">{cartItemCount}</span></span>
                  <span className="mt-0.5 hidden text-[11px] leading-4 text-white/75 min-[390px]:block">ตรวจสอบรายการก่อนสั่งซื้อ</span>
                </span>
              </span>
              <span className="miniapp-cta-price text-right">
                <span className="block text-[clamp(15px,4.8vw,19px)] font-extrabold leading-tight">{hasPieceOrders ? "ตั้งแต่ " : "~"}฿{formatPrice(estimatedTotal)}</span>
                <span className="block text-[10px] text-white/75">ยอดประมาณการ ›</span>
              </span>
            </button>
          </div>
        </div>
      )}

      {/* BASKET REVIEW — SAME CART DATA AND CHECKOUT DESTINATION */}
      {showCart && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#082C1E]/55 p-0 sm:items-center sm:p-4" role="presentation">
          <button type="button" aria-label="ปิดตะกร้า" onClick={() => setShowCart(false)} className="absolute inset-0 h-full w-full" />
          <section role="dialog" aria-modal="true" aria-label="ตะกร้าสินค้า" className="relative flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-[28px] bg-white shadow-2xl sm:max-h-[88vh] sm:rounded-[28px]">
            <div className="flex items-center justify-between gap-3 border-b border-[#E8F0E9] px-5 py-4 sm:px-6">
              <div>
                <h2 className="text-xl font-extrabold text-[#174333]">🛒 ตะกร้าสินค้า</h2>
                <p className="mt-1 text-xs text-[#8A9C91]">{customer.customerName} · {cartItemCount} รายการ</p>
              </div>
              <button type="button" onClick={() => setShowCart(false)} className="grid h-10 w-10 place-items-center rounded-full bg-[#EEF4EF] text-2xl text-[#587962]" aria-label="ปิดหน้าตะกร้า">×</button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-2 sm:px-6">
              {cartProducts.length === 0 ? (
                <p className="py-12 text-center text-sm text-[#86998A]">ยังไม่มีสินค้าในตะกร้า</p>
              ) : (
                <div className="divide-y divide-[#EEF2ED]">
                  {cartProducts.map((product) => (
                    <div key={product.id} className="flex items-start gap-3 py-4">
                      <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-[#F4F8F3]">
                        <div className="absolute inset-0 grid place-items-center text-2xl">{isLiquorTobaccoCategory(product.category) ? "ⓘ" : "📦"}</div>
                        {product.imageUrl && !isLiquorTobaccoCategory(product.category) && (
                          <img src={product.imageUrl} alt={product.productName} loading="lazy" className="absolute inset-0 h-full w-full bg-white object-contain p-1" onError={(event) => { event.currentTarget.style.display = "none"; }} />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold leading-5 text-[#274937]">{product.productName}</p>
                        <p className="mt-1 text-xs text-[#8E9D91]"><span className={(product.hasSpecialPrice && product.effectivePrice < product.normalPrice) ? "font-bold text-[#DC2626]" : ""}>฿{formatPrice(product.effectivePrice)}</span> / {product.unit}</p>
                        <p className="mt-1 text-xs font-bold text-[#608073]">สั่ง {formatQuantity(product.quantity)} {pieceProductIds.includes(product.id) ? "ชิ้น" : product.unit}</p>
                        {pieceProductIds.includes(product.id) && <p className="mt-1 text-[11px] text-[#92671B]">คิดราคาเมื่อชั่งน้ำหนักจริง</p>}
                        <div className="mt-3 inline-flex h-9 items-center overflow-hidden rounded-lg border border-[#D3E7D9]">
                          <button type="button" onClick={() => changeQuantity(product, -1)} aria-label={`ลดจำนวน ${product.productName}`} className="h-full w-9 bg-[#EEF7EF] text-lg font-bold text-[#0D8466]">−</button>
                          <span className="min-w-14 px-2 text-center text-xs font-extrabold">{formatQuantity(product.quantity)}</span>
                          <button type="button" onClick={() => changeQuantity(product, 1)} aria-label={`เพิ่มจำนวน ${product.productName}`} className="h-full w-9 bg-[#00886B] text-lg font-bold text-white">+</button>
                        </div>
                      </div>
                      <p className={`shrink-0 text-sm font-extrabold ${(product.hasSpecialPrice && product.effectivePrice < product.normalPrice) ? "text-[#DC2626]" : "text-[#009F9D]"}`}>{pieceProductIds.includes(product.id) ? "รอชั่งจริง" : "฿" + formatPrice(product.quantity * product.effectivePrice)}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="border-t border-[#E4EEE7] bg-[#F9FCFA] px-5 py-4 sm:px-6">
              <div className="mb-4 flex items-end justify-between gap-3">
                <div>
                  <p className="text-xs font-bold text-[#607D6B]">ยอดรวมประมาณการ</p>
                  <p className="mt-1 text-[11px] text-[#92A299]">{hasPieceOrders ? "ยังไม่รวมรายการสั่งเป็นชิ้น (คิดราคาหลังชั่งจริง)" : "ยอดจริงอาจเปลี่ยนหลังหยิบสินค้า"}</p>
                </div>
                <strong className="text-2xl font-black text-[#007E61]">฿{formatPrice(estimatedTotal)}</strong>
              </div>
              <button
                type="button"
                disabled={cartProducts.length === 0}
                onClick={() => router.push(`/miniapp/checkout?customer=${encodeURIComponent(customer.customerCode)}`)}
                className="min-h-13 w-full rounded-xl bg-[#02B0AF] px-5 py-3.5 text-sm font-extrabold text-white disabled:opacity-40"
              >ดำเนินการสั่งซื้อ <span className="ml-1">→</span></button>
              <div className="mt-3 flex justify-center gap-4">
                <button type="button" onClick={() => setShowCart(false)} className="px-3 py-2 text-xs font-bold text-[#58806A]">เลือกซื้อสินค้าต่อ</button>
                {cartProducts.length > 0 && <button type="button" onClick={() => { if (window.confirm("ต้องการล้างสินค้าทั้งหมดในตะกร้าหรือไม่?")) { saveCart({}); setPieceProductIds([]); localStorage.removeItem(`b2b-cart-pieces-${customer.customerCode}`); setQuantityInputs({}); setShowCart(false); } }} className="px-3 py-2 text-xs font-semibold text-[#B65B53]">ล้างตะกร้า</button>}
              </div>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
