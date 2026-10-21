import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  createClient,
} from "@supabase/supabase-js";

type LineVerifyResponse = {
  sub?: string;
  name?: string;
  picture?: string;
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

type StaffRow = {
  id: string;
  staff_code: string;
  staff_name: string;
  account_type: string;
  is_active: boolean;
};

type StaffLinkRow = {
  id: string;
  staff_id: string;
  line_user_id: string;
  is_authorized: boolean;
};

export async function POST(
  request: NextRequest
) {
  try {
    const body =
      await request.json();

    const idToken =
      typeof body.idToken ===
      "string"
        ? body.idToken
        : "";

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

    const channelId =
      process.env
        .LINE_CHANNEL_ID;

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
      return NextResponse.json(
        {
          error:
            "Server configuration is incomplete.",
        },
        {
          status: 500,
        }
      );
    }

    // ===================================================
    // 1. VERIFY LINE IDENTITY
    // ===================================================

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
          signal: AbortSignal.timeout(10000),
        }
      );

    const lineData =
      (await lineResponse.json()) as LineVerifyResponse;

    if (!lineResponse.ok || !lineData.sub) {
      // Never log the ID token or echo raw LINE responses to the browser.
      console.error("LINE ID token verification failed", {
        httpStatus: lineResponse.status,
        code: lineData.error ?? "unknown",
        description: lineData.error_description ?? "",
      });
      return NextResponse.json(
        {
          error: "LINE identity could not be verified.",
          code: "LINE_ID_TOKEN_INVALID",
        },
        { status: 401, headers: { "Cache-Control": "no-store" } }
      );
    }

    // ===================================================
    // 2. SERVER SUPABASE
    // ===================================================

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

    // ===================================================
    // 3. FIND / REGISTER LINE IDENTITY
    //
    // user_type is NOT used for authorization.
    // ===================================================

    const {
      data:
        existingLineUser,
      error:
        lineUserError,
    } =
      await supabase
        .from("line_users")
        .select(`
          id,
          line_user_id,
          display_name,
          is_active
        `)
        .eq(
          "line_user_id",
          lineData.sub
        )
        .maybeSingle();

    if (lineUserError) {
      console.error(
        "LINE user lookup:",
        lineUserError
      );

      return NextResponse.json(
        {
          error:
            "Could not check LINE account.",
        },
        {
          status: 500,
        }
      );
    }

    let lineUser =
      existingLineUser;

    if (!lineUser) {
      const {
        data:
          insertedLineUser,
        error:
          insertError,
      } =
        await supabase
          .from("line_users")
          .insert({
            line_user_id:
              lineData.sub,

            display_name:
              lineData.name ??
              "LINE User",

            is_active:
              true,
          })
          .select(`
            id,
            line_user_id,
            display_name,
            is_active
          `)
          .single();

      if (
        insertError ||
        !insertedLineUser
      ) {
        console.error(
          "LINE registration:",
          insertError
        );

        return NextResponse.json(
          {
            error:
              "Could not register LINE account.",
          },
          {
            status: 500,
          }
        );
      }

      lineUser =
        insertedLineUser;
    }

    if (
      !lineUser.is_active
    ) {
      return NextResponse.json(
        {
          linked: false,
          inactive: true,

          error:
            "This LINE account is inactive.",
        },
        {
          status: 403,
        }
      );
    }

    // ===================================================
    // 4. CUSTOMER ACCESS
    // ===================================================

    const {
      data:
        customerLinkData,
      error:
        customerLinkError,
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

    if (
      customerLinkError
    ) {
      console.error(
        "Customer access error:",
        customerLinkError
      );

      return NextResponse.json(
        {
          error:
            "Could not load customer access.",
        },
        {
          status: 500,
        }
      );
    }

    const customerLinks =
      (
        customerLinkData ??
        []
      ) as CustomerLinkRow[];

    const customers =
      customerLinks
        .map(
          (link) => {
            const rawCustomer =
              link.customers;

            const customer =
              Array.isArray(
                rawCustomer
              )
                ? rawCustomer[0]
                : rawCustomer;

            if (
              !customer ||
              !customer.is_active
            ) {
              return null;
            }

            return {
              id:
                customer.id,

              customerCode:
                customer.customer_code,

              customerName:
                customer.customer_name,
            };
          }
        )
        .filter(
          (
            customer
          ): customer is {
            id: string;
            customerCode: string;
            customerName: string;
          } =>
            customer !==
            null
        );

    // ===================================================
    // 5. STAFF ACCESS
    //
    // IMPORTANT:
    // staff_line_users.line_user_id is the technical
    // LINE ID itself (Uxxxx), NOT line_users.id.
    //
    // Query the link first, then staff separately.
    // ===================================================

    const {
      data:
        staffLinkData,
      error:
        staffLinkError,
    } =
      await supabase
        .from(
          "staff_line_users"
        )
        .select(`
          id,
          staff_id,
          line_user_id,
          is_authorized
        `)
        .eq(
          "line_user_id",
          lineData.sub
        )
        .eq(
          "is_authorized",
          true
        )
        .maybeSingle();

    if (
      staffLinkError
    ) {
      console.error(
        "Staff LINE link error:",
        staffLinkError
      );

      return NextResponse.json(
        {
          error:
            "Could not load staff LINE link.",
        },
        {
          status: 500,
        }
      );
    }

    let staffAccess:
      | {
          staffId: string;
          staffCode: string;
          staffName: string;
          accountType: string;
        }
      | null =
      null;

    // ===================================================
    // 6. LOAD STAFF RECORD IF LINK EXISTS
    // ===================================================

    if (staffLinkData) {
      const staffLink =
        staffLinkData as StaffLinkRow;

      const {
        data:
          staffData,
        error:
          staffError,
      } =
        await supabase
          .from("staff")
          .select(`
            id,
            staff_code,
            staff_name,
            account_type,
            is_active
          `)
          .eq(
            "id",
            staffLink.staff_id
          )
          .maybeSingle();

      if (staffError) {
        console.error(
          "Staff record error:",
          staffError
        );

        return NextResponse.json(
          {
            error:
              "Could not load staff account.",
          },
          {
            status: 500,
          }
        );
      }

      const staff =
        staffData as
          | StaffRow
          | null;

      if (
        staff &&
        staff.is_active
      ) {
        staffAccess = {
          staffId:
            staff.id,

          staffCode:
            staff.staff_code,

          staffName:
            staff.staff_name,

          accountType:
            staff.account_type,
        };
      }
    }

    // ===================================================
    // 7. FINAL ACCESS PROFILE
    // ===================================================

    const hasCustomerAccess =
      customers.length >
      0;

    const hasStaffAccess =
      staffAccess !==
      null;

    return NextResponse.json({
      linked:
        hasCustomerAccess ||
        hasStaffAccess,

      pendingAuthorization:
        !hasCustomerAccess &&
        !hasStaffAccess,

      lineUserId:
        lineData.sub,

      displayName:
        lineUser.display_name ??
        lineData.name ??
        "LINE User",

      hasCustomerAccess,

      hasStaffAccess,

      customers,

      staff:
        staffAccess,
    });
  } catch (error) {
    console.error(
      "LINE access API:",
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