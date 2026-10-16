"use client";

import {
  useEffect,
  useMemo,
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
};

type FavouriteRow = {
  product_id: string;
  sort_order: number | null;
};

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
          normal_price
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

    setProducts(
      loadedProducts
    );

    setLoadingFavourites(
      false
    );
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
              href="/customers"
              className="text-gray-500"
            >
              ← กลับไปหน้าลูกค้า
            </Link>

            <h1 className="text-3xl font-bold mt-3">
              จัดการสินค้าซื้อประจำ
            </h1>

            <p className="text-gray-500 mt-1">
              แสดงเฉพาะสินค้าที่ถูกตั้งเป็น Favourites ของลูกค้าแต่ละราย
            </p>

          </div>

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

        {message && (
          <div className="bg-white border rounded-lg p-4 mb-6 text-red-600">
            {message}
          </div>
        )}

        <section className="bg-white border rounded-2xl p-5 mb-6">

          <div className="grid md:grid-cols-2 gap-4">

            <div>

              <label className="block text-sm font-medium mb-2">
                ลูกค้า
              </label>

              <select
                value={
                  selectedCustomer
                }
                onChange={(event) =>
                  setSelectedCustomer(
                    event.target.value
                  )
                }
                className="w-full border rounded-lg px-4 py-3 bg-white"
              >

                {customers.map(
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

        <section className="bg-white border rounded-2xl overflow-hidden">

          <div className="p-5 border-b flex justify-between items-center">

            <div>

              <h2 className="font-bold text-lg">
                สินค้าซื้อประจำของลูกค้า
              </h2>

              <p className="text-sm text-gray-500 mt-1">
                แสดงเฉพาะสินค้าที่ติด ★ อยู่แล้ว กด ★ เพื่อลบออกจากสินค้าซื้อประจำ
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
              ลูกค้ารายนี้ยังไม่มีสินค้าซื้อประจำ
            </div>

          ) : (

            <div className="overflow-x-auto">

              <table className="w-full">

                <thead className="bg-gray-50">

                  <tr>

                    <th className="text-left p-4">
                      Favourite
                    </th>

                    <th className="text-left p-4">
                      SKU
                    </th>

                    <th className="text-left p-4">
                      สินค้า
                    </th>

                    <th className="text-left p-4">
                      หมวด
                    </th>

                    <th className="text-right p-4">
                      ราคาปกติ
                    </th>

                  </tr>

                </thead>

                <tbody>

                  {filteredProducts.map(
                    (
                      product
                    ) => {
                      const isFavourite =
                        favouriteIds.has(
                          product.id
                        );

                      const busy =
                        savingIds.has(
                          product.id
                        );

                      return (
                        <tr
                          key={
                            product.id
                          }
                          className="border-t"
                        >

                          <td className="p-4">

                            <button
                              type="button"
                              disabled={
                                busy ||
                                !selectedCustomer
                              }
                              onClick={() =>
                                toggleFavourite(
                                  product
                                )
                              }
                              className="w-11 h-11 rounded-full border flex items-center justify-center text-2xl disabled:opacity-40"
                              title="ลบออกจากสินค้าซื้อประจำ"
                            >
                              {busy
                                ? "…"
                                : isFavourite
                                ? "★"
                                : "☆"}
                            </button>

                          </td>

                          <td className="p-4 font-medium">
                            {
                              product.sku
                            }
                          </td>

                          <td className="p-4">

                            <div className="font-medium">
                              {
                                product.product_name
                              }
                            </div>

                            <div className="text-sm text-gray-500">
                              {
                                product.unit
                              }
                            </div>

                          </td>

                          <td className="p-4">
                            {
                              product.category ??
                              "—"
                            }
                          </td>

                          <td className="p-4 text-right">
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
                          </td>

                        </tr>
                      );
                    }
                  )}

                </tbody>

              </table>

            </div>

          )}

        </section>

      </div>

    </main>
  );
}
