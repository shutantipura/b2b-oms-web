import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers={"Cache-Control":"no-store, max-age=0"};

export async function POST(request:NextRequest) {
  try {
    const raw=request.headers.get("authorization")??"";
    const token=raw.startsWith("Bearer ")?raw.slice(7):"";
    if(!/^[a-f0-9]{64}$/.test(token))
      return NextResponse.json({error:"Device not enrolled"},{status:401,headers});
    const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
    const secret=process.env.SUPABASE_SECRET_KEY??process.env.SUPABASE_SERVICE_ROLE_KEY;
    if(!url||!secret)throw new Error("Server not configured");
    const db=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
    const hash=createHash("sha256").update(token,"utf8").digest("hex");
    const {data:station,error:stationErr}=await db.from("alarm_stations")
      .select("id,dedicated_staff_id").eq("secret_hash",hash)
      .is("revoked_at",null).maybeSingle();
    if(stationErr)throw stationErr;
    if(!station?.dedicated_staff_id)
      return NextResponse.json({error:"This alarm station is not assigned an OMS terminal account"},
        {status:403,headers});
    const {data:staff,error:staffErr}=await db.from("staff")
      .select("id,staff_code,staff_name,account_type,auth_user_id,is_active")
      .eq("id",station.dedicated_staff_id).maybeSingle();
    if(staffErr||!staff||!staff.is_active||staff.account_type!=="staff"||!staff.auth_user_id)
      return NextResponse.json({error:"This terminal has been disabled"},
        {status:403,headers});
    const {data:authUser,error:authErr}=await db.auth.admin.getUserById(staff.auth_user_id);
    if(authErr||!authUser.user?.email)
      throw authErr??new Error("Staff Auth user not available");
    const {data:link,error:linkErr}=await db.auth.admin.generateLink({
      type:"magiclink",email:authUser.user.email,
    });
    if(linkErr||!link?.properties?.hashed_token||link.user?.id!==staff.auth_user_id)
      throw linkErr??new Error("Could not create verified staff link");
    // A one-time Supabase OTP, not a reusable API token, is returned only
    // to a manager-enrolled physical terminal with its private bearer token.
    return NextResponse.json({
      tokenHash:link.properties.hashed_token,
      staffCode:staff.staff_code,
      staffName:staff.staff_name,
    },{headers});
  } catch(e) {
    console.error("[terminal:session]",e instanceof Error?e.message:"Unknown");
    return NextResponse.json({error:"Unable to start terminal OMS session"},
      {status:503,headers});
  }
}
