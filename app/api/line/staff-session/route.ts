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
    const { idToken } =
      await request.json();

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
    // SERVER-SIDE SUPABASE
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
    // FIND AUTHORIZED STAFF LINK
    // =====================================================

    const {
      data: staffLink,
      error: staffLinkError,
    } =
      await supabase
        .from(
          "staff_line_users"
        )
        .select(`
          staff_id,
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

    if (staffLinkError) {
      console.error(
        staffLinkError
      );

      return NextResponse.json(
        {
          error:
            "Could not check staff authorization.",
        },
        {
          status: 500,
        }
      );
    }

    if (!staffLink) {
      return NextResponse.json(
        {
          error:
            "This LINE account is not authorized for staff access.",
        },
        {
          status: 403,
        }
      );
    }

    // =====================================================
    // LOAD STAFF PROFILE
    // =====================================================

    const {
      data: staff,
      error: staffError,
    } =
      await supabase
        .from("staff")
        .select(`
          id,
          staff_code,
          staff_name,
          email,
          account_type,
          is_active,
          auth_user_id
        `)
        .eq(
          "id",
          staffLink.staff_id
        )
        .maybeSingle();

    if (
      staffError ||
      !staff
    ) {
      return NextResponse.json(
        {
          error:
            "Staff account could not be found.",
        },
        {
          status: 404,
        }
      );
    }

    if (!staff.is_active) {
      return NextResponse.json(
        {
          error:
            "Staff account is inactive.",
        },
        {
          status: 403,
        }
      );
    }

    // =====================================================
    // AUTH EMAIL
    //
    // If the staff record has a real email, use it.
    // Otherwise use an internal deterministic address.
    // No email is actually sent.
    // =====================================================

    const authEmail =
      (
        staff.email ??
        ""
      ).trim() ||
      `staff-${staff.id}@line-login.invalid`;

    let authUserId:
      | string
      | null =
      staff.auth_user_id ??
      null;

    let tokenHash:
      | string
      | null =
      null;

    // =====================================================
    // EXISTING AUTH USER
    // =====================================================

    if (authUserId) {
      const {
        data: existingUserData,
        error: existingUserError,
      } =
        await supabase.auth.admin
          .getUserById(
            authUserId
          );

      if (
        !existingUserError &&
        existingUserData?.user
      ) {
        const email =
          existingUserData
            .user
            .email ??
          authEmail;

        const {
          data: linkData,
          error: linkError,
        } =
          await supabase.auth.admin
            .generateLink({
              type:
                "magiclink",

              email,
            });

        if (linkError) {
          console.error(
            linkError
          );

          return NextResponse.json(
            {
              error:
                "Could not create staff login session.",
            },
            {
              status: 500,
            }
          );
        }

        tokenHash =
          linkData
            ?.properties
            ?.hashed_token ??
          null;
      } else {
        // Stale auth_user_id:
        // create/recover a new identity below.
        authUserId =
          null;
      }
    }

    // =====================================================
    // FIRST-TIME STAFF AUTH PROVISIONING
    // =====================================================

    if (!authUserId) {
      const {
        data: newLinkData,
        error: newLinkError,
      } =
        await supabase.auth.admin
          .generateLink({
            type:
              "magiclink",

            email:
              authEmail,

            options: {
              data: {
                staff_code:
                  staff.staff_code,

                staff_name:
                  staff.staff_name,

                account_type:
                  staff.account_type,

                source:
                  "line_staff",
              },
            },
          });

      if (
        newLinkError ||
        !newLinkData?.user
      ) {
        console.error(
          newLinkError
        );

        return NextResponse.json(
          {
            error:
              "Could not create staff authentication account.",
          },
          {
            status: 500,
          }
        );
      }

      authUserId =
        newLinkData.user.id;

      tokenHash =
        newLinkData
          ?.properties
          ?.hashed_token ??
        null;

      // -----------------------------------------------
      // Save the Supabase Auth identity on staff row
      // -----------------------------------------------

      const {
        error: updateError,
      } =
        await supabase
          .from("staff")
          .update({
            auth_user_id:
              authUserId,

            updated_at:
              new Date()
                .toISOString(),
          })
          .eq(
            "id",
            staff.id
          );

      if (updateError) {
        console.error(
          updateError
        );

        return NextResponse.json(
          {
            error:
              "Authentication account was created, but staff profile linking failed.",
          },
          {
            status: 500,
          }
        );
      }
    }

    // =====================================================
    // FINAL TOKEN CHECK
    // =====================================================

    if (!tokenHash) {
      return NextResponse.json(
        {
          error:
            "Staff login token was not generated.",
        },
        {
          status: 500,
        }
      );
    }

    return NextResponse.json(
      {
        tokenHash,

        staff: {
          staffCode:
            staff.staff_code,

          staffName:
            staff.staff_name,

          accountType:
            staff.account_type,
        },
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
      "Staff session error:",
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