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

  error_description?: string;

};



type RawItem = Record<

  string,

  any

>;



export async function POST(

  request: NextRequest

) {

  try {

    const body =

      await request.json();



    const idToken =

      body.idToken;



    const requestedCustomerCode =

      typeof body.customerCode ===

      "string"

        ? body.customerCode

            .trim()

            .toUpperCase()

        : "";



    const mode =

      body.mode ===

      "history"

        ? "history"

        : "active";



    if (

      !idToken ||

      typeof idToken !==

        "string"

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



    // ===================================================

    // 1. VERIFY LINE ID TOKEN

    // ===================================================



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

        "https\://api.line.me/oauth2/v2.1/verify",

        {

          method:

            "POST",



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



    // ===================================================

    // 2. SERVER-SIDE SUPABASE

    // ===================================================



    const supabaseAdmin =

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



    // ===================================================

    // 3. FIND LINE USER

    // ===================================================



    const {

      data: lineUser,

      error: lineUserError,

    } =

      await supabaseAdmin

        .from(

          "line_users"

        )

        .select(`

          id,

          line_user_id,

          display_name,

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



    // ===================================================

    // 4. FIND AUTHORIZED CUSTOMERS

    // ===================================================



    const {

      data: customerLinks,

      error: customerLinkError,

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

      (

        customerLinks ??

        []

      )

        .map(

          (link: any) => {

            const customer =

              Array.isArray(

                link.customers

              )

                ? link.customers[

                    0

                  ]

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

            };

          }

        )

        .filter(

          Boolean

        ) as {

          id: string;

          customerCode: string;

          customerName: string;

        }[];



    if (

      authorizedCustomers.length ===

      0

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



    // ===================================================

    // 5. CHOOSE CUSTOMER

    // ===================================================



    let selectedCustomer:

      | {

          id: string;

          customerCode: string;

          customerName: string;

        }

      | undefined;



    if (

      requestedCustomerCode

    ) {

      selectedCustomer =

        authorizedCustomers.find(

          (customer) =>

            customer.customerCode ===

            requestedCustomerCode

        );



      // Important:

      // URL/customerCode does NOT grant access.

      // It must belong to this verified LINE user.

      if (

        !selectedCustomer

      ) {

        return NextResponse.json(

          {

            error:

              "You are not authorized to view this customer.",

          },

          {

            status: 403,

          }

        );

      }

    } else if (

      authorizedCustomers.length ===

      1

    ) {

      selectedCustomer =

        authorizedCustomers[

          0

        ];

    }



    if (

      !selectedCustomer

    ) {

      return NextResponse.json({

        needsCustomerSelection:

          true,



        customers:

          authorizedCustomers,

      });

    }



    // ===================================================

    // 6. LOAD ORDERS

    // ===================================================



    let orderQuery =

      supabaseAdmin

        .from("orders")

        .select(`

          id,

          order_number,

          status,

          created_at,

          delivery_date,

          delivery_slot,

          delivery_address,

          final_amount

        `)

        .eq(

          "customer_id",

          selectedCustomer.id

        );



    if (
      mode === "history"
    ) {

      orderQuery =
        orderQuery.in(
          "status",
          [
            "completed",
            "cancelled",
          ]
        );

    } else {

      orderQuery =

        orderQuery.not(

          "status",

          "in",

          '("completed","cancelled")'

        );

    }



    const {

      data: orderData,

      error: orderError,

    } =

      await orderQuery.order(

        "created_at",

        {

          ascending:

            false,

        }

      );



    if (orderError) {

      return NextResponse.json(

        {

          error:

            "Could not load orders: " +

            orderError.message,

        },

        {

          status: 500,

        }

      );

    }



    const orders =

      orderData ?? [];



    // ===================================================

    // 7. LOAD ORDER ITEMS

    //

    // We deliberately use \* here so this works with the

    // quantity snapshot columns already in your database.

    // ===================================================



    const orderIds =

      orders.map(

        (order) =>

          order.id

      );



    let rawItems:

      RawItem[] = [];



    if (

      orderIds.length >

      0

    ) {

      const {

        data: itemData,

        error: itemError,

      } =

        await supabaseAdmin

          .from(

            "order_items"

          )

          .select("\*")

          .in(

            "order_id",

            orderIds

          );



      if (itemError) {

        return NextResponse.json(

          {

            error:

              "Could not load order items: " +

              itemError.message,

          },

          {

            status: 500,

          }

        );

      }



      rawItems =

        (itemData ??

          []) as RawItem[];

    }



    // ===================================================

    // 8. LOAD PRODUCT NAMES / UNITS

    // ===================================================



    const productIds = [

      ...new Set(

        rawItems

          .map(

            (item) =>

              item.product_id

          )

          .filter(

            Boolean

          )

      ),

    ];



    const productMap =

      new Map<

        string,

        {

          product_name: string;

          unit: string;

        }

      >();



    if (

      productIds.length >

      0

    ) {

      const {

        data: productData,

      } =

        await supabaseAdmin

          .from("products")

          .select(`

            id,

            product_name,

            unit

          `)

          .in(

            "id",

            productIds

          );



      (

        productData ??

        []

      ).forEach(

        (product) => {

          productMap.set(

            product.id,

            {

              product_name:

                product.product_name,



              unit:

                product.unit,

            }

          );

        }

      );

    }



    // ===================================================

    // 9. FORMAT ORDERS

    // ===================================================



    const formattedOrders =

      orders.map(

        (order) => {

          const items =

            rawItems

              .filter(

                (item) =>

                  item.order_id ===

                  order.id

              )

              .map(

                (item) => {

                  const product =

                    productMap.get(

                      item.product_id

                    );



                  const requested =

                    item.requested_qty ??

                    item.requested_quantity ??

                    item.quantity ??

                    item.requested ??

                    null;



                  const confirmed =

                    item.confirmed_qty ??

                    item.confirmed_quantity ??

                    null;



                  const actual =

                    item.actual_qty ??

                    item.actual_picked_qty ??

                    item.actual_quantity ??

                    item.picked_qty ??

                    null;



                  const productName =

                    item.product_name_snapshot ??

                    item.product_name ??

                    product?.product_name ??

                    "Product";



                  const unit =

                    item.unit_snapshot ??

                    item.unit ??

                    product?.unit ??

                    "";



                  return {

                    id:

                      item.id,



                    productName,



                    unit,



                    requested:

                      requested ===

                      null

                        ? null

                        : Number(

                            requested

                          ),



                    confirmed:

                      confirmed ===

                      null

                        ? null

                        : Number(

                            confirmed

                          ),



                    actual:

                      actual ===

                      null

                        ? null

                        : Number(

                            actual

                          ),

                  };

                }

              );



          return {

            id:

              order.id,



            orderNumber:

              order.order_number,



            status:

              order.status,



            createdAt:

              order.created_at,



            deliveryDate:

              order.delivery_date,



            deliverySlot:

              order.delivery_slot,



            deliveryAddress:

              order.delivery_address,



            finalAmount:

              order.final_amount ===

              null

                ? null

                : Number(

                    order.final_amount

                  ),



            items,

          };

        }

      );



    return NextResponse.json({

      customer:

        selectedCustomer,



      customers:

        authorizedCustomers,



      mode,



      orders:

        formattedOrders,

    });

  } catch (error) {

    console.error(

      "Customer orders API:",

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