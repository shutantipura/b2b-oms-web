"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "../../lib/supabase";

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

export default function CustomersPage() {
  const [customers, setCustomers] =
    useState<Customer[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [message, setMessage] =
    useState("");

  const [search, setSearch] =
    useState("");

  const [statusFilter, setStatusFilter] =
    useState("all");

  async function loadCustomers() {
    setLoading(true);
    setMessage("");

    const { data, error } =
      await supabase
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
        .order("customer_name", {
          ascending: true,
        });

    if (error) {
      console.error(error);

      setMessage(
        "Could not load customers: " +
          error.message
      );

      setLoading(false);
      return;
    }

    setCustomers(
      (data ?? []) as Customer[]
    );

    setLoading(false);
  }

  useEffect(() => {
    loadCustomers();
  }, []);

  const filteredCustomers =
    useMemo(() => {
      const searchText =
        search.trim().toLowerCase();

      return customers.filter(
        (customer) => {
          const matchesStatus =
  statusFilter === "all" ||
  (statusFilter === "active"
    ? customer.is_active
    : !customer.is_active);

          const matchesSearch =
            searchText === "" ||
            customer.customer_name
              .toLowerCase()
              .includes(searchText) ||
            customer.customer_code
              .toLowerCase()
              .includes(searchText) ||
            customer.phone
              ?.toLowerCase()
              .includes(searchText) ||
            customer.contact_name
              ?.toLowerCase()
              .includes(searchText);

          return (
            matchesStatus &&
            matchesSearch
          );
        }
      );
    }, [
      customers,
      search,
      statusFilter,
    ]);

  const activeCount =
  customers.filter(
    (customer) => customer.is_active
  ).length;

const inactiveCount =
  customers.filter(
    (customer) => !customer.is_active
  ).length;

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-100 p-8">
        Loading customers...
      </main>
    );
  }

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
              Customers
            </h1>

            <p className="text-gray-500 mt-1">
              Manage B2B customer accounts.
            </p>
          </div>

          <div className="flex gap-3">

            <button
              onClick={loadCustomers}
              className="bg-white border rounded-lg px-5 py-2"
            >
              Refresh
            </button>

            <Link
              href="/customers/new"
              className="bg-black text-white rounded-lg px-5 py-2 font-semibold"
            >
              + CREATE CUSTOMER
            </Link>

          </div>

        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">

          <div className="bg-white border rounded-2xl p-5">
            <p className="text-sm text-gray-500">
              Total Customers
            </p>

            <p className="text-3xl font-bold mt-2">
              {customers.length}
            </p>
          </div>

          <div className="bg-white border rounded-2xl p-5">
            <p className="text-sm text-gray-500">
              Active
            </p>

            <p className="text-3xl font-bold mt-2">
              {activeCount}
            </p>
          </div>

          <div className="bg-white border rounded-2xl p-5">
            <p className="text-sm text-gray-500">
              Inactive
            </p>

            <p className="text-3xl font-bold mt-2">
              {inactiveCount}
            </p>
          </div>

        </div>

        <section className="bg-white border rounded-2xl p-5 mb-6">

          <div className="grid md:grid-cols-2 gap-4">

            <div>
              <label className="block text-sm font-medium mb-2">
                Search
              </label>

              <input
                type="text"
                value={search}
                onChange={(event) =>
                  setSearch(
                    event.target.value
                  )
                }
                placeholder="Customer name, code, contact or phone"
                className="w-full border rounded-lg px-4 py-3"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">
                Status
              </label>

              <select
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(
                    event.target.value
                  )
                }
                className="w-full border rounded-lg px-4 py-3 bg-white"
              >
                <option value="all">
                  All Customers
                </option>

                <option value="active">
                  Active
                </option>

                <option value="inactive">
                  Inactive
                </option>
              </select>
            </div>

          </div>

        </section>

        {message && (
          <div className="bg-white border rounded-lg p-4 mb-6 text-red-600">
            {message}
          </div>
        )}

        <section className="bg-white border rounded-2xl overflow-hidden">

          <div className="p-5 border-b flex justify-between">

            <h2 className="font-bold text-lg">
              Customer Directory
            </h2>

            <span className="text-gray-500 text-sm">
              {filteredCustomers.length} customers
            </span>

          </div>

          {filteredCustomers.length === 0 ? (
            <div className="p-8 text-gray-500">
              No customers found.
            </div>
          ) : (
            <div className="overflow-x-auto">

              <table className="w-full">

                <thead className="bg-gray-50">
                  <tr>
                    <th className="p-4 text-left">
                      Customer
                    </th>

                    <th className="p-4 text-left">
                      Type
                    </th>

                    <th className="p-4 text-left">
                      Contact
                    </th>

                    <th className="p-4 text-left">
                      Address
                    </th>

                    <th className="p-4 text-left">
                      Status
                    </th>

                    <th className="p-4 text-right">
                      Action
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {filteredCustomers.map(
                    (customer) => (
                      <tr
                        key={customer.id}
                        className="border-t"
                      >
                        <td className="p-4">
                          <div className="font-semibold">
                            {customer.customer_name}
                          </div>

                          <div className="text-sm text-gray-500">
                            {customer.customer_code}
                          </div>
                        </td>

                        <td className="p-4">
                          {prettyText(
                            customer.customer_type
                          )}
                        </td>

                        <td className="p-4">
                          <div>
                            {customer.contact_name ??
                              "—"}
                          </div>

                          <div className="text-sm text-gray-500">
                            {customer.phone ?? ""}
                          </div>
                        </td>

                        <td className="p-4 max-w-xs">
                          <div className="truncate">
                            {customer.delivery_address ??
                              "—"}
                          </div>
                        </td>

                        <td className="p-4">
                          <span className="inline-block bg-gray-100 rounded-full px-3 py-1 text-sm font-medium">
                            {customer.is_active
  ? "Active"
  : "Inactive"}
                          </span>
                        </td>

                        <td className="p-4 text-right">
                          <Link
                            href={`/customers/${customer.customer_code}`}
                            className="inline-block bg-white border rounded-lg px-4 py-2 font-semibold"
                          >
                            VIEW
                          </Link>
                        </td>
                      </tr>
                    )
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