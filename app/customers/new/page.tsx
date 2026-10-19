"use client";

import {
  FormEvent,
  useState,
} from "react";

import Link from "next/link";

import {
  useRouter,
} from "next/navigation";

import {
  supabase,
} from "../../../lib/supabase";

export default function NewCustomerPage() {
  const router =
    useRouter();

  const [
    customerCode,
    setCustomerCode,
  ] =
    useState("");

  const [
    customerName,
    setCustomerName,
  ] =
    useState("");

  const [
    customerType,
    setCustomerType,
  ] =
    useState("");

  const [
    contactName,
    setContactName,
  ] =
    useState("");

  const [
    phone,
    setPhone,
  ] =
    useState("");

  const [
    deliveryAddress,
    setDeliveryAddress,
  ] =
    useState("");

  const [
    saving,
    setSaving,
  ] =
    useState(false);

  const [
    message,
    setMessage,
  ] =
    useState("");

  async function createCustomer(
    event:
      FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    setMessage("");

    const code =
      customerCode
        .trim()
        .toUpperCase();

    const name =
      customerName.trim();

    if (!code) {
      setMessage(
        "กรุณากรอกเลข CV"
      );

      return;
    }

    if (!name) {
      setMessage(
        "กรุณากรอกชื่อร้าน"
      );

      return;
    }

    if (
      !phone.trim()
    ) {
      setMessage(
        "กรุณากรอกเบอร์โทรศัพท์"
      );

      return;
    }

    if (
      !deliveryAddress.trim()
    ) {
      setMessage(
        "กรุณากรอกที่อยู่จัดส่ง"
      );

      return;
    }

    setSaving(
      true
    );

    // ตรวจสอบว่าเลข CV มีอยู่แล้วหรือไม่
    const {
      data:
        existingCustomer,
      error:
        checkError,
    } =
      await supabase
        .from(
          "customers"
        )
        .select(
          "id"
        )
        .eq(
          "customer_code",
          code
        )
        .maybeSingle();

    if (
      checkError
    ) {
      setMessage(
        "ไม่สามารถตรวจสอบเลข CV ได้: " +
          checkError.message
      );

      setSaving(
        false
      );

      return;
    }

    if (
      existingCustomer
    ) {
      setMessage(
        `เลข CV ${code} มีอยู่ในระบบแล้ว`
      );

      setSaving(
        false
      );

      return;
    }

    const {
      data,
      error,
    } =
      await supabase
        .from(
          "customers"
        )
        .insert({
          customer_code:
            code,

          customer_name:
            name,

          customer_type:
            customerType
              .trim() ||
            null,

          contact_name:
            contactName
              .trim() ||
            null,

          phone:
            phone.trim(),

          delivery_address:
            deliveryAddress
              .trim(),

          is_active:
            true,
        })
        .select(
          "customer_code"
        )
        .single();

    if (
      error
    ) {
      setMessage(
        "ไม่สามารถสร้างลูกค้าได้: " +
          error.message
      );

      setSaving(
        false
      );

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
          ← กลับไปหน้าลูกค้า
        </Link>

        <div className="mt-4 mb-8">

          <p className="text-sm text-gray-500">
            จัดการลูกค้า
          </p>

          <h1 className="text-3xl font-bold mt-1">
            สร้างลูกค้าใหม่
          </h1>

          <p className="text-gray-500 mt-2">
            สร้างบัญชีลูกค้า B2B ใหม่
          </p>

        </div>

        <form
          onSubmit={
            createCustomer
          }
          className="bg-white border rounded-2xl p-6"
        >

          <div className="grid md:grid-cols-2 gap-5">

            <div>

              <label className="block font-medium mb-2">
                เลข CV *
              </label>

              <input
                type="text"
                value={
                  customerCode
                }
                onChange={(
                  event
                ) =>
                  setCustomerCode(
                    event
                      .target
                      .value
                  )
                }
                placeholder="เช่น 1234567890"
                className="w-full border rounded-lg px-4 py-3"
                required
              />

              <p className="text-xs text-gray-500 mt-2">
                เลข CV ใช้เป็นรหัสประจำตัวลูกค้าในระบบ
              </p>

            </div>

            <div>

              <label className="block font-medium mb-2">
                ชื่อร้าน *
              </label>

              <input
                type="text"
                value={
                  customerName
                }
                onChange={(
                  event
                ) =>
                  setCustomerName(
                    event
                      .target
                      .value
                  )
                }
                placeholder="ชื่อร้านหรือชื่อบริษัท"
                className="w-full border rounded-lg px-4 py-3"
                required
              />

            </div>

            <div>

              <label className="block font-medium mb-2">
                ประเภทลูกค้า
              </label>

              <select
                value={
                  customerType
                }
                onChange={(
                  event
                ) =>
                  setCustomerType(
                    event
                      .target
                      .value
                  )
                }
                className="w-full border rounded-lg px-4 py-3 bg-white"
              >

                <option value="">
                  เลือกประเภทลูกค้า
                </option>

                <option value="restaurant">
                  ร้านอาหาร
                </option>

                <option value="grocery">
                  ร้านโชห่วย
                </option>

                <option value="hotel">
                  โรงแรม
                </option>

                <option value="cafe">
                  คาเฟ่
                </option>

                <option value="other">
                  อื่น ๆ
                </option>

              </select>

            </div>

            <div>

              <label className="block font-medium mb-2">
                ชื่อลูกค้า CV
              </label>

              <input
                type="text"
                value={
                  contactName
                }
                onChange={(
                  event
                ) =>
                  setContactName(
                    event
                      .target
                      .value
                  )
                }
                placeholder="ชื่อผู้ติดต่อหลัก"
                className="w-full border rounded-lg px-4 py-3"
              />

            </div>

            <div className="md:col-span-2">

              <label className="block font-medium mb-2">
                เบอร์โทรศัพท์ *
              </label>

              <input
                type="tel"
                value={
                  phone
                }
                onChange={(
                  event
                ) =>
                  setPhone(
                    event
                      .target
                      .value
                  )
                }
                placeholder="0812345678"
                className="w-full border rounded-lg px-4 py-3"
                required
              />

            </div>

            <div className="md:col-span-2">

              <label className="block font-medium mb-2">
                ที่อยู่จัดส่ง *
              </label>

              <textarea
                value={
                  deliveryAddress
                }
                onChange={(
                  event
                ) =>
                  setDeliveryAddress(
                    event
                      .target
                      .value
                  )
                }
                rows={
                  4
                }
                placeholder="กรอกที่อยู่สำหรับจัดส่งสินค้า"
                className="w-full border rounded-lg px-4 py-3"
                required
              />

            </div>

          </div>

          {message && (

            <div className="mt-6 border rounded-lg p-4 text-red-600">
              {
                message
              }
            </div>

          )}

          <div className="flex justify-end gap-3 mt-8">

            <Link
              href="/customers"
              className="bg-white border rounded-lg px-6 py-3 font-semibold"
            >
              ยกเลิก
            </Link>

            <button
              type="submit"
              disabled={
                saving
              }
              className="bg-black text-white rounded-lg px-8 py-3 font-semibold disabled:opacity-40"
            >
              {saving
                ? "กำลังสร้าง..."
                : "สร้างลูกค้า"}
            </button>

          </div>

        </form>

      </div>

    </main>
  );
}