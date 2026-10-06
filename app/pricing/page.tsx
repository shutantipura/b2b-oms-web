"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "../../lib/supabase";

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

type CustomerPrice = {
  id: string;
  customer_id: string;
  product_id: string;
  agreed_price: number | string;
  is_active: boolean;
};

export default function PricingPage() {
  const [products, setProducts] =
    useState<Product[]>([]);

  const [customers, setCustomers] =
    useState<Customer[]>([]);

  const [customerPrices, setCustomerPrices] =
    useState<CustomerPrice[]>([]);

  const [search, setSearch] =
    useState("");

  const [selectedCustomer, setSelectedCustomer] =
    useState("");

  const [editingMaster, setEditingMaster] =
    useState<Record<string, string>>({});

  const [editingOverride, setEditingOverride] =
    useState<Record<string, string>>({});

  const [loading, setLoading] =
    useState(true);

  const [saving, setSaving] =
    useState(false);

  const [message, setMessage] =
    useState("");

  async function loadPricing() {
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

    const loadedProducts =
      (productData ?? []) as Product[];

    setProducts(loadedProducts);

    const initialMaster:
      Record<string, string> = {};

    loadedProducts.forEach((product) => {
      initialMaster[product.id] =
        String(product.normal_price);
    });

    setEditingMaster(initialMaster);

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

    setCustomers(
      (customerData ?? []) as Customer[]
    );

    const {
      data: priceData,
      error: priceError,
    } = await supabase
      .from("customer_prices")
      .select(`
        id,
        customer_id,
        product_id,
        agreed_price,
        is_active
      `);

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
    loadPricing();
  }, []);

  useEffect(() => {
    if (!selectedCustomer) {
      setEditingOverride({});
      return;
    }

    const values:
      Record<string, string> = {};

    customerPrices
      .filter(
        (price) =>
          price.customer_id ===
            selectedCustomer &&
          price.is_active
      )
      .forEach((price) => {
        values[price.product_id] =
          String(price.agreed_price);
      });

    setEditingOverride(values);
  }, [
    selectedCustomer,
    customerPrices,
  ]);

  const filteredProducts =
    useMemo(() => {
      const text =
        search.trim().toLowerCase();

      if (!text) {
        return products;
      }

      return products.filter(
        (product) =>
          product.sku
            .toLowerCase()
            .includes(text) ||
          product.product_name
            .toLowerCase()
            .includes(text)
      );
    }, [products, search]);

  function getExistingOverride(
    productId: string
  ) {
    return customerPrices.find(
      (price) =>
        price.customer_id ===
          selectedCustomer &&
        price.product_id ===
          productId &&
        price.is_active
    );
  }

  async function saveMasterPrice(
    product: Product
  ) {
    const value =
      Number(
        editingMaster[product.id]
      );

    if (
      Number.isNaN(value) ||
      value < 0
    ) {
      setMessage(
        `Invalid price for ${product.product_name}.`
      );
      return;
    }

    setSaving(true);
    setMessage("");

    const { data, error } =
  await supabase
    .from("products")
    .update({
      normal_price: value,
    })
    .eq(
      "id",
      product.id
    )
    .select("id, normal_price");

    if (error) {
      setMessage(
        "Could not update master price: " +
          error.message
      );
      setSaving(false);
      return;
    }

    if (!data || data.length === 0) {
  setMessage(
    "The database did not update this product. This is usually caused by a Supabase permission/RLS policy."
  );

  setSaving(false);
  return;
}

    setMessage(
      `${product.product_name} master price updated.`
    );

    setSaving(false);

    await loadPricing();
  }

  async function saveOverride(
    product: Product
  ) {
    if (!selectedCustomer) {
      setMessage(
        "Please select a customer first."
      );
      return;
    }

    const rawValue =
      editingOverride[product.id];

    if (
      rawValue === undefined ||
      rawValue === ""
    ) {
      setMessage(
        "Enter a special price, or use Remove Override."
      );
      return;
    }

    const value =
      Number(rawValue);

    if (
      Number.isNaN(value) ||
      value < 0
    ) {
      setMessage(
        "Please enter a valid special price."
      );
      return;
    }

    setSaving(true);
    setMessage("");

    const existing =
      getExistingOverride(
        product.id
      );

    if (existing) {
      const { error } =
        await supabase
          .from("customer_prices")
          .update({
            agreed_price: value,
            is_active: true,
          })
          .eq(
            "id",
            existing.id
          );

      if (error) {
        setMessage(
          "Could not update special price: " +
            error.message
        );
        setSaving(false);
        return;
      }
    } else {
      const { error } =
        await supabase
          .from("customer_prices")
          .insert({
            customer_id:
              selectedCustomer,

            product_id:
              product.id,

            agreed_price:
              value,

            is_active:
              true,
          });

      if (error) {
        setMessage(
          "Could not create special price: " +
            error.message
        );
        setSaving(false);
        return;
      }
    }

    setMessage(
      `${product.product_name} special price saved.`
    );

    setSaving(false);

    await loadPricing();
  }

  async function removeOverride(
    product: Product
  ) {
    const existing =
      getExistingOverride(
        product.id
      );

    if (!existing) {
      setEditingOverride({
        ...editingOverride,
        [product.id]: "",
      });

      return;
    }

    const confirmed =
      window.confirm(
        `Remove the special price for ${product.product_name}? The customer will return to the normal price.`
      );

    if (!confirmed) {
      return;
    }

    setSaving(true);
    setMessage("");

    const { error } =
      await supabase
        .from("customer_prices")
        .update({
          is_active: false,
        })
        .eq(
          "id",
          existing.id
        );

    if (error) {
      setMessage(
        "Could not remove special price: " +
          error.message
      );
      setSaving(false);
      return;
    }

    setMessage(
      `${product.product_name} now uses the normal price.`
    );

    setSaving(false);

    await loadPricing();
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-100 p-8">
        Loading pricing...
      </main>
    );
  }

  const selectedCustomerInfo =
    customers.find(
      (customer) =>
        customer.id ===
        selectedCustomer
    );

  return (
    <main className="min-h-screen bg-gray-100 p-8">

      <div className="max-w-7xl mx-auto">

        <div className="flex justify-between items-start mb-8">

          <div>
            <Link
              href="/"
              className="text-gray-500"
            >
              ← Back
            </Link>

            <h1 className="text-3xl font-bold mt-3">
              Pricing
            </h1>

            <p className="text-gray-500 mt-1">
              Manage normal prices and customer-specific prices.
            </p>
          </div>

          <div className="flex gap-3">

  <Link
    href="/pricing/favourites"
    className="bg-black text-white rounded-lg px-5 py-2 font-semibold"
  >
    MANAGE FAVOURITES
  </Link>

  <button
    onClick={loadPricing}
    className="bg-white border rounded-lg px-5 py-2"
  >
    Refresh
  </button>

</div>

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

            <div>

              <label className="block text-sm font-medium mb-2">
                Customer Price View
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

                <option value="">
                  Master prices only
                </option>

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

          </div>

        </section>

        {selectedCustomerInfo && (
          <section className="bg-white border rounded-2xl p-5 mb-6">

            <p className="text-sm text-gray-500">
              Viewing effective prices for
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

          </section>
        )}

        <section className="bg-white border rounded-2xl overflow-hidden">

          <div className="p-5 border-b flex justify-between">

            <h2 className="font-bold text-lg">
              Product Price List
            </h2>

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

                  {selectedCustomer && (
                    <>
                      <th className="p-4 text-right">
                        Special Price
                      </th>

                      <th className="p-4 text-right">
                        Effective Price
                      </th>
                    </>
                  )}

                  <th className="p-4 text-right">
                    Action
                  </th>

                </tr>

              </thead>

              <tbody>

                {filteredProducts.map(
                  (product) => {

                    const override =
                      getExistingOverride(
                        product.id
                      );

                    const normalPrice =
                      Number(
                        product.normal_price
                      );

                    const effectivePrice =
                      override
                        ? Number(
                            override.agreed_price
                          )
                        : normalPrice;

                    return (
                      <tr
                        key={product.id}
                        className="border-t"
                      >

                        <td className="p-4">

                          <div className="font-semibold">
                            {product.product_name}
                          </div>

                          <div className="text-sm text-gray-500">
                            {product.sku}
                          </div>

                        </td>

                        <td className="p-4">
                          {product.unit}
                        </td>

                        <td className="p-4">

                          <div className="flex justify-end items-center gap-2">

                            <span>
                              ฿
                            </span>

                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={
                                editingMaster[
                                  product.id
                                ] ?? ""
                              }
                              onChange={(event) =>
                                setEditingMaster({
                                  ...editingMaster,

                                  [product.id]:
                                    event.target.value,
                                })
                              }
                              className="w-28 border rounded-lg px-3 py-2 text-right"
                            />

                          </div>

                        </td>

                        {selectedCustomer && (
                          <>

                            <td className="p-4">

                              <div className="flex justify-end items-center gap-2">

                                <span>
                                  ฿
                                </span>

                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  placeholder="None"
                                  value={
                                    editingOverride[
                                      product.id
                                    ] ?? ""
                                  }
                                  onChange={(event) =>
                                    setEditingOverride({
                                      ...editingOverride,

                                      [product.id]:
                                        event.target.value,
                                    })
                                  }
                                  className="w-28 border rounded-lg px-3 py-2 text-right"
                                />

                              </div>

                            </td>

                            <td className="p-4 text-right">

                              <div className="font-bold">
                                ฿
                                {effectivePrice.toFixed(
                                  2
                                )}
                              </div>

                              <div className="text-xs text-gray-500">
                                {override
                                  ? "Special price"
                                  : "Normal price"}
                              </div>

                            </td>

                          </>
                        )}

                        <td className="p-4">

                          <div className="flex justify-end gap-2">

                            <button
                              onClick={() =>
                                saveMasterPrice(
                                  product
                                )
                              }
                              disabled={saving}
                              className="bg-white border rounded-lg px-3 py-2 text-sm font-semibold"
                            >
                              SAVE NORMAL
                            </button>

                            {selectedCustomer && (
                              <>
                                <button
                                  onClick={() =>
                                    saveOverride(
                                      product
                                    )
                                  }
                                  disabled={saving}
                                  className="bg-black text-white rounded-lg px-3 py-2 text-sm font-semibold"
                                >
                                  SAVE SPECIAL
                                </button>

                                {override && (
                                  <button
                                    onClick={() =>
                                      removeOverride(
                                        product
                                      )
                                    }
                                    disabled={saving}
                                    className="bg-white border rounded-lg px-3 py-2 text-sm"
                                  >
                                    REMOVE
                                  </button>
                                )}
                              </>
                            )}

                          </div>

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