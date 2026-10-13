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

        "ไม่สามารถโหลดสินค้าได้: " +

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

        "ไม่สามารถโหลดลูกค้าได้: " +

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

        "ไม่สามารถโหลดราคาลูกค้าได้: " +

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

        `ราคาไม่ถูกต้องสำหรับ ${product.product_name}`

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

        "ไม่สามารถอัปเดตราคาปกติได้: " +

          error.message

      );

      setSaving(false);

      return;

    }



    if (!data || data.length === 0) {

  setMessage(

    "ฐานข้อมูลไม่ได้อัปเดตสินค้านี้ โดยปกติเกิดจากสิทธิ์หรือ RLS policy ของ Supabase"

  );



  setSaving(false);

  return;

}



    setMessage(

      `${product.product_name} อัปเดตราคาปกติแล้ว`

    );



    setSaving(false);



    await loadPricing();

  }



  async function saveOverride(

    product: Product

  ) {

    if (!selectedCustomer) {

      setMessage(

        "กรุณาเลือกลูกค้าก่อน"

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

        "กรุณากรอกราคาพิเศษ หรือกดลบราคาพิเศษ"

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

        "กรุณากรอกราคาพิเศษที่ถูกต้อง"

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

          "ไม่สามารถอัปเดตราคาพิเศษได้: " +

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

          "ไม่สามารถสร้างราคาพิเศษได้: " +

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

        "ไม่สามารถลบราคาพิเศษได้: " +

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

        กำลังโหลดราคา...

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

              ← กลับ

            </Link>



            <h1 className="text-3xl font-bold mt-3">

              ราคา

            </h1>



            <p className="text-gray-500 mt-1">

              จัดการราคาปกติและราคาพิเศษรายลูกค้า

            </p>

          </div>



          <div className="flex gap-3">



  <Link

  href="/pricing/import"

  className="bg-white border rounded-lg px-5 py-2 font-semibold"

>

  นำเข้า EXCEL

</Link>



<Link

    href="/pricing/favourites"

    className="bg-black text-white rounded-lg px-5 py-2 font-semibold"

  >  

    จัดการสินค้าซื้อประจำ

  </Link>



  <button

    onClick={loadPricing}

    className="bg-white border rounded-lg px-5 py-2"

  >

    รีเฟรช

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

                ค้นหาสินค้า

              </label>



              <input

                value={search}

                onChange={(event) =>

                  setSearch(

                    event.target.value

                  )

                }

                placeholder="SKU หรือชื่อสินค้า"

                className="w-full border rounded-lg px-4 py-3"

              />



            </div>



            <div>



              <label className="block text-sm font-medium mb-2">

                ดูราคาตามลูกค้า

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

                  แสดงเฉพาะราคาปกติ

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

                        ? " · ไม่ใช้งาน"

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

              กำลังดูราคาที่ใช้จริงสำหรับ

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

              รายการราคาสินค้า

            </h2>



            <span className="text-sm text-gray-500">

              {filteredProducts.length} รายการ

            </span>



          </div>



          <div className="overflow-x-auto">



            <table className="w-full">



              <thead className="bg-gray-50">



                <tr>



                  <th className="p-4 text-left">

                    สินค้า

                  </th>



                  <th className="p-4 text-left">

                    หน่วย

                  </th>



                  <th className="p-4 text-right">

                    ราคาปกติ

                  </th>



                  {selectedCustomer && (

                    <>

                      <th className="p-4 text-right">

                        ราคาพิเศษ

                      </th>



                      <th className="p-4 text-right">

                        ราคาที่ใช้จริง

                      </th>

                    </>

                  )}



                  <th className="p-4 text-right">

                    การดำเนินการ

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

                                  placeholder="ไม่มี"

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

                                  ? "ราคาพิเศษ"

                                  : "ราคาปกติ"}

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

                              บันทึกราคาปกติ

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

                                  บันทึกราคาพิเศษ

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

                                    ลบ

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