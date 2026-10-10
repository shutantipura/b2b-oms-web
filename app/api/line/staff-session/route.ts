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

    // ================================================
    // VERIFY LINE USER
    // ================================================

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

    // ================================================
    // SERVER SUPABASE CLIENT
    // ================================================

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

    // ================================================
    // STAFF LINE AUTHORIZATION
    // ================================================

    const {
      data: staffLink,
      error: linkError,
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

    if (linkError) {
      console.error(
        linkError
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

    // ================================================
    // LOAD STAFF ACCOUNT
    // ================================================

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

    if (!staff.auth_user_id) {
      return NextResponse.json(
        {
          error:
            "Staff account is not linked to Supabase Auth.",
        },
        {
          status: 400,
        }
      );
    }

    // ================================================
    // GET EXISTING AUTH USER
    // ================================================

    const {
      data: authData,
      error: authError,
    } =
      await supabase.auth.admin
        .getUserById(
          staff.auth_user_id
        );

    if (
      authError ||
      !authData?.user
    ) {
      return NextResponse.json(
        {
          error:
            "Could not load staff authentication account.",
        },
        {
          status: 500,
        }
      );
    }

    const email =
      authData.user.email;

    if (!email) {
      return NextResponse.json(
        {
          error:
            "Staff authentication account has no email.",
        },
        {
          status: 400,
        }
      );
    }

    // ================================================
    // CREATE ONE-TIME SUPABASE LOGIN TOKEN
    // ================================================

    const {
      data: linkData,
      error: generateError,
    } =
      await supabase.auth.admin
        .generateLink({
          type:
            "magiclink",

          email,
        });

    if (
      generateError
    ) {
      console.error(
        generateError
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

    const tokenHash =
      linkData
        ?.properties
        ?.hashed_token;

    if (!tokenHash) {
      return NextResponse.json(
        {
          error:
            "Login token was not generated.",
        },
        {
          status: 500,
        }
      );
    }

    return NextResponse.json({
      tokenHash,

      staff: {
        staffCode:
          staff.staff_code,

        staffName:
          staff.staff_name,

        accountType:
          staff.account_type,
      },
    });
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