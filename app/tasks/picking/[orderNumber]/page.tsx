"use client";

import {
  useEffect,
  useRef,
  useState,
} from "react";

import Link from "next/link";

import {
  useParams,
  useRouter,
} from "next/navigation";

import {
  supabase,
} from "../../../../lib/supabase";
import DeliverySchedule from "../../../../components/DeliverySchedule";
import TaskFilePicker from "../../../../components/TaskFilePicker";

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
  product_id: string;
  product_name_snapshot: string;
  confirmed_qty:
    | number
    | string;
  actual_qty:
    | number
    | string
    | null;
  addon_requested_qty: number | string;
  addon_confirmed_qty: number | string | null;
  unit_snapshot: string;
  staff_note: string | null;
  products: {
    sku: string;
    image_url: string | null;
  } | null;
};

type ArchivedCartPhoto = {
  id: string;
  file_type: string;
  original_filename: string | null;
  created_at: string;
  url: string | null;
};

type SearchProduct = {
  product_id: string;
  sku: string;
  product_name: string;
  unit: string;
  effective_price:
    | number
    | string;
  image_url: string | null;
};

function formatPrice(
  value:
    | number
    | string
) {
  const number =
    Number(value);

  if (!Number.isFinite(number)) {
    return String(value);
  }

  return new Intl.NumberFormat(
    "th-TH",
    {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }
  ).format(number);
}

function ProductThumbnail({
  imageUrl,
  alt,
  size = "normal",
}: {
  imageUrl:
    | string
    | null
    | undefined;
  alt: string;
  size?: "normal" | "small";
}) {
  const sizeClass =
    size === "small"
      ? "w-14 h-14"
      : "w-16 h-16";

  return (
    <div
      className={`relative ${sizeClass} rounded-xl bg-gray-100 overflow-hidden shrink-0 border`}
    >
      <div className="absolute inset-0 flex items-center justify-center text-xl text-gray-400">
        📦
      </div>

      {imageUrl ? (
        <img
          src={imageUrl}
          alt={alt}
          loading="lazy"
          decoding="async"
          className="absolute inset-0 w-full h-full object-contain bg-white p-1"
          onError={(event) => {
            event.currentTarget.style.display =
              "none";
          }}
        />
      ) : null}
    </div>
  );
}

export default function PickingPage() {
  const params =
    useParams();

  const router =
    useRouter();

  const orderNumber =
    Number(
      params.orderNumber
    );

  const [
    order,
    setOrder,
  ] =
    useState<OrderDetails | null>(
      null
    );

  const [
    items,
    setItems,
  ] =
    useState<OrderItem[]>(
      []
    );

  const addonMode = items.some((item) => Number(item.addon_requested_qty) > 0);
  const actionableItems = addonMode
    ? items.filter((item) => Number(item.addon_requested_qty) > 0)
    : items;
  const previouslyCompletedItems = addonMode
    ? items.filter((item) => Number(item.addon_requested_qty) === 0)
    : [];

  const [
    actual,
    setActual,
  ] =
    useState<
      Record<
        string,
        string
      >
    >({});

  const [cartPhotoNames, setCartPhotoNames] = useState<(string | null)[]>([null, null]);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  const [photoUploaded, setPhotoUploaded] = useState<boolean[]>([false, false]);
  // Superseded photos are retained in Storage and shown here for comparison.
  // They NEVER satisfy the fresh-photo requirement for the new picking run.
  const [archivedCartPhotos, setArchivedCartPhotos] = useState<ArchivedCartPhoto[]>([]);
  const [photoHistoryError, setPhotoHistoryError] = useState("");

  const [
    loading,
    setLoading,
  ] =
    useState(true);

  const [
    submitting,
    setSubmitting,
  ] =
    useState(false);

  const [
    message,
    setMessage,
  ] =
    useState("");

  // Details of any customer-added products that sent billing back to picking.
  const [mergeAddedQuantities, setMergeAddedQuantities] = useState<Record<string, number> | null>(null);

  // =====================================================
  // ADD PRODUCT
  // =====================================================

  const [
    addProductOpen,
    setAddProductOpen,
  ] =
    useState(false);

  const [
    productSearch,
    setProductSearch,
  ] =
    useState("");

  const [
    searchResults,
    setSearchResults,
  ] =
    useState<
      SearchProduct[]
    >([]);

  const [
    searchingProducts,
    setSearchingProducts,
  ] =
    useState(false);

  const [
    selectedProduct,
    setSelectedProduct,
  ] =
    useState<
      SearchProduct | null
    >(null);

  const [
    addQuantity,
    setAddQuantity,
  ] =
    useState("");

  const [
    addingProduct,
    setAddingProduct,
  ] =
    useState(false);

  const [
    addProductMessage,
    setAddProductMessage,
  ] =
    useState("");

  const searchRequestId =
    useRef(0);

  async function loadOrder() {
    setLoading(true);
    setMessage("");

    const {
      data: orderData,
      error: orderError,
    } =
      await supabase
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
        .eq(
          "order_number",
          orderNumber
        )
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
    } =
      await supabase
        .from("order_items")
        .select(`
          id,
          product_id,
          product_name_snapshot,
          confirmed_qty,
          actual_qty,
          addon_requested_qty,
          addon_confirmed_qty,
          unit_snapshot,
          staff_note,
          products (
            sku,
            image_url
          )
        `)
        .eq(
          "order_id",
          orderData.id
        )
        .order(
          "product_name_snapshot",
          {
            ascending: true,
          }
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
      (itemData ??
        []) as unknown as OrderItem[];

    setItems(
      loadedItems
    );

    const initialActual:
      Record<
        string,
        string
      > = {};

    loadedItems.forEach(
      (item) => {
        initialActual[
          item.id
        ] =
          String(
            Number(item.addon_requested_qty) > 0
              ? (item.addon_confirmed_qty ?? 0)
              : (item.actual_qty ?? item.confirmed_qty)
          );
      }
    );

    setActual(
      initialActual
    );

    const { data: existingPhotos, error: photoError } = await supabase
      .from("order_files")
      .select("id, file_type, storage_path, original_filename, created_at, is_current")
      .eq("order_id", orderData.id)
      .in("file_type", ["cart_photo", "cart_photo_2"])
      .order("created_at", { ascending: true });

    const currentPhotos = (existingPhotos ?? []).filter((photo) => photo.is_current);
    const firstPhoto = currentPhotos.find((photo) => photo.file_type === "cart_photo");
    const secondPhoto = currentPhotos.find((photo) => photo.file_type === "cart_photo_2");
    setPhotoUploaded([Boolean(!photoError && firstPhoto), Boolean(!photoError && secondPhoto)]);
    setCartPhotoNames([
      !photoError ? firstPhoto?.original_filename ?? null : null,
      !photoError ? secondPhoto?.original_filename ?? null : null,
    ]);

    // A merged order archives the old cart images (is_current=false), it does
    // not delete the database rows or the Storage objects. Display those
    // historical images and ask for NEW photos for the new picking pass.
    if (photoError) {
      setArchivedCartPhotos([]);
      setPhotoHistoryError("ไม่สามารถโหลดรูปรถเข็นเดิมได้: " + photoError.message);
    } else {
      const archived = (existingPhotos ?? []).filter((photo) => !photo.is_current);
      const signed = await Promise.all(archived.map(async (photo) => {
        const { data, error } = await supabase.storage
          .from("order-files")
          .createSignedUrl(photo.storage_path, 60 * 60);
        return {
          id: photo.id,
          file_type: photo.file_type,
          original_filename: photo.original_filename,
          created_at: photo.created_at,
          url: !error && data ? data.signedUrl : null,
        } satisfies ArchivedCartPhoto;
      }));
      setArchivedCartPhotos(signed);
      setPhotoHistoryError("");
    }

    const { data: latestMerge } = await supabase
      .from("order_history")
      .select("details")
      .eq("order_id", orderData.id)
      .eq("action", "items_merged")
      .order("created_at", { ascending: false })
      .limit(1);

    if (latestMerge?.length) {
      const details = latestMerge[0].details as { added_items?: { product_id: string; quantity: number }[] } | null;
      const additions: Record<string, number> = {};
      for (const added of details?.added_items ?? []) {
        if (added.product_id && Number(added.quantity) > 0) {
          additions[added.product_id] = (additions[added.product_id] ?? 0) + Number(added.quantity);
        }
      }
      setMergeAddedQuantities(additions);
    } else {
      setMergeAddedQuantities(null);
    }

    setLoading(false);
  }

  useEffect(() => {
    if (
      !Number.isNaN(
        orderNumber
      )
    ) {
      void loadOrder();
    }
  }, [orderNumber]);

  function closeAddProduct() {
    searchRequestId.current +=
      1;

    setAddProductOpen(
      false
    );

    setProductSearch(
      ""
    );

    setSearchResults(
      []
    );

    setSearchingProducts(
      false
    );

    setSelectedProduct(
      null
    );

    setAddQuantity(
      ""
    );

    setAddProductMessage(
      ""
    );
  }

  async function searchProducts(
    query: string
  ) {
    const trimmed =
      query.trim();

    if (!trimmed) {
      setSearchResults(
        []
      );

      setSearchingProducts(
        false
      );

      return;
    }

    const requestId =
      ++searchRequestId.current;

    setSearchingProducts(
      true
    );

    setAddProductMessage(
      ""
    );

    const {
      data,
      error,
    } =
      await supabase.rpc(
        "search_products_for_my_order",
        {
          p_order_number:
            orderNumber,
          p_query:
            trimmed,
          p_limit:
            20,
        }
      );

    if (
      requestId !==
      searchRequestId.current
    ) {
      return;
    }

    if (error) {
      setSearchResults(
        []
      );

      setAddProductMessage(
        "ไม่สามารถค้นหาสินค้าได้: " +
          error.message
      );

      setSearchingProducts(
        false
      );

      return;
    }

    setSearchResults(
      (data ??
        []) as unknown as SearchProduct[]
    );

    setSearchingProducts(
      false
    );
  }

  useEffect(() => {
    if (
      !addProductOpen ||
      selectedProduct
    ) {
      return;
    }

    const query =
      productSearch.trim();

    if (!query) {
      searchRequestId.current +=
        1;

      setSearchResults(
        []
      );

      setSearchingProducts(
        false
      );

      setAddProductMessage(
        ""
      );

      return;
    }

    const timer =
      window.setTimeout(
        () => {
          void searchProducts(
            query
          );
        },
        350
      );

    return () => {
      window.clearTimeout(
        timer
      );
    };
  }, [
    productSearch,
    addProductOpen,
    selectedProduct,
    orderNumber,
  ]);

  async function addSelectedProduct() {
    if (
      !selectedProduct
    ) {
      return;
    }

    const quantity =
      Number(
        addQuantity
      );

    if (
      !Number.isFinite(
        quantity
      ) ||
      quantity <= 0
    ) {
      setAddProductMessage(
        "กรุณากรอกจำนวนที่มากกว่า 0"
      );

      return;
    }

    setAddingProduct(
      true
    );

    setAddProductMessage(
      ""
    );

    const {
      error,
    } =
      await supabase.rpc(
        "add_product_to_my_order",
        {
          p_order_number:
            orderNumber,
          p_product_id:
            selectedProduct.product_id,
          p_qty:
            quantity,
        }
      );

    if (error) {
      setAddProductMessage(
        "ไม่สามารถเพิ่มสินค้าได้: " +
          error.message
      );

      setAddingProduct(
        false
      );

      return;
    }

    closeAddProduct();

    await loadOrder();
  }

  async function uploadCartPhoto(file: File, index: 0 | 1) {
    if (uploadingPhoto || submitting) return;
    setUploadingPhoto(true);
    setMessage(`กำลังอัปโหลดรูปรถเข็นสินค้า ${index + 1}...`);

    const fileType = index === 0 ? "cart_photo" : "cart_photo_2";
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

      setPhotoUploaded((previous) => previous.map((uploaded, photoIndex) =>
        photoIndex === index ? true : uploaded
      ));
      setCartPhotoNames((previous) => previous.map((name, photoIndex) =>
        photoIndex === index ? file.name : name
      ));
      setMessage(`✓ บันทึกรูปรถเข็นสินค้า ${index + 1} เรียบร้อยแล้ว`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "อัปโหลดรูปไม่สำเร็จ");
    } finally {
      setUploadingPhoto(false);
    }
  }

  async function completePicking() {
    setMessage("");

    if (
      !photoUploaded[0]
    ) {
      setMessage(
        "ต้องอัปโหลดรูปรถเข็นสินค้าก่อนปิดงานจัดสินค้า"
      );

      return;
    }

    const invalidItem =
      actionableItems.find(
        (item) => {
          const value =
            Number(
              actual[
                item.id
              ]
            );

          return (
            Number.isNaN(
              value
            ) ||
            !Number.isFinite(
              value
            ) ||
            value < 0
          );
        }
      );

    if (
      invalidItem
    ) {
      setMessage(
        `${invalidItem.product_name_snapshot}: กรุณากรอกจำนวนที่หยิบจริงให้ถูกต้อง`
      );

      return;
    }

    const missingSku =
      actionableItems.find(
        (item) =>
          !item.products
            ?.sku
      );

    if (missingSku) {
      setMessage(
        `ไม่พบ SKU สำหรับ ${missingSku.product_name_snapshot}`
      );

      return;
    }

    const payload =
      actionableItems.map(
        (item) => ({
          sku:
            item.products!
              .sku,
          actual_qty:
            Number(
              actual[
                item.id
              ]
            ),
        })
      );

    setSubmitting(
      true
    );

    const {
      error,
    } =
      await supabase.rpc(
        "complete_my_picking",
        {
          p_order_number:
            orderNumber,
          p_items:
            payload,
        }
      );

    if (error) {
      setMessage(
        "ไม่สามารถปิดงานจัดสินค้าได้: " +
          error.message
      );

      setSubmitting(
        false
      );

      return;
    }

    router.push(
      "/tasks"
    );

    router.refresh();
  }

  async function releaseTask() {
    const confirmedRelease =
      window.confirm(
        "ต้องการปล่อยงานนี้เพื่อให้พนักงานคนอื่นรับไปดำเนินการหรือไม่?"
      );

    if (
      !confirmedRelease
    ) {
      return;
    }

    const {
      error,
    } =
      await supabase.rpc(
        "release_my_task",
        {
          p_order_number:
            orderNumber,
        }
      );

    if (error) {
      setMessage(
        "ไม่สามารถปล่อยงานได้: " +
          error.message
      );

      return;
    }

    router.push(
      "/tasks"
    );

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
    <main className="min-h-screen bg-gray-100 p-4 md:p-8">
      <div className="max-w-5xl mx-auto">
        <Link
          href="/tasks"
          className="text-gray-500"
        >
          ← กลับไปหน้างาน
        </Link>

        <div className="flex justify-between items-start gap-4 mt-4 mb-8">
          <div>
            <p className="text-sm text-gray-500">
              จัดสินค้า
            </p>

            <h1 className="mt-1 text-2xl font-extrabold leading-tight text-[#17453F] md:text-3xl">
              {order.customers?.customer_name ?? "ไม่ทราบชื่อร้าน"}
            </h1>
            <p className="mt-1 text-xs font-semibold text-[#82958F]">
              คำสั่งซื้อ #{order.order_number}
            </p>
          </div>

          <button
            type="button"
            onClick={
              releaseTask
            }
            className="bg-white border rounded-lg px-4 py-2 shrink-0"
          >
            ปล่อยงาน
          </button>
        </div>

        {mergeAddedQuantities !== null && (
          <div role="status" className="mb-6 rounded-2xl border-2 border-[#FFB74D] bg-[#FFF3E0] p-4 text-[#894600]">
            <p className="font-extrabold">📦 ลูกค้าเพิ่มสินค้าเข้าคำสั่งซื้อเดิม</p>
            <p className="mt-1 text-sm leading-6">
              จำนวนยืนยันและหยิบสินค้ารอบเดิมยังคงอยู่ ไม่ต้องจัดซ้ำ
              กรุณาจัดเฉพาะรายการที่เพิ่มเข้ามา และถ่ายรูปรถเข็นเพิ่มเติมอย่างน้อย 1 รูปก่อนส่งไปออกบิล
            </p>
          </div>
        )}

        <section className="bg-white border rounded-2xl p-6 mb-6">
          <h2 className="font-bold text-lg mb-4">
            ข้อมูลลูกค้าและการจัดส่ง
          </h2>

          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-gray-500">
                เบอร์โทรศัพท์
              </p>

              {order
                .customers
                ?.phone ? (
                <a
                  href={`tel:${order.customers.phone}`}
                  className="underline font-medium"
                >
                  {
                    order
                      .customers
                      .phone
                  }
                </a>
              ) : (
                "—"
              )}
            </div>

            <div>
              <p className="text-sm text-gray-500">
                การจัดส่ง
              </p>

              <DeliverySchedule date={order.delivery_date} slot={order.delivery_slot} />
            </div>
          </div>
        </section>

        <section className="bg-white border rounded-2xl overflow-hidden mb-6">
          <div className="p-6 border-b flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h2 className="font-bold text-lg">
                จำนวนสินค้าที่หยิบจริง
              </h2>

              <p className="text-sm text-gray-500 mt-1">
                กรอกจำนวนที่หยิบได้จริง และสามารถเพิ่มสินค้าทดแทนได้เมื่อจำเป็น
              </p>
            </div>

            <button
              type="button"
              onClick={() => {
                setAddProductOpen(
                  true
                );
              }}
              disabled={
                submitting
              }
              className="bg-black text-white rounded-xl px-5 py-3 font-semibold shrink-0 disabled:opacity-50"
            >
              + เพิ่มสินค้า
            </button>
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
                {actionableItems.map(
                  (item) => {
                    const addedByStaff =
                      Boolean(
                        item.staff_note?.startsWith(
                          "Added by staff during"
                        )
                      );

                    return (
                      <tr
                        key={
                          item.id
                        }
                        className="border-t"
                      >
                        <td className="p-4 min-w-[260px]">
                          <div className="flex items-center gap-3">
                            <ProductThumbnail
                              imageUrl={
                                item
                                  .products
                                  ?.image_url
                              }
                              alt={
                                item.product_name_snapshot
                              }
                            />

                            <div className="font-medium min-w-0">
                              {mergeAddedQuantities?.[item.product_id] ? (
                                <span className="mb-1 inline-block rounded-md bg-[#FFE0B2] px-2 py-1 text-xs font-bold text-[#8B4500]">
                                  ลูกค้าเพิ่ม +{mergeAddedQuantities[item.product_id]} {item.unit_snapshot}
                                </span>
                              ) : null}
                              <div>
                                {
                                  item.product_name_snapshot
                                }
                              </div>
                              {addonMode && (
                                <div className="mt-1 text-xs font-bold text-[#A34D00]">
                                  เพิ่มใหม่ {Number(item.addon_requested_qty)} {item.unit_snapshot}
                                  {item.actual_qty !== null
                                    ? ` · เดิมหยิบแล้ว ${Number(item.actual_qty)} ${item.unit_snapshot}`
                                    : ""}
                                </div>
                              )}

                              {addedByStaff && (
                                <div className="inline-block text-xs font-semibold bg-blue-50 text-blue-700 rounded-full px-2 py-1 mt-1">
                                  เพิ่มโดยพนักงาน
                                </div>
                              )}
                            </div>
                          </div>
                        </td>

                        <td className="p-4">
                          {item
                            .products
                            ?.sku ??
                            "—"}
                        </td>

                        <td className="p-4 text-right whitespace-nowrap">
                          {Number(
                            addonMode ? item.addon_confirmed_qty : item.confirmed_qty
                          )}{" "}
                          {
                            item.unit_snapshot
                          }
                        </td>

                        <td className="p-4">
                          <div className="flex justify-end items-center gap-2">
                            <input
                              type="number"
                              min="0"
                              step="0.001"
                              value={
                                actual[
                                  item.id
                                ] ??
                                ""
                              }
                              onChange={(
                                event
                              ) =>
                                setActual(
                                  {
                                    ...actual,
                                    [item.id]:
                                      event
                                        .target
                                        .value,
                                  }
                                )
                              }
                              className="w-32 border rounded-lg px-3 py-2 text-right"
                            />

                            <span className="text-gray-500 w-10">
                              {
                                item.unit_snapshot
                              }
                            </span>
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

        {addonMode && previouslyCompletedItems.length > 0 && (
          <section className="mb-6 rounded-2xl border bg-[#F8FAF9] p-5">
            <h3 className="text-sm font-extrabold text-[#315E50]">สินค้าที่จัดแล้วในรอบก่อน (ไม่ต้องจัดซ้ำ)</h3>
            <div className="mt-3 space-y-2">
              {previouslyCompletedItems.map((item) => (
                <div key={item.id} className="flex justify-between gap-3 text-xs">
                  <span>{item.product_name_snapshot}</span>
                  <span className="shrink-0 font-semibold">
                    หยิบแล้ว {Number(item.actual_qty ?? 0)} {item.unit_snapshot}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="bg-white border rounded-2xl p-6">
          <h2 className="font-bold text-lg">รูปรถเข็นสินค้า</h2>
          {archivedCartPhotos.length > 0 && (
            <div className="mt-4 mb-5 rounded-xl border border-[#B8EAE5] bg-[#F0FAF8] p-4">
              <h3 className="font-extrabold text-[#006F6A]">
                รูปรถเข็นที่บันทึกไว้ก่อนหน้านี้ ({archivedCartPhotos.length} รูป)
              </h3>
              <p className="mt-1 text-sm text-[#47675D]">
                รูปเดิมไม่ได้ถูกลบ และจะยังปรากฏในประวัติคำสั่งซื้อ กรุณาเพิ่มรูปจากการจัดสินค้ารอบนี้
              </p>
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {archivedCartPhotos.map((photo, i) => (
                  <div key={photo.id} className="rounded-lg border border-[#CEE7E0] bg-white p-2">
                    {photo.url ? (
                      <a href={photo.url} target="_blank" rel="noopener noreferrer">
                        <img src={photo.url} alt={`รูปรถเข็นเดิม ${i + 1}`} loading="lazy" className="h-28 w-full rounded-md object-contain" />
                      </a>
                    ) : (
                      <div className="flex h-28 items-center justify-center rounded-md bg-gray-100 text-xs text-gray-500">ไม่สามารถเปิดภาพได้</div>
                    )}
                    <p className="mt-2 text-xs font-semibold text-[#315E50]">รูปเดิม #{i + 1}</p>
                    <p className="mt-1 truncate text-[11px] text-gray-500">{photo.original_filename ?? "รูปรถเข็น"}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
          {photoHistoryError && (
            <p role="alert" className="mt-3 mb-4 text-sm text-red-700">{photoHistoryError}</p>
          )}
          <p className="text-sm text-gray-500 mt-1 mb-4">
            {mergeAddedQuantities !== null
              ? "เพิ่มรูปรถเข็นจากการจัดสินค้ารอบใหม่อย่างน้อย 1 รูป (เพิ่มรูปที่ 2 ได้ ไม่บังคับ) รูปเดิมจะยังคงอยู่"
              : "ถ่ายรูปรถเข็นอย่างน้อย 1 รูป หลังบันทึกรูปแรกแล้วสามารถเพิ่มรูปที่ 2 ได้ (ไม่บังคับ)"}
          </p>
          <div className="space-y-4">
            <TaskFilePicker
              label={mergeAddedQuantities !== null ? "รูปรถเข็นเพิ่มเติม 1 (จำเป็น)" : "รูปรถเข็นสินค้า 1"}
              chooseLabel={mergeAddedQuantities !== null ? "เพิ่มรูปรถเข็นใหม่" : "ถ่ายหรือเลือกรูปรถเข็น"}
              replaceLabel="เปลี่ยนรูปที่ 1"
              accept="image/*"
              uploaded={photoUploaded[0]}
              uploading={uploadingPhoto}
              disabled={submitting}
              fileName={cartPhotoNames[0]}
              onSelect={(file) => uploadCartPhoto(file, 0)}
            />
            {photoUploaded[0] && (
              <TaskFilePicker
                label={mergeAddedQuantities !== null ? "รูปรถเข็นเพิ่มเติม 2 (ไม่บังคับ)" : "รูปรถเข็นสินค้า 2 (ไม่บังคับ)"}
                chooseLabel="เพิ่มรูปรถเข็นอีก 1 รูป (ไม่บังคับ)"
                replaceLabel="เปลี่ยนรูปที่ 2"
                appearance={photoUploaded[1] ? "default" : "add"}
                accept="image/*"
                uploaded={photoUploaded[1]}
                uploading={uploadingPhoto}
                disabled={submitting}
                fileName={cartPhotoNames[1]}
                onSelect={(file) => uploadCartPhoto(file, 1)}
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
            type="button"
            onClick={
              completePicking
            }
            disabled={submitting || uploadingPhoto || !photoUploaded[0]}
            className="bg-black text-white rounded-lg px-8 py-4 font-semibold disabled:opacity-50"
          >
            {submitting
              ? "กำลังบันทึก..."
              : "จัดสินค้าเสร็จสิ้น"}
          </button>
        </div>
      </div>

      {addProductOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end md:items-center justify-center">
          <div className="bg-white w-full md:max-w-2xl md:rounded-2xl rounded-t-2xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className="p-5 border-b flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold">
                  เพิ่มสินค้าในออเดอร์
                </h2>

                <p className="text-sm text-gray-500 mt-1">
                  ค้นหาสินค้าทดแทนด้วยชื่อสินค้า หรือ SKU
                </p>
              </div>

              <button
                type="button"
                onClick={
                  closeAddProduct
                }
                className="w-10 h-10 rounded-full bg-gray-100 text-xl shrink-0"
                aria-label="ปิด"
              >
                ×
              </button>
            </div>

            <div className="p-5 overflow-y-auto">
              {selectedProduct ? (
                <div>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedProduct(
                        null
                      );

                      setAddQuantity(
                        ""
                      );

                      setAddProductMessage(
                        ""
                      );
                    }}
                    className="text-sm text-gray-500"
                  >
                    ← กลับไปผลการค้นหา
                  </button>

                  <div className="border rounded-2xl p-4 mt-4 flex gap-4">
                    <ProductThumbnail
                      imageUrl={
                        selectedProduct.image_url
                      }
                      alt={
                        selectedProduct.product_name
                      }
                    />

                    <div className="min-w-0">
                      <p className="font-semibold">
                        {
                          selectedProduct.product_name
                        }
                      </p>

                      <p className="text-xs text-gray-500 mt-1">
                        SKU{" "}
                        {
                          selectedProduct.sku
                        }
                      </p>

                      <p className="font-semibold mt-2">
                        ฿
                        {formatPrice(
                          selectedProduct.effective_price
                        )}
                        {" / "}
                        {
                          selectedProduct.unit
                        }
                      </p>
                    </div>
                  </div>

                  <label className="block mt-5">
                    <span className="text-sm font-semibold">
                      จำนวนที่จะเพิ่ม / จำนวนที่หยิบ
                    </span>

                    <div className="flex items-center gap-3 mt-2">
                      <input
                        type="number"
                        min="0.001"
                        step="0.001"
                        value={
                          addQuantity
                        }
                        onChange={(
                          event
                        ) =>
                          setAddQuantity(
                            event
                              .target
                              .value
                          )
                        }
                        className="min-w-0 flex-1 border rounded-xl px-4 py-3"
                        placeholder="0"
                        autoFocus
                      />

                      <span className="text-gray-500 min-w-12">
                        {
                          selectedProduct.unit
                        }
                      </span>
                    </div>
                  </label>

                  <p className="text-xs text-gray-500 mt-2">
                    สินค้านี้จะถูกเพิ่มในออเดอร์และใช้ราคาของลูกค้ารายนี้ ณ เวลาที่เพิ่ม
                  </p>

                  {addProductMessage && (
                    <div className="mt-4 bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-sm">
                      {
                        addProductMessage
                      }
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={
                      addSelectedProduct
                    }
                    disabled={
                      addingProduct
                    }
                    className="w-full bg-black text-white rounded-xl px-5 py-4 font-semibold mt-5 disabled:opacity-50"
                  >
                    {addingProduct
                      ? "กำลังเพิ่มสินค้า..."
                      : "ยืนยันเพิ่มสินค้า"}
                  </button>
                </div>
              ) : (
                <div>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">
                      🔍
                    </span>

                    <input
                      value={
                        productSearch
                      }
                      onChange={(
                        event
                      ) =>
                        setProductSearch(
                          event
                            .target
                            .value
                        )
                      }
                      placeholder="ค้นหาชื่อสินค้า หรือ SKU"
                      className="w-full bg-gray-100 rounded-xl pl-11 pr-4 py-3 outline-none focus:ring-2 focus:ring-gray-300"
                      autoFocus
                    />
                  </div>

                  {addProductMessage && (
                    <div className="mt-4 bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-sm">
                      {
                        addProductMessage
                      }
                    </div>
                  )}

                  <div className="mt-4 space-y-2">
                    {!productSearch.trim() ? (
                      <div className="text-center text-gray-500 py-10">
                        พิมพ์ชื่อสินค้า หรือ SKU เพื่อค้นหา
                      </div>
                    ) : searchingProducts ? (
                      <div className="text-center text-gray-500 py-10">
                        กำลังค้นหา...
                      </div>
                    ) : searchResults.length ===
                      0 ? (
                      <div className="text-center text-gray-500 py-10">
                        ไม่พบสินค้า
                      </div>
                    ) : (
                      searchResults.map(
                        (
                          product
                        ) => (
                          <button
                            type="button"
                            key={
                              product.product_id
                            }
                            onClick={() => {
                              setSelectedProduct(
                                product
                              );

                              setAddQuantity(
                                ""
                              );

                              setAddProductMessage(
                                ""
                              );
                            }}
                            className="w-full text-left border rounded-xl p-3 flex items-center gap-3 hover:bg-gray-50"
                          >
                            <ProductThumbnail
                              imageUrl={
                                product.image_url
                              }
                              alt={
                                product.product_name
                              }
                              size="small"
                            />

                            <div className="min-w-0 flex-1">
                              <p className="font-semibold text-sm">
                                {
                                  product.product_name
                                }
                              </p>

                              <p className="text-xs text-gray-500 mt-1">
                                SKU{" "}
                                {
                                  product.sku
                                }
                              </p>

                              <p className="text-sm font-semibold mt-1">
                                ฿
                                {formatPrice(
                                  product.effective_price
                                )}
                                {" / "}
                                {
                                  product.unit
                                }
                              </p>
                            </div>

                            <span className="text-sm font-semibold text-gray-600">
                              เลือก
                            </span>
                          </button>
                        )
                      )
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
