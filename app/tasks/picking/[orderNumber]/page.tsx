"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "../../../../lib/supabase";

type OrderDetails = {
  id: string;
  order_number: number;
  delivery_date: string | null;
  delivery_slot: string | null;
  delivery_address: string | null;
  customer_notes: string | null;
  customers: {
    customer_name: string;
    contact_name: string | null;
    phone: string | null;
  } | null;
};

type OrderItem = {
  id: string;
  product_name_snapshot: string;
  confirmed_qty: number | string;
  actual_qty: number | string | null;
  unit_snapshot: string;
  products: {
    sku: string;
  } | null;
};

export default function PickingPage() {
  const params = useParams();
  const router = useRouter();

  const orderNumber = Number(params.orderNumber);

  const [order, setOrder] = useState<OrderDetails | null>(null);
  const [items, setItems] = useState<OrderItem[]>([]);
  const [actual, setActual] = useState<Record<string, string>>({});
  const [cartPhoto, setCartPhoto] = useState<File | null>(null);
  const [photoUploaded, setPhotoUploaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  async function loadOrder() {
    setLoading(true);
    setMessage("");

    const {
      data: orderData,
      error: orderError,
    } = await supabase
      .from("orders")
      .select(`
        id,
        order_number,
        delivery_date,
        delivery_slot,
        delivery_address,
        customer_notes,
        customers (
          customer_name,
          contact_name,
          phone
        )
      `)
      .eq("order_number", orderNumber)
      .single();

    if (orderError) {
      setMessage(
        "ไม่สามารถโหลดคำสั่งซื้อได้: " +
          orderError.message
      );
      setLoading(false);
      return;
    }

    setOrder(
      orderData as unknown as OrderDetails
    );

    const {
      data: itemData,
      error: itemError,
    } = await supabase
      .from("order_items")
      .select(`
        id,
        product_name_snapshot,
        confirmed_qty,
        actual_qty,
        unit_snapshot,
        products (
          sku
        )
      `)
      .eq("order_id", orderData.id)
      .order(
        "product_name_snapshot",
        { ascending: true }
      );

    if (itemError) {
      setMessage(
        "ไม่สามารถโหลดรายการสินค้าได้: " +
          itemError.message
      );
      setLoading(false);
      return;
    }

    const loadedItems =
      (itemData ?? []) as unknown as OrderItem[];

    setItems(loadedItems);

    const initialActual:
      Record<string, string> = {};

    loadedItems.forEach((item) => {
      initialActual[item.id] =
        String(
          item.actual_qty ??
          item.confirmed_qty
        );
    });

    setActual(initialActual);

    // Check whether a current cart photo already exists
    const {
      data: existingPhoto,
      error: photoError,
    } = await supabase
      .from("order_files")
      .select("id")
      .eq("order_id", orderData.id)
      .eq("file_type", "cart_photo")
      .eq("is_current", true)
      .maybeSingle();

    if (!photoError && existingPhoto) {
      setPhotoUploaded(true);
    }

    setLoading(false);
  }

  useEffect(() => {
    if (!Number.isNaN(orderNumber)) {
      loadOrder();
    }
  }, [orderNumber]);

  async function uploadCartPhoto() {
    if (!cartPhoto) {
      setMessage(
        "กรุณาเลือกรูปรถเข็นสินค้าก่อน"
      );
      return;
    }

    setMessage("กำลังอัปโหลดรูปรถเข็นสินค้า...");

    const extension =
      cartPhoto.name.split(".").pop() || "jpg";

    const storagePath =
      `orders/${orderNumber}/cart_photo/` +
      `${crypto.randomUUID()}.${extension}`;

    const { error: uploadError } =
      await supabase.storage
        .from("order-files")
        .upload(
          storagePath,
          cartPhoto,
          {
            upsert: false,
            contentType:
              cartPhoto.type ||
              "image/jpeg",
          }
        );

    if (uploadError) {
      setMessage(
        "อัปโหลดรูปไม่สำเร็จ: " +
          uploadError.message
      );
      return;
    }

    const { error: registerError } =
      await supabase.rpc(
        "register_my_order_file",
        {
          p_order_number: orderNumber,
          p_file_type: "cart_photo",
          p_storage_path: storagePath,
          p_original_filename:
            cartPhoto.name,
          p_mime_type:
            cartPhoto.type ||
            "image/jpeg",
        }
      );

    if (registerError) {
      setMessage(
        "อัปโหลดรูปสำเร็จ แต่บันทึกข้อมูลไฟล์ไม่สำเร็จ: " +
          registerError.message
      );
      return;
    }

    setPhotoUploaded(true);
    setMessage(
      "อัปโหลดรูปรถเข็นสินค้าสำเร็จ"
    );
  }

  async function completePicking() {
    setMessage("");

    if (!photoUploaded) {
      setMessage(
        "ต้องอัปโหลดรูปรถเข็นสินค้าก่อนปิดงานจัดสินค้า"
      );
      return;
    }

    const invalidItem =
      items.find((item) => {
        const value =
          Number(actual[item.id]);

        return (
          Number.isNaN(value) ||
          !Number.isFinite(value) ||
          value < 0
        );
      });

    if (invalidItem) {
      setMessage(
        `${invalidItem.product_name_snapshot}: กรุณากรอกจำนวนที่หยิบจริงให้ถูกต้อง`
      );

      return;
    }

    const missingSku =
      items.find(
        (item) => !item.products?.sku
      );

    if (missingSku) {
      setMessage(
        `ไม่พบ SKU สำหรับ ${missingSku.product_name_snapshot}`
      );
      return;
    }

    const payload = items.map(
      (item) => ({
        sku: item.products!.sku,
        actual_qty:
          Number(actual[item.id]),
      })
    );

    setSubmitting(true);

    const { error } = await supabase.rpc(
      "complete_my_picking",
      {
        p_order_number: orderNumber,
        p_items: payload,
      }
    );

    if (error) {
      setMessage(
        "ไม่สามารถปิดงานจัดสินค้าได้: " +
          error.message
      );
      setSubmitting(false);
      return;
    }

    router.push("/tasks");
    router.refresh();
  }

  async function releaseTask() {
    const confirmedRelease =
      window.confirm(
        "ต้องการปล่อยงานนี้เพื่อให้พนักงานคนอื่นรับไปดำเนินการหรือไม่?"
      );

    if (!confirmedRelease) {
      return;
    }

    const { error } = await supabase.rpc(
      "release_my_task",
      {
        p_order_number: orderNumber,
      }
    );

    if (error) {
      setMessage(
        "ไม่สามารถปล่อยงานได้: " +
          error.message
      );
      return;
    }

    router.push("/tasks");
    router.refresh();
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-100 p-8">
        กำลังโหลดคำสั่งซื้อ...
      </main>
    );
  }

  if (!order) {
    return (
      <main className="min-h-screen bg-gray-100 p-8">
        ไม่พบคำสั่งซื้อ
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-5xl mx-auto">

        <Link
          href="/tasks"
          className="text-gray-500"
        >
          ← กลับไปหน้างาน
        </Link>

        <div className="flex justify-between items-start mt-4 mb-8">

          <div>
            <p className="text-sm text-gray-500">
              จัดสินค้า
            </p>

            <h1 className="text-3xl font-bold mt-1">
              คำสั่งซื้อ #{order.order_number}
            </h1>

            <p className="text-xl mt-2">
              {order.customers?.customer_name}
            </p>
          </div>

          <button
            onClick={releaseTask}
            className="bg-white border rounded-lg px-4 py-2"
          >
            ปล่อยงาน
          </button>

        </div>

        <section className="bg-white border rounded-2xl p-6 mb-6">
          <h2 className="font-bold text-lg mb-4">
            ข้อมูลลูกค้าและการจัดส่ง
          </h2>

          <div className="grid md:grid-cols-2 gap-4">

            <div>
              <p className="text-sm text-gray-500">
                เบอร์โทรศัพท์
              </p>

              {order.customers?.phone ? (
                <a
                  href={`tel:${order.customers.phone}`}
                  className="underline font-medium"
                >
                  {order.customers.phone}
                </a>
              ) : (
                "—"
              )}
            </div>

            <div>
              <p className="text-sm text-gray-500">
                การจัดส่ง
              </p>

              <p className="font-medium">
                {order.delivery_date ?? "—"}
                {" · "}
                {order.delivery_slot ?? "—"}
              </p>
            </div>

          </div>
        </section>

        <section className="bg-white border rounded-2xl overflow-hidden mb-6">

          <div className="p-6 border-b">
            <h2 className="font-bold text-lg">
              จำนวนสินค้าที่หยิบจริง
            </h2>

            <p className="text-sm text-gray-500 mt-1">
              กรอกจำนวนสินค้าที่หยิบได้จริง
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">

              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left p-4">
                    สินค้า
                  </th>

                  <th className="text-left p-4">
                    SKU
                  </th>

                  <th className="text-right p-4">
                    จำนวนที่ยืนยัน
                  </th>

                  <th className="text-right p-4">
                    จำนวนที่หยิบจริง
                  </th>
                </tr>
              </thead>

              <tbody>
                {items.map((item) => (
                  <tr
                    key={item.id}
                    className="border-t"
                  >
                    <td className="p-4 font-medium">
                      {item.product_name_snapshot}
                    </td>

                    <td className="p-4">
                      {item.products?.sku ?? "—"}
                    </td>

                    <td className="p-4 text-right">
                      {Number(item.confirmed_qty)}{" "}
                      {item.unit_snapshot}
                    </td>

                    <td className="p-4">
                      <div className="flex justify-end items-center gap-2">

                        <input
                          type="number"
                          min="0"
                          step="0.001"
                          value={
                            actual[item.id] ?? ""
                          }
                          onChange={(event) =>
                            setActual({
                              ...actual,
                              [item.id]:
                                event.target.value,
                            })
                          }
                          className="w-32 border rounded-lg px-3 py-2 text-right"
                        />

                        <span className="text-gray-500 w-10">
                          {item.unit_snapshot}
                        </span>

                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>

            </table>
          </div>
        </section>

        <section className="bg-white border rounded-2xl p-6">

          <h2 className="font-bold text-lg">
            รูปรถเข็นสินค้า
          </h2>

          <p className="text-sm text-gray-500 mt-1 mb-4">
            ต้องอัปโหลดรูปรถเข็นสินค้าที่จัดเสร็จแล้ว 1 รูป
          </p>

          {photoUploaded ? (
            <div className="font-semibold">
              ✓ อัปโหลดรูปรถเข็นสินค้าแล้ว
            </div>
          ) : (
            <div className="flex flex-col md:flex-row gap-4">

              <input
                type="file"
                accept="image/*"
                onChange={(event) =>
                  setCartPhoto(
                    event.target.files?.[0] ??
                    null
                  )
                }
              />

              <button
                onClick={uploadCartPhoto}
                className="bg-white border rounded-lg px-5 py-2"
              >
                อัปโหลดรูปรถเข็นสินค้า
              </button>

            </div>
          )}

        </section>

        {message && (
          <div className="mt-6 bg-white border rounded-lg p-4">
            {message}
          </div>
        )}

        <div className="flex justify-end mt-6">
          <button
            onClick={completePicking}
            disabled={submitting}
            className="bg-black text-white rounded-lg px-8 py-4 font-semibold disabled:opacity-50"
          >
            {submitting
              ? "กำลังบันทึก..."
              : "จัดสินค้าเสร็จสิ้น"}
          </button>
        </div>

      </div>
    </main>
  );
}
