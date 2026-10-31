import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  createClient,
} from "@supabase/supabase-js";
import sharp from "sharp";

type LineVerifyResponse = {
  sub?: string;
  error?: string;
  error_description?: string;
};

type CustomerRow = {
  id: string;
  customer_code: string;
  customer_name: string;
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

type OrderFileRow = {
  id: string;
  file_type: string;
  storage_path: string;
  original_filename:
    | string
    | null;
  mime_type:
    | string
    | null;
};

async function getAuthorizedContext(
  idToken: string,
  customerCode: string
) {
  const channelId =
    process.env.LINE_CHANNEL_ID;

  const supabaseUrl =
    process.env
      .NEXT_PUBLIC_SUPABASE_URL;

  const secret =
    process.env
      .SUPABASE_SECRET_KEY;

  if (
    !channelId ||
    !supabaseUrl ||
    !secret
  ) {
    throw new Error(
      "Server configuration is incomplete."
    );
  }

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

  const response =
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
    (await response.json()) as LineVerifyResponse;

  if (
    !response.ok ||
    !lineData.sub
  ) {
    throw new Error("LINE_ID_TOKEN_INVALID");
  }

  const supabase: any =
    createClient(
      supabaseUrl,
      secret,
      {
        auth: {
          persistSession:
            false,

          autoRefreshToken:
            false,
        },
      }
    );

  const {
    data: lineUser,
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

  if (
    lineUserError ||
    !lineUser
  ) {
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

  let customer:
    CustomerRow | null =
    null;

  for (
    const link of links
  ) {
    const rawCustomer =
      link.customers;

    const candidate =
      Array.isArray(
        rawCustomer
      )
        ? rawCustomer[0]
        : rawCustomer;

    if (
      candidate &&
      candidate.is_active &&
      candidate.customer_code
        .trim()
        .toUpperCase() ===
        normalizedCode
    ) {
      customer =
        candidate;

      break;
    }
  }

  if (!customer) {
    throw new Error(
      "You are not authorized to view this customer."
    );
  }

  return {
    supabase,
    lineUserId:
      lineUser.id as string,
    customer,
  };
}

async function createSignedFile(
  supabase: any,
  file:
    | OrderFileRow
    | undefined
) {
  if (!file) {
    return null;
  }

  const {
    data,
    error,
  } =
    await supabase.storage
      .from("order-files")
      .createSignedUrl(
        file.storage_path,
        60 * 60
      );

  if (error) {
    console.error(
      "Signed URL error:",
      error
    );

    return null;
  }

  return {
    fileType:
      file.file_type,

    name:
      file.original_filename ??
      file.file_type,

    mimeType:
      file.mime_type,

    url:
      data.signedUrl,
  };
}

// =====================================================
// LOAD PAYMENT
// =====================================================

async function loadPayment(
  request: NextRequest
) {
  const body =
    await request.json();

  const idToken =
    typeof body.idToken ===
    "string"
      ? body.idToken
      : "";

  const customerCode =
    typeof body.customerCode ===
    "string"
      ? body.customerCode
      : "";

  const orderNumber =
    Number(
      body.orderNumber
    );

  if (!idToken) {
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

  if (
    !customerCode ||
    !Number.isFinite(
      orderNumber
    )
  ) {
    return NextResponse.json(
      {
        error:
          "Customer and order number are required.",
      },
      {
        status: 400,
      }
    );
  }

  const {
    supabase,
    customer,
  } =
    await getAuthorizedContext(
      idToken,
      customerCode
    );

  const {
    data: order,
    error: orderError,
  } =
    await supabase
      .from("orders")
      .select(`
        id,
        order_number,
        group_root_order_id,
        group_sequence,
        status,
        final_amount,
        billing_account_suspended,
        billing_no_cv,
        delivery_date,
        delivery_slot
      `)
      .eq(
        "order_number",
        orderNumber
      )
      .eq(
        "customer_id",
        customer.id
      )
      .maybeSingle();

  if (orderError) {
    throw new Error(
      "Could not load order."
    );
  }

  if (!order) {
    return NextResponse.json(
      {
        error:
          "Order not found.",
      },
      {
        status: 404,
      }
    );
  }

  if (order.group_root_order_id && order.group_root_order_id !== order.id) {
    return NextResponse.json({
      error: "คำสั่งซื้อย่อยต้องชำระเงินผ่านคำสั่งซื้อหลัก",
    }, { status: 409 });
  }

  const {
    data: fileData,
    error: fileError,
  } =
    await supabase
      .from("order_files")
      .select(`
        id,
        file_type,
        storage_path,
        original_filename,
        mime_type
      `)
      .eq(
        "order_id",
        order.id
      )
      .eq(
        "is_current",
        true
      )
      .in(
        "file_type",
        [
          "bill",
          "bill_2",
          "payment_qr",
          "payment_qr_2",
          "delivery_proof",
          "payment_slip",
          "payment_slip_2",
        ]
      );

  if (fileError) {
    throw new Error(
      "Could not load order files."
    );
  }

  const files =
    (
      fileData ??
      []
    ) as OrderFileRow[];

  const billFile =
    files.find(
      (file) =>
        file.file_type ===
        "bill"
    );

  const qrFile =
    files.find(
      (file) =>
        file.file_type ===
        "payment_qr"
    );
  const bill2File = files.find(file => file.file_type === "bill_2");
  const qr2File = files.find(file => file.file_type === "payment_qr_2");

  const proofFile =
    files.find(
      (file) =>
        file.file_type ===
        "delivery_proof"
    );

  const slip2File = files.find(file => file.file_type === "payment_slip_2");
  const slipFile =
    files.find(
      (file) =>
        file.file_type ===
        "payment_slip"
    );

  const [
    bill,
    paymentQr,
    deliveryProof,
    paymentSlip,
    paymentSlip2,
    bill2,
    paymentQr2,
  ] =
    await Promise.all([
      createSignedFile(
        supabase,
        billFile
      ),

      createSignedFile(
        supabase,
        qrFile
      ),

      createSignedFile(
        supabase,
        proofFile
      ),

      createSignedFile(
        supabase,
        slipFile
      ),
      createSignedFile(supabase, slip2File),
      createSignedFile(supabase, bill2File),
      createSignedFile(supabase, qr2File),
    ]);

  return NextResponse.json({
    customer: {
      customerCode:
        customer.customer_code,

      customerName:
        customer.customer_name,
    },

    order: {
      orderNumber:
        order.order_number,

      status:
        order.status,

      billingAccountSuspended: order.billing_account_suspended === true,
      billingNoCv: order.billing_no_cv === true,

      finalAmount:
        order.final_amount ===
        null
          ? null
          : Number(
              order.final_amount
            ),

      deliveryDate:
        order.delivery_date,

      deliverySlot:
        order.delivery_slot,
    },

    files: {
      bill,
      bill2,
      paymentQr,
      paymentQr2,
      deliveryProof,
      paymentSlip,
      paymentSlip2,
    },
  });
}

// =====================================================
// SUBMIT PAYMENT SLIP
// =====================================================

async function submitPayment(
  request: NextRequest
) {
  const formData =
    await request.formData();

  const idToken =
    String(
      formData.get(
        "idToken"
      ) ?? ""
    );

  const customerCode =
    String(
      formData.get(
        "customerCode"
      ) ?? ""
    );

  const orderNumber =
    Number(
      formData.get(
        "orderNumber"
      )
    );

  const fileValue =
    formData.get(
      "file"
    );

  if (
    !idToken ||
    !customerCode ||
    !Number.isFinite(
      orderNumber
    )
  ) {
    return NextResponse.json(
      {
        error:
          "Payment submission information is incomplete.",
      },
      {
        status: 400,
      }
    );
  }

  if (
    !(fileValue instanceof File)
  ) {
    return NextResponse.json(
      {
        error:
          "Please choose a payment slip.",
      },
      {
        status: 400,
      }
    );
  }

  const file =
    fileValue;

  if (
    file.size <= 0
  ) {
    return NextResponse.json(
      {
        error:
          "Payment slip file is empty.",
      },
      {
        status: 400,
      }
    );
  }

  const maxSize =
    10 *
    1024 *
    1024;

  if (
    file.size >
    maxSize
  ) {
    return NextResponse.json(
      {
        error:
          "Payment slip must be smaller than 10 MB.",
      },
      {
        status: 400,
      }
    );
  }

  const mimeType =
    file.type ||
    "application/octet-stream";

  const allowed =
    mimeType.startsWith(
      "image/"
    ) ||
    mimeType ===
      "application/pdf";

  if (!allowed) {
    return NextResponse.json(
      {
        error:
          "Payment slip must be an image or PDF.",
      },
      {
        status: 400,
      }
    );
  }

  const {
    supabase,
    lineUserId,
    customer,
  } =
    await getAuthorizedContext(
      idToken,
      customerCode
    );

  // Verify order belongs to this customer
  // and is awaiting payment.

  const {
    data: order,
    error: orderError,
  } =
    await supabase
      .from("orders")
      .select(`
        id,
        group_root_order_id,
        group_sequence,
        status
      `)
      .eq(
        "order_number",
        orderNumber
      )
      .eq(
        "customer_id",
        customer.id
      )
      .maybeSingle();

  if (
    orderError ||
    !order
  ) {
    return NextResponse.json(
      {
        error:
          "Order not found.",
      },
      {
        status: 404,
      }
    );
  }

  if (order.group_root_order_id && order.group_root_order_id !== order.id) {
    return NextResponse.json({
      error: "คำสั่งซื้อย่อยไม่รับสลิปแยก กรุณาชำระเงินผ่านคำสั่งซื้อหลัก",
    }, { status: 409 });
  }
  if (
    order.status !==
    "awaiting_payment"
  ) {
    return NextResponse.json(
      {
        error:
          `This order is currently ${order.status} and cannot accept a new payment slip.`,
      },
      {
        status: 400,
      }
    );
  }

  const originalName = file.name || "payment-slip";
  let uploadName = originalName;
  let uploadMimeType = mimeType;
  let uploadBytes = Buffer.from(await file.arrayBuffer());

  // Customer photos are normally compressed in the browser. Only optimize
  // oversized images here (legacy clients or failed browser compression).
  if (mimeType.startsWith("image/") && uploadBytes.length > 900_000) {
    try {
      const prepared = await sharp(uploadBytes, { failOn: "error", limitInputPixels: 95_000_000 })
        .rotate()
        .flatten({ background: "#ffffff" })
        .resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 88, mozjpeg: true })
        .toBuffer();
      const verified = await sharp(prepared).metadata();
      if (verified.format === "jpeg" && prepared.length < uploadBytes.length * 0.98) {
        uploadBytes = prepared;
        uploadMimeType = "image/jpeg";
        uploadName = originalName.replace(/\.[^.]+$/, "") + ".jpg";
      }
    } catch (error) {
      // A legacy image decoder must not prevent payment submission.
      console.warn("Payment slip image could not be optimized", error);
    }
  }

  const extensionMatch = uploadName.match(/\.([A-Za-z0-9]+)$/);
  const extension = extensionMatch?.[1]?.toLowerCase() ?? (uploadMimeType === "application/pdf" ? "pdf" : "jpg");
  const storagePath = `orders/${orderNumber}/payment_slip/${crypto.randomUUID()}.${extension}`;

  const {
    error: uploadError,
  } =
    await supabase.storage
      .from("order-files")
      .upload(
        storagePath,
        uploadBytes,
        {
          contentType:
            uploadMimeType,

          upsert:
            false,
        }
      );

  if (uploadError) {
    console.error(
      "Payment slip upload:",
      uploadError
    );

    return NextResponse.json(
      {
        error:
          "Payment slip upload failed: " +
          uploadError.message,
      },
      {
        status: 500,
      }
    );
  }

  const {
    error: submitError,
  } =
    await supabase.rpc(
      "submit_customer_payment_slip",
      {
        p_order_number:
          orderNumber,

        p_line_user_id:
          lineUserId,

        p_storage_path:
          storagePath,

        p_original_filename:
          originalName,

        p_mime_type:
          uploadMimeType,
      }
    );

  if (submitError) {
    // Remove unused uploaded file.
    await supabase.storage
      .from("order-files")
      .remove([
        storagePath,
      ]);

    console.error(
      "Payment submission RPC:",
      submitError
    );

    return NextResponse.json(
      {
        error:
          "Payment slip could not be submitted: " +
          submitError.message,
      },
      {
        status: 500,
      }
    );
  }

  return NextResponse.json({
    success: true,
    status: "completed",
  });
}

// =====================================================
// POST
// =====================================================

export async function POST(
  request: NextRequest
) {
  try {
    const contentType =
      request.headers.get(
        "content-type"
      ) ?? "";

    if (
      contentType.includes(
        "multipart/form-data"
      )
    ) {
      return await submitPayment(
        request
      );
    }

    return await loadPayment(
      request
    );
  } catch (error) {
    const invalidLineIdentity =
      error instanceof Error && error.message === "LINE_ID_TOKEN_INVALID";
    if (!invalidLineIdentity) console.error("LINE payment API:", error);
    return NextResponse.json(
      {
        error: invalidLineIdentity
          ? "LINE identity could not be verified."
          : error instanceof Error ? error.message : "Unexpected server error.",
        ...(invalidLineIdentity ? { code: "LINE_ID_TOKEN_INVALID" } : {}),
      },
      { status: invalidLineIdentity ? 401 : 500 }
    );
  }
}