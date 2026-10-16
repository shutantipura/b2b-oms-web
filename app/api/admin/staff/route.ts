import {
  randomBytes,
} from "crypto";

import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  createClient,
} from "@supabase/supabase-js";

export const runtime =
  "nodejs";

type AccountType =
  | "staff"
  | "manager";

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
      "Server configuration is incomplete. Add SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY to Vercel."
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

  return {
    admin,
    currentUserId:
      authData.user.id,
  };
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
      error:
        message,
    },
    {
      status: 500,
    }
  );
}

function normalizeText(
  value: unknown
) {
  return typeof value ===
    "string"
    ? value.trim()
    : "";
}

function normalizeAccountType(
  value: unknown
): AccountType | null {
  if (
    value === "staff" ||
    value === "manager"
  ) {
    return value;
  }

  return null;
}

function buildNextStaffCode(
  rows: Array<{
    staff_code:
      | string
      | null;
  }>
) {
  let highest = 0;

  for (
    const row of rows
  ) {
    const match =
      String(
        row.staff_code ??
          ""
      ).match(
        /^S(\d+)$/i
      );

    if (!match) {
      continue;
    }

    highest =
      Math.max(
        highest,
        Number(
          match[1]
        ) || 0
      );
  }

  return `S${String(
    highest + 1
  ).padStart(
    3,
    "0"
  )}`;
}

function buildInternalEmail(
  staffCode: string
) {
  const suffix =
    randomBytes(6)
      .toString("hex");

  return `${staffCode.toLowerCase()}.${suffix}@staff.b2boms.invalid`;
}

function buildInternalPassword() {
  return (
    randomBytes(32)
      .toString(
        "base64url"
      ) +
    "Aa1!"
  );
}

// =====================================================
// GET — LIST STAFF
// =====================================================

export async function GET(
  request: NextRequest
) {
  try {
    const {
      admin,
      currentUserId,
    } =
      await requireManager(
        request
      );

    const {
      data: staffRows,
      error: staffError,
    } =
      await admin
        .from("staff")
        .select(`
          id,
          staff_code,
          staff_name,
          account_type,
          auth_user_id,
          is_active
        `)
        .order(
          "staff_code",
          {
            ascending: true,
          }
        );

    if (staffError) {
      throw new Error(
        "ไม่สามารถโหลดข้อมูลพนักงานได้: " +
          staffError.message
      );
    }

    // Keep Auth details internal. We only expose last sign-in time.
    const lastSignInMap =
      new Map<
        string,
        string | null
      >();

    let page = 1;

    while (true) {
      const {
        data,
        error,
      } =
        await admin.auth
          .admin.listUsers(
            {
              page,
              perPage: 1000,
            }
          );

      if (error) {
        throw new Error(
          "ไม่สามารถโหลดข้อมูลการเข้าสู่ระบบได้: " +
            error.message
        );
      }

      for (
        const user of
        data.users
      ) {
        lastSignInMap.set(
          user.id,
          user.last_sign_in_at ??
            null
        );
      }

      if (
        data.users.length <
        1000
      ) {
        break;
      }

      page += 1;
    }

    const staff =
      (staffRows ??
        []).map(
        (row) => ({
          id:
            row.id,
          staffCode:
            row.staff_code,
          staffName:
            row.staff_name,
          accountType:
            row.account_type,
          authUserId:
            row.auth_user_id,
          isActive:
            row.is_active,
          lastSignInAt:
            row.auth_user_id
              ? (
                  lastSignInMap.get(
                    row.auth_user_id
                  ) ??
                  null
                )
              : null,
          isCurrentUser:
            row.auth_user_id ===
            currentUserId,
        })
      );

    return NextResponse.json(
      {
        staff,
      }
    );
  } catch (error) {
    return errorResponse(
      error
    );
  }
}

// =====================================================
// POST — CREATE STAFF + HIDDEN AUTH IDENTITY
// =====================================================

export async function POST(
  request: NextRequest
) {
  try {
    const {
      admin,
    } =
      await requireManager(
        request
      );

    const body =
      await request.json();

    const staffName =
      normalizeText(
        body.staffName
      );

    const accountType =
      normalizeAccountType(
        body.accountType
      );

    if (!staffName) {
      return NextResponse.json(
        {
          error:
            "กรุณากรอกชื่อพนักงาน",
        },
        {
          status: 400,
        }
      );
    }

    if (!accountType) {
      return NextResponse.json(
        {
          error:
            "ประเภทบัญชีไม่ถูกต้อง",
        },
        {
          status: 400,
        }
      );
    }

    const {
      data: staffCodes,
      error: codeError,
    } =
      await admin
        .from("staff")
        .select(
          "staff_code"
        );

    if (codeError) {
      throw new Error(
        "ไม่สามารถสร้างรหัสพนักงานได้: " +
          codeError.message
      );
    }

    const staffCode =
      buildNextStaffCode(
        staffCodes ??
          []
      );

    const internalEmail =
      buildInternalEmail(
        staffCode
      );

    const internalPassword =
      buildInternalPassword();

    const {
      data: authCreate,
      error: authCreateError,
    } =
      await admin.auth
        .admin.createUser(
          {
            email:
              internalEmail,
            password:
              internalPassword,
            email_confirm:
              true,
            user_metadata: {
              staff_code:
                staffCode,
              staff_name:
                staffName,
              auth_mode:
                "line",
            },
          }
        );

    if (
      authCreateError ||
      !authCreate.user
    ) {
      return NextResponse.json(
        {
          error:
            "ไม่สามารถสร้างบัญชีระบบภายในได้: " +
            (
              authCreateError
                ?.message ??
              "Unknown error"
            ),
        },
        {
          status: 400,
        }
      );
    }

    const authUserId =
      authCreate.user.id;

    const {
      data: createdStaff,
      error: insertError,
    } =
      await admin
        .from("staff")
        .insert({
          staff_code:
            staffCode,
          staff_name:
            staffName,
          account_type:
            accountType,
          auth_user_id:
            authUserId,
          is_active:
            true,
        })
        .select(`
          id,
          staff_code,
          staff_name,
          account_type,
          auth_user_id,
          is_active
        `)
        .single();

    if (insertError) {
      await admin.auth
        .admin.deleteUser(
          authUserId
        );

      return NextResponse.json(
        {
          error:
            "สร้างบัญชีระบบภายในแล้ว แต่สร้างข้อมูลพนักงานไม่สำเร็จ: " +
            insertError.message,
        },
        {
          status: 400,
        }
      );
    }

    return NextResponse.json(
      {
        success:
          true,
        staff: {
          id:
            createdStaff.id,
          staffCode:
            createdStaff.staff_code,
          staffName:
            createdStaff.staff_name,
          accountType:
            createdStaff.account_type,
          authUserId:
            createdStaff.auth_user_id,
          isActive:
            createdStaff.is_active,
          lastSignInAt:
            null,
          isCurrentUser:
            false,
        },
      },
      {
        status: 201,
      }
    );
  } catch (error) {
    return errorResponse(
      error
    );
  }
}

// =====================================================
// PATCH — EDIT / DEACTIVATE / REACTIVATE
// =====================================================

export async function PATCH(
  request: NextRequest
) {
  try {
    const {
      admin,
      currentUserId,
    } =
      await requireManager(
        request
      );

    const body =
      await request.json();

    const staffId =
      normalizeText(
        body.staffId
      );

    const staffName =
      normalizeText(
        body.staffName
      );

    const accountType =
      normalizeAccountType(
        body.accountType
      );

    const isActive =
      body.isActive;

    if (
      !staffId ||
      !staffName ||
      !accountType ||
      typeof isActive !==
        "boolean"
    ) {
      return NextResponse.json(
        {
          error:
            "ข้อมูลพนักงานไม่ครบถ้วน",
        },
        {
          status: 400,
        }
      );
    }

    const {
      data: target,
      error:
        targetError,
    } =
      await admin
        .from("staff")
        .select(`
          id,
          staff_code,
          staff_name,
          account_type,
          auth_user_id,
          is_active
        `)
        .eq(
          "id",
          staffId
        )
        .maybeSingle();

    if (
      targetError ||
      !target
    ) {
      return NextResponse.json(
        {
          error:
            "ไม่พบพนักงาน",
        },
        {
          status: 404,
        }
      );
    }

    const isSelf =
      target.auth_user_id ===
      currentUserId;

    if (
      isSelf &&
      (
        isActive !==
          true ||
        accountType !==
          "manager"
      )
    ) {
      return NextResponse.json(
        {
          error:
            "ไม่สามารถปิดใช้งานหรือลดสิทธิ์ Manager ของบัญชีที่กำลังใช้งานอยู่ได้",
        },
        {
          status: 400,
        }
      );
    }

    const removingManager =
      target.account_type ===
        "manager" &&
      (
        accountType !==
          "manager" ||
        isActive !==
          true
      );

    if (removingManager) {
      const {
        count,
        error:
          countError,
      } =
        await admin
          .from("staff")
          .select(
            "id",
            {
              count:
                "exact",
              head:
                true,
            }
          )
          .eq(
            "account_type",
            "manager"
          )
          .eq(
            "is_active",
            true
          );

      if (countError) {
        throw new Error(
          "ไม่สามารถตรวจสอบจำนวน Manager ได้: " +
            countError.message
        );
      }

      if (
        (count ??
          0) <= 1
      ) {
        return NextResponse.json(
          {
            error:
              "ต้องมี Manager ที่ใช้งานอยู่ในระบบอย่างน้อย 1 คน",
          },
          {
            status: 400,
          }
        );
      }
    }

    if (
      target.is_active ===
        true &&
      isActive === false
    ) {
      const {
        count:
          activeClaimCount,
        error:
          activeClaimError,
      } =
        await admin
          .from(
            "task_claims"
          )
          .select(
            "id",
            {
              count:
                "exact",
              head:
                true,
            }
          )
          .eq(
            "staff_id",
            target.id
          )
          .eq(
            "claim_status",
            "active"
          );

      if (activeClaimError) {
        throw new Error(
          "ไม่สามารถตรวจสอบงานที่พนักงานกำลังถืออยู่ได้: " +
            activeClaimError.message
        );
      }

      if (
        (activeClaimCount ??
          0) > 0
      ) {
        return NextResponse.json(
          {
            error:
              "พนักงานคนนี้ยังมีงานที่ Claim อยู่ กรุณาทำงานให้เสร็จหรือปล่อยงานก่อนปิดใช้งานบัญชี",
          },
          {
            status: 400,
          }
        );
      }
    }

    const activeChanged =
      target.is_active !==
      isActive;

    if (
      activeChanged &&
      target.auth_user_id
    ) {
      const {
        error:
          authUpdateError,
      } =
        await admin.auth
          .admin.updateUserById(
            target.auth_user_id,
            {
              ban_duration:
                isActive
                  ? "none"
                  : "876000h",
            }
          );

      if (
        authUpdateError
      ) {
        return NextResponse.json(
          {
            error:
              "ไม่สามารถอัปเดตสถานะบัญชีระบบได้: " +
              authUpdateError.message,
          },
          {
            status: 400,
          }
        );
      }
    }

    const {
      data: updated,
      error:
        updateError,
    } =
      await admin
        .from("staff")
        .update({
          staff_name:
            staffName,
          account_type:
            accountType,
          is_active:
            isActive,
        })
        .eq(
          "id",
          staffId
        )
        .select(`
          id,
          staff_code,
          staff_name,
          account_type,
          auth_user_id,
          is_active
        `)
        .single();

    if (updateError) {
      if (
        activeChanged &&
        target.auth_user_id
      ) {
        await admin.auth
          .admin.updateUserById(
            target.auth_user_id,
            {
              ban_duration:
                target.is_active
                  ? "none"
                  : "876000h",
            }
          );
      }

      return NextResponse.json(
        {
          error:
            "ไม่สามารถอัปเดตข้อมูลพนักงานได้: " +
            updateError.message,
        },
        {
          status: 400,
        }
      );
    }

    return NextResponse.json(
      {
        success:
          true,
        staff: {
          id:
            updated.id,
          staffCode:
            updated.staff_code,
          staffName:
            updated.staff_name,
          accountType:
            updated.account_type,
          authUserId:
            updated.auth_user_id,
          isActive:
            updated.is_active,
        },
      }
    );
  } catch (error) {
    return errorResponse(
      error
    );
  }
}
