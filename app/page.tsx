"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../lib/supabase";

type StaffProfile = {
  staff_code: string;
  staff_name: string;
  account_type: string;
};

export default function Home() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [staff, setStaff] = useState<StaffProfile | null>(null);

  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  async function loadStaff() {
    setLoading(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setStaff(null);
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from("staff")
      .select("staff_code, staff_name, account_type")
      .eq("auth_user_id", user.id)
      .single();

    if (error) {
      console.error(error);
      setMessage(
        "Login worked, but your staff profile could not be loaded: " +
          error.message
      );
      setStaff(null);
    } else {
      setStaff(data);
      setMessage("");
    }

    setLoading(false);
  }

  useEffect(() => {
    loadStaff();
  }, []);

  async function handleSignIn(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    setMessage("Signing in...");

    const { error } =
      await supabase.auth.signInWithPassword({
        email,
        password,
      });

    if (error) {
      setMessage(error.message);
      return;
    }

    await loadStaff();
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    setStaff(null);
    setEmail("");
    setPassword("");
    setMessage("");
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-100 flex items-center justify-center">
        <p className="text-xl">Loading B2B OMS...</p>
      </main>
    );
  }

  if (!staff) {
    return (
      <main className="min-h-screen bg-gray-100 flex items-center justify-center p-6">
        <div className="w-full max-w-md bg-white rounded-2xl shadow p-8">
          <h1 className="text-3xl font-bold mb-2">
            B2B OMS
          </h1>

          <p className="text-gray-500 mb-8">
            Staff & Manager Login
          </p>

          <form
            onSubmit={handleSignIn}
            className="space-y-5"
          >
            <div>
              <label className="block mb-2 font-medium">
                Email
              </label>

              <input
                type="email"
                value={email}
                onChange={(e) =>
                  setEmail(e.target.value)
                }
                className="w-full border rounded-lg px-4 py-3"
                required
              />
            </div>

            <div>
              <label className="block mb-2 font-medium">
                Password
              </label>

              <input
                type="password"
                value={password}
                onChange={(e) =>
                  setPassword(e.target.value)
                }
                className="w-full border rounded-lg px-4 py-3"
                required
              />
            </div>

            <button
              type="submit"
              className="w-full bg-black text-white rounded-lg py-3 font-semibold"
            >
              SIGN IN
            </button>
          </form>

          {message && (
            <p className="mt-5 text-sm text-red-600">
              {message}
            </p>
          )}
        </div>
      </main>
    );
  }

  const navigation =
    staff.account_type === "manager"
      ? [
          "Tasks",
          "Orders",
          "Control Tower",
          "Customers",
          "Pricing",
        ]
      : [
          "Tasks",
          "Orders",
          "Control Tower",
        ];

  return (
    <main className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex justify-between items-start mb-10">
          <div>
            <h1 className="text-3xl font-bold">
              Hello, {staff.staff_name} 👋
            </h1>

            <p className="text-gray-500 mt-2">
              {staff.staff_code} ·{" "}
              {staff.account_type === "manager"
                ? "Manager"
                : "Staff"}
            </p>
          </div>

          <button
            onClick={handleSignOut}
            className="bg-white border rounded-lg px-4 py-2"
          >
            Sign Out
          </button>
        </div>

        <h2 className="text-xl font-semibold mb-5">
          B2B OMS
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {navigation.map((item) => {
  let href = "";

  if (item === "Tasks") {
    href = "/tasks";
  }

  if (item === "Orders") {
    href = "/orders";
  }

  if (item === "Customers") {
  href = "/customers";
}

  if (href) {
    return (
      <Link
        key={item}
        href={href}
        className="bg-white border rounded-xl p-7 text-left font-semibold hover:shadow"
      >
        {item}
      </Link>
    );
  }

  return (
    <button
      key={item}
      className="bg-white border rounded-xl p-7 text-left font-semibold hover:shadow"
    >
      {item}
    </button>
  );
})}
        </div>

        <div className="bg-white border rounded-xl p-6 mt-8">
          <p className="font-semibold">
            Supabase connection successful.
          </p>

          <p className="text-gray-500 mt-2">
            Your authenticated account is linked to
            the OMS staff database.
          </p>
        </div>
      </div>
    </main>
  );
}