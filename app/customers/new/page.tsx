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

function isValidWebUrl(
  value: string
) {
  try {
    const url =
      new URL(value);

    return (
      url.protocol === "https:" ||
      url.protocol === "http:"
    );
  } catch {
    return false;
  }
}

export default function NewCustomerPage() {
  const router =
    useRouter();

  const [
    customerCode,
    setCustomerCode,
  ] =
    useState("");

  const [noCv, setNoCv] = useState(false);

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
    deliveryMapUrl,
    setDeliveryMapUrl,
  ] =
    useState("");

  const [deliveryMapUrl2, setDeliveryMapUrl2] = useState("");
  const [locationName1, setLocationName1] = useState("จุดส่ง 1");
  const [locationName2, setLocationName2] = useState("จุดส่ง 2");
  const [
    riderNote,
    setRiderNote,
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

    const code = noCv
      ? "NCV-" + crypto.randomUUID().replace(/-/g, "").slice(0, 16).toUpperCase()
      : customerCode.trim().toUpperCase();

    const name =
      customerName.trim();

    const mapUrl =
      deliveryMapUrl.trim();

    if (!noCv && !code) {
      setMessage(
        "กรุณากรอกเลข CV"
      );
      return;
    }

    if (
      !noCv &&
      code !== "C001" &&
      !/^\d{10}$/.test(code)
    ) {
      setMessage(
        "เลข CV ต้องเป็นตัวเลข 10 หลัก"
      );
      return;
    }

    if (!name) {
      setMessage(
        "กรุณากรอกชื่อร้าน"
      );
      return;
    }

    if (!phone.trim()) {
      setMessage(
        "กรุณากรอกเบอร์โทรศัพท์"
      );
      return;
    }

    if (!mapUrl) {
      setMessage(
        "กรุณากรอกลิงก์ Google Maps"
      );
      return;
    }

    if (!isValidWebUrl(mapUrl)) {
      setMessage(
        "ลิงก์ Google Maps ต้องขึ้นต้นด้วย http:// หรือ https://"
      );
      return;
    }

    if (deliveryMapUrl2.trim() && (!isValidWebUrl(deliveryMapUrl2.trim()) || deliveryMapUrl2.trim() === mapUrl)) {
      setMessage("ลิงก์จุดส่งที่ 2 ไม่ถูกต้องหรือซ้ำกับจุดส่งที่ 1");
      return;
    }
    setSaving(true);

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

    if (checkError) {
      setMessage(
        "ไม่สามารถตรวจสอบเลข CV ได้: " +
          checkError.message
      );
      setSaving(false);
      return;
    }

    if (existingCustomer) {
      setMessage(
        `เลข CV ${code} มีอยู่ในระบบแล้ว`
      );
      setSaving(false);
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

          has_no_cv: noCv,

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

          delivery_map_url:
            mapUrl,
          delivery_map_url_2: deliveryMapUrl2.trim() || null,
          delivery_location_1_name: locationName1.trim() || "จุดส่ง 1",
          delivery_location_2_name: locationName2.trim() || "จุดส่ง 2",

          rider_note:
            riderNote.trim() ||
            null,

          // Temporary compatibility mirror for older flows.
          delivery_address:
            mapUrl,

          is_active:
            true,
        })
        .select(
          "customer_code"
        )
        .single();

    if (error) {
      setMessage(
        "ไม่สามารถสร้างลูกค้าได้: " +
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
            <div className="md:col-span-2 rounded-xl border border-[#B8EAE5] bg-[#F4FBFA] p-4">
              <label className="flex items-center gap-3 text-sm font-semibold text-[#173F3C]">
                <input type="checkbox" checked={noCv} onChange={(event) => setNoCv(event.target.checked)} className="h-4 w-4 accent-[#00BCB4]" />
                ไม่มีเลข CV (No CV)
              </label>
              <p className="mt-2 text-xs text-[#52786F]">ระบบจะสร้างรหัสภายในเพื่อใช้งาน OMS โดยอัตโนมัติ ไม่ใช่เลข CV จริง</p>
            </div>
            {!noCv && <div>
              <label className="block font-medium mb-2">
                เลข CV *
              </label>

              <input
                type="text"
                value={customerCode}
                onChange={(event) =>
                  setCustomerCode(
                    event.target.value
                  )
                }
                placeholder="เช่น 1234567890"
                className="w-full border rounded-lg px-4 py-3"
                required
              />

              <p className="text-xs text-gray-500 mt-2">
                กรอกเลข CV จริง 10 หลัก
              </p>
            </div>}

            <div>
              <label className="block font-medium mb-2">
                ชื่อร้าน *
              </label>

              <input
                type="text"
                value={customerName}
                onChange={(event) =>
                  setCustomerName(
                    event.target.value
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
                value={customerType}
                onChange={(event) =>
                  setCustomerType(
                    event.target.value
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
                {noCv ? "ชื่อผู้ติดต่อหลัก" : "ชื่อลูกค้า CV"}
              </label>

              <input
                type="text"
                value={contactName}
                onChange={(event) =>
                  setContactName(
                    event.target.value
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
                ลิงก์ Google Maps จุดส่งที่ 1 *
              </label>

              <input
                type="url"
                value={deliveryMapUrl}
                onChange={(event) =>
                  setDeliveryMapUrl(
                    event.target.value
                  )
                }
                placeholder="https://maps.app.goo.gl/..."
                className="w-full border rounded-lg px-4 py-3"
                required
              />

              <p className="text-xs text-gray-500 mt-2">
                ไรเดอร์จะกดลิงก์นี้เพื่อเปิดตำแหน่งจัดส่งโดยตรง
              </p>
            </div>

            <div className="md:col-span-2 rounded-xl border border-[#D5EAE5] bg-[#F4FBF9] p-3">
              <p className="mb-3 font-bold text-[#006F69]">จุดจัดส่ง (สูงสุด 2 จุด)</p>
              <label className="mb-1 block text-sm">ชื่อจุดส่งที่ 1</label>
              <input value={locationName1} maxLength={50} onChange={e => setLocationName1(e.target.value)}
                className="mb-3 w-full rounded-lg border px-3 py-2.5" placeholder="หน้าร้าน" />
              <label className="mb-1 block text-sm">ชื่อจุดส่งที่ 2 (ไม่บังคับ)</label>
              <input value={locationName2} maxLength={50} onChange={e => setLocationName2(e.target.value)}
                className="mb-3 w-full rounded-lg border px-3 py-2.5" placeholder="ครัวกลาง" />
              <input type="url" value={deliveryMapUrl2} onChange={e => setDeliveryMapUrl2(e.target.value)}
                className="w-full rounded-lg border px-3 py-2.5" placeholder="ลิงก์ Google Maps จุดส่งที่ 2" />
            </div>
            <div className="md:col-span-2"><label className="block font-medium mb-2">หมายเหตุถึงไรเดอร์
              </label>

              <textarea
                value={riderNote}
                onChange={(event) =>
                  setRiderNote(
                    event.target.value
                  )
                }
                rows={3}
                placeholder="เช่น เข้าทางประตูหลัง โทรหาลูกค้าก่อนถึง 10 นาที หรือจอดส่งของด้านข้างร้าน"
                className="w-full border rounded-lg px-4 py-3"
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
              ยกเลิก
            </Link>

            <button
              type="submit"
              disabled={saving}
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
