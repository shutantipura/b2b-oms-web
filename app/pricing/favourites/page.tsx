"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "../../../lib/supabase";

type Product = {
  id: string;
  sku: string;
  product_name: string;
  unit: string;
  normal_price: number | string;
};

type Customer = {
  id: string;
  customer_code: string;
  customer_name: string;
  is_active: boolean;
};

type Favourite = {
  id: string;
  customer_id: string;
  product_id: string;
  sort_order: number | null;
};

type CustomerPrice = {
  customer_id: string;
  product_id: string;
  agreed_price: number | string;
  is_active: boolean;
};

export default function FavouritesPage() {
  const [products, setProducts] =
    useState<Product[]>([]);

  const [customers, setCustomers] =
    useState<Customer[]>([]);

  const [favourites, setFavourites] =
    useState<Favourite[]>([]);

  const [customerPrices, setCustomerPrices] =
    useState<CustomerPrice[]>([]);

  const [selectedCustomer, setSelectedCustomer] =
    useState("");

  const [search, setSearch] =
    useState("");

  const [loading, setLoading] =
    useState(true);

  const [savingProduct, setSavingProduct] =
    useState<string | null>(null);

  const [message, setMessage] =
    useState("");

  async function loadData() {
    setLoading(true);
    setMessage("");

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
      .order("product_name", {
        ascending: true,
      });

    if (productError) {
      setMessage(
        "Could not load products: " +
          productError.message
      );

      setLoading(false);
      return;
    }

    setProducts(
      (productData ?? []) as Product[]
    );

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
      .order("customer_name", {
        ascending: true,
      });

    if (customerError) {
      setMessage(
        "Could not load customers: " +
          customerError.message
      );

      setLoading(false);
      return;
    }

    const loadedCustomers =
      (customerData ?? []) as Customer[];

    setCustomers(loadedCustomers);

    if (
      !selectedCustomer &&
      loadedCustomers.length > 0
    ) {
      const firstActive =
        loadedCustomers.find(
          (customer) =>
            customer.is_active
        );

      setSelectedCustomer(
        firstActive?.id ??
          loadedCustomers[0].id
      );
    }

    const {
      data: favouriteData,
      error: favouriteError,
    } = await supabase
      .from("favourites")
      .select(`
        id,
        customer_id,
        product_id,
        sort_order
      `);

    if (favouriteError) {
      setMessage(
        "Could not load favourites: " +
          favouriteError.message
      );

      setLoading(false);
      return;
    }

    setFavourites(
      (favouriteData ?? []) as Favourite[]
    );

    const {
      data: priceData,
      error: priceError,
    } = await supabase
      .from("customer_prices")
      .select(`
        customer_id,
        product_id,
        agreed_price,
        is_active
      `)
      .eq("is_active", true);

    if (priceError) {
      setMessage(
        "Could not load customer prices: " +
          priceError.message
      );

      setLoading(false);
      return;
    }

    setCustomerPrices(
      (priceData ?? []) as CustomerPrice[]
    );

    setLoading(false);
  }

  useEffect(() => {
    loadData();
  }, []);

  const filteredProducts =
    useMemo(() => {
      const text =
        search.trim().toLowerCase();

      if (!text) {
        return products;
      }

      return products.filter(
        (product) =>
          product.product_name
            .toLowerCase()
            .includes(text) ||
          product.sku
            .toLowerCase()
            .includes(text)
      );
    }, [products, search]);

  const selectedCustomerInfo =
    customers.find(
      (customer) =>
        customer.id ===
        selectedCustomer
    );

  const selectedFavourites =
    favourites.filter(
      (favourite) =>
        favourite.customer_id ===
        selectedCustomer
    );

  function getFavourite(
    productId: string
  ) {
    return favourites.find(
      (favourite) =>
        favourite.customer_id ===
          selectedCustomer &&
        favourite.product_id ===
          productId
    );
  }

  function getEffectivePrice(
    product: Product
  ) {
    const specialPrice =
      customerPrices.find(
        (price) =>
          price.customer_id ===
            selectedCustomer &&
          price.product_id ===
            product.id &&
          price.is_active
      );

    if (specialPrice) {
      return {
        price: Number(
          specialPrice.agreed_price
        ),
        type: "Special",
      };
    }

    return {
      price: Number(
        product.normal_price
      ),
      type: "Normal",
    };
  }

  async function toggleFavourite(
    product: Product
  ) {
    if (!selectedCustomer) {
      setMessage(
        "Please select a customer."
      );
      return;
    }

    setSavingProduct(product.id);
    setMessage("");

    const existing =
      getFavourite(product.id);

    if (existing) {
      const {
        data,
        error,
      } = await supabase
        .from("favourites")
        .delete()
        .eq("id", existing.id)
        .select("id");

      if (error) {
        setMessage(
          "Could not remove favourite: " +
            error.message
        );

        setSavingProduct(null);
        return;
      }

      if (!data || data.length === 0) {
        setMessage(
          "The database did not remove this favourite. Check the Supabase permission policy."
        );

        setSavingProduct(null);
        return;
      }

      setFavourites(
        favourites.filter(
          (favourite) =>
            favourite.id !==
            existing.id
        )
      );

      setMessage(
        `${product.product_name} removed from favourites.`
      );

      setSavingProduct(null);
      return;
    }

    const customerFavourites =
      favourites.filter(
        (favourite) =>
          favourite.customer_id ===
          selectedCustomer
      );

    const highestSortOrder =
      customerFavourites.reduce(
        (highest, favourite) =>
          Math.max(
            highest,
            favourite.sort_order ?? 0
          ),
        0
      );

    const {
      data,
      error,
    } = await supabase
      .from("favourites")
      .insert({
        customer_id:
          selectedCustomer,

        product_id:
          product.id,

        sort_order:
          highestSortOrder + 1,
      })
      .select(`
        id,
        customer_id,
        product_id,
        sort_order
      `)
      .single();

    if (error) {
      setMessage(
        "Could not add favourite: " +
          error.message
      );

      setSavingProduct(null);
      return;
    }

    setFavourites([
      ...favourites,
      data as Favourite,
    ]);

    setMessage(
      `${product.product_name} added to favourites.`
    );

    setSavingProduct(null);
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-100 p-8">
        Loading favourites...
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-100 p-8">

      <div className="max-w-7xl mx-auto">

        <div className="flex justify-between items-start mb-8">

          <div>

            <Link
              href="/pricing"
              className="text-gray-500"
            >
              ← Back to Pricing
            </Link>

            <h1 className="text-3xl font-bold mt-3">
              Favourites
            </h1>

            <p className="text-gray-500 mt-1">
              Choose the frequently ordered products shown to each customer.
            </p>

          </div>

          <button
            onClick={loadData}
            className="bg-white border rounded-lg px-5 py-2"
          >
            Refresh
          </button>

        </div>

        {message && (
          <div className="bg-white border rounded-lg p-4 mb-6">
            {message}
          </div>
        )}

        <section className="bg-white border rounded-2xl p-5 mb-6">

          <div className="grid md:grid-cols-2 gap-4">

            <div>

              <label className="block text-sm font-medium mb-2">
                Customer
              </label>

              <select
                value={selectedCustomer}
                onChange={(event) =>
                  setSelectedCustomer(
                    event.target.value
                  )
                }
                className="w-full border rounded-lg px-4 py-3 bg-white"
              >

                {customers.map(
                  (customer) => (
                    <option
                      key={customer.id}
                      value={customer.id}
                    >
                      {customer.customer_code}
                      {" · "}
                      {customer.customer_name}
                      {!customer.is_active
                        ? " · Inactive"
                        : ""}
                    </option>
                  )
                )}

              </select>

            </div>

            <div>

              <label className="block text-sm font-medium mb-2">
                Search Products
              </label>

              <input
                value={search}
                onChange={(event) =>
                  setSearch(
                    event.target.value
                  )
                }
                placeholder="SKU or product name"
                className="w-full border rounded-lg px-4 py-3"
              />

            </div>

          </div>

        </section>

        {selectedCustomerInfo && (
          <section className="grid md:grid-cols-2 gap-4 mb-6">

            <div className="bg-white border rounded-2xl p-5">

              <p className="text-sm text-gray-500">
                Customer
              </p>

              <p className="text-xl font-bold mt-1">
                {
                  selectedCustomerInfo.customer_name
                }
              </p>

              <p className="text-gray-500">
                {
                  selectedCustomerInfo.customer_code
                }
              </p>

            </div>

            <div className="bg-white border rounded-2xl p-5">

              <p className="text-sm text-gray-500">
                Favourite Products
              </p>

              <p className="text-3xl font-bold mt-2">
                {
                  selectedFavourites.length
                }
              </p>

            </div>

          </section>
        )}

        <section className="bg-white border rounded-2xl overflow-hidden">

          <div className="p-5 border-b flex justify-between">

            <div>

              <h2 className="font-bold text-lg">
                Product Catalogue
              </h2>

              <p className="text-sm text-gray-500 mt-1">
                Add or remove products from this customer's Favourites.
              </p>

            </div>

            <span className="text-sm text-gray-500">
              {filteredProducts.length} products
            </span>

          </div>

          <div className="overflow-x-auto">

            <table className="w-full">

              <thead className="bg-gray-50">

                <tr>

                  <th className="p-4 text-left">
                    Product
                  </th>

                  <th className="p-4 text-left">
                    Unit
                  </th>

                  <th className="p-4 text-right">
                    Normal Price
                  </th>

                  <th className="p-4 text-right">
                    Customer Price
                  </th>

                  <th className="p-4 text-left">
                    Favourite
                  </th>

                  <th className="p-4 text-right">
                    Action
                  </th>

                </tr>

              </thead>

              <tbody>

                {filteredProducts.map(
                  (product) => {

                    const favourite =
                      getFavourite(
                        product.id
                      );

                    const effective =
                      getEffectivePrice(
                        product
                      );

                    return (
                      <tr
                        key={product.id}
                        className="border-t"
                      >

                        <td className="p-4">

                          <p className="font-semibold">
                            {product.product_name}
                          </p>

                          <p className="text-sm text-gray-500">
                            {product.sku}
                          </p>

                        </td>

                        <td className="p-4">
                          {product.unit}
                        </td>

                        <td className="p-4 text-right">
                          ฿
                          {Number(
                            product.normal_price
                          ).toFixed(2)}
                        </td>

                        <td className="p-4 text-right">

                          <p className="font-semibold">
                            ฿
                            {effective.price.toFixed(
                              2
                            )}
                          </p>

                          <p className="text-xs text-gray-500">
                            {effective.type}
                          </p>

                        </td>

                        <td className="p-4">

                          {favourite ? (
                            <span className="font-semibold">
                              ★ Yes
                            </span>
                          ) : (
                            <span className="text-gray-400">
                              No
                            </span>
                          )}

                        </td>

                        <td className="p-4 text-right">

                          <button
                            onClick={() =>
                              toggleFavourite(
                                product
                              )
                            }
                            disabled={
                              savingProduct ===
                              product.id
                            }
                            className={
                              favourite
                                ? "bg-white border rounded-lg px-4 py-2 font-semibold"
                                : "bg-black text-white rounded-lg px-4 py-2 font-semibold"
                            }
                          >

                            {savingProduct ===
                            product.id
                              ? "SAVING..."
                              : favourite
                              ? "REMOVE"
                              : "ADD TO FAVOURITES"}

                          </button>

                        </td>

                      </tr>
                    );
                  }
                )}

              </tbody>

            </table>

          </div>

        </section>

      </div>

    </main>
  );
}