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

type OrderDetails = {
  id: string;
  order_number: number;
  group_root_order_id: string | null;
  group_sequence: number | null;
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
  requested_qty: number | string;
  addon_requested_qty: number | string;
  addon_confirmed_qty: number | string | null;
  actual_qty: number | string | null;
  confirmed_qty:
    | number
    | string
    | null;
  unit_snapshot: string;
  staff_note: string | null;
  products: {
    sku: string;
    image_url: string | null;
  } | null;
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

export default function ConfirmationPage() {
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
  const [groupDisplayNumber, setGroupDisplayNumber] = useState<string | null>(null);

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
  // A SKU can appear in both sections if the customer added more of an
  // originally ordered product. The original portion is always shown below,
  // while only the additional quantity is editable in the new-items table.
  const originalItems = addonMode
    ? items.filter((item) =>
        Number(item.requested_qty) - Number(item.addon_requested_qty) > 0
      )
    : [];

  const [
    confirmed,
    setConfirmed,
  ] =
    useState<
      Record<
        string,
        string
      >
    >({});

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
          group_root_order_id,
          group_sequence,
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

    const selectedOrder = orderData as unknown as OrderDetails;
    setOrder(selectedOrder);
    if (selectedOrder.group_root_order_id) {
      const {data:root} = await supabase.from("orders")
        .select("order_number").eq("id",selectedOrder.group_root_order_id).maybeSingle();
      setGroupDisplayNumber(`${root?.order_number ?? selectedOrder.order_number}/${selectedOrder.group_sequence ?? 1}`);
    } else setGroupDisplayNumber(null);

    const {
      data: itemData,
      error: itemError,
    } =
      await supabase
        .from("order_items")
        .select(`
          id,
          product_name_snapshot,
          requested_qty,
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

    const initialConfirmed:
      Record<
        string,
        string
      > = {};

    loadedItems.forEach(
      (item) => {
        initialConfirmed[
          item.id
        ] =
          String(
            Number(item.addon_requested_qty) > 0
              ? (item.addon_confirmed_qty ?? item.addon_requested_qty)
              : (item.confirmed_qty ?? item.requested_qty)
          );
      }
    );

    setConfirmed(
      initialConfirmed
    );

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

  async function completeConfirmation() {
    setMessage("");

    const invalidItem = actionableItems.find((item) => {
      const rawValue = confirmed[item.id];
      const value = Number(rawValue);

      // Confirmed quantities may exceed what the customer ordered.
      // Reject blank, negative, and non-finite values only.
      return (
        rawValue === undefined ||
        String(rawValue).trim() === "" ||
        !Number.isFinite(value) ||
        value < 0
      );
    });

    if (invalidItem) {
      setMessage(
        `${invalidItem.product_name_snapshot}: กรุณากรอกจำนวนที่ยืนยันให้ถูกต้อง (0 หรือมากกว่า)`
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
          confirmed_qty:
            Number(
              confirmed[
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
        "complete_my_confirmation",
        {
          p_order_number:
            orderNumber,
          p_items:
            payload,
        }
      );

    if (error) {
      setMessage(
        "ไม่สามารถปิดงานเช็คสต็อกได้: " +
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
        <p>
          ไม่พบคำสั่งซื้อ
        </p>

        <Link href="/tasks">
          ← กลับไปหน้างาน
        </Link>
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
              เช็คสต็อก
            </p>

            <h1 className="mt-1 text-2xl font-extrabold leading-tight text-[#17453F] md:text-3xl">
              {order.customers?.customer_name ?? "ไม่ทราบชื่อร้าน"}
            </h1>
            <p className="mt-1 text-xs font-semibold text-[#82958F]">
              คำสั่งซื้อ #{groupDisplayNumber ?? order.order_number}
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

        <section className="bg-white border rounded-2xl p-6 mb-6">
          <h2 className="text-lg font-bold mb-4">
            ข้อมูลลูกค้าและการจัดส่ง
          </h2>

          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-gray-500">
                ผู้ติดต่อ
              </p>

              <p className="font-medium">
                {order
                  .customers
                  ?.contact_name ??
                  "—"}
              </p>
            </div>

            <div>
              <p className="text-sm text-gray-500">
                เบอร์โทรศัพท์
              </p>

              {order
                .customers
                ?.phone ? (
                <a
                  href={`tel:${order.customers.phone}`}
                  className="font-medium underline"
                >
                  {
                    order
                      .customers
                      .phone
                  }
                </a>
              ) : (
                <p>
                  —
                </p>
              )}
            </div>

            <div>
              <p className="text-sm text-gray-500">
                การจัดส่ง
              </p>

              <DeliverySchedule date={order.delivery_date} slot={order.delivery_slot} />
            </div>

            <div>
              <p className="text-sm text-gray-500">
                ที่อยู่จัดส่ง
              </p>

              <p className="font-medium">
                {order.delivery_address ??
                  "—"}
              </p>
            </div>
          </div>

          {order.customer_notes && (
            <div className="mt-5">
              <p className="text-sm text-gray-500">
                หมายเหตุจากลูกค้า
              </p>

              <p className="mt-1">
                {
                  order.customer_notes
                }
              </p>
            </div>
          )}
        </section>

        <section className="bg-white border rounded-2xl overflow-hidden">
          <div className="p-6 border-b flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold">
                {addonMode
                  ? `สินค้าเพิ่มเติมที่ต้องเช็คสต็อก (${actionableItems.length} รายการ)`
                  : "เช็คสต็อกและระบุจำนวนที่มี"}
              </h2>

              <p className="text-gray-500 text-sm mt-1">
                {addonMode
                  ? "เช็คสต็อกเฉพาะสินค้าเพิ่มเติม จำนวนที่ยืนยันและหยิบไว้เดิมจะไม่เปลี่ยนแปลง"
                  : "ลดจำนวนสินค้าเดิมได้ และสามารถเพิ่มสินค้าทดแทนได้เมื่อจำเป็น"}
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
                    จำนวนที่สั่ง
                  </th>

                  <th className="text-right p-4">
                    จำนวนที่ยืนยัน
                  </th>
                </tr>
              </thead>

              <tbody>
                {actionableItems.map(
                  (item) => {
                    const requested =
                      Number(
                        addonMode ? item.addon_requested_qty : item.requested_qty
                      );

                    const confirmedValue =
                      Number(
                        confirmed[
                          item.id
                        ] ??
                          0
                      );

                    const reduced =
                      confirmedValue <
                      requested;

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

                            <div className="min-w-0">
                              <div className="font-medium">
                                {
                                  item.product_name_snapshot
                                }
                              </div>

                              {addedByStaff && (
                                <div className="inline-block text-xs font-semibold bg-blue-50 text-blue-700 rounded-full px-2 py-1 mt-1">
                                  เพิ่มโดยพนักงาน
                                </div>
                              )}

                              {reduced && (
                                <div className="text-sm text-red-600 mt-1">
                                  {addedByStaff
                                    ? "ลดจากจำนวนที่เพิ่มเข้ามา"
                                    : "ลดจากจำนวนที่ลูกค้าสั่ง"}
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
                          {
                            requested
                          }{" "}
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
                                confirmed[
                                  item.id
                                ] ??
                                ""
                              }
                              onChange={(
                                event
                              ) =>
                                setConfirmed(
                                  {
                                    ...confirmed,
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

        {addonMode && (
          <section className="mt-5 overflow-hidden rounded-2xl border border-[#CFE3DD] bg-white">
            <div className="border-b border-[#DCE9E4] bg-[#F0F7F4] px-5 py-4">
              <h3 className="text-base font-extrabold text-[#234C40]">
                สินค้าในคำสั่งซื้อเดิม ({originalItems.length} รายการ)
              </h3>
              <p className="mt-1 text-sm leading-6 text-[#577268]">
                ดูจำนวนที่สั่ง ยืนยัน และหยิบไว้ก่อนหน้าได้ที่นี่ โดยไม่ต้องยืนยันซ้ำ
                ถ้าลูกค้าเพิ่ม SKU เดิม สินค้านั้นจะแสดงทั้งสองส่วน แต่แยกจำนวนเดิมกับจำนวนเพิ่ม
              </p>
            </div>
            {originalItems.length > 0 ? (
              <div className="divide-y divide-[#E5EFEB]">
                {originalItems.map((item) => {
                  const originalRequested = Math.max(
                    0, Number(item.requested_qty) - Number(item.addon_requested_qty)
                  );
                  return (
                    <div key={item.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex min-w-0 items-center gap-3">
                        <ProductThumbnail
                          imageUrl={item.products?.image_url}
                          alt={item.product_name_snapshot}
                        />
                        <div className="min-w-0">
                          <p className="font-semibold text-[#24473F]">{item.product_name_snapshot}</p>
                          <p className="mt-1 text-xs text-[#71877E]">SKU {item.products?.sku ?? "—"}</p>
                          {Number(item.addon_requested_qty) > 0 && (
                            <span className="mt-2 inline-block rounded-full bg-[#FFF3D4] px-2 py-1 text-xs font-bold text-[#8A6000]">
                              สินค้าเดียวกับรายการเพิ่มเติมด้านบน
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-3 rounded-xl bg-[#F6FAF8] px-3 py-3 text-center sm:min-w-[280px]">
                        <div>
                          <p className="text-xs text-[#72877D]">สั่งเดิม</p>
                          <p className="mt-1 text-sm font-bold">{originalRequested} {item.unit_snapshot}</p>
                        </div>
                        <div>
                          <p className="text-xs text-[#72877D]">ยืนยันเดิม</p>
                          <p className="mt-1 text-sm font-bold">
                            {item.confirmed_qty === null ? "ยังไม่ยืนยัน" : `${Number(item.confirmed_qty)} ${item.unit_snapshot}`}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-[#72877D]">หยิบเดิม</p>
                          <p className="mt-1 text-sm font-bold">
                            {item.actual_qty === null ? "ยังไม่หยิบ" : `${Number(item.actual_qty)} ${item.unit_snapshot}`}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="p-5 text-sm text-[#71877E]">คำสั่งซื้อเดิมยังไม่มีสินค้าอื่น</p>
            )}
          </section>
        )}

        {message && (
          <div className="mt-6 border bg-white rounded-lg p-4 text-red-600">
            {message}
          </div>
        )}

        <div className="flex justify-end mt-6">
          <button
            type="button"
            onClick={
              completeConfirmation
            }
            disabled={
              submitting
            }
            className="bg-black text-white rounded-lg px-8 py-4 font-semibold disabled:opacity-50"
          >
            {submitting
              ? "กำลังบันทึก..."
              : "เช็คสต็อกเสร็จสิ้น"}
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
                      จำนวนที่ยืนยัน
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
