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
  error?: string;
};

export async function POST(
  request: NextRequest
) {
  try {
    const body =
      await request.json();

    const idToken =
      body.idToken;

    const requestedCustomerCode =
      typeof body.customerCode === "string"
        ? body.customerCode
            .trim()
            .toUpperCase()
        : "";

    if (
      !idToken ||
      typeof idToken !== "string"
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

    const lineChannelId =
      process.env.LINE_CHANNEL_ID;

    const supabaseUrl =
      process.env
        .NEXT_PUBLIC_SUPABASE_URL;

    const supabaseSecret =
      process.env
        .SUPABASE_SECRET_KEY;

    if (
      !lineChannelId ||
      !supabaseUrl ||
      !supabaseSecret
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

    // ================================================
    // VERIFY LINE IDENTITY
    // ================================================

    const verifyBody =
      new URLSearchParams();

    verifyBody.set(
      "id_token",
      idToken
    );

    verifyBody.set(
      "client_id",
      lineChannelId
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

    const lineProfile =
      (await lineResponse.json()) as LineVerifyResponse;

    if (
      !lineResponse.ok ||
      !lineProfile.sub
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

    // ================================================
    // SERVER SUPABASE
    // ================================================

    const supabaseAdmin =
      createClient(
        supabaseUrl,
        supabaseSecret,
        {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
          },
        }
      );

    // ================================================
    // FIND LINE USER
    // ================================================

    const {
      data: lineUser,
      error: lineUserError,
    } =
      await supabaseAdmin
        .from("line_users")
        .select(`
          id,
          is_active
        `)
        .eq(
          "line_user_id",
          lineProfile.sub
        )
        .maybeSingle();

    if (lineUserError) {
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

    if (
      !lineUser ||
      !lineUser.is_active
    ) {
      return NextResponse.json(
        {
          error:
            "This LINE account is not authorized.",
        },
        {
          status: 403,
        }
      );
    }

    // ================================================
    // FIND CUSTOMER ACCESS
    // ================================================

    const {
      data: links,
      error: linkError,
    } =
      await supabaseAdmin
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

    const authorizedCustomers =
      (links ?? [])
        .map((link: any) => {
          const customer =
            Array.isArray(
              link.customers
            )
              ? link.customers[0]
              : link.customers;

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

            deliveryAddress:
              customer.delivery_address ??
              "",
          };
        })
        .filter(Boolean);

    if (
      authorizedCustomers.length === 0
    ) {
      return NextResponse.json(
        {
          error:
            "No active B2B customer is linked to this LINE account.",
        },
        {
          status: 403,
        }
      );
    }

    const selectedCustomer =
      authorizedCustomers.find(
        (customer: any) =>
          customer.customerCode ===
          requestedCustomerCode
      );

    // URL does NOT grant access.
    // LINE authorization must match it.

    if (!selectedCustomer) {
      return NextResponse.json(
        {
          error:
            "You are not authorized to order for this customer.",
        },
        {
          status: 403,
        }
      );
    }

    // ================================================
    // LOAD ACTIVE PRODUCTS
    // ================================================

    const {
      data: productData,
      error: productError,
    } =
      await supabaseAdmin
        .from("products")
        .select(`
          id,
          sku,
          product_name,
          category,
          unit,
          normal_price
        `)
        .eq(
          "is_active",
          true
        )
        .order(
          "product_name",
          {
            ascending: true,
          }
        );

    if (productError) {
      return NextResponse.json(
        {
          error:
            "Could not load products: " +
            productError.message,
        },
        {
          status: 500,
        }
      );
    }

    const products =
      productData ?? [];

    const productIds =
      products.map(
        (product) =>
          product.id
      );

    // ================================================
    // SPECIAL PRICES
    // ================================================

    let priceData: any[] =
      [];

    if (
      productIds.length >
      0
    ) {
      const {
        data,
        error,
      } =
        await supabaseAdmin
          .from(
            "customer_prices"
          )
          .select(`
            product_id,
            agreed_price
          `)
          .eq(
            "customer_id",
            selectedCustomer.id
          )
          .eq(
            "is_active",
            true
          )
          .in(
            "product_id",
            productIds
          );

      if (error) {
        return NextResponse.json(
          {
            error:
              "Could not load customer prices: " +
              error.message,
          },
          {
            status: 500,
          }
        );
      }

      priceData =
        data ?? [];
    }

    const priceMap =
      new Map<
        string,
        number
      >();

    priceData.forEach(
      (price) => {
        priceMap.set(
          price.product_id,
          Number(
            price.agreed_price
          )
        );
      }
    );

    // ================================================
    // FAVOURITES
    // ================================================

    const {
      data: favouriteData,
      error: favouriteError,
    } =
      await supabaseAdmin
        .from("favourites")
        .select(`
          product_id,
          sort_order
        `)
        .eq(
          "customer_id",
          selectedCustomer.id
        )
        .order(
          "sort_order",
          {
            ascending: true,
          }
        );

    if (favouriteError) {
      return NextResponse.json(
        {
          error:
            "Could not load favourites: " +
            favouriteError.message,
        },
        {
          status: 500,
        }
      );
    }

    const favouriteMap =
      new Map<
        string,
        number
      >();

    (
      favouriteData ?? []
    ).forEach(
      (favourite) => {
        favouriteMap.set(
          favourite.product_id,
          favourite.sort_order ??
            999999
        );
      }
    );

    // ================================================
    // FINAL CATALOGUE
    // ================================================

    const catalogue =
      products.map(
        (product) => {
          const specialPrice =
            priceMap.get(
              product.id
            );

          const favouriteOrder =
            favouriteMap.get(
              product.id
            );

          return {
            id:
              product.id,

            sku:
              product.sku,

            productName:
              product.product_name,

            category:
              product.category,

            unit:
              product.unit,

            normalPrice:
              Number(
                product.normal_price
              ),

            effectivePrice:
              specialPrice ??
              Number(
                product.normal_price
              ),

            hasSpecialPrice:
              specialPrice !==
              undefined,

            isFavourite:
              favouriteOrder !==
              undefined,

            favouriteOrder:
              favouriteOrder ??
              null,
          };
        }
      );

    return NextResponse.json({
      customer:
        selectedCustomer,

      products:
        catalogue,
    });
  } catch (error) {
    console.error(
      "LINE catalogue API:",
      error
    );

    return NextResponse.json(
      {
        error:
          "Unexpected server error.",
      },
      {
        status: 500,
      }
    );
  }
}