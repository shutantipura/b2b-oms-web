"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import Link from "next/link";

import {
  supabase,
} from "../../../lib/supabase";

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
  category: string | null;
  unit: string;
  normal_price: number | string;
  image_url: string | null;
};

type FavouriteRow = {
  product_id: string;
  sort_order: number | null;
};

type CustomerPriceRow = {
  product_id: string;
  agreed_price: number | string;
};

type ProductCostRow = {
  product_id: string;
  cost: number | string;
};

type PriceFeedback = {
  kind: "success" | "error";
  text: string;
};

function bahtAmount(value: number) {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function SpecialPriceEditor({
  product,
  cost,
  savedPrice,
  draft,
  busy,
  feedback,
  onChange,
  onSave,
}: {
  product: Product;
  cost: number | null;
  savedPrice: number | undefined;
  draft: string;
  busy: boolean;
  feedback?: PriceFeedback;
  onChange: (value: string) => void;
  onSave: () => void;
}) {
  const valid = /^\d+(?:\.\d{1,2})?$/.test(draft.trim())
    && Number.isFinite(Number(draft))
    && Number(draft) >= 0;
  const changed = valid && (savedPrice === undefined || Number(draft) !== savedPrice);
  const normalPrice = Number(product.normal_price);
  const normalProfit = cost === null ? null : normalPrice - cost;
  const draftPrice = valid ? Number(draft) : null;
  const proposedProfit = cost !== null && draftPrice !== null ? draftPrice - cost : null;
  const margin = (price: number, profit: number) =>
    price > 0 ? `${(100 * profit / price).toFixed(1)}%` : "—";

  return (
    <div className="min-w-[160px]">
      <p className="mb-1 text-xs text-[#6E837B]">
        {savedPrice === undefined
          ? "ยังไม่มีราคาพิเศษ"
          : <>ราคาที่บันทึก: <strong className="text-[#007F79]">฿{bahtAmount(savedPrice)}</strong></>}
      </p>
      <div className="mb-2 rounded-lg border border-[#E0ECE7] bg-[#F7FBF9] px-2.5 py-2 text-[11px] leading-5">
        {cost === null ? (
          <>
            <p className="text-[#8C7660]">ต้นทุน <strong>N/A</strong> / {product.unit}</p>
            <p className="text-[#8C7660]">ราคาปกติ: กำไรขั้นต้น N/A · %GP N/A</p>
            {draftPrice !== null && (
              <p className="mt-1 font-semibold text-[#8C7660]">ราคาที่ตั้ง: กำไรขั้นต้น N/A · %GP N/A</p>
            )}
          </>
        ) : (
          <>
            <p className="text-[#567569]">ต้นทุน <strong className="text-[#244C3F]">฿{bahtAmount(cost)}</strong> / {product.unit}</p>
            <p className={normalProfit !== null && normalProfit < 0 ? "font-semibold text-red-700" : "text-[#567569]"}>
              ราคาปกติ: กำไรขั้นต้น {normalProfit !== null && normalProfit < 0 ? "−" : ""}฿{bahtAmount(Math.abs(normalProfit ?? 0))} · %GP {margin(normalPrice, normalProfit ?? 0)}
            </p>
            {proposedProfit !== null && draftPrice !== null && (
              <p className={`mt-1 font-extrabold ${proposedProfit < 0 ? "text-red-700" : "text-[#00877C]"}`}>
                ราคาที่ตั้ง: กำไรขั้นต้น {proposedProfit < 0 ? "−" : ""}฿{bahtAmount(Math.abs(proposedProfit))} · %GP {margin(draftPrice, proposedProfit)}
                {proposedProfit < 0 ? " · ต่ำกว่าต้นทุน" : ""}
              </p>
            )}
          </>
        )}
      </div>
      <div className="flex items-center gap-2">

        <div className="relative min-w-0 flex-1">
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm font-bold text-[#647D74]">฿</span>
          <input
            aria-label={`ราคาพิเศษสำหรับ ${product.product_name} ต่อ ${product.unit}`}
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={draft}
            placeholder="ตั้งราคา"
            onChange={(event) => onChange(event.target.value)}
            disabled={busy}
            className="h-11 w-full min-w-0 rounded-xl border border-[#BBD9D2] bg-white pl-7 pr-2 text-sm font-bold text-[#17453F] outline-none focus:border-[#02B0AF] focus:ring-2 focus:ring-[#02B0AF]/15 disabled:opacity-60"
          />
        </div>
        <button
          type="button"
          onClick={onSave}
          disabled={busy || !changed}
          className="h-11 shrink-0 rounded-xl bg-[#02B0AF] px-3 text-xs font-extrabold text-white disabled:cursor-not-allowed disabled:bg-[#E3EBE8] disabled:text-[#8B9D96]"
        >
          {busy ? "กำลังบันทึก" : "ยืนยันราคา"}
        </button>
      </div>
      <p className="mt-1 text-[11px] text-[#7D968B]">บาท/{product.unit} · สูงสุด 2 ตำแหน่งทศนิยม</p>
      {feedback && (
        <p role="status" className={`mt-1 text-xs font-bold ${feedback.kind === "success" ? "text-[#008B79]" : "text-red-600"}`}>
          {feedback.text}
        </p>
      )}
    </div>
  );
}

function ProductThumbnail({
  imageUrl,
  alt,
  category,
}: {
  imageUrl: string | null | undefined;
  alt: string;
  category: string | null;
}) {
  const isRestrictedCategory =
    category?.trim() ===
    "สุราและยาสูบ";

  if (isRestrictedCategory) {
    return (
      <div className="w-16 h-16 rounded-xl border bg-gray-50 shrink-0 flex flex-col items-center justify-center text-center px-1">
        <span className="text-lg">ℹ️</span>
        <span className="text-[9px] leading-tight text-gray-500 mt-1">
          ไม่แสดงรูป
        </span>
      </div>
    );
  }

  return (
    <div className="relative w-16 h-16 rounded-xl bg-gray-100 overflow-hidden shrink-0 border">
      <div className="absolute inset-0 flex items-center justify-center text-xl text-gray-400">
        📦
      </div>

      {imageUrl ? (
        <img
          src={imageUrl}
          alt={alt}
          loading="lazy"
          decoding="async"
          className="absolute inset-0 w-full h-full object-contain bg-white p-1"
          onError={(event) => {
            event.currentTarget.style.display =
              "none";
          }}
        />
      ) : null}
    </div>
  );
}

export default function CustomerFavouritesPage() {
  const [
    customers,
    setCustomers,
  ] =
    useState<Customer[]>([]);

  const [
    products,
    setProducts,
  ] =
    useState<Product[]>([]);

  const [
    selectedCustomer,
    setSelectedCustomer,
  ] =
    useState("");

  const [customerSearch, setCustomerSearch] = useState("");

  const [
    favouriteIds,
    setFavouriteIds,
  ] =
    useState<Set<string>>(
      new Set()
    );

  const [
    search,
    setSearch,
  ] =
    useState("");

  const [
    showAddProduct,
    setShowAddProduct,
  ] =
    useState(false);

  const [
    addSearch,
    setAddSearch,
  ] =
    useState("");

  const [
    addResults,
    setAddResults,
  ] =
    useState<Product[]>(
      []
    );

  const [
    searchingProducts,
    setSearchingProducts,
  ] =
    useState(false);

  const [
    addingProductId,
    setAddingProductId,
  ] =
    useState<
      string | null
    >(null);

  const [
    loading,
    setLoading,
  ] =
    useState(true);

  const [
    loadingFavourites,
    setLoadingFavourites,
  ] =
    useState(false);

  const [
    savingIds,
    setSavingIds,
  ] =
    useState<Set<string>>(
      new Set()
    );

  const [specialPrices, setSpecialPrices] = useState<Record<string, number>>({});
  const [productCosts, setProductCosts] = useState<Record<string, number>>({});
  const [priceDrafts, setPriceDrafts] = useState<Record<string, string>>({});
  const [priceFeedback, setPriceFeedback] = useState<Record<string, PriceFeedback>>({});
  const [savingPriceIds, setSavingPriceIds] = useState<Set<string>>(new Set());
  const [pricesReady, setPricesReady] = useState(false);
  const favouritesLoadRef = useRef(0);
  const activeCustomerRef = useRef("");

  const [
    message,
    setMessage,
  ] =
    useState("");

  // =====================================================
  // LOAD PAGE
  // =====================================================

  async function loadPage() {
    setLoading(true);
    setMessage("");

    const {
      data: { user },
    } =
      await supabase.auth.getUser();

    if (!user) {
      setMessage(
        "กรุณาเข้าสู่ระบบ OMS ก่อน"
      );

      setLoading(false);
      return;
    }

    const {
      data: staff,
      error: staffError,
    } =
      await supabase
        .from("staff")
        .select(
          "account_type"
        )
        .eq(
          "auth_user_id",
          user.id
        )
        .single();

    if (
      staffError ||
      staff?.account_type !==
        "manager"
    ) {
      setMessage(
        "หน้านี้สำหรับ Manager เท่านั้น"
      );

      setLoading(false);
      return;
    }

    const {
      data: customerData,
      error: customerError,
    } =
      await supabase
        .from(
          "customers"
        )
        .select(`
          id,
          customer_code,
          customer_name,
          is_active
        `)
        .order(
          "customer_name",
          {
            ascending:
              true,
          }
        );

    if (
      customerError
    ) {
      setMessage(
        "ไม่สามารถโหลดลูกค้าได้: " +
          customerError.message
      );

      setLoading(false);
      return;
    }

    const loadedCustomers =
      (customerData ??
        []) as Customer[];

    setCustomers(
      loadedCustomers
    );

    if (
      loadedCustomers.length >
      0
    ) {
      const firstActive =
        loadedCustomers.find(
          (
            customer
          ) =>
            customer.is_active
        ) ??
        loadedCustomers[0];

      activeCustomerRef.current = firstActive.id;
      setSelectedCustomer(
        firstActive.id
      );
    }

    setLoading(false);
  }

  useEffect(() => {
    loadPage();
  }, []);

  // =====================================================
  // LOAD FAVOURITES FOR CUSTOMER
  // =====================================================

  async function loadFavourites(
    customerId: string
  ) {
    const requestId = ++favouritesLoadRef.current;
    const isCurrent = () => requestId === favouritesLoadRef.current
      && activeCustomerRef.current === customerId;

    setPricesReady(false);
    setSpecialPrices({});
    setProductCosts({});
    setPriceDrafts({});
    setPriceFeedback({});

    if (!customerId) {
      setFavouriteIds(
        new Set()
      );

      setProducts(
        []
      );

      return;
    }

    setLoadingFavourites(
      true
    );

    setMessage("");

    const {
      data,
      error,
    } =
      await supabase.rpc(
        "get_customer_favourite_ids",
        {
          p_customer_id:
            customerId,
        }
      );

    if (!isCurrent()) return;

    if (error) {
      setMessage(
        "ไม่สามารถโหลดสินค้าซื้อประจำได้: " +
          error.message
      );

      setFavouriteIds(
        new Set()
      );

      setProducts(
        []
      );

      setLoadingFavourites(
        false
      );

      return;
    }

    const rows =
      (data ??
        []) as unknown as FavouriteRow[];

    const productIds =
      rows.map(
        (
          row
        ) =>
          row.product_id
      );

    setFavouriteIds(
      new Set(
        productIds
      )
    );

    if (
      productIds.length === 0
    ) {
      setProducts(
        []
      );

      setLoadingFavourites(
        false
      );

      return;
    }

    const {
      data: productData,
      error: productError,
    } =
      await supabase
        .from(
          "products"
        )
        .select(`
          id,
          sku,
          product_name,
          category,
          unit,
          normal_price,
          image_url
        `)
        .eq(
          "is_active",
          true
        )
        .eq(
          "is_customer_visible",
          true
        )
        .in(
          "id",
          productIds
        );

    if (!isCurrent()) return;

    if (
      productError
    ) {
      setMessage(
        "ไม่สามารถโหลดรายละเอียดสินค้าซื้อประจำได้: " +
          productError.message
      );

      setProducts(
        []
      );

      setLoadingFavourites(
        false
      );

      return;
    }

    const orderMap =
      new Map(
        rows.map(
          (
            row,
            index
          ) => [
            row.product_id,
            row.sort_order ??
              index,
          ]
        )
      );

    const loadedProducts =
      (
        (productData ??
          []) as Product[]
      ).sort(
        (
          a,
          b
        ) =>
          (
            orderMap.get(
              a.id
            ) ??
            999999
          ) -
          (
            orderMap.get(
              b.id
            ) ??
            999999
          )
      );

    // Prices come from the same customer_prices table used by Excel imports
    // and by the customer's live product catalogue.
    const { data: customerPriceData, error: customerPriceError } =
      await supabase
        .from("customer_prices")
        .select("product_id, agreed_price")
        .eq("customer_id", customerId)
        .eq("is_active", true)
        .in("product_id", loadedProducts.map((product) => product.id));

    if (!isCurrent()) return;

    setProducts(loadedProducts);

    if (customerPriceError) {
      // Never display editable prices without knowing the stored values.
      setMessage("ไม่สามารถโหลดราคาพิเศษของลูกค้าได้: " + customerPriceError.message);
      setLoadingFavourites(false);
      return;
    }

    const priceMap: Record<string, number> = {};
    const draftMap: Record<string, string> = {};
    for (const row of (customerPriceData ?? []) as CustomerPriceRow[]) {
      const price = Number(row.agreed_price);
      if (!Number.isFinite(price)) continue;
      priceMap[row.product_id] = price;
      draftMap[row.product_id] = String(price);
    }
    // Manager-only RLS protects cost; never include it in customer product data.
    const { data: costData, error: costError } = await supabase
      .from("product_costs")
      .select("product_id,cost")
      .in("product_id", loadedProducts.map((product) => product.id));
    if (!isCurrent()) return;
    const costMap: Record<string, number> = {};
    if (costError) {
      setMessage("ไม่สามารถโหลดต้นทุนสำหรับ Manager ได้: " + costError.message);
    } else {
      for (const row of (costData ?? []) as ProductCostRow[]) {
        const value = Number(row.cost);
        if (Number.isFinite(value) && value >= 0) costMap[row.product_id] = value;
      }
    }
    setProductCosts(costMap);
    setSpecialPrices(priceMap);
    setPriceDrafts(draftMap);
    setPricesReady(true);
    setLoadingFavourites(false);
  }

  useEffect(() => {
    if (
      selectedCustomer
    ) {
      loadFavourites(
        selectedCustomer
      );
    }
  }, [
    selectedCustomer,
  ]);

  // =====================================================
  // SEARCH PRODUCTS TO ADD
  // Same ranking as customer Order Products:
  //   1. Exact SKU
  //   2. Exact product name
  //   3. Any other match
  //   then Sales DESC
  // =====================================================

  async function searchProductsToAdd(
    rawSearch: string
  ) {
    const term =
      rawSearch.trim();

    if (
      !showAddProduct ||
      !selectedCustomer ||
      term.length === 0
    ) {
      setAddResults([]);
      setSearchingProducts(false);
      return;
    }

    setSearchingProducts(true);
    setMessage("");

    const {
      data,
      error,
    } = await supabase.rpc(
      "search_products_for_customer_favourites",
      {
        p_customer_id:
          selectedCustomer,
        p_query:
          term,
        p_limit:
          30,
      }
    );

    if (error) {
      setMessage(
        "ไม่สามารถค้นหาสินค้าได้: " +
          error.message
      );

      setAddResults([]);
      setSearchingProducts(false);
      return;
    }

    setAddResults(
      (data ?? []) as Product[]
    );

    setSearchingProducts(false);
  }

  useEffect(() => {
    if (
      !showAddProduct
    ) {
      return;
    }

    const timer =
      window.setTimeout(
        () => {
          void searchProductsToAdd(
            addSearch
          );
        },
        300
      );

    return () =>
      window.clearTimeout(
        timer
      );
  }, [
    addSearch,
    showAddProduct,
    selectedCustomer,
    favouriteIds,
  ]);

  async function addFavourite(
    product: Product
  ) {
    if (
      !selectedCustomer ||
      addingProductId
    ) {
      return;
    }

    setAddingProductId(
      product.id
    );

    setMessage("");

    const {
      error,
    } =
      await supabase.rpc(
        "set_customer_favourite",
        {
          p_customer_id:
            selectedCustomer,

          p_product_id:
            product.id,

          p_is_favourite:
            true,
        }
      );

    if (error) {
      setMessage(
        "ไม่สามารถเพิ่มสินค้าซื้อประจำได้: " +
          error.message
      );

      setAddingProductId(
        null
      );

      return;
    }

    await loadFavourites(
      selectedCustomer
    );

    setAddResults(
      (
        current
      ) =>
        current.filter(
          (
            item
          ) =>
            item.id !==
            product.id
        )
    );

    setAddingProductId(
      null
    );
  }

  // =====================================================
  // TOGGLE FAVOURITE
  // =====================================================

  async function toggleFavourite(
    product: Product
  ) {
    if (
      !selectedCustomer ||
      savingIds.has(
        product.id
      )
    ) {
      return;
    }

    const currentlyFavourite =
      favouriteIds.has(
        product.id
      );

    const nextFavourite =
      !currentlyFavourite;

    setSavingIds(
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

    // Optimistic UI
    setFavouriteIds(
      (
        current
      ) => {
        const next =
          new Set(
            current
          );

        if (
          nextFavourite
        ) {
          next.add(
            product.id
          );
        } else {
          next.delete(
            product.id
          );
        }

        return next;
      }
    );

    const {
      error,
    } =
      await supabase.rpc(
        "set_customer_favourite",
        {
          p_customer_id:
            selectedCustomer,

          p_product_id:
            product.id,

          p_is_favourite:
            nextFavourite,
        }
      );

    if (error) {
      // Roll back UI
      setFavouriteIds(
        (
          current
        ) => {
          const next =
            new Set(
              current
            );

          if (
            currentlyFavourite
          ) {
            next.add(
              product.id
            );
          } else {
            next.delete(
              product.id
            );
          }

          return next;
        }
      );

      setMessage(
        "ไม่สามารถอัปเดตสินค้าซื้อประจำได้: " +
          error.message
      );
    }

    setSavingIds(
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

  // =====================================================
  // MANUAL CUSTOMER PRICE UPDATE (SAME RPC AS EXCEL IMPORT)
  // =====================================================

  async function saveSpecialPrice(product: Product) {
    const customerId = selectedCustomer;
    const customer = customers.find((item) => item.id === customerId);
    if (!customer || !pricesReady || savingPriceIds.has(product.id)) return;
    if (activeCustomerRef.current !== customerId) return;

    const raw = (priceDrafts[product.id] ?? "").trim();
    if (!/^\d+(?:\.\d{1,2})?$/.test(raw) || !Number.isFinite(Number(raw))) {
      setPriceFeedback((current) => ({ ...current, [product.id]: {
        kind: "error", text: "กรุณากรอกราคาเป็นตัวเลขที่ไม่ติดลบ และมีทศนิยมไม่เกิน 2 ตำแหน่ง",
      } }));
      return;
    }

    const nextPrice = Number(raw);
    const previous = specialPrices[product.id];
    if (previous !== undefined && previous === nextPrice) return;

    const oldLabel = previous === undefined ? "ยังไม่มีราคาพิเศษ" : `฿${bahtAmount(previous)}`;
    const unitCost = productCosts[product.id];
    const estimatedProfit = unitCost === undefined ? null : nextPrice - unitCost;
    const confirmationMargin = estimatedProfit === null
      ? null : nextPrice > 0 ? (100 * estimatedProfit / nextPrice).toFixed(1) + "%" : "—";
    const profitMessage = estimatedProfit === null
      ? `ต้นทุน: N/A / ${product.unit}\nกำไรขั้นต้น: N/A · %GP N/A`
      : `ต้นทุน: ฿${bahtAmount(unitCost)} / ${product.unit}\nกำไรขั้นต้น: ${estimatedProfit < 0 ? "−" : ""}฿${bahtAmount(Math.abs(estimatedProfit))} · %GP ${confirmationMargin}${estimatedProfit < 0 ? "\n⚠ ราคาขายต่ำกว่าต้นทุน" : ""}`;
    if (!window.confirm(
      `ยืนยันราคาพิเศษสำหรับ ${customer.customer_name}?\n\n` +
      `${product.product_name}\nSKU: ${product.sku}\n` +
      `ราคาปัจจุบัน: ${oldLabel}\nราคาใหม่: ฿${bahtAmount(nextPrice)} / ${product.unit}\n` +
      `${profitMessage}\n\n` +
      "การเปลี่ยนราคานี้จะถูกใช้กับคำสั่งซื้อใหม่ของลูกค้ารายนี้"
    )) return;

    setSavingPriceIds((current) => new Set(current).add(product.id));
    setPriceFeedback((current) => {
      const next = { ...current };
      delete next[product.id];
      return next;
    });

    try {
      // This SECURITY DEFINER function enforces is_current_manager().
      // Excel uses the identical function with many rows; here we send one.
      const { data, error } = await supabase.rpc("import_customer_price_batch", {
        p_rows: [{
          customer_code: customer.customer_code,
          sku: product.sku,
          agreed_price: nextPrice,
        }],
      });

      if (error) throw error;
      const result = data as {
        success?: boolean;
        insertedCount?: number;
        updatedCount?: number;
        unmatchedCustomerCount?: number;
        unmatchedProductCount?: number;
        invalidCount?: number;
      } | null;
      if (!result?.success || Number(result.insertedCount ?? 0) +
        Number(result.updatedCount ?? 0) !== 1) {
        throw new Error("ไม่สามารถจับคู่ลูกค้าและ SKU หรือบันทึกราคาพิเศษได้");
      }

      if (activeCustomerRef.current !== customerId) return;
      setSpecialPrices((current) => ({ ...current, [product.id]: nextPrice }));
      setPriceDrafts((current) => ({ ...current, [product.id]: String(nextPrice) }));
      setPriceFeedback((current) => ({ ...current, [product.id]: {
        kind: "success", text: `✓ บันทึกแล้ว ฿${bahtAmount(nextPrice)} / ${product.unit}`,
      } }));
    } catch (error) {
      if (activeCustomerRef.current !== customerId) return;
      setPriceFeedback((current) => ({ ...current, [product.id]: {
        kind: "error",
        text: error instanceof Error ? error.message : "บันทึกราคาพิเศษไม่สำเร็จ",
      } }));
    } finally {
      setSavingPriceIds((current) => {
        const next = new Set(current);
        next.delete(product.id);
        return next;
      });
    }
  }

  function editPrice(productId: string, value: string) {
    setPriceDrafts((current) => ({ ...current, [productId]: value }));
    setPriceFeedback((current) => {
      const next = { ...current };
      delete next[productId];
      return next;
    });
  }

  // =====================================================
  // FILTER PRODUCTS
  // =====================================================

  const filteredProducts =
    useMemo(() => {
      const favouriteProducts =
        products.filter(
          (
            product
          ) =>
            favouriteIds.has(
              product.id
            )
        );

      const text =
        search
          .trim()
          .toLowerCase();

      if (!text) {
        return favouriteProducts;
      }

      return favouriteProducts.filter(
        (
          product
        ) =>
          product.sku
            .toLowerCase()
            .includes(
              text
            ) ||
          product.product_name
            .toLowerCase()
            .includes(
              text
            ) ||
          (
            product.category ??
            ""
          )
            .toLowerCase()
            .includes(
              text
            )
      );
    }, [
      products,
      favouriteIds,
      search,
    ]);

  const matchingCustomers = useMemo(() => {
    const term = customerSearch.trim().toLowerCase();
    if (!term) return customers;
    return customers.filter((customer) =>
      customer.customer_code.toLowerCase().includes(term) ||
      customer.customer_name.toLowerCase().includes(term)
    );
  }, [customers, customerSearch]);

  // Keep the currently selected customer visible even during a different search.
  const customerOptions = useMemo(() => {
    const current = customers.find((customer) => customer.id === selectedCustomer);
    return current && !matchingCustomers.some((customer) => customer.id === current.id)
      ? [current, ...matchingCustomers]
      : matchingCustomers;
  }, [customers, matchingCustomers, selectedCustomer]);

  const selectedCustomerInfo =
    customers.find(
      (
        customer
      ) =>
        customer.id ===
        selectedCustomer
    );

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-100 p-8">
        กำลังโหลดสินค้าซื้อประจำ...
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-100 p-4 md:p-8">

      <div className="max-w-7xl mx-auto">

        <div className="flex flex-col md:flex-row md:justify-between md:items-start gap-4 mb-8">

          <div>

            <Link
              href="/catalog"
              className="text-gray-500"
            >
              ← กลับไปสินค้าและราคา
            </Link>

            <h1 className="text-3xl font-bold mt-3">
              จัดการสินค้าซื้อประจำ
            </h1>

            <p className="text-gray-500 mt-1">
              แสดงเฉพาะสินค้าที่ถูกตั้งเป็น Favourites ของลูกค้าแต่ละราย
            </p>

          </div>

          <div className="flex gap-2">

            <button
              type="button"
              onClick={() => {
                setShowAddProduct(
                  (
                    current
                  ) =>
                    !current
                );

                setAddSearch(
                  ""
                );

                setAddResults(
                  []
                );
              }}
              disabled={
                !selectedCustomer
              }
              className="bg-black text-white rounded-lg px-5 py-2 font-semibold disabled:opacity-40"
            >
              {showAddProduct
                ? "ปิด"
                : "+ เพิ่มสินค้า"}
            </button>

            <button
              type="button"
              onClick={() =>
                selectedCustomer &&
                loadFavourites(
                  selectedCustomer
                )
              }
              className="bg-white border rounded-lg px-5 py-2"
            >
              รีเฟรช
            </button>

          </div>

        </div>

        {message && (
          <div className="bg-white border rounded-lg p-4 mb-6 text-red-600">
            {message}
          </div>
        )}

        <section className="bg-white border rounded-2xl p-5 mb-6">

          <div className="grid md:grid-cols-2 gap-4">

            <div>

              <label htmlFor="favourites-customer-search" className="block text-sm font-medium mb-2">
                ค้นหาลูกค้า
              </label>

              <input
                id="favourites-customer-search"
                type="search"
                value={customerSearch}
                onChange={(event) => setCustomerSearch(event.target.value)}
                placeholder="ชื่อร้าน หรือรหัส CV"
                className="w-full border border-[#BBD9D2] rounded-lg px-4 py-3 mb-3 focus:outline-none focus:border-[#02B0AF] focus:ring-2 focus:ring-[#02B0AF]/15"
              />

              <label htmlFor="favourites-customer-select" className="block text-sm font-medium mb-2">
                ลูกค้า
              </label>

              <select
                id="favourites-customer-select"
                value={
                  selectedCustomer
                }
                onChange={(event) => {
                  activeCustomerRef.current = event.target.value;
                  setSelectedCustomer(event.target.value);
                }}
                className="w-full border rounded-lg px-4 py-3 bg-white"
              >

                {customerOptions.map(
                  (
                    customer
                  ) => (

                    <option
                      key={
                        customer.id
                      }
                      value={
                        customer.id
                      }
                    >
                      {
                        customer.customer_code
                      }
                      {" · "}
                      {
                        customer.customer_name
                      }
                      {!customer.is_active
                        ? " · ไม่ใช้งาน"
                        : ""}
                    </option>

                  )
                )}

              </select>

              {customerSearch.trim() && (
                <p role="status" className="mt-2 text-xs text-[#647D74]">
                  {matchingCustomers.length > 0
                    ? `พบลูกค้า ${matchingCustomers.length} ราย`
                    : "ไม่พบลูกค้าที่ค้นหา"}
                </p>
              )}

            </div>

            <div>

              <label className="block text-sm font-medium mb-2">
                ค้นหาสินค้า
              </label>

              <input
                type="text"
                value={
                  search
                }
                onChange={(event) =>
                  setSearch(
                    event.target.value
                  )
                }
                placeholder="SKU ชื่อสินค้า หรือหมวดสินค้า"
                className="w-full border rounded-lg px-4 py-3"
              />

            </div>

          </div>

          {selectedCustomerInfo && (
            <p className="text-sm text-gray-500 mt-4">
              กำลังจัดการ Favourites สำหรับ{" "}
              <span className="font-semibold text-gray-800">
                {
                  selectedCustomerInfo.customer_name
                }
              </span>
              {" · "}
              {
                favouriteIds.size
              }
              {" รายการ"}
            </p>
          )}

        </section>

        {showAddProduct && (
          <section className="bg-white border rounded-2xl p-5 mb-6">

            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">

              <div>
                <h2 className="font-bold text-lg">
                  เพิ่มสินค้าซื้อประจำ
                </h2>

                <p className="text-sm text-gray-500 mt-1">
                  ค้นหาจาก SKU หรือชื่อสินค้า ผลลัพธ์เรียงตามความตรงของคำค้นหา แล้วตามยอดขาย
                </p>
              </div>

              <div className="text-sm text-gray-500">
                แสดงสูงสุด 30 รายการต่อการค้นหา
              </div>

            </div>

            <input
              type="text"
              value={
                addSearch
              }
              onChange={(event) =>
                setAddSearch(
                  event.target.value
                )
              }
              placeholder="พิมพ์ SKU หรือชื่อสินค้า..."
              autoFocus
              className="w-full border rounded-xl px-4 py-3 mt-5"
            />

            {searchingProducts ? (

              <div className="py-8 text-gray-500">
                กำลังค้นหาสินค้า...
              </div>

            ) : addSearch.trim().length ===
              0 ? (

              <div className="py-8 text-gray-500">
                พิมพ์คำค้นหาเพื่อค้นหาสินค้าที่ต้องการเพิ่ม
              </div>

            ) : addResults.length ===
              0 ? (

              <div className="py-8 text-gray-500">
                ไม่พบสินค้าที่สามารถเพิ่มได้
              </div>

            ) : (

              <div className="mt-4 border rounded-xl overflow-hidden">

                {addResults.map(
                  (
                    product
                  ) => {

                    const busy =
                      addingProductId ===
                      product.id;

                    return (
                      <div
                        key={
                          product.id
                        }
                        className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 p-4 border-b last:border-b-0"
                      >

                        <div className="flex items-center gap-3 min-w-0 flex-1">

                          <ProductThumbnail
                            imageUrl={
                              product.image_url
                            }
                            alt={
                              product.product_name
                            }
                            category={
                              product.category
                            }
                          />

                          <div className="min-w-0 flex-1">

                          <div className="font-semibold">
                            {
                              product.product_name
                            }
                          </div>

                          <div className="text-sm text-gray-500 mt-1">
                            SKU{" "}
                            {
                              product.sku
                            }
                            {" · "}
                            {
                              product.unit
                            }
                            {" · "}
                            {
                              product.category ??
                              "ไม่ระบุหมวด"
                            }
                          </div>

                          <div className="text-sm mt-1">
                            ฿
                            {Number(
                              product.normal_price
                            ).toLocaleString(
                              "th-TH",
                              {
                                minimumFractionDigits:
                                  2,
                                maximumFractionDigits:
                                  2,
                              }
                            )}
                          </div>

                          </div>

                        </div>

                        <button
                          type="button"
                          onClick={() =>
                            void addFavourite(
                              product
                            )
                          }
                          disabled={
                            busy
                          }
                          className="shrink-0 bg-black text-white rounded-xl px-5 py-2.5 font-semibold disabled:opacity-40"
                        >
                          {busy
                            ? "กำลังเพิ่ม..."
                            : "+ เพิ่ม"}
                        </button>

                      </div>
                    );
                  }
                )}

              </div>
            )}

          </section>
        )}

        <section className="bg-white border rounded-2xl overflow-hidden">

          <div className="p-5 border-b flex justify-between items-center">

            <div>

              <h2 className="font-bold text-lg">
                สินค้าซื้อประจำของลูกค้า
              </h2>

              <p className="text-sm text-gray-500 mt-1">
                จัดการสินค้า ★ และกำหนดราคาพิเศษราย SKU พร้อมดูต้นทุน กำไรขั้นต้น และ Margin ก่อนบันทึก
              </p>

            </div>

            <span className="text-sm text-gray-500">
              {
                filteredProducts.length
              }
              {" SKU"}
            </span>

          </div>

          {loadingFavourites ? (

            <div className="p-8 text-gray-500">
              กำลังโหลดสินค้าซื้อประจำ...
            </div>

          ) : filteredProducts.length ===
            0 ? (

            <div className="p-8 text-gray-500">
              ลูกค้ารายนี้ยังไม่มีสินค้าซื้อประจำ — กด “+ เพิ่มสินค้า” เพื่อเริ่มเพิ่ม
            </div>

          ) : (
            <>

            {/* Small screens: show prices and confirm button directly on each product card. */}
            <div className="divide-y divide-[#E5EFEB] md:hidden">
              {filteredProducts.map((product) => {
                const busy = savingIds.has(product.id);
                return (
                  <div key={product.id} className="space-y-3 px-4 py-4">
                    <div className="flex items-start gap-3">
                      <button
                        type="button"
                        disabled={busy || !selectedCustomer}
                        onClick={() => void toggleFavourite(product)}
                        className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-[#F5D786] bg-[#FFF8E8] text-xl text-[#D69B00] disabled:opacity-40"
                        title="ลบออกจากสินค้าซื้อประจำ"
                        aria-label={`ลบ ${product.product_name} จากสินค้าซื้อประจำ`}
                      >{busy ? "…" : "★"}</button>
                      <div className="min-w-0 flex-1">
                        <p className="font-bold text-[#17453F]">{product.product_name}</p>
                        <p className="mt-1 text-xs text-[#71877F]">SKU {product.sku} · {product.unit}</p>
                        <p className="mt-1 text-xs text-[#87988F]">{product.category ?? "—"}</p>
                      </div>
                    </div>
                    <div className="rounded-xl border border-[#DAECE7] bg-[#F6FBF9] p-3">
                      <p className="mb-2 text-sm text-[#537369]">
                        ราคาปกติ <strong className="text-[#17453F]">฿{bahtAmount(Number(product.normal_price))}</strong> / {product.unit}
                      </p>
                      <SpecialPriceEditor
                        product={product}
                        cost={productCosts[product.id] ?? null}
                        savedPrice={specialPrices[product.id]}
                        draft={priceDrafts[product.id] ?? ""}
                        busy={!pricesReady || savingPriceIds.has(product.id)}
                        feedback={priceFeedback[product.id]}
                        onChange={(value) => editPrice(product.id, value)}
                        onSave={() => void saveSpecialPrice(product)}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Wide screens: an additional special-price column next to normal price. */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[950px]">
                <thead className="bg-[#F4F9F7]">
                  <tr>
                    <th className="p-3 text-left text-sm">★</th>
                    <th className="p-3 text-left text-sm">SKU</th>
                    <th className="p-3 text-left text-sm">สินค้า</th>
                    <th className="p-3 text-left text-sm">หมวด</th>
                    <th className="p-3 text-right text-sm">ราคาปกติ</th>
                    <th className="min-w-[235px] p-3 text-left text-sm">ราคาพิเศษ (฿) · ยืนยัน</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProducts.map((product) => {
                    const busy = savingIds.has(product.id);
                    return (
                      <tr key={product.id} className="border-t border-[#E5EFEB] align-top">
                        <td className="p-3">
                          <button
                            type="button"
                            onClick={() => void toggleFavourite(product)}
                            disabled={busy || !selectedCustomer}
                            title="ลบออกจากสินค้าซื้อประจำ"
                            aria-label={`ลบ ${product.product_name} จากสินค้าซื้อประจำ`}
                            className="grid h-10 w-10 place-items-center rounded-full border border-[#F5D786] bg-[#FFF8E8] text-xl text-[#D69B00] disabled:opacity-40"
                          >{busy ? "…" : "★"}</button>
                        </td>
                        <td className="p-3 text-sm font-semibold text-[#426559]">{product.sku}</td>
                        <td className="p-3">
                          <p className="font-semibold text-[#17453F]">{product.product_name}</p>
                          <p className="mt-1 text-xs text-[#71877F]">{product.unit}</p>
                        </td>
                        <td className="p-3 text-sm text-[#71877F]">{product.category ?? "—"}</td>
                        <td className="whitespace-nowrap p-3 text-right text-sm font-bold">
                          ฿{bahtAmount(Number(product.normal_price))}
                        </td>
                        <td className="min-w-[235px] p-3">
                          <SpecialPriceEditor
                            product={product}
                            cost={productCosts[product.id] ?? null}
                            savedPrice={specialPrices[product.id]}
                            draft={priceDrafts[product.id] ?? ""}
                            busy={!pricesReady || savingPriceIds.has(product.id)}
                            feedback={priceFeedback[product.id]}
                            onChange={(value) => editPrice(product.id, value)}
                            onSave={() => void saveSpecialPrice(product)}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            </>
          )}

        </section>

      </div>

    </main>
  );
}
