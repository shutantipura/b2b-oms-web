"use client";



import { useEffect, useState } from "react";

import Link from "next/link";

import { useParams, useRouter } from "next/navigation";

import { supabase } from "../../../../lib/supabase";
import DeliverySchedule from "../../../../components/DeliverySchedule";
import TaskFilePicker from "../../../../components/TaskFilePicker";



type OrderDetails = {

  id: string;

  order_number: number;
  group_root_order_id: string | null;

  status: string;

  delivery_date: string | null;

  delivery_slot: string | null;

  delivery_address: string | null;

  customer_notes: string | null;

  final_amount: number | string | null;
  billing_account_suspended: boolean;
  billing_no_cv: boolean;



  customers: {

    customer_name: string;

    contact_name: string | null;

    phone: string | null;

    delivery_map_url: string | null;

    rider_note: string | null;

  } | null;

};


type DeliveryItem = {
  id: string;
  product_name_snapshot: string;
  actual_qty: number | string | null;
  unit_snapshot: string;
  piece_price_per_kg_snapshot?: number | string | null;
  sources?: unknown;
  products: {
    sku: string;
    image_url: string | null;
  } | null;
};

// Confirmed pieces and actually picked kilograms must remain distinct.
// Grouped billing lines retain the picked unit in their source breakdown.
function pickedQuantityUnit(item: DeliveryItem): string {
  if (item.piece_price_per_kg_snapshot != null) return "กก.";
  if (Array.isArray(item.sources) && item.sources.some(
    (source: unknown) => typeof source === "object" && source !== null &&
      "picked_unit" in source && source.picked_unit === "กก."
  )) return "กก.";
  return item.unit_snapshot;
}

type OrderFile = {
  id: string;
  file_type: string;
  storage_path: string;
  original_filename: string | null;
  mime_type: string | null;
};

type DisplayFile = {
  url: string;
  name: string;
  mimeType: string | null;
};

type CartPhoto = DisplayFile & { orderLabel: string };

function safeWebUrl(
  value: string | null | undefined
) {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);

    if (
      url.protocol !== "https:" &&
      url.protocol !== "http:"
    ) {
      return null;
    }

    return value;
  } catch {
    return null;
  }
}



export default function DeliveryPage() {

  const params = useParams();

  const router = useRouter();



  const orderNumber = Number(params.orderNumber);



  const [editingMap, setEditingMap] = useState(false);
  const [mapDraft, setMapDraft] = useState("");
  const [savingMap, setSavingMap] = useState(false);

  const [order, setOrder] =

    useState<OrderDetails | null>(null);

  const [items, setItems] = useState<DeliveryItem[]>([]);
  const [itemsError, setItemsError] = useState("");

  const [deliveryPhotoNames, setDeliveryPhotoNames] = useState<(string | null)[]>([null, null]);

  const [photoUploaded, setPhotoUploaded] = useState<boolean[]>([false, false]);



  const [cartPhotos, setCartPhotos] = useState<CartPhoto[]>([]);
  const [missingCartLabels, setMissingCartLabels] = useState<string[]>([]);



  const [bill, setBill] =

    useState<DisplayFile | null>(null);



  const [paymentQr, setPaymentQr] =

    useState<DisplayFile | null>(null);



  const [loading, setLoading] =

    useState(true);



  const [uploading, setUploading] =

    useState(false);



  const [submitting, setSubmitting] =

    useState(false);



  const [message, setMessage] =

    useState("");



  async function loadOrder() {

    setLoading(true);

    setMessage("");
    setItems([]);
    setItemsError("");
    setCartPhotos([]);
    setMissingCartLabels([]);
    setBill(null);
    setPaymentQr(null);



    const {

      data: orderData,

      error: orderError,

    } = await supabase

      .from("orders")

      .select(`

        id,

        order_number,
        group_root_order_id,

        status,

        delivery_date,

        delivery_slot,

        delivery_address,

        customer_notes,

        final_amount,
        billing_account_suspended,
        billing_no_cv,

        customers (

          customer_name,

          contact_name,

          phone,

          delivery_map_url,

          rider_note

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



    const typedOrder = orderData as unknown as OrderDetails;
    setOrder(typedOrder);
    setMapDraft(typedOrder.delivery_address ?? typedOrder.customers?.delivery_map_url ?? "");

    // Delivery displays what was actually picked and billed. Group roots use
    // the same consolidated lines as Billing, avoiding duplicated /x items.
    const isGroupRoot = orderData.group_root_order_id === orderData.id;
    const { data: itemData, error: itemError } = isGroupRoot
      ? await supabase.from("group_billing_lines")
          .select("id, product_name_snapshot, actual_qty, unit_snapshot, sources, products(sku, image_url)")
          .eq("root_order_id", orderData.id)
          .order("product_name_snapshot", { ascending: true })
      : await supabase.from("order_items")
          .select("id, product_name_snapshot, actual_qty, unit_snapshot, piece_price_per_kg_snapshot, products(sku, image_url)")
          .eq("order_id", orderData.id)
          .order("product_name_snapshot", { ascending: true });

    // A product-list read issue must never block proof upload or delivery.
    if (itemError) {
      setItemsError("ไม่สามารถโหลดรายการสินค้าที่จัดส่งได้: " + itemError.message);
    } else {
      setItems((itemData ?? []) as unknown as DeliveryItem[]);
    }

    const {

      data: fileData,

      error: fileError,

    } = await supabase

      .from("order_files")

      .select(`

        id,

        file_type,

        storage_path,

        original_filename,

        mime_type

      `)

      .eq("order_id", orderData.id)

      .eq("is_current", true)

      .in(

        "file_type",

        [

          "cart_photo",

          "bill",

          "payment_qr",

          "delivery_proof",

          "delivery_proof_2",

        ]

      );



    if (fileError) {

      setMessage(

        "ไม่สามารถโหลดไฟล์ประกอบคำสั่งซื้อได้: " +

          fileError.message

      );

      setLoading(false);

      return;

    }



    const files =

      (fileData ?? []) as OrderFile[];



    const firstProof = files.find((file) => file.file_type === "delivery_proof");
    const secondProof = files.find((file) => file.file_type === "delivery_proof_2");
    setPhotoUploaded([Boolean(firstProof), Boolean(secondProof)]);
    setDeliveryPhotoNames([
      firstProof?.original_filename ?? null,
      secondProof?.original_filename ?? null,
    ]);

    async function getDisplayFile(

      fileType: string

    ): Promise<DisplayFile | null> {

      const file =

        files.find(

          (item) =>

            item.file_type ===

            fileType

        );



      if (!file) {

        return null;

      }



      const {

        data,

        error,

      } = await supabase.storage

        .from("order-files")

        .createSignedUrl(

          file.storage_path,

          60 * 60

        );



      if (

        error ||

        !data

      ) {

        return null;

      }



      return {

        url: data.signedUrl,

        name:

          file.original_filename ??

          file.file_type,

        mimeType:

          file.mime_type,

      };

    }



    // Every /x member has its own picked cart and its own photo.
    // Do not rely on the grouped root's legacy cart_photo.
    const { data: members, error: membersError } = await supabase
      .from("orders")
      .select("id, order_number, group_sequence")
      .eq("group_root_order_id", orderData.id)
      .neq("status", "cancelled")
      .order("group_sequence", { ascending: true });
    if (membersError) {
      setMessage("ไม่สามารถโหลดรายการรถเข็นของกลุ่มได้: " + membersError.message);
      setLoading(false);
      return;
    }

    const memberIds = (members ?? []).map((member) => member.id);
    let groupCartPhotos: CartPhoto[] = [];
    if (memberIds.length > 0) {
      const { data: memberFiles, error: memberFilesError } = await supabase
        .from("order_files")
        .select("order_id, file_type, storage_path, original_filename, mime_type")
        .in("order_id", memberIds)
        .eq("file_type", "cart_photo")
        .eq("is_current", true);
      if (memberFilesError) {
        setMessage("ไม่สามารถโหลดรูปรถเข็นของคำสั่งซื้อย่อยได้: " + memberFilesError.message);
        setLoading(false);
        return;
      }
      const fileByOrder = new Map((memberFiles ?? []).map((file) => [file.order_id, file]));
      const photos = await Promise.all((members ?? []).map(async (member): Promise<CartPhoto | null> => {
        const file = fileByOrder.get(member.id);
        if (!file) return null;
        const { data, error } = await supabase.storage.from("order-files")
          .createSignedUrl(file.storage_path, 60 * 60);
        if (error || !data) return null;
        return {
          url: data.signedUrl,
          name: file.original_filename ?? "รูปรถเข็น",
          mimeType: file.mime_type,
          orderLabel: `${orderData.order_number}/${member.group_sequence ?? "?"}`,
        };
      }));
      groupCartPhotos = photos.filter((photo): photo is CartPhoto => photo !== null);
      setMissingCartLabels((members ?? [])
        .filter((_, index) => photos[index] === null)
        .map((member) => `${orderData.order_number}/${member.group_sequence ?? "?"}`));
    } else {
      const singleCart = await getDisplayFile("cart_photo");
      if (singleCart) groupCartPhotos = [{ ...singleCart, orderLabel: String(orderData.order_number) }];
    }
    setCartPhotos(groupCartPhotos);

    const [loadedBill, loadedPaymentQr] = await Promise.all([
      getDisplayFile("bill"),
      getDisplayFile("payment_qr"),
    ]);



    setBill(

      loadedBill

    );



    setPaymentQr(

      loadedPaymentQr

    );



    setLoading(false);

  }



  useEffect(() => {

    if (!Number.isNaN(orderNumber)) {

      loadOrder();

    }

  }, [orderNumber]);



  async function uploadDeliveryProof(file: File, index: 0 | 1) {
    if (uploading || submitting) return;
    setUploading(true);
    setMessage(`กำลังอัปโหลดหลักฐานการจัดส่ง ${index + 1}...`);
    const fileType = index === 0 ? "delivery_proof" : "delivery_proof_2";
    const extension = file.name.split(".").pop() || "jpg";
    const storagePath =
      `orders/${orderNumber}/${fileType}/${crypto.randomUUID()}.${extension}`;

    try {
      const { error: uploadError } = await supabase.storage
        .from("order-files")
        .upload(storagePath, file, {
          upsert: false,
          contentType: file.type || "image/jpeg",
        });
      if (uploadError) throw new Error("อัปโหลดรูปไม่สำเร็จ: " + uploadError.message);

      const { error: registerError } = await supabase.rpc(
        "register_my_order_file",
        {
          p_order_number: orderNumber,
          p_file_type: fileType,
          p_storage_path: storagePath,
          p_original_filename: file.name,
          p_mime_type: file.type || "image/jpeg",
        }
      );
      if (registerError) throw new Error("บันทึกรูปไม่สำเร็จ: " + registerError.message);

      setPhotoUploaded((previous) =>
        previous.map((uploaded, photoIndex) => photoIndex === index ? true : uploaded)
      );
      setDeliveryPhotoNames((previous) =>
        previous.map((name, photoIndex) => photoIndex === index ? file.name : name)
      );
      setMessage(`✓ บันทึกหลักฐานการจัดส่ง ${index + 1} เรียบร้อยแล้ว`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "อัปโหลดหลักฐานการจัดส่งไม่สำเร็จ");
    } finally {
      setUploading(false);
    }
  }

  async function completeDelivery() {

    setMessage("");



    if (!photoUploaded[0]) {

      setMessage(

        "ต้องอัปโหลดหลักฐานการจัดส่งก่อนปิดงานจัดส่ง"

      );

      return;

    }



    setSubmitting(true);



    const { error } = await supabase.rpc(

      "complete_my_delivery",

      {

        p_order_number: orderNumber,

      }

    );



    if (error) {

      setMessage(

        "ไม่สามารถปิดงานจัดส่งได้: " +

          error.message

      );



      setSubmitting(false);

      return;

    }



    router.push("/tasks");

    router.refresh();

  }



  async function saveDeliveryMap() {
    const nextUrl = mapDraft.trim();
    try {
      const parsed = new URL(nextUrl);
      if (parsed.protocol !== "https:") throw new Error("กรุณาใช้ลิงก์ Google Maps แบบ HTTPS");
    } catch {
      setMessage("กรุณากรอกลิงก์ Google Maps ที่ถูกต้อง");
      return;
    }
    setSavingMap(true);
    setMessage("");
    const { error } = await supabase.rpc("update_my_delivery_map", {
      p_order_number: orderNumber,
      p_map_url: nextUrl,
    });
    if (error) {
      setMessage("เปลี่ยนตำแหน่งจัดส่งไม่สำเร็จ: " + error.message);
    } else {
      setOrder((previous) => previous ? { ...previous, delivery_address: nextUrl } : previous);
      setEditingMap(false);
      setMessage("✓ อัปเดตตำแหน่งจัดส่งสำหรับออเดอร์นี้แล้ว");
    }
    setSavingMap(false);
  }

  async function releaseTask() {

    const confirmedRelease =

      window.confirm(

        "ต้องการปล่อยงานจัดส่งนี้เพื่อให้พนักงานคนอื่นรับไปดำเนินการหรือไม่?"

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



  function isImage(

    file: DisplayFile | null

  ) {

    return Boolean(

      file?.mimeType?.startsWith(

        "image/"

      )

    );

  }



  if (loading) {

    return (

      <main className="min-h-screen bg-gray-100 p-8">

        กำลังโหลดงานจัดส่ง...

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



  const deliveryItems = items.filter((item) => Number(item.actual_qty ?? 0) > 0);
  const formatQuantity = (value: number | string | null) =>
    new Intl.NumberFormat("th-TH", { maximumFractionDigits: 3 }).format(Number(value ?? 0));

  const deliveryMapUrl =

    safeWebUrl(

      order.delivery_address

    ) ??

    safeWebUrl(

      order.customers?.delivery_map_url

    );



  return (

    <main className="min-h-screen bg-gray-100 p-8">

      <div className="max-w-4xl mx-auto">



        <Link

          href="/tasks"

          className="text-gray-500"

        >

          ← กลับไปหน้างาน

        </Link>



        <div className="flex justify-between items-start mt-4 mb-8">



          <div>

            <p className="text-sm text-gray-500">

              จัดส่ง

            </p>



            <h1 className="mt-1 text-2xl font-extrabold leading-tight text-[#17453F] md:text-3xl">
              {order.customers?.customer_name ?? "ไม่ทราบชื่อร้าน"}
            </h1>
            <p className="mt-1 text-xs font-semibold text-[#82958F]">
              คำสั่งซื้อ #{order.order_number}
            </p>

          </div>



          <button

            onClick={releaseTask}

            className="bg-white border rounded-lg px-4 py-2"

          >

            ปล่อยงาน

          </button>



        </div>



        {(order.billing_account_suspended || order.billing_no_cv) && (
          <section role="status" aria-live="polite"
            className="mb-6 rounded-2xl border-2 border-[#F0BD59] bg-[#FFF7E3] p-4 shadow-sm sm:p-5">
            <div className="flex items-start gap-3">
              <span aria-hidden="true" className="text-2xl">⚠️</span>
              <div>
                <h2 className="text-base font-extrabold text-[#8A4A00]">
                  แจ้งไรเดอร์: {order.billing_account_suspended ? "CV Card" : "พักบิล"}
                </h2>
                <p className="mt-2 text-sm font-semibold leading-6 text-[#795323]">
                  {order.billing_account_suspended
                    ? "ออเดอร์นี้ใช้รูป CV Card ของลูกค้าแทน QR ชำระเงิน และอาจไม่มีรูปบิล กรุณาตรวจสอบเอกสารก่อนจัดส่ง"
                    : "ออเดอร์นี้พักบิล พนักงานออกบิลที่เครื่อง POS และถ่ายรูปพักบิลแล้ว ไม่มี QR ชำระเงิน กรุณาตรวจสอบรูปพักบิลก่อนจัดส่ง"}
                </p>
              </div>
            </div>
          </section>
        )}

        <section className="bg-white border rounded-2xl p-6 mb-6">



          <h2 className="font-bold text-lg mb-5">

            ข้อมูลการจัดส่ง

          </h2>



          <div className="grid md:grid-cols-2 gap-5">



            <div>

              <p className="text-sm text-gray-500">

                ผู้ติดต่อ

              </p>



              <p className="font-medium">

                {order.customers

                  ?.contact_name ?? "—"}

              </p>

            </div>



            <div>

              <p className="text-sm text-gray-500">

                เบอร์โทรศัพท์

              </p>



              {order.customers?.phone ? (

                <a

                  href={`tel:${order.customers.phone}`}

                  className="font-medium underline"

                >

                  {order.customers.phone}

                </a>

              ) : (

                <p>—</p>

              )}

            </div>



            <div>

              <p className="text-sm text-gray-500">

                ช่วงเวลาจัดส่ง

              </p>



              <DeliverySchedule date={order.delivery_date} slot={order.delivery_slot} />

            </div>



            <div>

              <p className="text-sm text-gray-500">

                ยอดบิลสุดท้าย

              </p>



              <p className="font-bold text-lg">

                ฿

                {Number(

                  order.final_amount ?? 0

                ).toFixed(2)}

              </p>

            </div>



          </div>



          <div className="mt-5">

            <p className="text-sm text-gray-500">

              ตำแหน่งจัดส่ง

            </p>



            <div className="mt-2 flex flex-wrap items-center gap-2">
            {deliveryMapUrl ? (

              <a

                href={deliveryMapUrl}

                target="_blank"

                rel="noopener noreferrer"

                className="inline-flex min-h-11 items-center bg-black text-white rounded-xl px-5 py-3 font-semibold"

              >

                📍 เปิด Google Maps

              </a>

            ) : (

              <p className="font-medium text-red-600 mt-2">

                ยังไม่ได้บันทึกลิงก์ Google Maps

              </p>

            )}
            <button type="button" onClick={() => { setMapDraft(deliveryMapUrl ?? ""); setEditingMap(true); }} aria-label="เปลี่ยนตำแหน่งจัดส่ง" title="เปลี่ยนตำแหน่งจัดส่ง" className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[#02B0AF] text-[#007F79]">✏️</button>
            </div>
          </div>



          <div className="mt-3">
            {editingMap && (
              <div className="rounded-xl border p-4">
                <label htmlFor="delivery-map-edit" className="block text-sm font-bold mb-2">ลิงก์ Google Maps ใหม่</label>
                <input id="delivery-map-edit" type="url" value={mapDraft} onChange={(event) => setMapDraft(event.target.value)}
                  placeholder="https://maps.app.goo.gl/..." className="w-full rounded-lg border px-3 py-3" />
                <p className="mt-2 text-xs text-gray-500">เปลี่ยนเฉพาะออเดอร์นี้ ไม่เปลี่ยนที่อยู่ประจำของลูกค้า</p>
                <div className="mt-3 flex gap-2">
                  <button type="button" disabled={savingMap} onClick={() => void saveDeliveryMap()}
                    className="rounded-lg bg-[#02B0AF] px-4 py-2.5 font-bold text-white disabled:opacity-50">
                    {savingMap ? "กำลังบันทึก..." : "บันทึกตำแหน่ง"}
                  </button>
                  <button type="button" disabled={savingMap} onClick={() => setEditingMap(false)}
                    className="rounded-lg border px-4 py-2.5">ยกเลิก</button>
                </div>
              </div>
            )}
          </div>

          <div className="mt-5">

            <p className="text-sm text-gray-500">

              หมายเหตุถึงไรเดอร์

            </p>



            <p className="font-medium whitespace-pre-wrap mt-1">

              {order.customers?.rider_note ?? "—"}

            </p>

          </div>



          {order.customer_notes && (

            <div className="mt-5">

              <p className="text-sm text-gray-500">

                หมายเหตุคำสั่งซื้อจากลูกค้า

              </p>



              <p>

                {order.customer_notes}

              </p>

            </div>

          )}



        </section>

        <section className="mb-6 rounded-2xl border bg-white p-4 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-extrabold text-[#17453F]">รายการสินค้าที่จัดส่ง</h2>
            <span className="rounded-full bg-[#E7F8F5] px-3 py-1 text-sm font-bold text-[#007F79]">
              {deliveryItems.length} รายการ
            </span>
          </div>
          <p className="mb-4 mt-1 text-sm text-[#6B8179]">
            แสดงจำนวนที่หยิบจริงหลังเช็คสต็อกและหยิบสินค้า
            {order.group_root_order_id === order.id ? " · รวมสินค้าจากออเดอร์ย่อยทั้งหมด" : ""}
          </p>

          {itemsError ? (
            <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              {itemsError} กรุณาตรวจสอบบิลและรูปรถเข็นประกอบ
            </p>
          ) : deliveryItems.length === 0 ? (
            <p className="rounded-xl bg-gray-50 p-4 text-sm text-gray-500">
              ไม่พบสินค้าที่หยิบจริงสำหรับการจัดส่ง
            </p>
          ) : (
            <div className="divide-y divide-[#E2EDE8]">
              {deliveryItems.map((item) => (
                <div key={item.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl border bg-[#F3F7F5]">
                    <span aria-hidden="true" className="absolute inset-0 flex items-center justify-center text-xl">📦</span>
                    {item.products?.image_url && (
                      <img
                        src={item.products.image_url}
                        alt={item.product_name_snapshot}
                        loading="lazy"
                        decoding="async"
                        className="absolute inset-0 h-full w-full bg-white object-contain p-1"
                        onError={(event) => { event.currentTarget.style.display = "none"; }}
                      />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-bold leading-5 text-[#234C40]">
                      {item.product_name_snapshot}
                    </p>
                    <p className="mt-1 text-xs text-[#71877E]">SKU {item.products?.sku ?? "—"}</p>
                  </div>
                  <div className="max-w-[42%] shrink-0 rounded-xl bg-[#E7F8F5] px-3 py-2 text-right text-[#007F79]">
                    <span className="block text-[11px] font-bold">หยิบจริง</span>
                    <span className="text-base font-extrabold">
                      {formatQuantity(item.actual_qty)} {pickedQuantityUnit(item)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="bg-white border rounded-2xl p-6 mb-6">

          <h2 className="font-bold text-lg">
            เอกสารสำหรับการจัดส่ง
          </h2>

          <p className="text-sm text-gray-500 mt-1 mb-5">
            {order.billing_account_suspended
              ? "ตรวจสอบรูปรถเข็นและรูป CV Card (บิลไม่บังคับ)"
              : order.billing_no_cv
                ? "ตรวจสอบรูปรถเข็นและรูปพักบิลจาก POS (ไม่ต้องใช้ QR)"
                : "ตรวจสอบรูปรถเข็น บิล และ QR ชำระเงินก่อนออกจัดส่ง"}
          </p>

          <div className="grid md:grid-cols-3 gap-5">

            <div className="border rounded-2xl p-4">
              <p className="font-semibold mb-3">
                รูปรถเข็นสินค้า
              </p>

              {missingCartLabels.length > 0 && (
                <p role="alert" className="mb-3 rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-700">
                  ไม่พบรูปรถเข็นสำหรับออเดอร์: {missingCartLabels.join(", ")} กรุณาตรวจสอบก่อนจัดส่ง
                </p>
              )}
              {cartPhotos.length === 0 ? (
                <p className="text-sm text-red-600">ยังไม่มีรูปรถเข็นสินค้า กรุณาตรวจสอบก่อนจัดส่ง</p>
              ) : (
                <div className="space-y-4">
                  {cartPhotos.map((photo) => (
                    <div key={photo.orderLabel} className="rounded-xl border border-[#D6E8E2] p-3">
                      <p className="mb-2 text-sm font-bold text-[#007F79]">ออเดอร์ #{photo.orderLabel}</p>
                      {isImage(photo) ? (
                        <a href={photo.url} target="_blank" rel="noreferrer">
                          <img src={photo.url} alt={`รูปรถเข็นออเดอร์ ${photo.orderLabel}`}
                            className="h-48 w-full rounded-lg bg-gray-50 object-contain" />
                        </a>
                      ) : (
                        <a href={photo.url} target="_blank" rel="noreferrer" className="text-sm underline">
                          เปิดไฟล์รูปรถเข็นออเดอร์ #{photo.orderLabel}
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="border rounded-2xl p-4">
              <p className="font-semibold mb-3">
                {order.billing_no_cv ? "รูปพักบิล (POS)" : "บิล"}
              </p>

              {!bill ? (
                <p className="text-sm text-gray-500">
                  {order.billing_account_suspended ? "CV Card: ไม่บังคับรูปบิล" : "ยังไม่มีรูปบิล"}
                </p>
              ) : isImage(bill) ? (
                <a
                  href={bill.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  <img
                    src={bill.url}
                    alt="บิล"
                    className="w-full h-56 object-contain border rounded-xl bg-gray-50"
                  />
                </a>
              ) : (
                <a
                  href={bill.url}
                  target="_blank"
                  rel="noreferrer"
                  className="underline text-sm"
                >
                  เปิดไฟล์บิล
                </a>
              )}
            </div>

            <div className="border rounded-2xl p-4">
              <p className="font-semibold mb-3">
                {order.billing_account_suspended ? "CV Card ลูกค้า"
                  : order.billing_no_cv ? "QR ชำระเงิน (ไม่ต้องใช้)" : "QR ชำระเงิน"}
              </p>

              {!paymentQr ? (
                <p className="text-sm text-gray-500">
                  {order.billing_no_cv ? "พักบิล: ไม่ต้องใช้ QR ชำระเงิน" : "ยังไม่มี QR ชำระเงิน"}
                </p>
              ) : (
                <a
                  href={paymentQr.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  <img
                    src={paymentQr.url}
                    alt={order.billing_account_suspended ? "CV Card ลูกค้า" : "QR ชำระเงิน"}
                    className="w-full h-56 object-contain border rounded-xl bg-gray-50"
                  />
                </a>
              )}
            </div>

          </div>

        </section>



        <section className="bg-white border rounded-2xl p-6">



          <h2 className="font-bold text-lg">

            หลักฐานการจัดส่ง

          </h2>



          <p className="text-sm text-gray-500 mt-1 mb-5">

            ถ่ายหลักฐานการจัดส่งอย่างน้อย 1 รูป หลังบันทึกรูปแรกแล้วสามารถเพิ่มรูปที่ 2 ได้ (ไม่บังคับ)

          </p>

          <div className="space-y-4">
            <TaskFilePicker
              label="หลักฐานการจัดส่ง 1"
              chooseLabel="ถ่ายหรือเลือกหลักฐานการจัดส่ง"
              replaceLabel="เปลี่ยนรูปที่ 1"
              accept="image/*"
              uploaded={photoUploaded[0]}
              uploading={uploading}
              disabled={submitting}
              fileName={deliveryPhotoNames[0]}
              onSelect={(file) => uploadDeliveryProof(file, 0)}
            />
            {photoUploaded[0] && (
              <TaskFilePicker
                label="หลักฐานการจัดส่ง 2 (ไม่บังคับ)"
                chooseLabel="เพิ่มหลักฐานอีก 1 รูป (ไม่บังคับ)"
                replaceLabel="เปลี่ยนรูปที่ 2"
                appearance={photoUploaded[1] ? "default" : "add"}
                accept="image/*"
                uploaded={photoUploaded[1]}
                uploading={uploading}
                disabled={submitting}
                fileName={deliveryPhotoNames[1]}
                onSelect={(file) => uploadDeliveryProof(file, 1)}
              />
            )}
          </div>

        </section>



        {message && (

          <div className="mt-6 bg-white border rounded-lg p-4">

            {message}

          </div>

        )}



        <div className="flex justify-end mt-6">



          <button

            onClick={completeDelivery}

            disabled={submitting || uploading || !photoUploaded[0]}

            className="bg-black text-white rounded-lg px-8 py-4 font-semibold disabled:opacity-30"

          >

            {submitting

              ? "กำลังบันทึก..."

              : "จัดส่งเสร็จสิ้น"}

          </button>



        </div>



      </div>

    </main>

  );

}