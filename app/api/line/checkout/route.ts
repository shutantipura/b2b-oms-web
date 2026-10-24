import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  createClient,
} from "@supabase/supabase-js";

import {
  getDeliveryOptions,
  validateDeliverySelection,
} from "../../../../lib/deliveryRules";

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

    throw new Error(
      "LINE identity could not be verified."
    );
  }

  // -------------------------------------------------
  // 2. SERVER-SIDE SUPABASE
  // -------------------------------------------------

  // We deliberately use `any` here.
  //
  // We do not currently have generated Supabase
  // Database types wired into this Next.js project.
  // Without them, supabase-js can incorrectly infer
  // some query results as `never`.
  //
  // This API is server-only, and we explicitly type
  // the returned rows below.

  const supabase: any =
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

  const {
    data: linkData,
    error: linkError,
  } =
    await supabase
      .from(
        "customer_line_users"
      )
      .select(`
        customer_id,
        can_order,
        customers (
          id,
          customer_code,
          customer_name,
          delivery_address,
          is_active
        )
      `)
      .eq(
        "line_user_id",
        lineUser.id
      )
      .eq(
        "can_order",
        true
      );

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

// =====================================================
// BUILD / VERIFY CART
// =====================================================

async function buildCart(
  supabase: any,
  customerId: string,
  cart: Cart
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
        normal_price
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

          normalPrice,

          effectivePrice,

          hasSpecialPrice:
            specialPrice !==
            undefined,

          estimatedSubtotal:
            quantity *
            effectivePrice,
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
async function findMergeCandidates(supabase: any, customerId: string, deliveryDate: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(deliveryDate)) return [];

  const { data: orders, error: orderError } = await supabase
    .from("orders")
    .select("id, order_number, delivery_date, delivery_slot, status, created_at")
    .eq("customer_id", customerId)
    .eq("delivery_date", deliveryDate)
    .in("status", ["awaiting_confirmation", "awaiting_picking", "picking", "awaiting_billing"])
    .is("final_amount", null)
    .order("created_at", { ascending: true })
    .limit(20);

  if (orderError) throw new Error("Could not check existing deliveries: " + orderError.message);
  if (!orders?.length) return [];

  const ids: string[] = orders.map((order: { id: string }) => order.id);
  const [claimResult, fileResult] = await Promise.all([
    supabase.from("task_claims").select("order_id").in("order_id", ids).eq("stage", "billing"),
    supabase.from("order_files").select("order_id").in("order_id", ids).in("file_type", ["bill", "payment_qr"]),
  ]);
  if (claimResult.error || fileResult.error) {
    throw new Error("Could not verify whether an existing order has entered billing.");
  }

  const blocked = new Set<string>([
    ...(claimResult.data ?? []).map((claim: { order_id: string }) => claim.order_id),
    ...(fileResult.data ?? []).map((file: { order_id: string }) => file.order_id),
  ]);

  return orders.filter((order: { id: string }) => !blocked.has(order.id)).map(
    (order: { order_number: number; delivery_date: string; delivery_slot: string; status: string }) => ({
      orderNumber: order.order_number,
      deliveryDate: order.delivery_date,
      deliverySlot: order.delivery_slot,
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

    const action: "load" | "submit" | "merge-options" =
      body.action === "submit" ? "submit"
        : body.action === "merge-options" ? "merge-options"
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
    // CART DATA
    // -------------------------------------------------

    const items =
      await buildCart(
        supabase,
        customer.id,
        cart
      );

    // =================================================
    // LOAD CHECKOUT
    // =================================================

    if (
      action ===
      "load"
    ) {
      return NextResponse.json({
        customer: {
          id:
            customer.id,

          customerCode:
            customer.customer_code,

          customerName:
            customer.customer_name,

          deliveryAddress:
            customer.delivery_address ??
            "",
        },

        items,

        deliveryOptions:
          getDeliveryOptions(),
      });
    }

    // =================================================
    // LOAD POSSIBLE SAME-DAY MERGES
    // =================================================

    if (action === "merge-options") {
      const date = typeof body.deliveryDate === "string" ? body.deliveryDate : "";
      const mergeCandidates = await findMergeCandidates(supabase, customer.id, date);
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

    // -------------------------------------------------
    // ADDRESS
    // -------------------------------------------------

    if (
      !deliveryAddress
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
    // DELIVERY DATE + SLOT
    //
    // This is checked again SERVER-SIDE.
    // So changing browser values manually won't bypass
    // the delivery rules.
    // -------------------------------------------------

    const validation =
      validateDeliverySelection(
        deliveryDate,
        deliverySlot
      );

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
        })
      );

    // -------------------------------------------------
    // CREATE ORDER
    //
    // Important:
    // We pass customer code only AFTER the LINE user has
    // already been verified as authorized for it.
    // -------------------------------------------------

    // A merge updates the original order atomically; no second order is created.
    // LINE authorization above is compulsory for both code paths.
    const mergeIntoOrderNumber = Number(body.mergeIntoOrderNumber);
    const merging = Number.isSafeInteger(mergeIntoOrderNumber) && mergeIntoOrderNumber > 0;
    const requestId = typeof body.requestId === "string" ? body.requestId : "";

    if (merging && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) {
      return NextResponse.json({ error: "Missing merge request reference. Please try again." }, { status: 400 });
    }

    const { data: orderData, error: orderError } = merging
      ? await supabase.rpc("merge_customer_order", {
          p_customer_id: customer.id,
          p_primary_order_number: mergeIntoOrderNumber,
          p_delivery_date: deliveryDate,
          p_delivery_slot: deliverySlot,
          p_customer_notes: notes,
          p_items: orderItems,
          p_line_user_id: verifiedLineUserId,
          p_request_id: requestId,
        })
      : await supabase.rpc("create_customer_order", {
          p_customer_code: customer.customer_code,
          p_delivery_date: deliveryDate,
          p_delivery_slot: deliverySlot,
          p_delivery_address: deliveryAddress,
          p_customer_notes: notes,
          p_items: orderItems,
        });

    if (orderError) {
      console.error(
        merging ? "merge_customer_order:" : "create_customer_order:",
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

    return NextResponse.json({
      success:
        true,

      orderNumber,
      merged: merging,
    });
  } catch (error) {
    console.error(
      "LINE checkout API:",
      error
    );

    return NextResponse.json(
      {
        error:
          error instanceof
            Error
            ? error.message
            : "Unexpected server error.",
      },
      {
        status: 500,
      }
    );
  }
}