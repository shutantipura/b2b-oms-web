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

type TaskStage =
  | "confirmation"
  | "picking"
  | "billing"
  | "delivery"
  | "payment_verification";

const ALL_TASK_STAGES: TaskStage[] = [
  "confirmation",
  "picking",
  "billing",
  "delivery",
  "payment_verification",
];

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
    managerStaffId:
      manager.id as string,
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

function normalizePhone(value: unknown): string | null {
  const raw = normalizeText(value);
  if (!raw) return null;
  const cleaned = raw.replace(/[\s().-]/g, "");
  if (!/^\+?[0-9]{9,15}$/.test(cleaned)) throw new Error("กรุณากรอกเบอร์โทรศัพท์ให้ถูกต้อง (9–15 หลัก)");
  return cleaned;
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

function normalizeTaskPermissions(
  value: unknown,
  fallback:
    TaskStage[] = []
): TaskStage[] {
  if (!Array.isArray(value)) {
    return [...fallback];
  }

  const valid =
    new Set<TaskStage>(
      ALL_TASK_STAGES
    );

  return Array.from(
    new Set(
      value.filter(
        (
          stage
        ): stage is TaskStage =>
          typeof stage ===
            "string" &&
          valid.has(
            stage as TaskStage
          )
      )
    )
  );
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

function queueStatusForStage(
  stage: TaskStage
) {
  const map:
    Record<TaskStage, string> = {
      confirmation:
        "awaiting_confirmation",
      picking:
        "awaiting_picking",
      billing:
        "awaiting_billing",
      delivery:
        "ready_for_delivery",
      payment_verification:
        "payment_submitted",
    };

  return map[stage];
}

async function releaseClaimsForRemovedPermissions(
  admin: any,
  staffId: string,
  managerStaffId: string,
  removedStages: TaskStage[]
) {
  if (
    removedStages.length ===
    0
  ) {
    return;
  }

  const {
    data: claims,
    error: claimError,
  } =
    await admin
      .from("task_claims")
      .select(`
        id,
        order_id,
        stage
      `)
      .eq(
        "staff_id",
        staffId
      )
      .eq(
        "claim_status",
        "active"
      )
      .in(
        "stage",
        removedStages
      );

  if (claimError) {
    throw new Error(
      "ไม่สามารถตรวจสอบงานที่ต้องปล่อยได้: " +
        claimError.message
    );
  }

  const activeClaims =
    (claims ?? []) as Array<{
      id: string;
      order_id: string;
      stage: TaskStage;
    }>;

  if (
    activeClaims.length ===
    0
  ) {
    return;
  }

  const orderIds =
    Array.from(
      new Set(
        activeClaims.map(
          (claim) =>
            claim.order_id
        )
      )
    );

  const {
    data: orders,
    error: orderError,
  } =
    await admin
      .from("orders")
      .select(`
        id,
        status
      `)
      .in(
        "id",
        orderIds
      );

  if (orderError) {
    throw new Error(
      "ไม่สามารถโหลดคำสั่งซื้อสำหรับการปล่อยงานได้: " +
        orderError.message
    );
  }

  const orderStatusMap =
    new Map<string, string>(
      (orders ?? []).map(
        (order: any) => [
          order.id,
          order.status,
        ]
      )
    );

  for (
    const claim of activeClaims
  ) {
    const fromStatus =
      orderStatusMap.get(
        claim.order_id
      );

    const returnStatus =
      queueStatusForStage(
        claim.stage
      );

    const {
      error: releaseError,
    } =
      await admin
        .from("task_claims")
        .update({
          claim_status:
            "released",
          released_at:
            new Date()
              .toISOString(),
        })
        .eq(
          "id",
          claim.id
        )
        .eq(
          "claim_status",
          "active"
        );

    if (releaseError) {
      throw new Error(
        "ไม่สามารถปล่อยงานของพนักงานได้: " +
          releaseError.message
      );
    }

    if (
      fromStatus &&
      fromStatus !==
        "completed" &&
      fromStatus !==
        "cancelled"
    ) {
      const {
        error: orderUpdateError,
      } =
        await admin
          .from("orders")
          .update({
            status:
              returnStatus,
            updated_at:
              new Date()
                .toISOString(),
          })
          .eq(
            "id",
            claim.order_id
          );

      if (orderUpdateError) {
        throw new Error(
          "ปล่อยงานแล้ว แต่ไม่สามารถคืนคำสั่งซื้อกลับเข้าคิวได้: " +
            orderUpdateError.message
        );
      }

      const {
        error: historyError,
      } =
        await admin
          .from(
            "order_history"
          )
          .insert({
            order_id:
              claim.order_id,
            action:
              "task_released",
            stage:
              claim.stage,
            from_status:
              fromStatus,
            to_status:
              returnStatus,
            performed_by_staff_id:
              managerStaffId,
            note:
              "Task released because Manager removed this staff task permission",
            details: {
              affected_staff_id:
                staffId,
              removed_stage:
                claim.stage,
            },
          });

      if (historyError) {
        throw new Error(
          "คืนงานเข้าคิวแล้ว แต่บันทึกประวัติไม่สำเร็จ: " +
            historyError.message
        );
      }
    }
  }
}

async function replacePermissions(
  admin: any,
  staffId: string,
  stages: TaskStage[]
) {
  const {
    error: deleteError,
  } =
    await admin
      .from(
        "staff_task_permissions"
      )
      .delete()
      .eq(
        "staff_id",
        staffId
      );

  if (deleteError) {
    throw new Error(
      "ไม่สามารถล้างสิทธิ์งานเดิมได้: " +
        deleteError.message
    );
  }

  if (
    stages.length === 0
  ) {
    return;
  }

  const {
    error: insertError,
  } =
    await admin
      .from(
        "staff_task_permissions"
      )
      .insert(
        stages.map(
          (stage) => ({
            staff_id:
              staffId,
            stage,
          })
        )
      );

  if (insertError) {
    throw new Error(
      "ไม่สามารถบันทึกสิทธิ์งานได้: " +
        insertError.message
    );
  }
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

    const [
      staffResult,
      permissionResult,
    ] =
      await Promise.all([
        admin
          .from("staff")
          .select(`
            id,
            staff_code,
            staff_name,
            phone,
            account_type,
            auth_user_id,
            is_active
          `)
          .order(
            "staff_code",
            {
              ascending: true,
            }
          ),

        admin
          .from(
            "staff_task_permissions"
          )
          .select(`
            staff_id,
            stage
          `),
      ]);

    if (
      staffResult.error
    ) {
      throw new Error(
        "ไม่สามารถโหลดข้อมูลพนักงานได้: " +
          staffResult.error.message
      );
    }

    if (
      permissionResult.error
    ) {
      throw new Error(
        "ไม่สามารถโหลดสิทธิ์งานได้: " +
          permissionResult.error.message
      );
    }

    const permissionMap =
      new Map<
        string,
        TaskStage[]
      >();

    for (
      const row of
      permissionResult.data ?? []
    ) {
      const list =
        permissionMap.get(
          row.staff_id
        ) ?? [];

      const stage =
        row.stage as TaskStage;

      if (
        ALL_TASK_STAGES.includes(
          stage
        )
      ) {
        list.push(stage);
      }

      permissionMap.set(
        row.staff_id,
        list
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
      (
        staffResult.data ??
        []
      ).map(
        (row) => ({
          id:
            row.id,
          staffCode:
            row.staff_code,
          staffName:
            row.staff_name,
          phone: row.phone,
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
          taskPermissions:
            row.account_type ===
            "manager"
              ? [...ALL_TASK_STAGES]
              : (
                  permissionMap.get(
                    row.id
                  ) ??
                  []
                ),
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
    const phone = normalizePhone(body.phone);

    const accountType =
      normalizeAccountType(
        body.accountType
      );

    const taskPermissions =
      normalizeTaskPermissions(
        body.taskPermissions,
        ALL_TASK_STAGES
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
          phone,
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
          phone,
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

    try {
      if (
        accountType ===
        "staff"
      ) {
        await replacePermissions(
          admin,
          createdStaff.id,
          taskPermissions
        );
      }
    } catch (permissionError) {
      await admin
        .from("staff")
        .delete()
        .eq(
          "id",
          createdStaff.id
        );

      await admin.auth
        .admin.deleteUser(
          authUserId
        );

      throw permissionError;
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
          phone: createdStaff.phone,
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
          taskPermissions:
            accountType ===
            "manager"
              ? [...ALL_TASK_STAGES]
              : taskPermissions,
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
// PATCH — EDIT / DEACTIVATE / REACTIVATE / PERMISSIONS
// =====================================================

export async function PATCH(
  request: NextRequest
) {
  try {
    const {
      admin,
      currentUserId,
      managerStaffId,
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

    const hasPhone = Object.prototype.hasOwnProperty.call(body, "phone");

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
      error: targetError,
    } =
      await admin
        .from("staff")
        .select(`
          id,
          staff_code,
          staff_name,
          phone,
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

    const {
      data: currentPermissionRows,
      error: currentPermissionError,
    } =
      await admin
        .from(
          "staff_task_permissions"
        )
        .select("stage")
        .eq(
          "staff_id",
          target.id
        );

    if (
      currentPermissionError
    ) {
      throw new Error(
        "ไม่สามารถโหลดสิทธิ์งานเดิมได้: " +
          currentPermissionError.message
      );
    }

    const currentPermissions =
      normalizeTaskPermissions(
        (
          currentPermissionRows ??
          []
        ).map(
          (row) =>
            row.stage
        )
      );

    const requestedPermissions =
      normalizeTaskPermissions(
        body.taskPermissions,
        target.account_type ===
          "manager"
          ? ALL_TASK_STAGES
          : currentPermissions
      );

    const finalPermissions =
      accountType ===
      "manager"
        ? [...ALL_TASK_STAGES]
        : requestedPermissions;

    const isSelf =
      target.auth_user_id ===
      currentUserId;

    if (
      isSelf &&
      (
        isActive !== true ||
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
        error: countError,
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
        (count ?? 0) <=
        1
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
              "พนักงานคนนี้ยังมีงานที่ Claim อยู่ กรุณาทำงานให้เสร็จหรือเอาสิทธิ์งานนั้นออกก่อนปิดใช้งานบัญชี",
          },
          {
            status: 400,
          }
        );
      }
    }

    const effectiveCurrentPermissions =
      target.account_type ===
      "manager"
        ? [...ALL_TASK_STAGES]
        : currentPermissions;

    const removedStages =
      accountType ===
      "staff"
        ? effectiveCurrentPermissions.filter(
            (stage) =>
              !finalPermissions.includes(
                stage
              )
          )
        : [];

    // If a Manager removes a stage that the staff member is actively
    // working on, release that task back to the shared queue first.
    await releaseClaimsForRemovedPermissions(
      admin,
      target.id,
      managerStaffId,
      removedStages
    );

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

      if (authUpdateError) {
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
      error: updateError,
    } =
      await admin
        .from("staff")
        .update({
          staff_name:
            staffName,
          phone: hasPhone ? normalizePhone(body.phone) : target.phone,
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
          phone,
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

    await replacePermissions(
      admin,
      target.id,
      accountType ===
        "manager"
        ? []
        : finalPermissions
    );

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
          phone: updated.phone,
          accountType:
            updated.account_type,
          authUserId:
            updated.auth_user_id,
          isActive:
            updated.is_active,
          taskPermissions:
            accountType ===
            "manager"
              ? [...ALL_TASK_STAGES]
              : finalPermissions,
        },
      }
    );
  } catch (error) {
    return errorResponse(
      error
    );
  }
}
