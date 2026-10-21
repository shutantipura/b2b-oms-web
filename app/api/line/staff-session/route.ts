import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type LineVerifyResponse = { sub?: string };

export async function POST(request: NextRequest) {
  const started = performance.now();
  let checkpoint = started;
  const timings: Record<string, number> = {};
  const mark = (name: string) => {
    const now = performance.now();
    timings[name] = Math.round(now - checkpoint);
    checkpoint = now;
  };
  const respond = (payload: Record<string, unknown>, status = 200) => {
    const total = Math.round(performance.now() - started);
    console.info("[staff-session] timings (ms)", { ...timings, total, status });
    return NextResponse.json(payload, {
      status,
      headers: {
        "Cache-Control": "no-store",
        "Server-Timing": [
          ...Object.entries(timings).map(([name, ms]) => `${name};dur=${ms}`),
          `total;dur=${total}`,
        ].join(", "),
      },
    });
  };

  try {
    const { idToken } = await request.json();
    if (typeof idToken !== "string" || !idToken) {
      return respond({ error: "LINE ID token is required." }, 400);
    }

    const channelId = process.env.LINE_CHANNEL_ID;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const secret = process.env.SUPABASE_SECRET_KEY;
    if (!channelId || !supabaseUrl || !secret) {
      return respond({ error: "Server configuration missing." }, 500);
    }

    // Always verify LINE's signed ID token on the server.
    const verifyBody = new URLSearchParams({
      id_token: idToken,
      client_id: channelId,
    });
    const lineResponse = await fetch("https://api.line.me/oauth2/v2.1/verify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: verifyBody.toString(),
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    const lineData = (await lineResponse.json()) as LineVerifyResponse;
    mark("line_verify");
    if (!lineResponse.ok || !lineData.sub) {
      return respond({ error: "LINE identity could not be verified." }, 401);
    }

    // Service-role client: this route must remain server-only.
    const supabase = createClient(supabaseUrl, secret, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    const { data: staffLink, error: staffLinkError } = await supabase
      .from("staff_line_users")
      .select("staff_id, is_authorized")
      .eq("line_user_id", lineData.sub)
      .eq("is_authorized", true)
      .maybeSingle();
    mark("staff_link");
    if (staffLinkError) {
      console.error("[staff-session] staff authorization lookup failed", staffLinkError);
      return respond({ error: "Could not check staff authorization." }, 500);
    }
    if (!staffLink) {
      return respond({ error: "This LINE account is not authorized for staff access." }, 403);
    }

    const { data: staff, error: staffError } = await supabase
      .from("staff")
      .select("id, staff_code, staff_name, email, account_type, is_active, auth_user_id")
      .eq("id", staffLink.staff_id)
      .maybeSingle();
    mark("staff_profile");
    if (staffError || !staff) {
      return respond({ error: "Staff account could not be found." }, 404);
    }
    if (!staff.is_active) {
      return respond({ error: "Staff account is inactive." }, 403);
    }

    const authEmail = (staff.email ?? "").trim() || `staff-${staff.id}@line-login.invalid`;
    let authUserId: string | null = staff.auth_user_id ?? null;
    let tokenHash: string | null = null;

    if (authUserId) {
      const { data: existingUserData, error: existingUserError } =
        await supabase.auth.admin.getUserById(authUserId);
      mark("auth_user_lookup");
      if (!existingUserError && existingUserData?.user) {
        const email = existingUserData.user.email ?? authEmail;
        const { data: linkData, error: linkError } =
          await supabase.auth.admin.generateLink({ type: "magiclink", email });
        mark("generate_link");
        if (linkError) {
          console.error("[staff-session] generateLink failed", linkError);
          return respond({ error: "Could not create staff login session." }, 500);
        }
        // Ensure generated token is for the authorized staff's Auth user.
        if (linkData?.user?.id && linkData.user.id !== authUserId) {
          return respond({ error: "Staff authentication identity mismatch. Contact an administrator." }, 409);
        }
        tokenHash = linkData?.properties?.hashed_token ?? null;
      } else {
        authUserId = null;
      }
    }

    if (!authUserId) {
      const { data: newLinkData, error: newLinkError } =
        await supabase.auth.admin.generateLink({
          type: "magiclink",
          email: authEmail,
          options: {
            data: {
              staff_code: staff.staff_code,
              staff_name: staff.staff_name,
              account_type: staff.account_type,
              source: "line_staff",
            },
          },
        });
      mark("provision_auth");
      if (newLinkError || !newLinkData?.user) {
        console.error("[staff-session] provisioning failed", newLinkError);
        return respond({ error: "Could not create staff authentication account." }, 500);
      }
      authUserId = newLinkData.user.id;
      tokenHash = newLinkData.properties?.hashed_token ?? null;
      const { error: updateError } = await supabase
        .from("staff")
        .update({ auth_user_id: authUserId, updated_at: new Date().toISOString() })
        .eq("id", staff.id);
      mark("save_auth_link");
      if (updateError) {
        console.error("[staff-session] saving staff auth link failed", updateError);
        return respond({ error: "Authentication account was created, but staff profile linking failed." }, 500);
      }
    }

    if (!tokenHash) {
      return respond({ error: "Staff login token was not generated." }, 500);
    }
    return respond({
      tokenHash,
      staff: {
        staffCode: staff.staff_code,
        staffName: staff.staff_name,
        accountType: staff.account_type,
      },
    });
  } catch (error) {
    console.error("[staff-session] unexpected error", error);
    const isTimeout = error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError");
    return respond({
      error: isTimeout
        ? "LINE identity verification timed out. Please try again."
        : error instanceof Error ? error.message : "Unexpected error.",
    }, isTimeout ? 504 : 500);
  }
}
