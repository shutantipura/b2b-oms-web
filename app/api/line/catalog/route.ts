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



type CatalogueProduct = {

  id: string;

  sku: string;

  productName: string;

  imageUrl: string | null;

  category: string | null;

  unit: string;

  normalPrice: number;

  effectivePrice: number;

  hasSpecialPrice: boolean;

  isFavourite: boolean;

  favouriteOrder: number | null;

};



type CategoryFacet = {

  category: string;

  count: number;

};



const PAGE_SIZE = 30;

const MAX_CART_PRODUCT_IDS = 200;



function clampOffset(value: unknown) {

  const parsed = Number(value);



  if (!Number.isFinite(parsed) || parsed < 0) {

    return 0;

  }



  return Math.floor(parsed);

}



function sanitizeSearch(value: unknown) {

  if (typeof value !== "string") {

    return "";

  }



  return value

    .trim()

    .replace(/[,%()*_\\]/g, " ")

    .replace(/\s+/g, " ")

    .slice(0, 100);

}



function sanitizeCategory(value: unknown) {

  if (typeof value !== "string") {

    return "";

  }



  return value

    .trim()

    .slice(0, 100);

}



function cleanProductIds(value: unknown) {

  if (!Array.isArray(value)) {

    return [] as string[];

  }



  const unique = new Set<string>();



  for (const raw of value) {

    if (typeof raw !== "string") {

      continue;

    }



    const id = raw.trim();



    if (!id) {

      continue;

    }



    unique.add(id);



    if (unique.size >= MAX_CART_PRODUCT_IDS) {

      break;

    }

  }



  return [...unique];

}



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



    const search =

      sanitizeSearch(

        body.search

      );



    const category =

      sanitizeCategory(

        body.category

      );



    const offset =

      clampOffset(

        body.offset

      );



    const includeContext =

      body.includeContext !== false;



    const cartProductIds =

      cleanProductIds(

        body.cartProductIds

      );



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

    // LOAD ONE PAGE OF ACTIVE + VISIBLE PRODUCTS
    // Ranked by search relevance, then sales score.
    // ================================================



    const {

      data: pageProductData,

      error: productError,

    } =

      await supabaseAdmin.rpc(

        "search_customer_catalogue",

        {

          p_search:

            search,

          p_category:

            category ||

            null,

          p_offset:

            offset,

          p_limit:

            PAGE_SIZE,

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



    const rawPageProducts =

      pageProductData ??

      [];



    const productCount =

      rawPageProducts.length >

      0

        ? Number(

            rawPageProducts[0]

              .total_count ??

              0

          )

        : 0;



    const pageProducts =

      rawPageProducts.map(

        (

          product: any

        ) => {

          const {

            total_count:

              _totalCount,

            ...baseProduct

          } = product;



          return baseProduct;

        }

      );



    const pageProductIds =

      pageProducts.map(

        (

          product: any

        ) =>

          product.id

      );



    // ================================================

    // CATEGORY FACETS FOR THE CURRENT SEARCH
    // Category counts ignore the selected category so the
    // customer can freely switch filters.
    // ================================================



    let categoryFacets:

      CategoryFacet[] =

      [];



    let searchTotal =

      productCount;



    if (search) {

      const {

        data: facetData,

        error: facetError,

      } =

        await supabaseAdmin.rpc(

          "catalogue_category_facets",

          {

            p_search:

              search,

          }

        );



      if (facetError) {

        return NextResponse.json(

          {

            error:

              "Could not load category filters: " +

              facetError.message,

          },

          {

            status: 500,

          }

        );

      }



      const facetRows =

        facetData ??

        [];



      const allRow =

        facetRows.find(

          (

            row: any

          ) =>

            row.category ===

              null

        );



      if (allRow) {

        searchTotal =

          Number(

            allRow.product_count ??

            0

          );

      }



      categoryFacets =

        facetRows

          .filter(

            (

              row: any

            ) =>

              typeof row.category ===

                "string" &&

              row.category.trim() !==

                ""

          )

          .map(

            (

              row: any

            ) => ({

              category:

                row.category,

              count:

                Number(

                  row.product_count ??

                  0

                ),

            })

          );

    }



    // ================================================

    // FAVOURITES

    // ================================================



    let favouriteData: any[] =

      [];



    if (includeContext) {

      const {

        data,

        error,

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



      if (error) {

        return NextResponse.json(

          {

            error:

              "Could not load favourites: " +

              error.message,

          },

          {

            status: 500,

          }

        );

      }



      favouriteData =

        data ?? [];

    } else if (

      pageProductIds.length > 0

    ) {

      const {

        data,

        error,

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

          .in(

            "product_id",

            pageProductIds

          );



      if (error) {

        return NextResponse.json(

          {

            error:

              "Could not check favourites: " +

              error.message,

          },

          {

            status: 500,

          }

        );

      }



      favouriteData =

        data ?? [];

    }



    const favouriteMap =

      new Map<string, number>();



    favouriteData.forEach(

      (favourite) => {

        favouriteMap.set(

          favourite.product_id,

          favourite.sort_order ??

          999999

        );

      }

    );



    // ================================================

    // INITIAL CONTEXT: FAVOURITES + CART PRODUCT DETAILS

    // ================================================



    let contextProducts: any[] =

      [];



    if (includeContext) {

      const contextIds =

        Array.from(

          new Set([

            ...favouriteData.map(

              (favourite) =>

                favourite.product_id

            ),

            ...cartProductIds,

          ])

        ).filter(

          (id) =>

            !pageProductIds.includes(

              id

            )

        );



      if (

        contextIds.length > 0

      ) {

        const {

          data,

          error,

        } =

          await supabaseAdmin

            .from("products")

            .select(`

              id,

              sku,

              product_name,

              category,

              unit,

              normal_price,

              image_url

            `)

            .eq(

              "is_active",

              true

            )

            .eq(

              "is_customer_visible",

              true

            )

            .in(

              "id",

              contextIds

            );



        if (error) {

          return NextResponse.json(

            {

              error:

                "Could not load catalogue context: " +

                error.message,

            },

            {

              status: 500,

            }

          );

        }



        contextProducts =

          data ?? [];

      }

    }



    // ================================================

    // SPECIAL PRICES FOR ONLY THE PRODUCTS IN THIS RESPONSE

    // ================================================



    const allBaseProducts =

      [

        ...pageProducts,

        ...contextProducts,

      ];



    const allProductIds =

      Array.from(

        new Set(

          allBaseProducts.map(

            (product) =>

              product.id

          )

        )

      );



    let priceData: any[] =

      [];



    if (

      allProductIds.length > 0

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

            allProductIds

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

      new Map<string, number>();



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



    function toCatalogueProduct(

      product: any

    ): CatalogueProduct {

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

        imageUrl:

          product.image_url ??

          null,

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



    const catalogueById =

      new Map<

        string,

        CatalogueProduct

      >();



    allBaseProducts.forEach(

      (product) => {

        catalogueById.set(

          product.id,

          toCatalogueProduct(

            product

          )

        );

      }

    );



    const catalogue =

      pageProductIds

        .map(

          (id: string) =>

            catalogueById.get(

              id

            )

        )

        .filter(

          (

            product: CatalogueProduct | undefined

          ): product is CatalogueProduct =>

            Boolean(product)

        );



    const favourites =

      includeContext

        ? favouriteData

            .map(

              (favourite) =>

                catalogueById.get(

                  favourite.product_id

                )

            )

            .filter(

              (

                product

              ): product is CatalogueProduct =>

                Boolean(product)

            )

        : undefined;



    const cartProducts =

      includeContext

        ? cartProductIds

            .map(

              (id) =>

                catalogueById.get(

                  id

                )

            )

            .filter(

              (

                product

              ): product is CatalogueProduct =>

                Boolean(product)

            )

        : undefined;



    const total =

      productCount ??

      0;



    const nextOffset =

      offset +

      catalogue.length;



    return NextResponse.json({

      customer:

        selectedCustomer,

      products:

        catalogue,

      favourites,

      cartProducts,

      total,

      nextOffset,

      hasMore:

        nextOffset <

        total,

      pageSize:

        PAGE_SIZE,

      search,

      category,

      categoryFacets,

      searchTotal,

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
