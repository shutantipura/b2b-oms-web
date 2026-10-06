"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabase";

export default function NewCustomerPage() {
  const router = useRouter();

  const [customerCode, setCustomerCode] =
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

  const [saving, setSaving] =
    useState(false);

  const [message, setMessage] =
    useState("");

  async function createCustomer(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    setMessage("");

    const code =
      customerCode.trim().toUpperCase();

    const name =
      customerName.trim();

    if (!code) {
      setMessage(
        "Customer code is required."
      );
      return;
    }

    if (!name) {
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

    // Check whether customer code already exists
    const {
      data: existingCustomer,
      error: checkError,
    } = await supabase
      .from("customers")
      .select("id")
      .eq("customer_code", code)
      .maybeSingle();

    if (checkError) {
      setMessage(
        "Could not check customer code: " +
          checkError.message
      );

      setSaving(false);
      return;
    }

    if (existingCustomer) {
      setMessage(
        `Customer code ${code} already exists.`
      );

      setSaving(false);
      return;
    }

    const {
      data,
      error,
    } = await supabase
      .from("customers")
      .insert({
        customer_code: code,
        customer_name: name,
        customer_type:
          customerType.trim() || null,
        contact_name:
          contactName.trim() || null,
        phone: phone.trim(),
        delivery_address:
          deliveryAddress.trim(),
        is_active: true,
      })
      .select("customer_code")
      .single();

    if (error) {
      setMessage(
        "Could not create customer: " +
          error.message
      );

      setSaving(false);
      return;
    }

    router.push(
      `/customers/${data.customer_code}`
    );

    router.refresh();
  }

  return (
    <main className="min-h-screen bg-gray-100 p-8">

      <div className="max-w-3xl mx-auto">

        <Link
          href="/customers"
          className="text-gray-500"
        >
          ← Back to Customers
        </Link>

        <div className="mt-4 mb-8">

          <p className="text-sm text-gray-500">
            CUSTOMER MANAGEMENT
          </p>

          <h1 className="text-3xl font-bold mt-1">
            Create Customer
          </h1>

          <p className="text-gray-500 mt-2">
            Create a new B2B customer account.
          </p>

        </div>

        <form
          onSubmit={createCustomer}
          className="bg-white border rounded-2xl p-6"
        >

          <div className="grid md:grid-cols-2 gap-5">

            <div>
              <label className="block font-medium mb-2">
                Customer Code *
              </label>

              <input
                type="text"
                value={customerCode}
                onChange={(event) =>
                  setCustomerCode(
                    event.target.value
                  )
                }
                placeholder="e.g. C002"
                className="w-full border rounded-lg px-4 py-3"
                required
              />

              <p className="text-xs text-gray-500 mt-2">
                Customer code becomes the permanent identifier and should not be changed later.
              </p>
            </div>

            <div>
              <label className="block font-medium mb-2">
                Customer Name *
              </label>

              <input
                type="text"
                value={customerName}
                onChange={(event) =>
                  setCustomerName(
                    event.target.value
                  )
                }
                placeholder="Restaurant or company name"
                className="w-full border rounded-lg px-4 py-3"
                required
              />
            </div>

            <div>
              <label className="block font-medium mb-2">
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
              <label className="block font-medium mb-2">
                Contact Person
              </label>

              <input
                type="text"
                value={contactName}
                onChange={(event) =>
                  setContactName(
                    event.target.value
                  )
                }
                placeholder="Main contact"
                className="w-full border rounded-lg px-4 py-3"
              />
            </div>

            <div className="md:col-span-2">

              <label className="block font-medium mb-2">
                Phone *
              </label>

              <input
                type="tel"
                value={phone}
                onChange={(event) =>
                  setPhone(
                    event.target.value
                  )
                }
                placeholder="0812345678"
                className="w-full border rounded-lg px-4 py-3"
                required
              />

            </div>

            <div className="md:col-span-2">

              <label className="block font-medium mb-2">
                Delivery Address *
              </label>

              <textarea
                value={deliveryAddress}
                onChange={(event) =>
                  setDeliveryAddress(
                    event.target.value
                  )
                }
                rows={4}
                placeholder="Full delivery address"
                className="w-full border rounded-lg px-4 py-3"
                required
              />

            </div>

          </div>

          {message && (
            <div className="mt-6 border rounded-lg p-4 text-red-600">
              {message}
            </div>
          )}

          <div className="flex justify-end gap-3 mt-8">

            <Link
              href="/customers"
              className="bg-white border rounded-lg px-6 py-3 font-semibold"
            >
              CANCEL
            </Link>

            <button
              type="submit"
              disabled={saving}
              className="bg-black text-white rounded-lg px-8 py-3 font-semibold disabled:opacity-40"
            >
              {saving
                ? "CREATING..."
                : "CREATE CUSTOMER"}
            </button>

          </div>

        </form>

      </div>

    </main>
  );
}