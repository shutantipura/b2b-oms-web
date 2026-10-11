import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  createClient,
} from "@supabase/supabase-js";

type LineVerifyResponse = {
  sub?: string;
};

export async function POST(
  request: NextRequest
) {
  try {
    const {
      idToken,
      customerCode,
      productId,
      isFavourite,
    } =
      await request.json();

    if (
      !idToken ||
      !customerCode ||
      !productId ||
      typeof isFavourite !==
        "boolean"
    ) {
      return NextResponse.json(
        {
          error:
            "Missing favourite request information.",
        },
        {
          status: 400,
        }
      );
    }

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
      return NextResponse.json(
        {
          error:
            "Server configuration missing.",
        },
        {
          status: 500,
        }
      );
    }

    // =====================================================
    // VERIFY LINE IDENTITY
    // =====================================================

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
      return NextResponse.json(
        {
          error:
            "LINE identity could not be verified.",
        },
        {
          status: 401,
        }
      );
    }

    // =====================================================
    // SERVER SUPABASE
    // =====================================================

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

    // =====================================================
    // LINE USER
    // =====================================================

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
        .eq(
          "is_active",
          true
        )
        .maybeSingle();

    if (
      lineUserError ||
      !lineUser
    ) {
      return NextResponse.json(
        {
          error:
            "LINE account is not registered.",
        },
        {
          status: 403,
        }
      );
    }

    // =====================================================
    // CUSTOMER
    // =====================================================

    const {
      data: customer,
      error: customerError,
    } =
      await supabase
        .from("customers")
        .select(`
          id,
          customer_code,
          is_active
        `)
        .eq(
          "customer_code",
          customerCode
            .trim()
            .toUpperCase()
        )
        .eq(
          "is_active",
          true
        )
        .maybeSingle();

    if (
      customerError ||
      !customer
    ) {
      return NextResponse.json(
        {
          error:
            "Customer could not be found.",
        },
        {
          status: 404,
        }
      );
    }

    // =====================================================
    // VERIFY CUSTOMER ACCESS
    // =====================================================

    const {
      data: membership,
      error: membershipError,
    } =
      await supabase
        .from(
          "customer_line_users"
        )
        .select("id")
        .eq(
          "line_user_id",
          lineUser.id
        )
        .eq(
          "customer_id",
          customer.id
        )
        .eq(
          "can_order",
          true
        )
        .maybeSingle();

    if (
      membershipError ||
      !membership
    ) {
      return NextResponse.json(
        {
          error:
            "You are not authorized for this customer.",
        },
        {
          status: 403,
        }
      );
    }

    // =====================================================
    // VERIFY PRODUCT
    // =====================================================

    const {
      data: product,
      error: productError,
    } =
      await supabase
        .from("products")
        .select(`
          id,
          is_active
        `)
        .eq(
          "id",
          productId
        )
        .eq(
          "is_active",
          true
        )
        .maybeSingle();

    if (
      productError ||
      !product
    ) {
      return NextResponse.json(
        {
          error:
            "Product could not be found.",
        },
        {
          status: 404,
        }
      );
    }

    // =====================================================
    // ADD FAVOURITE
    // =====================================================

    if (isFavourite) {
      const {
        data: existing,
        error: existingError,
      } =
        await supabase
          .from("favourites")
          .select(`
            id,
            sort_order
          `)
          .eq(
            "customer_id",
            customer.id
          )
          .eq(
            "product_id",
            product.id
          )
          .maybeSingle();

      if (existingError) {
        return NextResponse.json(
          {
            error:
              existingError.message,
          },
          {
            status: 500,
          }
        );
      }

      if (existing) {
        return NextResponse.json(
          {
            success: true,
            isFavourite:
              true,
            favouriteOrder:
              existing.sort_order ??
              0,
          },
          {
            headers: {
              "Cache-Control":
                "no-store",
            },
          }
        );
      }

      // Put new favourites at the end.

      const {
        data: lastFavourite,
        error: orderError,
      } =
        await supabase
          .from("favourites")
          .select(
            "sort_order"
          )
          .eq(
            "customer_id",
            customer.id
          )
          .order(
            "sort_order",
            {
              ascending:
                false,
            }
          )
          .limit(1)
          .maybeSingle();

      if (orderError) {
        return NextResponse.json(
          {
            error:
              orderError.message,
          },
          {
            status: 500,
          }
        );
      }

      const nextOrder =
        Number(
          lastFavourite
            ?.sort_order ??
            0
        ) + 1;

      const {
        error: insertError,
      } =
        await supabase
          .from("favourites")
          .insert({
            customer_id:
              customer.id,

            product_id:
              product.id,

            sort_order:
              nextOrder,
          });

      if (insertError) {
        return NextResponse.json(
          {
            error:
              insertError.message,
          },
          {
            status: 500,
          }
        );
      }

      return NextResponse.json(
        {
          success: true,
          isFavourite:
            true,
          favouriteOrder:
            nextOrder,
        },
        {
          headers: {
            "Cache-Control":
              "no-store",
          },
        }
      );
    }

    // =====================================================
    // REMOVE FAVOURITE
    // =====================================================

    const {
      error: deleteError,
    } =
      await supabase
        .from("favourites")
        .delete()
        .eq(
          "customer_id",
          customer.id
        )
        .eq(
          "product_id",
          product.id
        );

    if (deleteError) {
      return NextResponse.json(
        {
          error:
            deleteError.message,
        },
        {
          status: 500,
        }
      );
    }

    return NextResponse.json(
      {
        success: true,
        isFavourite:
          false,
        favouriteOrder:
          null,
      },
      {
        headers: {
          "Cache-Control":
            "no-store",
        },
      }
    );
  } catch (error) {
    console.error(
      "Favourite API error:",
      error
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unexpected error.",
      },
      {
        status: 500,
      }
    );
  }
}