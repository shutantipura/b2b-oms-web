import { loadAuthorizedLineCustomerLinks } from "@/lib/server/lineCustomerAccess";
import { createHash } from "node:crypto";
import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  createClient,
} from "@supabase/supabase-js";

import {
  DELIVERY_RULES,
  getBangkokToday,
  getDeliveryOptions,
  validateDeliverySelection,
} from "../../../../lib/deliveryRules";
import { findChosenMerge } from "../../../../lib/orderMergeChoices";
import { validateDeliveryLocations } from "@/lib/deliveryLocations";

// =====================================================
// TYPES
// =====================================================

type Cart = Record<
  string,
  number
>;

type CheckoutItem = {
  id: string;
  sku: string;
  productName: string;
  unit: string;
  quantity: number;
  isPiece: boolean;
  normalPrice: number;
  effectivePrice: number;
  hasSpecialPrice: boolean;
  estimatedSubtotal: number;
};

type LineVerifyResponse = {
  sub?: string;
  name?: string;
  error?: string;
  error_description?: string;
};

type LineUserRow = {
  id: string;
  is_active: boolean;
};

type CustomerRow = {
  id: string;
  customer_code: string;
  customer_name: string;
  delivery_address:
    | string
    | null;
  delivery_map_url: string | null;
  delivery_map_url_2: string | null;
  delivery_location_1_name: string | null;
  delivery_location_2_name: string | null;
  updated_at: string;
  is_active: boolean;
};

type CustomerLinkRow = {
  customer_id: string;
  can_order: boolean;

  customers:
    | CustomerRow
    | CustomerRow[]
    | null;
};

type ProductRow = {
  is_customer_out_of_stock: boolean;
  id: string;
  sku: string;
  product_name: string;
  unit: string;
  normal_price:
    | number
    | string;
};

type PriceRow = {
  product_id: string;
  agreed_price:
    | number
    | string;
};

// =====================================================
// VERIFY LINE + CUSTOMER
// =====================================================

async function verifyLineAndCustomer(
  idToken: string,
  customerCode: string
) {
  const channelId =
    process.env.LINE_CHANNEL_ID;

  const supabaseUrl =
    process.env
      .NEXT_PUBLIC_SUPABASE_URL;

  const supabaseSecret =
    process.env
      .SUPABASE_SECRET_KEY;

  if (
    !channelId ||
    !supabaseUrl ||
    !supabaseSecret
  ) {
    throw new Error(
      "Server configuration is incomplete."
    );
  }

  // -------------------------------------------------
  // 1. VERIFY LINE ID TOKEN
  // -------------------------------------------------

  const verifyBody =
    new URLSearchParams();

  verifyBody.set(
    "id_token",
    idToken
  );

  verifyBody.set(
    "client_id",
    channelId
  );

  const lineResponse =
    await fetch(
      "https://api.line.me/oauth2/v2.1/verify",
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/x-www-form-urlencoded",
        },

        body:
          verifyBody.toString(),

        cache:
          "no-store",
      }
    );

  const lineData =
    (await lineResponse.json()) as LineVerifyResponse;

  if (
    !lineResponse.ok ||
    !lineData.sub
  ) {
    console.error(
      "LINE verification failed:",
      lineData
    );

    throw new Error("LINE_ID_TOKEN_INVALID");
  }

  // -------------------------------------------------
  // 2. SERVER-SIDE SUPABASE
  // -------------------------------------------------

  // The client is inferred from createClient; database rows are
  // validated and shaped explicitly at the query boundaries.
  const supabase =
    createClient(
      supabaseUrl,
      supabaseSecret,
      {
        auth: {
          persistSession:
            false,

          autoRefreshToken:
            false,
        },
      }
    );

  // -------------------------------------------------
  // 3. FIND LINE USER
  // -------------------------------------------------

  const {
    data: lineUserData,
    error: lineUserError,
  } =
    await supabase
      .from("line_users")
      .select(`
        id,
        is_active
      `)
      .eq(
        "line_user_id",
        lineData.sub
      )
      .maybeSingle();

  if (lineUserError) {
    console.error(
      "LINE user query:",
      lineUserError
    );

    throw new Error(
      "Could not check LINE account."
    );
  }

  const lineUser =
    lineUserData as
      | LineUserRow
      | null;

  if (!lineUser) {
    throw new Error(
      "LINE account is not registered."
    );
  }

  if (
    !lineUser.is_active
  ) {
    throw new Error(
      "This LINE account is inactive."
    );
  }

  // -------------------------------------------------
  // 4. LOAD AUTHORIZED CUSTOMER LINKS
  // -------------------------------------------------

  const { data: linkData, error: linkError } =
      await loadAuthorizedLineCustomerLinks(supabase, lineData.sub, lineUser.id);

  if (linkError) {
    console.error(
      "Customer authorization query:",
      linkError
    );

    throw new Error(
      "Could not check customer authorization."
    );
  }

  const links =
    (
      linkData ??
      []
    ) as CustomerLinkRow[];

  const normalizedCode =
    customerCode
      .trim()
      .toUpperCase();

  let selectedCustomer:
    CustomerRow | null =
    null;

  for (
    const link of links
  ) {
    const rawCustomer =
      link.customers;

    const customer =
      Array.isArray(
        rawCustomer
      )
        ? rawCustomer[0]
        : rawCustomer;

    if (
      !customer
    ) {
      continue;
    }

    if (
      customer.is_active &&
      customer.customer_code
        .trim()
        .toUpperCase() ===
        normalizedCode
    ) {
      selectedCustomer =
        customer;

      break;
    }
  }

  if (
    !selectedCustomer
  ) {
    throw new Error(
      "You are not authorized to order for this customer."
    );
  }

  return {
    supabase,
    customer: selectedCustomer,
    verifiedLineUserId: lineUser.id,
  };
}

function savedDeliveryLocations(customer: CustomerRow) {
  return [
    { label: (!customer.delivery_location_1_name?.trim() || customer.delivery_location_1_name.trim() === "จุดส่ง 1")
      ? customer.customer_name : customer.delivery_location_1_name.trim(),
      url: customer.delivery_map_url ?? customer.delivery_address ?? "" },
    ...(customer.delivery_map_url_2
      ? [{ label: customer.delivery_location_2_name?.trim() || "จุดส่ง 2",
           url: customer.delivery_map_url_2 }] : []),
  ].filter((location) => location.url);
}

// =====================================================
// BUILD / VERIFY CART
// =====================================================

async function buildCart(
  supabase: Awaited<ReturnType<typeof verifyLineAndCustomer>>["supabase"],
  customerId: string,
  cart: Cart,
  pieceProductIds: string[]
): Promise<
  CheckoutItem[]
> {
  // -------------------------------------------------
  // 1. SANITIZE CART
  // -------------------------------------------------

  const validCart: Cart =
    {};

  for (
    const [
      productId,
      rawQuantity,
    ] of Object.entries(
      cart ?? {}
    )
  ) {
    const quantity =
      Number(
        rawQuantity
      );

    if (
      !productId
    ) {
      continue;
    }

    if (
      !Number.isFinite(
        quantity
      )
    ) {
      continue;
    }

    if (
      quantity <= 0
    ) {
      continue;
    }

    validCart[
      productId
    ] =
      quantity;
  }

  const productIds =
    Object.keys(
      validCart
    );

  if (
    productIds.length ===
    0
  ) {
    throw new Error(
      "Your cart is empty."
    );
  }

  // -------------------------------------------------
  // 2. LOAD ACTIVE PRODUCTS
  // -------------------------------------------------

  const {
    data: productData,
    error: productError,
  } =
    await supabase
      .from("products")
      .select(`
        id,
        sku,
        product_name,
        unit,
        normal_price,
        is_customer_out_of_stock
      `)
      .eq(
        "is_active",
        true
      )
      .in(
        "id",
        productIds
      );

  if (productError) {
    console.error(
      "Product query:",
      productError
    );

    throw new Error(
      "Could not load products."
    );
  }

  const products =
    (
      productData ??
      []
    ) as ProductRow[];

  if (
    products.length !==
    productIds.length
  ) {
    throw new Error(
      "One or more products in your cart are no longer available."
    );
  }

  const unavailable = products.filter(product => product.is_customer_out_of_stock);
  if (unavailable.length > 0) {
    throw new Error(
      "สินค้าหมดชั่วคราว กรุณากลับไปนำออกจากตะกร้า: " +
      unavailable.slice(0, 5).map(product => product.product_name + " (SKU " + product.sku + ")").join(", ")
    );
  }

  // -------------------------------------------------
  // 3. LOAD CUSTOMER SPECIAL PRICES
  // -------------------------------------------------

  const {
    data: priceData,
    error: priceError,
  } =
    await supabase
      .from(
        "customer_prices"
      )
      .select(`
        product_id,
        agreed_price
      `)
      .eq(
        "customer_id",
        customerId
      )
      .eq(
        "is_active",
        true
      )
      .in(
        "product_id",
        productIds
      );

  if (priceError) {
    console.error(
      "Customer price query:",
      priceError
    );

    throw new Error(
      "Could not load customer pricing."
    );
  }

  const prices =
    (
      priceData ??
      []
    ) as PriceRow[];

  const priceMap =
    new Map<
      string,
      number
    >();

  for (
    const price of prices
  ) {
    priceMap.set(
      price.product_id,
      Number(
        price.agreed_price
      )
    );
  }

  // -------------------------------------------------
  // 4. BUILD CHECKOUT ITEMS
  // -------------------------------------------------

  const selectedPieces = new Set(pieceProductIds);
  const checkoutItems:
    CheckoutItem[] =
    products.map(
      (
        product:
          ProductRow
      ) => {
        const specialPrice =
          priceMap.get(
            product.id
          );

        const normalPrice =
          Number(
            product.normal_price
          );

        const effectivePrice =
          specialPrice ??
          normalPrice;

        const quantity =
          Number(
            validCart[
              product.id
            ]
          );
        const requestedPieces = selectedPieces.has(product.id);
        const kgPriced = /kg|กก|กิโล/i.test(product.unit);
        if (requestedPieces && (!kgPriced ||
          !Number.isSafeInteger(quantity) || quantity > 1000)) {
          throw new Error("สั่งเป็นชิ้นได้เฉพาะสินค้าคิดราคาเป็น กก. และจำนวนต้องเป็นจำนวนเต็ม 1–1,000 ชิ้น");
        }
        return {
          id:
            product.id,

          sku:
            product.sku,

          productName:
            product.product_name,

          unit:
            product.unit,

          quantity,
          isPiece: requestedPieces,

          normalPrice,

          effectivePrice,

          hasSpecialPrice:
            specialPrice !==
            undefined,

          // Piece count is NOT a weight. Never multiply by per-kg price.
          estimatedSubtotal:
            requestedPieces ? 0 : quantity * effectivePrice,
        };
      }
    );

  return checkoutItems;
}

// =====================================================
// READ ORDER NUMBER FROM RPC
// =====================================================

function extractOrderNumber(
  data: unknown
):
  | number
  | null {
  // --------------------------------
  // Example:
  // 15
  // --------------------------------

  if (
    typeof data ===
      "number"
  ) {
    return data;
  }

  // --------------------------------
  // Example:
  // "15"
  // --------------------------------

  if (
    typeof data ===
      "string"
  ) {
    const value =
      Number(data);

    return Number.isFinite(
      value
    )
      ? value
      : null;
  }

  // --------------------------------
  // Example:
  // [{ order_number: 15 }]
  // --------------------------------

  if (
    Array.isArray(data)
  ) {
    if (
      data.length ===
      0
    ) {
      return null;
    }

    return extractOrderNumber(
      data[0]
    );
  }

  // --------------------------------
  // Example:
  // { order_number: 15 }
  // --------------------------------

  if (
    data &&
    typeof data ===
      "object"
  ) {
    const record =
      data as Record<
        string,
        unknown
      >;

    if (
      "order_number" in
      record
    ) {
      return extractOrderNumber(
        record.order_number
      );
    }

    // Sometimes RPCs may return:
    // { orderNumber: 15 }

    if (
      "orderNumber" in
      record
    ) {
      return extractOrderNumber(
        record.orderNumber
      );
    }
  }

  return null;
}

// =====================================================
// MERGE CANDIDATES
// =====================================================

// This is only a preview. The database RPC repeats all checks
// while locking the primary order so billing cannot start mid-merge.
async function findMergeCandidates(supabase: Awaited<ReturnType<typeof verifyLineAndCustomer>>["supabase"], customerId: string, deliveryDate: string, deliveryAddress: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(deliveryDate)) return [];

  const { data: orders, error: orderError } = await supabase
    .from("orders")
    .select("id, order_number, delivery_date, delivery_slot, delivery_address, status, group_root_order_id, group_sequence, created_at")
    .eq("customer_id", customerId)
    .eq("delivery_date", deliveryDate)
    .eq("delivery_address", deliveryAddress)
    .in("status", ["awaiting_confirmation", "awaiting_picking", "picking", "awaiting_billing"])
    .is("final_amount", null)
    .order("created_at", { ascending: true })
    .limit(100);

  if (orderError) throw new Error("Could not check existing deliveries: " + orderError.message);
  if (!orders?.length) return [];

  const roots = orders.filter((order: { id: string; group_root_order_id: string | null }) =>
    !order.group_root_order_id || order.group_root_order_id === order.id);
  const ids: string[] = roots.map((order: { id: string }) => order.id);
  if (!ids.length) return [];

  // A grouped order can have a billing attempt on a /x member rather than
  // its primary order. Check every member, not just the root, before offering.
  const membersResult = await supabase.from("orders")
    .select("id,group_root_order_id,status,final_amount")
    .in("group_root_order_id", ids);
  if (membersResult.error) throw new Error("Could not verify grouped-order status.");
  const members = membersResult.data ?? [];
  const memberRoot = new Map<string, string>(ids.map(id => [id, id]));
  const blocked = new Set<string>();
  const beforeBilling = new Set(["awaiting_confirmation", "awaiting_picking", "picking", "awaiting_billing"]);
  for (const member of members) {
    const rootId = member.group_root_order_id ?? member.id;
    memberRoot.set(member.id, rootId);
    if (member.id !== rootId && member.status !== "cancelled" &&
        (!beforeBilling.has(member.status) || member.final_amount !== null)) {
      blocked.add(rootId);
    }
  }
  const allIds = [...new Set([...ids, ...members.map(member => member.id)])];
  const [claimResult, fileResult] = await Promise.all([
    supabase.from("task_claims").select("order_id").in("order_id", allIds).eq("stage", "billing"),
    supabase.from("order_files").select("order_id").in("order_id", allIds).in("file_type", ["bill", "payment_qr"]),
  ]);
  if (claimResult.error || fileResult.error) {
    throw new Error("Could not verify whether an existing order has entered billing.");
  }
  for (const record of [...(claimResult.data ?? []), ...(fileResult.data ?? [])]) {
    blocked.add(memberRoot.get(record.order_id) ?? record.order_id);
  }

  return roots.filter((order: { id: string; delivery_address: string }) => !blocked.has(order.id) && order.delivery_address === deliveryAddress).map(
    (order: { order_number: number; delivery_date: string; delivery_slot: string; status: string; delivery_address: string }) => ({
      orderNumber: order.order_number,
      deliveryDate: order.delivery_date,
      deliverySlot: order.delivery_slot,
      deliveryAddress: order.delivery_address,
      status: order.status,
    })
  );
}

// =====================================================
// POST
// =====================================================

export async function POST(
  request: NextRequest
) {
  try {
    const body =
      await request.json();

    // -------------------------------------------------
    // ACTION
    // -------------------------------------------------

    const action: "load" | "submit" | "merge-options" | "save-locations" =
      body.action === "submit" ? "submit"
        : body.action === "merge-options" ? "merge-options"
          : body.action === "save-locations" ? "save-locations"
            : "load";

    // -------------------------------------------------
    // LINE TOKEN
    // -------------------------------------------------

    const idToken =
      typeof body.idToken ===
      "string"
        ? body.idToken
        : "";

    if (
      !idToken
    ) {
      return NextResponse.json(
        {
          error:
            "LINE ID token is required.",
        },
        {
          status: 400,
        }
      );
    }

    // -------------------------------------------------
    // CUSTOMER CODE
    // -------------------------------------------------

    const customerCode =
      typeof body.customerCode ===
      "string"
        ? body.customerCode
            .trim()
            .toUpperCase()
        : "";

    if (
      !customerCode
    ) {
      return NextResponse.json(
        {
          error:
            "Customer is required.",
        },
        {
          status: 400,
        }
      );
    }

    // -------------------------------------------------
    // CART
    // -------------------------------------------------

    const cart: Cart =
      {};

    if (
      body.cart &&
      typeof body.cart ===
        "object" &&
      !Array.isArray(
        body.cart
      )
    ) {
      const entries =
        Object.entries(
          body.cart as Record<
            string,
            unknown
          >
        );

      for (
        const [
          key,
          value,
        ] of entries
      ) {
        cart[key] =
          Number(
            value
          );
      }
    }

    // -------------------------------------------------
    // AUTHORIZATION
    // -------------------------------------------------

    const {
      supabase,
      customer,
      verifiedLineUserId,
    } =
      await verifyLineAndCustomer(
        idToken,
        customerCode
      );

    // -------------------------------------------------
    // AUTHORIZED CUSTOMER LOCATION EDIT
    // All edits are scoped to the LINE-authorized customer record.
    // Existing orders keep their original delivery_address snapshots.
    // -------------------------------------------------
    if (action === "save-locations") {
      let locations;
      try {
        locations = validateDeliveryLocations(body.locations);
      } catch (error) {
        return NextResponse.json(
          { error: error instanceof Error ? error.message : "ข้อมูลจุดส่งไม่ถูกต้อง" },
          { status: 400 }
        );
      }

      if (typeof body.expectedLocationsVersion !== "string" ||
          body.expectedLocationsVersion !== customer.updated_at) {
        return NextResponse.json(
          { error: "ข้อมูลจุดส่งเปลี่ยนไปแล้ว กรุณาโหลดหน้านี้ใหม่" },
          { status: 409 }
        );
      }

      const { data: updated, error: saveError } = await supabase
        .from("customers")
        .update({
          delivery_address: locations[0]?.url ?? null,
          delivery_map_url: locations[0]?.url ?? null,
          delivery_location_1_name: locations[0]?.label ?? customer.customer_name,
          delivery_map_url_2: locations[1]?.url ?? null,
          delivery_location_2_name: locations[1]?.label ?? "จุดส่ง 2",
          updated_at: new Date().toISOString(),
        })
        .eq("id", customer.id)
        .eq("is_active", true)
        .eq("updated_at", customer.updated_at)
        .select("updated_at")
        .maybeSingle();
      if (saveError) {
        console.error("Save customer delivery locations:", saveError);
        return NextResponse.json({ error: "ไม่สามารถบันทึกจุดส่งได้" }, { status: 500 });
      }
      if (!updated) {
        return NextResponse.json(
          { error: "มีการแก้ไขข้อมูลลูกค้าระหว่างบันทึก กรุณาโหลดหน้าใหม่" },
          { status: 409 }
        );
      }
      return NextResponse.json({
        customer: {
          id: customer.id,
          customerCode: customer.customer_code,
          customerName: customer.customer_name,
          deliveryAddress: locations[0]?.url ?? "",
          deliveryLocations: locations,
          locationsVersion: updated.updated_at,
        },
      });
    }

    // -------------------------------------------------
    // CART DATA
    // -------------------------------------------------

    const pieceProductIds = Array.isArray(body.pieceProductIds)
      ? body.pieceProductIds.filter((id: unknown): id is string =>
          typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id)).slice(0, 200)
      : [];
    // Recover a previously committed order BEFORE stock, prices, locations,
    // delivery cutoffs or a group's billing state are checked again. A lost
    // response must never turn a successful order into an apparent failure.
    let retryRequestId: string | null = null;
    let checkoutIntentHash: string | null = null;
    if (action === "submit") {
      const suppliedId = typeof body.requestId === "string" ? body.requestId : "";
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(suppliedId)) {
        return NextResponse.json({
          error: "กรุณาโหลดหน้าสั่งซื้อใหม่ก่อนยืนยัน เพื่อป้องกันการสั่งซื้อซ้ำ"
        }, { status: 400 });
      }
      retryRequestId = suppliedId;
      // Fingerprint only the customer's confirmed checkout intent, never
      // volatile product prices, stock, or the current clock time.
      const intent = {
        customerId: customer.id,
        cart: Object.entries(cart).sort(([a], [b]) => a.localeCompare(b)),
        pieceProductIds: [...new Set(pieceProductIds)].sort(),
        deliveryDate: typeof body.deliveryDate === "string" ? body.deliveryDate : "",
        deliverySlot: typeof body.deliverySlot === "string" ? body.deliverySlot : "",
        deliveryAddress: body.fulfillmentMethod === "pickup" ? "" :
          (typeof body.deliveryAddress === "string" ? body.deliveryAddress.trim() : ""),
        fulfillmentMethod: body.fulfillmentMethod === "pickup" ? "pickup" : "delivery",
        notes: typeof body.notes === "string" ? body.notes.trim() : "",
        mergeIntoOrderNumber: body.mergeConsent === true ? body.mergeIntoOrderNumber ?? null : null,
      };
      checkoutIntentHash = createHash("sha256").update(JSON.stringify(intent)).digest("hex");
      const { data: replay, error: replayError } = await supabase.rpc(
        "lookup_checkout_order_retry", {
          p_request_id: retryRequestId, p_customer_id: customer.id,
          p_line_user_id: verifiedLineUserId, p_intent_hash: checkoutIntentHash,
        }
      );
      if (replayError) {
        const conflicting = replayError.message.includes("different order details");
        if (!conflicting) console.error("Checkout replay lookup:", replayError);
        return NextResponse.json({
          error: conflicting
            ? "คำขอเดิมถูกใช้กับรายการสินค้าอื่นแล้ว กรุณาลองส่งคำสั่งซื้อใหม่"
            : "ไม่สามารถตรวจสอบสถานะคำสั่งซื้อเดิมได้ กรุณาลองอีกครั้ง",
        }, { status: conflicting ? 409 : 503 });
      }
      if (replay && typeof replay === "object") {
        const saved = replay as Record<string, unknown>;
        const replayOrderNumber = extractOrderNumber(saved);
        if (replayOrderNumber === null) {
          return NextResponse.json({ error: "ไม่สามารถอ่านหมายเลขคำสั่งซื้อเดิมได้" },
            { status: 503 });
        }
        return NextResponse.json({
          success: true, orderNumber: replayOrderNumber,
          fulfillmentMethod: saved.fulfillment_method === "pickup" ? "pickup" : "delivery",
          grouped: saved.grouped === true,
          merged: false,
          displayNumber: typeof saved.display_number === "string"
            ? saved.display_number : String(replayOrderNumber),
          groupRootNumber: typeof saved.group_root_number === "number"
            ? saved.group_root_number : null,
          alreadyProcessed: true,
        }, { headers: { "Cache-Control": "no-store" } });
      }
    }

    const items =
      await buildCart(
        supabase,
        customer.id,
        cart,
        pieceProductIds
      );

    // =================================================
    // LOAD CHECKOUT
    // =================================================

    if (
      action ===
      "load"
    ) {
      // When today's final ordinary delivery window has passed, retain today
      // as a merge-only date *if* this shop has an eligible unfinished delivery.
      // Do not make an expired slot available to standalone or pickup checkout.
      const deliveryOptions = getDeliveryOptions();
      const today = getBangkokToday();
      if (!deliveryOptions.some(option => option.date === today)) {
        try {
          const locations = savedDeliveryLocations(customer);
          const options = await Promise.all(locations.map(location =>
            findMergeCandidates(supabase, customer.id, today, location.url)));
          if (options.some(candidates => candidates.length > 0)) {
            deliveryOptions.unshift({ date: today, slots: [] });
          }
        } catch {
          // Merge suggestions are optional; never block standalone checkout.
        }
      }
      return NextResponse.json({
        customer: {
          id:
            customer.id,

          customerCode:
            customer.customer_code,

          customerName:
            customer.customer_name,

          deliveryAddress: customer.delivery_map_url ?? customer.delivery_address ?? "",
          deliveryLocations: savedDeliveryLocations(customer),
          locationsVersion: customer.updated_at,
        },

        items,

        deliveryOptions,
      });
    }

    // =================================================
    // LOAD POSSIBLE SAME-DAY MERGES
    // =================================================

    if (action === "merge-options") {
      const date = typeof body.deliveryDate === "string" ? body.deliveryDate : "";
      // Pickup is a separate flow: never offer a rider-delivery order as a merge candidate.
      if (body.fulfillmentMethod === "pickup") return NextResponse.json({ mergeCandidates: [] });
      const chosenAddress = typeof body.deliveryAddress === "string" ? body.deliveryAddress.trim() : "";
      const allowedAddresses = savedDeliveryLocations(customer).map((location) => location.url);
      if (!allowedAddresses.includes(chosenAddress))
        return NextResponse.json({ error: "กรุณาเลือกตำแหน่งจัดส่งที่บันทึกไว้" }, { status: 400 });
      // Same-day groups remain mergeable even after their original slot ends.
      // The database rechecks that billing has not begun under the root lock.
      const mergeCandidates = date >= getBangkokToday()
        ? await findMergeCandidates(supabase, customer.id, date, chosenAddress)
        : [];
      return NextResponse.json({ mergeCandidates });
    }

    // =================================================
    // SUBMIT ORDER
    // =================================================

    const deliveryDate =
      typeof body.deliveryDate ===
      "string"
        ? body.deliveryDate
        : "";

    const deliverySlot =
      typeof body.deliverySlot ===
      "string"
        ? body.deliverySlot
        : "";

    const deliveryAddress =
      typeof body.deliveryAddress ===
      "string"
        ? body.deliveryAddress
            .trim()
        : "";

    const notes =
      typeof body.notes ===
      "string"
        ? body.notes
            .trim()
        : "";
    const fulfillmentMethod = body.fulfillmentMethod === "pickup" ? "pickup" : "delivery";
    if (body.fulfillmentMethod != null &&
      body.fulfillmentMethod !== "pickup" && body.fulfillmentMethod !== "delivery") {
      return NextResponse.json({ error: "Invalid fulfillment method." }, { status: 400 });
    }

    // -------------------------------------------------
    // ADDRESS
    // -------------------------------------------------

    if (
      fulfillmentMethod === "delivery" && !deliveryAddress
    ) {
      return NextResponse.json(
        {
          error:
            "Delivery address is required.",
        },
        {
          status: 400,
        }
      );
    }

    // -------------------------------------------------
    // Validate the selected map against this customer's saved locations,
    // rather than accepting an arbitrary address supplied by the browser.
    if (fulfillmentMethod === "delivery") {
      const allowedAddresses = savedDeliveryLocations(customer).map((location) => location.url);
      if (!allowedAddresses.includes(deliveryAddress)) {
        return NextResponse.json({ error: "ตำแหน่งจัดส่งไม่ถูกต้อง กรุณาเลือกใหม่" }, { status: 400 });
      }
    }

    // DELIVERY DATE + SLOT
    //
    // This is checked again SERVER-SIDE.
    // So changing browser values manually won't bypass
    // the delivery rules.
    // -------------------------------------------------

    // Optional consolidation: never group without an explicit chosen order.
    // Previous LINE in-app pages may still run the former auto-merge UI.
    // Without a new explicit user opt-in, ignore any legacy merge number.
    const rawMerge = body.mergeConsent === true ? body.mergeIntoOrderNumber : null;
    const hasMergeChoice = rawMerge !== null && rawMerge !== undefined;
    if (hasMergeChoice && (typeof rawMerge !== "number" ||
        !Number.isSafeInteger(rawMerge) || rawMerge <= 0 || fulfillmentMethod === "pickup")) {
      return NextResponse.json({ error: "ตัวเลือกการรวมคำสั่งซื้อไม่ถูกต้อง" }, { status: 400 });
    }
    const requestedMergeNumber: number | null = hasMergeChoice ? rawMerge as number : null;
    const chosenMerge = requestedMergeNumber !== null && deliveryDate >= getBangkokToday()
      ? findChosenMerge(await findMergeCandidates(supabase, customer.id, deliveryDate, deliveryAddress),
          requestedMergeNumber, deliveryDate, deliveryAddress)
      : null;
    // The selected group may have a different slot from the original checkout
    // selection. That is deliberate: the customer explicitly chooses the
    // group and sees its slot before confirming. The effective slot below
    // must always come from the server-validated existing order.
    if (requestedMergeNumber !== null && !chosenMerge) {
      return NextResponse.json({ error: "คำสั่งซื้อที่เลือกไม่สามารถรวมได้แล้ว กรุณาเลือกใหม่" }, { status: 409 });
    }
    const effectiveDeliverySlot = chosenMerge?.deliverySlot ?? deliverySlot;
    // Only an explicitly selected, verified same-day group can bypass the
    // elapsed-slot restriction. Ordinary standalone/pickup orders cannot.
    const existingSameDayMerge = chosenMerge !== null &&
      deliveryDate === getBangkokToday() &&
      DELIVERY_RULES.slots.some(slot => slot.value === effectiveDeliverySlot);
    const validation = existingSameDayMerge
      ? { valid: true, message: "" }
      : validateDeliverySelection(deliveryDate, effectiveDeliverySlot);

    if (
      !validation.valid
    ) {
      return NextResponse.json(
        {
          error:
            validation.message,

          deliveryOptions:
            getDeliveryOptions(),
        },
        {
          status: 400,
        }
      );
    }

    // -------------------------------------------------
    // ORDER ITEMS
    // -------------------------------------------------

    const orderItems =
      items.map(
        (
          item:
            CheckoutItem
        ) => ({
          product_id:
            item.id,

          quantity:
            item.quantity,
          order_unit: item.isPiece ? "piece" : "kg",
        })
      );

    // -------------------------------------------------
    // CREATE ORDER
    //
    // Important:
    // We pass customer code only AFTER the LINE user has
    // already been verified as authorized for it.
    // -------------------------------------------------

    // The server validates the explicit selection; the database locks the root
    // and rechecks stage, date, slot and location inside create_group_suborder.
    const mergeIntoOrderNumber = chosenMerge?.orderNumber ?? null;
    const merging = mergeIntoOrderNumber !== null;
    const requestId = retryRequestId!;
    const intentHash = checkoutIntentHash!;

    const { data: orderData, error: orderError } = merging
      ? await supabase.rpc("create_group_suborder_v2", {
          p_customer_id: customer.id,
          p_primary_order_number: mergeIntoOrderNumber,
          p_delivery_date: deliveryDate,
          p_delivery_slot: effectiveDeliverySlot,
          p_customer_notes: notes,
          p_delivery_address: deliveryAddress,
          p_items: orderItems,
          p_line_user_id: verifiedLineUserId,
          p_request_id: requestId,
          p_intent_hash: intentHash,
        })
      : await supabase.rpc("create_checkout_order_once_v2", {
          p_customer_id: customer.id,
          p_line_user_id: verifiedLineUserId,
          p_customer_code: customer.customer_code,
          p_delivery_date: deliveryDate,
          p_delivery_slot: effectiveDeliverySlot,
          p_delivery_address: fulfillmentMethod === "pickup" ? "" : deliveryAddress,
          p_customer_notes: notes,
          p_items: orderItems,
          p_request_id: requestId,
          p_is_pickup: fulfillmentMethod === "pickup",
          p_intent_hash: intentHash,
        });

    if (orderError) {
      console.error(
        merging ? "create_group_suborder:" : "create_customer_order:",
        orderError
      );

      return NextResponse.json(
        {
          error:
            (merging ? "ไม่สามารถรวมคำสั่งซื้อได้: " : "Could not submit order: ") +
            orderError.message,
        },
        {
          status: merging ? 409 : 500,
        }
      );
    }

    // -------------------------------------------------
    // ORDER NUMBER
    // -------------------------------------------------

    const orderNumber =
      extractOrderNumber(
        orderData
      );

    if (
      orderNumber ===
      null
    ) {
      console.error(
        "Unexpected create_customer_order response:",
        orderData
      );

      return NextResponse.json(
        {
          error:
            "The order was created, but its order number could not be read.",
        },
        {
          status: 500,
        }
      );
    }

    // -------------------------------------------------
    // SUCCESS
    // -------------------------------------------------

    const groupInfo = orderData && typeof orderData === "object"
      ? orderData as Record<string, unknown>
      : {};
    return NextResponse.json({
      success: true,
      orderNumber,
      fulfillmentMethod,
      grouped: merging,
      merged: false,
      displayNumber: typeof groupInfo.display_number === "string"
        ? groupInfo.display_number : String(orderNumber),
      groupRootNumber: typeof groupInfo.group_root_number === "number"
        ? groupInfo.group_root_number : null,
    });
  } catch (error) {
    const invalidLineIdentity =
      error instanceof Error && error.message === "LINE_ID_TOKEN_INVALID";
    const unavailableProduct = error instanceof Error && error.message.startsWith("สินค้าหมดชั่วคราว");
    if (!invalidLineIdentity) console.error("LINE checkout API:", error);
    return NextResponse.json(
      {
        error: invalidLineIdentity
          ? "LINE identity could not be verified."
          : error instanceof Error ? error.message : "Unexpected server error.",
        ...(invalidLineIdentity ? { code: "LINE_ID_TOKEN_INVALID" } : {}),
      },
      { status: invalidLineIdentity ? 401 : unavailableProduct ? 409 : 500 }
    );
  }
}
