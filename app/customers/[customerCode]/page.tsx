"use client";



import { useEffect, useMemo, useState } from "react";

import Link from "next/link";

import { useParams, useRouter } from "next/navigation";

import { supabase } from "../../../lib/supabase";



type Customer = {

  id: string;

  customer_code: string;

  customer_name: string;

  customer_type: string | null;

  contact_name: string | null;

  phone: string | null;

  delivery_address: string | null;

  is_active: boolean;

};



type LineUser = {

  id: string;

  display_name: string;

  user_type: string;

};



type CustomerLineUser = {

  line_user_id: string;

  can_order: boolean;



  line_users: {

    id: string;

    display_name: string;

    user_type: string;

  } | null;

};



type CustomerOrder = {

  order_number: number;

  status: string;

  delivery_date: string | null;

  final_amount: number | string | null;

};



function prettyText(value: string | null) {

  if (!value) return "—";



  return value

    .split("_")

    .map(

      (word) =>

        word.charAt(0).toUpperCase() +

        word.slice(1)

    )

    .join(" ");

}



export default function CustomerDetailPage() {

  const params = useParams();

  const router = useRouter();



  const customerCode =

    String(params.customerCode).toUpperCase();



  const [customer, setCustomer] =

    useState<Customer | null>(null);



  const [linkedUsers, setLinkedUsers] =

    useState<CustomerLineUser[]>([]);



  const [allLineUsers, setAllLineUsers] =

    useState<LineUser[]>([]);



  const [orders, setOrders] =

    useState<CustomerOrder[]>([]);



  const [editing, setEditing] =

    useState(false);



  const [customerCodeInput, setCustomerCodeInput] =

    useState("");



  const [customerName, setCustomerName] =

    useState("");



  const [customerType, setCustomerType] =

    useState("");



  const [contactName, setContactName] =

    useState("");



  const [phone, setPhone] =

    useState("");



  const [deliveryAddress, setDeliveryAddress] =

    useState("");



  const [selectedLineUser, setSelectedLineUser] =

    useState("");



  const [loading, setLoading] =

    useState(true);



  const [saving, setSaving] =

    useState(false);



  const [message, setMessage] =

    useState("");



  async function loadCustomer() {

    setLoading(true);

    setMessage("");



    // ----------------------------

    // Customer

    // ----------------------------



    const {

      data: customerData,

      error: customerError,

    } = await supabase

      .from("customers")

      .select(`

        id,

        customer_code,

        customer_name,

        customer_type,

        contact_name,

        phone,

        delivery_address,

        is_active

      `)

      .eq("customer_code", customerCode)

      .single();



    if (customerError) {

      setMessage(

        "Could not load customer: " +

          customerError.message

      );



      setLoading(false);

      return;

    }



    const loadedCustomer =

      customerData as Customer;



    setCustomer(loadedCustomer);



    setCustomerName(

      loadedCustomer.customer_name

    );



    setCustomerType(

      loadedCustomer.customer_type ?? ""

    );



    setContactName(

      loadedCustomer.contact_name ?? ""

    );



    setPhone(

      loadedCustomer.phone ?? ""

    );



    setDeliveryAddress(

      loadedCustomer.delivery_address ?? ""

    );



    // ----------------------------

    // Linked LINE users

    // ----------------------------



    const {

      data: linkData,

      error: linkError,

    } = await supabase

      .from("customer_line_users")

      .select(`

        line_user_id,

        can_order,

        line_users (

          id,

          display_name,

          user_type

        )

      `)

      .eq(

        "customer_id",

        loadedCustomer.id

      );



    if (linkError) {

      setMessage(

        "Could not load LINE accounts: " +

          linkError.message

      );



      setLoading(false);

      return;

    }



    setLinkedUsers(

      (linkData ?? []) as unknown as CustomerLineUser[]

    );



    // ----------------------------

    // All available LINE users

    // ----------------------------



    const {

      data: lineData,

      error: lineError,

    } = await supabase

      .from("line_users")

      .select(`

        id,

        display_name,

        user_type

      `)

      .order("display_name", {

        ascending: true,

      });



    if (lineError) {

      setMessage(

        "Could not load LINE users: " +

          lineError.message

      );



      setLoading(false);

      return;

    }



    setAllLineUsers(

      (lineData ?? []) as LineUser[]

    );



    // ----------------------------

    // Recent orders

    // ----------------------------



    const {

      data: orderData,

      error: orderError,

    } = await supabase

      .from("orders")

      .select(`

        order_number,

        status,

        delivery_date,

        final_amount

      `)

      .eq(

        "customer_id",

        loadedCustomer.id

      )

      .order(

        "order_number",

        { ascending: false }

      )

      .limit(10);



    if (orderError) {

      setMessage(

        "Could not load orders: " +

          orderError.message

      );



      setLoading(false);

      return;

    }



    setOrders(

      (orderData ?? []) as CustomerOrder[]

    );



    setLoading(false);

  }



  useEffect(() => {

    loadCustomer();

  }, [customerCode]);



  const availableLineUsers =

    useMemo(() => {

      const linkedIds =

        new Set(

          linkedUsers.map(

            (link) =>

              link.line_user_id

          )

        );



      return allLineUsers.filter(

        (user) =>

          !linkedIds.has(user.id)

      );

    }, [

      allLineUsers,

      linkedUsers,

    ]);



  async function saveCustomer() {

    if (!customer) return;



    const nextCustomerCode =

      customerCodeInput.trim();



    const codeChanged =

      nextCustomerCode !==

      customer.customer_code;



    if (!nextCustomerCode) {

      setMessage(

        "CV Number is required."

      );

      return;

    }



    // The legacy ABC test account may remain C001.

    // Any changed / real customer CV Number must be exactly 10 digits.

    if (

      codeChanged &&

      !/^\d{10}$/.test(

        nextCustomerCode

      )

    ) {

      setMessage(

        "CV Number must contain exactly 10 digits."

      );

      return;

    }



    if (!customerName.trim()) {

      setMessage(

        "Customer name is required."

      );

      return;

    }



    if (!phone.trim()) {

      setMessage(

        "Phone number is required."

      );

      return;

    }



    if (!deliveryAddress.trim()) {

      setMessage(

        "Delivery address is required."

      );

      return;

    }



    setSaving(true);

    setMessage("");



    if (codeChanged) {

      const {

        data: duplicateCustomer,

        error: duplicateError,

      } = await supabase

        .from("customers")

        .select("id")

        .eq(

          "customer_code",

          nextCustomerCode

        )

        .neq(

          "id",

          customer.id

        )

        .limit(1)

        .maybeSingle();



      if (duplicateError) {

        setMessage(

          "Could not validate CV Number: " +

            duplicateError.message

        );

        setSaving(false);

        return;

      }



      if (duplicateCustomer) {

        setMessage(

          "This CV Number is already used by another customer."

        );

        setSaving(false);

        return;

      }

    }



    const { error } =

      await supabase

        .from("customers")

        .update({

          customer_code:

            nextCustomerCode,



          customer_name:

            customerName.trim(),



          customer_type:

            customerType || null,



          contact_name:

            contactName.trim() || null,



          phone:

            phone.trim(),



          delivery_address:

            deliveryAddress.trim(),

        })

        .eq(

          "id",

          customer.id

        );



    if (error) {

      setMessage(

        "Could not update customer: " +

          error.message

      );



      setSaving(false);

      return;

    }



    setEditing(false);

    setSaving(false);



    if (codeChanged) {

      router.replace(

        `/customers/${nextCustomerCode}`

      );

      return;

    }



    await loadCustomer();

  }

  async function toggleCustomerStatus() {

    if (!customer) return;



    const nextActive =

      !customer.is_active;



    const action =

      nextActive

        ? "reactivate"

        : "deactivate";



    const confirmed =

      window.confirm(

        `Are you sure you want to ${action} ${customer.customer_name}?`

      );



    if (!confirmed) {

      return;

    }



    const { error } =

      await supabase

        .from("customers")

        .update({

          is_active:

            nextActive,

        })

        .eq(

          "id",

          customer.id

        );



    if (error) {

      setMessage(

        "Could not change customer status: " +

          error.message

      );



      return;

    }



    await loadCustomer();

  }



  async function addLineUser() {

    if (

      !customer ||

      !selectedLineUser

    ) {

      setMessage(

        "Please select a LINE account."

      );

      return;

    }



    setMessage("");



    const { error } =

      await supabase

        .from("customer_line_users")

        .insert({

          customer_id:

            customer.id,



          line_user_id:

            selectedLineUser,



          can_order: true,

        });



    if (error) {

      setMessage(

        "Could not authorize LINE account: " +

          error.message

      );



      return;

    }



    setSelectedLineUser("");



    await loadCustomer();

  }



  async function toggleCanOrder(

    lineUserId: string,

    currentValue: boolean

  ) {

    if (!customer) return;



    const { error } =

      await supabase

        .from("customer_line_users")

        .update({

          can_order:

            !currentValue,

        })

        .eq(

          "customer_id",

          customer.id

        )

        .eq(

          "line_user_id",

          lineUserId

        );



    if (error) {

      setMessage(

        "Could not update LINE authorization: " +

          error.message

      );



      return;

    }



    await loadCustomer();

  }



  async function removeLineUser(

    lineUserId: string,

    displayName: string

  ) {

    if (!customer) return;



    const confirmed =

      window.confirm(

        `Remove ${displayName} from this customer account?`

      );



    if (!confirmed) {

      return;

    }



    const { error } =

      await supabase

        .from("customer_line_users")

        .delete()

        .eq(

          "customer_id",

          customer.id

        )

        .eq(

          "line_user_id",

          lineUserId

        );



    if (error) {

      setMessage(

        "Could not remove LINE account: " +

          error.message

      );



      return;

    }



    await loadCustomer();

  }



  if (loading) {

    return (

      <main className="min-h-screen bg-gray-100 p-8">

        Loading customer...

      </main>

    );

  }



  if (!customer) {

    return (

      <main className="min-h-screen bg-gray-100 p-8">

        Customer not found.

      </main>

    );

  }



  return (

    <main className="min-h-screen bg-gray-100 p-8">



      <div className="max-w-6xl mx-auto">



        <Link

          href="/customers"

          className="text-gray-500"

        >

          ← Back to Customers

        </Link>



        <div className="flex justify-between items-start mt-4 mb-8">



          <div>



            <p className="text-sm text-gray-500">

              CUSTOMER

            </p>



            <h1 className="text-3xl font-bold mt-1">

              {customer.customer_name}

            </h1>



            <p className="text-gray-500 mt-2">

              {customer.customer_code}

            </p>



          </div>



          <div className="text-right">



            <span className="inline-block bg-white border rounded-full px-4 py-2 font-semibold">

              {customer.is_active

                ? "Active"

                : "Inactive"}

            </span>



          </div>



        </div>



        {message && (

          <div className="bg-white border rounded-lg p-4 mb-6 text-red-600">

            {message}

          </div>

        )}



        {/* CUSTOMER DETAILS */}



        <section className="bg-white border rounded-2xl p-6 mb-6">



          <div className="flex justify-between items-center mb-6">



            <h2 className="font-bold text-lg">

              Customer Details

            </h2>



            {!editing && (

              <button

                onClick={() =>

                  setEditing(true)

                }

                className="bg-white border rounded-lg px-4 py-2 font-semibold"

              >

                EDIT CUSTOMER

              </button>

            )}



          </div>



          {editing ? (



            <div className="grid md:grid-cols-2 gap-5">

              <div>

                <label className="block text-sm font-medium mb-2">

                  CV Number

                </label>



                <input

                  value={customerCodeInput}

                  onChange={(event) =>

                    setCustomerCodeInput(

                      event.target.value

                        .replace(/\D/g, "")

                        .slice(0, 10)

                    )

                  }

                  inputMode="numeric"

                  maxLength={10}

                  className="w-full border rounded-lg px-4 py-3"

                  placeholder="10-digit CV Number"

                />



                <p className="text-xs text-gray-500 mt-2">

                  Real customer CV Numbers must contain exactly 10 digits. ABC Restaurant may remain C001 as the test account.

                </p>

              </div>



              <div>

                <label className="block text-sm font-medium mb-2">

                  Customer Name

                </label>



                <input

                  value={customerName}

                  onChange={(event) =>

                    setCustomerName(

                      event.target.value

                    )

                  }

                  className="w-full border rounded-lg px-4 py-3"

                />

              </div>



              <div>

                <label className="block text-sm font-medium mb-2">

                  Customer Type

                </label>



                <select

                  value={customerType}

                  onChange={(event) =>

                    setCustomerType(

                      event.target.value

                    )

                  }

                  className="w-full border rounded-lg px-4 py-3 bg-white"

                >

                  <option value="">

                    Select type

                  </option>



                  <option value="restaurant">

                    Restaurant

                  </option>



                  <option value="grocery">

                    Grocery / โชห่วย

                  </option>



                  <option value="hotel">

                    Hotel

                  </option>



                  <option value="cafe">

                    Cafe

                  </option>



                  <option value="other">

                    Other

                  </option>

                </select>

              </div>



              <div>

                <label className="block text-sm font-medium mb-2">

                  Contact Person

                </label>



                <input

                  value={contactName}

                  onChange={(event) =>

                    setContactName(

                      event.target.value

                    )

                  }

                  className="w-full border rounded-lg px-4 py-3"

                />

              </div>



              <div>

                <label className="block text-sm font-medium mb-2">

                  Phone

                </label>



                <input

                  value={phone}

                  onChange={(event) =>

                    setPhone(

                      event.target.value

                    )

                  }

                  className="w-full border rounded-lg px-4 py-3"

                />

              </div>



              <div className="md:col-span-2">



                <label className="block text-sm font-medium mb-2">

                  Delivery Address

                </label>



                <textarea

                  value={deliveryAddress}

                  onChange={(event) =>

                    setDeliveryAddress(

                      event.target.value

                    )

                  }

                  rows={4}

                  className="w-full border rounded-lg px-4 py-3"

                />



              </div>



              <div className="md:col-span-2 flex justify-end gap-3">



                <button

                  onClick={() => {

                    setEditing(false);



                    setCustomerCodeInput(

                      customer.customer_code

                    );



                    setCustomerName(

                      customer.customer_name

                    );



                    setCustomerType(

                      customer.customer_type ??

                        ""

                    );



                    setContactName(

                      customer.contact_name ??

                        ""

                    );



                    setPhone(

                      customer.phone ??

                        ""

                    );



                    setDeliveryAddress(

                      customer.delivery_address ??

                        ""

                    );

                  }}

                  className="bg-white border rounded-lg px-5 py-3"

                >

                  CANCEL

                </button>



                <button

                  onClick={saveCustomer}

                  disabled={saving}

                  className="bg-black text-white rounded-lg px-6 py-3 font-semibold disabled:opacity-40"

                >

                  {saving

                    ? "SAVING..."

                    : "SAVE CHANGES"}

                </button>



              </div>



            </div>



          ) : (



            <div className="grid md:grid-cols-2 gap-6">



              <div>

                <p className="text-sm text-gray-500">

                  CV Number

                </p>



                <p className="font-medium">

                  {customer.customer_code}

                </p>

              </div>



              <div>

                <p className="text-sm text-gray-500">

                  Customer Type

                </p>



                <p className="font-medium">

                  {prettyText(

                    customer.customer_type

                  )}

                </p>

              </div>



              <div>

                <p className="text-sm text-gray-500">

                  Contact Person

                </p>



                <p className="font-medium">

                  {customer.contact_name ??

                    "—"}

                </p>

              </div>



              <div>

                <p className="text-sm text-gray-500">

                  Phone

                </p>



                {customer.phone ? (

                  <a

                    href={`tel:${customer.phone}`}

                    className="font-medium underline"

                  >

                    {customer.phone}

                  </a>

                ) : (

                  <p>—</p>

                )}

              </div>



              <div className="md:col-span-2">

                <p className="text-sm text-gray-500">

                  Delivery Address

                </p>



                <p className="font-medium">

                  {customer.delivery_address ??

                    "—"}

                </p>

              </div>



            </div>



          )}



        </section>



        {/* LINE ACCOUNTS */}



        <section className="bg-white border rounded-2xl p-6 mb-6">



          <h2 className="font-bold text-lg">

            Authorized LINE Accounts

          </h2>



          <p className="text-sm text-gray-500 mt-1 mb-5">

            Multiple LINE users can be linked to one customer account.

          </p>



          {linkedUsers.length === 0 ? (



            <p className="text-gray-500 mb-6">

              No LINE accounts linked.

            </p>



          ) : (



            <div className="space-y-3 mb-6">



              {linkedUsers.map(

                (link) => {



                  const line =

                    link.line_users;



                  return (

                    <div

                      key={link.line_user_id}

                      className="border rounded-xl p-4 flex flex-col md:flex-row md:justify-between md:items-center gap-4"

                    >



                      <div>



                        <p className="font-semibold">

                          {line?.display_name ??

                            "Unknown LINE user"}

                        </p>



                        <p className="text-sm text-gray-500">

                          {prettyText(

                            line?.user_type ??

                              null

                          )}

                        </p>



                        <p className="text-sm mt-1">

                          {link.can_order

                            ? "✓ Can order"

                            : "Cannot order"}

                        </p>



                      </div>



                      <div className="flex gap-2">



                        <button

                          onClick={() =>

                            toggleCanOrder(

                              link.line_user_id,

                              link.can_order

                            )

                          }

                          className="bg-white border rounded-lg px-4 py-2"

                        >

                          {link.can_order

                            ? "DEAUTHORIZE"

                            : "AUTHORIZE"}

                        </button>



                        <button

                          onClick={() =>

                            removeLineUser(

                              link.line_user_id,

                              line?.display_name ??

                                "this LINE user"

                            )

                          }

                          className="bg-white border rounded-lg px-4 py-2"

                        >

                          REMOVE

                        </button>



                      </div>



                    </div>

                  );

                }

              )}



            </div>



          )}



          <div className="border-t pt-5">



            <p className="font-medium mb-3">

              Add LINE Account

            </p>



            <div className="flex flex-col md:flex-row gap-3">



              <select

                value={selectedLineUser}

                onChange={(event) =>

                  setSelectedLineUser(

                    event.target.value

                  )

                }

                className="flex-1 border rounded-lg px-4 py-3 bg-white"

              >



                <option value="">

                  Select LINE account

                </option>



                {availableLineUsers.map(

                  (user) => (

                    <option

                      key={user.id}

                      value={user.id}

                    >

                      {user.display_name}

                      {" · "}

                      {prettyText(

                        user.user_type

                      )}

                    </option>

                  )

                )}



              </select>



              <button

                onClick={addLineUser}

                disabled={!selectedLineUser}

                className="bg-black text-white rounded-lg px-6 py-3 font-semibold disabled:opacity-30"

              >

                AUTHORIZE LINE ACCOUNT

              </button>



            </div>



          </div>



        </section>



        {/* ORDERS */}



        <section className="bg-white border rounded-2xl overflow-hidden mb-6">



          <div className="p-6 border-b">



            <h2 className="font-bold text-lg">

              Recent Orders

            </h2>



          </div>



          {orders.length === 0 ? (



            <div className="p-6 text-gray-500">

              No orders for this customer yet.

            </div>



          ) : (



            <div>



              {orders.map((order) => (



                <div

                  key={order.order_number}

                  className="p-5 border-b last:border-b-0 flex justify-between items-center"

                >



                  <div>



                    <Link

                      href={`/orders/${order.order_number}`}

                      className="font-semibold underline"

                    >

                      Order #{order.order_number}

                    </Link>



                    <p className="text-sm text-gray-500 mt-1">

                      {order.delivery_date ??

                        "No delivery date"}

                      {" · "}

                      {prettyText(

                        order.status

                      )}

                    </p>



                  </div>



                  <div className="font-semibold">



                    {order.final_amount !==

                    null

                      ? `฿${Number(

                          order.final_amount

                        ).toFixed(2)}`

                      : "—"}



                  </div>



                </div>



              ))}



            </div>



          )}



        </section>



        {/* ACCOUNT STATUS */}



        <section className="bg-white border rounded-2xl p-6">



          <h2 className="font-bold text-lg">

            Account Status

          </h2>



          <p className="text-gray-500 mt-1">

            Inactive customers cannot place new orders, but historical data is retained.

          </p>



          <div className="flex justify-between items-center mt-6">



            <div>



              <p className="font-semibold">

                Current status

              </p>



              <p className="mt-1">

                {customer.is_active

                  ? "Active"

                  : "Inactive"}

              </p>



            </div>



            <button

              onClick={toggleCustomerStatus}

              className="bg-white border rounded-lg px-5 py-3 font-semibold"

            >

              {customer.is_active

                ? "DEACTIVATE CUSTOMER"

                : "REACTIVATE CUSTOMER"}

            </button>



          </div>



        </section>



      </div>



    </main>

  );

}