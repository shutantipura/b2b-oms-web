import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  createClient,
} from "@supabase/supabase-js";

export const runtime =
  "nodejs";

export const dynamic =
  "force-dynamic";

type VisibleRow = {
  sku: string;
  sales_score: string;
  category: string;
};

function getAdminClient() {
  const supabaseUrl =
    process.env
      .NEXT_PUBLIC_SUPABASE_URL;

  const supabaseSecret =
    process.env
      .SUPABASE_SECRET_KEY ??
    process.env
      .SUPABASE_SERVICE_ROLE_KEY;

  if (
    !supabaseUrl ||
    !supabaseSecret
  ) {
    throw new Error(
      "Server configuration is incomplete."
    );
  }

  return createClient(
    supabaseUrl,
    supabaseSecret,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  );
}

async function requireManager(
  request: NextRequest
) {
  const authorization =
    request.headers.get(
      "authorization"
    );

  const token =
    authorization?.startsWith(
      "Bearer "
    )
      ? authorization.slice(7)
      : "";

  if (!token) {
    throw new Error(
      "UNAUTHORIZED"
    );
  }

  const admin =
    getAdminClient();

  const {
    data: authData,
    error: authError,
  } =
    await admin.auth.getUser(
      token
    );

  if (
    authError ||
    !authData.user
  ) {
    throw new Error(
      "UNAUTHORIZED"
    );
  }

  const {
    data: manager,
    error: managerError,
  } =
    await admin
      .from("staff")
      .select(`
        id,
        account_type,
        is_active
      `)
      .eq(
        "auth_user_id",
        authData.user.id
      )
      .maybeSingle();

  if (
    managerError ||
    !manager ||
    manager.account_type !==
      "manager" ||
    manager.is_active !== true
  ) {
    throw new Error(
      "FORBIDDEN"
    );
  }

  return admin;
}

function normalizeSku(
  value: unknown
) {
  const trimmed =
    String(
      value ?? ""
    ).trim();

  if (
    /^[0-9]+$/.test(
      trimmed
    )
  ) {
    const stripped =
      trimmed.replace(
        /^0+/,
        ""
      );

    return stripped || "0";
  }

  return trimmed;
}

function normalizeRows(
  value: unknown
): VisibleRow[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const byKey =
    new Map<
      string,
      VisibleRow
    >();

  for (
    const raw of value
  ) {
    if (
      !raw ||
      typeof raw !==
        "object"
    ) {
      continue;
    }

    const row =
      raw as Record<
        string,
        unknown
      >;

    const sku =
      String(
        row.sku ?? ""
      ).trim();

    const salesScore =
      String(
        row.sales_score ??
          ""
      ).trim();

    const category =
      String(
        row.category ?? ""
      ).trim();

    if (!sku) {
      continue;
    }

    const key =
      normalizeSku(sku);

    if (!key) {
      continue;
    }

    const existing =
      byKey.get(key);

    if (!existing) {
      byKey.set(
        key,
        {
          sku,
          sales_score:
            salesScore,
          category,
        }
      );
      continue;
    }

    const currentSales =
      Number(
        salesScore.replace(
          /,/g,
          ""
        ) || "0"
      );

    const existingSales =
      Number(
        existing.sales_score.replace(
          /,/g,
          ""
        ) || "0"
      );

    if (
      Number.isFinite(
        currentSales
      ) &&
      currentSales >=
        existingSales
    ) {
      byKey.set(
        key,
        {
          sku,
          sales_score:
            salesScore,
          category,
        }
      );
    }
  }

  return Array.from(
    byKey.values()
  );
}

function errorResponse(
  error: unknown
) {
  const message =
    error instanceof Error
      ? error.message
      : "Unexpected error.";

  if (
    message ===
    "UNAUTHORIZED"
  ) {
    return NextResponse.json(
      {
        error:
          "กรุณาเข้าสู่ระบบก่อน",
      },
      {
        status: 401,
      }
    );
  }

  if (
    message ===
    "FORBIDDEN"
  ) {
    return NextResponse.json(
      {
        error:
          "หน้านี้สำหรับ Manager เท่านั้น",
      },
      {
        status: 403,
      }
    );
  }

  return NextResponse.json(
    {
      error: message,
    },
    {
      status: 500,
    }
  );
}

export async function POST(
  request: NextRequest
) {
  try {
    const admin =
      await requireManager(
        request
      );

    const body =
      (await request.json()) as Record<
        string,
        unknown
      >;

    const action =
      String(
        body.action ?? ""
      );

    // ===================================================
    // MATCH ONE SMALL BATCH
    // ===================================================

    if (action === "match") {
      const rows =
        normalizeRows(
          body.rows
        );

      if (
        rows.length === 0 ||
        rows.length > 500
      ) {
        return NextResponse.json(
          {
            error:
              "Match batch must contain 1-500 products.",
          },
          {
            status: 400,
          }
        );
      }

      const keys =
        rows.map(
          (row) =>
            normalizeSku(
              row.sku
            )
        );

      const {
        data,
        error,
      } =
        await admin
          .from("products")
          .select(
            "catalogue_sku_key"
          )
          .in(
            "catalogue_sku_key",
            keys
          );

      if (error) {
        throw new Error(
          "ไม่สามารถตรวจสอบ SKU ได้: " +
            error.message
        );
      }

      const matchedKeys =
        Array.from(
          new Set(
            (data ?? [])
              .map(
                (row) =>
                  String(
                    row.catalogue_sku_key ??
                      ""
                  )
              )
              .filter(Boolean)
          )
        );

      return NextResponse.json({
        matchedKeys,
        matchedCount:
          matchedKeys.length,
      });
    }

    // ===================================================
    // APPLY ONE SMALL BATCH
    // ===================================================

    if (action === "apply") {
      const rows =
        normalizeRows(
          body.rows
        );

      if (
        rows.length === 0 ||
        rows.length > 500
      ) {
        return NextResponse.json(
          {
            error:
              "Apply batch must contain 1-500 products.",
          },
          {
            status: 400,
          }
        );
      }

      const rowByKey =
        new Map<
          string,
          VisibleRow
        >();

      rows.forEach(
        (row) => {
          rowByKey.set(
            normalizeSku(
              row.sku
            ),
            row
          );
        }
      );

      const keys =
        Array.from(
          rowByKey.keys()
        );

      const {
        data: products,
        error: productError,
      } =
        await admin
          .from("products")
          .select("*")
          .in(
            "catalogue_sku_key",
            keys
          );

      if (productError) {
        throw new Error(
          "ไม่สามารถโหลดสินค้าที่จะอัปเดตได้: " +
            productError.message
        );
      }

      const now =
        new Date().toISOString();

      const updatedRows =
        (products ?? []).map(
          (product) => {
            const key =
              String(
                product.catalogue_sku_key ??
                  ""
              );

            const source =
              rowByKey.get(key);

            if (!source) {
              return product;
            }

            const salesScore =
              Number(
                source.sales_score
                  .replace(
                    /,/g,
                    ""
                  ) || "0"
              );

            return {
              ...product,
              is_customer_visible:
                true,
              sales_score:
                Number.isFinite(
                  salesScore
                )
                  ? salesScore
                  : 0,
              category:
                source.category,
              catalogue_updated_at:
                now,
            };
          }
        );

      if (
        updatedRows.length >
        0
      ) {
        const {
          error: updateError,
        } =
          await admin
            .from("products")
            .upsert(
              updatedRows,
              {
                onConflict:
                  "id",
              }
            );

        if (updateError) {
          throw new Error(
            "ไม่สามารถอัปเดตชุดสินค้าได้: " +
              updateError.message
          );
        }
      }

      return NextResponse.json({
        updatedCount:
          updatedRows.length,
      });
    }

    // ===================================================
    // LIST CURRENTLY VISIBLE PRODUCTS IN SMALL PAGES
    // ===================================================

    if (
      action ===
      "list-visible"
    ) {
      const requestedLimit =
        Number(
          body.limit ?? 500
        );

      const limit =
        Math.min(
          Math.max(
            Number.isFinite(
              requestedLimit
            )
              ? Math.floor(
                  requestedLimit
                )
              : 500,
            1
          ),
          500
        );

      const afterId =
        typeof body.afterId ===
          "string" &&
        body.afterId
          ? body.afterId
          : null;

      let query =
        admin
          .from("products")
          .select(
            "id,catalogue_sku_key"
          )
          .eq(
            "is_customer_visible",
            true
          )
          .order(
            "id",
            {
              ascending: true,
            }
          )
          .limit(limit);

      if (afterId) {
        query =
          query.gt(
            "id",
            afterId
          );
      }

      const {
        data,
        error,
      } =
        await query;

      if (error) {
        throw new Error(
          "ไม่สามารถตรวจสอบสินค้าที่แสดงอยู่ได้: " +
            error.message
        );
      }

      const items =
        (data ?? []).map(
          (row) => ({
            id:
              String(row.id),
            catalogue_sku_key:
              row.catalogue_sku_key
                ? String(
                    row.catalogue_sku_key
                  )
                : null,
          })
        );

      return NextResponse.json({
        items,
        nextCursor:
          items.length > 0
            ? items[
                items.length - 1
              ].id
            : null,
        done:
          items.length < limit,
      });
    }

    // ===================================================
    // HIDE STALE PRODUCT IDS
    // ===================================================

    if (action === "hide") {
      const ids =
        Array.isArray(
          body.ids
        )
          ? body.ids
              .map(
                (value) =>
                  String(value)
              )
              .filter(Boolean)
          : [];

      if (ids.length === 0) {
        return NextResponse.json({
          updatedCount: 0,
        });
      }

      const chunkSize = 100;
      let updatedCount = 0;

      for (
        let start = 0;
        start < ids.length;
        start += chunkSize
      ) {
        const chunk =
          ids.slice(
            start,
            start + chunkSize
          );

        const {
          data,
          error,
        } =
          await admin
            .from("products")
            .update({
              is_customer_visible:
                false,
              sales_score: 0,
              catalogue_updated_at:
                new Date().toISOString(),
            })
            .in(
              "id",
              chunk
            )
            .select("id");

        if (error) {
          throw new Error(
            "ไม่สามารถซ่อนสินค้าที่ไม่อยู่ในไฟล์ใหม่ได้: " +
              error.message
          );
        }

        updatedCount +=
          data?.length ?? 0;
      }

      return NextResponse.json({
        updatedCount,
      });
    }

    return NextResponse.json(
      {
        error:
          "Unknown action.",
      },
      {
        status: 400,
      }
    );

  } catch (error) {
    return errorResponse(
      error
    );
  }
}
