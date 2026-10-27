import { createHash, randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "no-store, max-age=0" };
const TASK_STAGES = ["confirmation","picking","billing","delivery","payment_verification"] as const;

function dbClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret) throw new Error("Server environment missing");
  return createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
}
async function manager(request:NextRequest) {
  const raw=request.headers.get("authorization") ?? "";
  if(!raw.startsWith("Bearer ")) return null;
  const db=dbClient();
  const {data,error}=await db.auth.getUser(raw.slice(7));
  if(error||!data.user) return null;
  const {data:staff}=await db.from("staff").select("id")
    .eq("auth_user_id",data.user.id).eq("is_active",true).eq("account_type","manager")
    .maybeSingle();
  return staff ? db : null;
}
const forbidden=()=>NextResponse.json({error:"Manager access required"},{status:403,headers:noStore});
const hash=(s:string)=>createHash("sha256").update(s,"utf8").digest("hex");
const uuid=/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

export async function GET(request:NextRequest) {
  try {
    const db=await manager(request);if(!db)return forbidden();
    const {data:stations,error}=await db.from("alarm_stations").select(
      "id,label,created_at,last_seen_at,last_success_at,monitor_active,pending_count,revoked_at,dedicated_staff_id,app_version"
    ).not("dedicated_staff_id","is",null).order("created_at",{ascending:false}).limit(150);
    if(error)throw error;
    const staffIds=(stations??[]).flatMap(s=>s.dedicated_staff_id?[s.dedicated_staff_id]:[]);
    const {data:staff,error:staffErr}=staffIds.length
      ?await db.from("staff").select("id,staff_name,staff_code,is_active").in("id",staffIds)
      :{data:[],error:null};
    if(staffErr)throw staffErr;
    const map=new Map((staff??[]).map(s=>[s.id,s]));
    const {data:pending,error:pendingErr}=await db
      .from("alarm_station_pairing_codes")
      .select("id,label,expires_at,created_at,dedicated_staff_id")
      .not("dedicated_staff_id","is",null)
      .is("consumed_at",null)
      .order("created_at",{ascending:false}).limit(200);
    if(pendingErr)throw pendingErr;
    // Display one entry per not-yet-enrolled staff account, including
    // expired codes so a manager can regenerate instead of duplicating.
    const alreadyEnrolled=new Set(staffIds);
    const pendingStaffIds=[...new Set((pending??[])
      .map(x=>x.dedicated_staff_id).filter((id):id is string=>!!id&&!alreadyEnrolled.has(id)))];
    const {data:pendingStaff,error:pStaffErr}=pendingStaffIds.length
      ?await db.from("staff").select("id,staff_name,staff_code,is_active").in("id",pendingStaffIds)
      :{data:[],error:null};
    if(pStaffErr)throw pStaffErr;
    const pendingStaffMap=new Map((pendingStaff??[]).map(x=>[x.id,x]));
    const pendingLatest=new Map<string,{id:string;label:string;expires_at:string;staffId:string;staffCode:string}>();
    for(const p of pending??[]){
      const st=pendingStaffMap.get(p.dedicated_staff_id);
      if(!st||!st.is_active||pendingLatest.has(p.dedicated_staff_id))continue;
      pendingLatest.set(p.dedicated_staff_id,{
        id:p.id,label:p.label,expires_at:p.expires_at,
        staffId:st.id,staffCode:st.staff_code,
      });
    }
    return NextResponse.json({
      terminals:(stations??[]).map(s=>({...s,staff:map.get(s.dedicated_staff_id)??null})),
      pending:[...pendingLatest.values()],
    },{headers:noStore});
  } catch(e) {
    console.error("[terminals:get]",e instanceof Error?e.message:"unknown");
    return NextResponse.json({error:"Unable to list terminals"},{status:503,headers:noStore});
  }
}

/** One manager action creates a staff identity and one-time enrollment code. */
export async function POST(request:NextRequest) {
  let newUserId:string|null=null;
  let newStaffId:string|null=null;
  try {
    const db=await manager(request);if(!db)return forbidden();
    const body=await request.json().catch(()=>({}));
    const reissueId=typeof body.reissueStaffId==="string"?body.reissueStaffId:"";
    if(reissueId){
      if(!uuid.test(reissueId))return NextResponse.json({error:"Invalid staff ID"},{status:400,headers:noStore});
      const {data:staff,error:staffErr}=await db.from("staff")
        .select("id,staff_name,account_type,is_active")
        .eq("id",reissueId).maybeSingle();
      if(staffErr)throw staffErr;
      if(!staff||!staff.is_active||staff.account_type!=="staff"||
        !/^Android-[0-9]{3,5}$/i.test(staff.staff_name))
        return NextResponse.json({error:"Not an active dedicated terminal account"},{status:403,headers:noStore});
      const {data:used,error:usedErr}=await db.from("alarm_stations")
        .select("id").eq("dedicated_staff_id",staff.id)
        .is("revoked_at",null).limit(1);
      if(usedErr)throw usedErr;
      if(used?.length)return NextResponse.json({error:"Terminal already enrolled"},{status:409,headers:noStore});
      const newCode=randomBytes(16).toString("hex").toUpperCase();
      const expiresAt=new Date(Date.now()+15*60*1000).toISOString();
      const {error:pairErr}=await db.from("alarm_station_pairing_codes").insert({
        code_hash:hash(newCode),label:staff.staff_name,
        expires_at:expiresAt,dedicated_staff_id:staff.id,
      });
      if(pairErr)throw pairErr;
      return NextResponse.json({success:true,label:staff.staff_name,
        pairingCode:newCode,expiresAt},{headers:noStore});
    }
    const label=typeof body.name==="string"?body.name.trim():"";
    const requested:unknown=body.taskPermissions;
    if(!/^Android-[0-9]{3,5}$/i.test(label))
      return NextResponse.json({error:"Use Android-001, Android-002, etc."},{status:400,headers:noStore});
    if(!Array.isArray(requested)||requested.length>5||
      !requested.every(x=>typeof x==="string"&&(TASK_STAGES as readonly string[]).includes(x))) {
      return NextResponse.json({error:"Invalid task permissions"},{status:400,headers:noStore});
    }
    const stages=[...new Set(requested as string[])];
    const {data:existing,error:existErr}=await db.from("staff").select("id")
      .eq("staff_name",label).limit(1);
    if(existErr)throw existErr;
    if(existing?.length)
      return NextResponse.json({error:"This terminal name is already in use"},{status:409,headers:noStore});

    // Keep staff_code compatible with the existing S### staff numbering.
    const {data:codes,error:codesErr}=await db.from("staff").select("staff_code");
    if(codesErr)throw codesErr;
    const highest=Math.max(0,...(codes??[]).map(s=>{
      const m=String(s.staff_code).match(/^S(\d+)$/i);
      return m?Number(m[1]):0;
    }));
    const staffCode="S"+String(highest+1).padStart(3,"0");
    const email=`terminal-${randomBytes(12).toString("hex")}@staff.b2boms.invalid`;
    const password=randomBytes(48).toString("base64url")+"Aa1!";
    const {data:user,error:userErr}=await db.auth.admin.createUser({
      email,password,email_confirm:true,
      user_metadata:{staff_code:staffCode,staff_name:label,auth_mode:"dedicated_terminal"},
    });
    if(userErr||!user.user)throw userErr??new Error("Failed to create Auth identity");
    newUserId=user.user.id;

    const {data:staff,error:staffErr}=await db.from("staff").insert({
      staff_code:staffCode,staff_name:label,account_type:"staff",
      auth_user_id:newUserId,is_active:true,
    }).select("id").single();
    if(staffErr||!staff)throw staffErr??new Error("Failed to create staff profile");
    newStaffId=staff.id;

    if(stages.length) {
      const {error:permErr}=await db.from("staff_task_permissions").insert(
        stages.map(stage=>({staff_id:staff.id,stage}))
      );
      if(permErr)throw permErr;
    }

    const code=randomBytes(16).toString("hex").toUpperCase();
    const expiresAt=new Date(Date.now()+15*60*1000).toISOString();
    const {error:codeErr}=await db.from("alarm_station_pairing_codes").insert({
      code_hash:hash(code),label,expires_at:expiresAt,dedicated_staff_id:staff.id,
    });
    if(codeErr)throw codeErr;
    return NextResponse.json({
      success:true,label,staffCode,staffId:staff.id,
      pairingCode:code,expiresAt,taskPermissions:stages,
    },{status:201,headers:noStore});
  } catch(e) {
    // On partial creation, remove the orphaned identity rather than give
    // the device a staff account that cannot be paired.
    const db=dbClient();
    if(newStaffId) {
      await db.from("staff_task_permissions").delete().eq("staff_id",newStaffId);
      await db.from("staff").delete().eq("id",newStaffId);
    }
    if(newUserId)await db.auth.admin.deleteUser(newUserId);
    console.error("[terminals:create]",e instanceof Error?e.message:"unknown");
    return NextResponse.json({error:"Unable to create terminal. Please retry."},{status:503,headers:noStore});
  }
}

/** Revokes device acknowledgement AND the corresponding OMS identity. */
export async function DELETE(request:NextRequest) {
  try {
    const db=await manager(request);if(!db)return forbidden();
    const body=await request.json().catch(()=>({}));
    const stationId=typeof body.stationId==="string"?body.stationId:"";
    if(!uuid.test(stationId))
      return NextResponse.json({error:"Invalid station"},{status:400,headers:noStore});
    const {data:station,error:stationErr}=await db.from("alarm_stations")
      .select("id,dedicated_staff_id").eq("id",stationId).maybeSingle();
    if(stationErr)throw stationErr;
    if(!station?.dedicated_staff_id)
      return NextResponse.json({error:"Not a dedicated terminal"},{status:404,headers:noStore});
    const {error:revokeErr}=await db.from("alarm_stations")
      .update({revoked_at:new Date().toISOString()}).eq("id",station.id);
    if(revokeErr)throw revokeErr;
    const {error:disableErr}=await db.from("staff").update({is_active:false})
      .eq("id",station.dedicated_staff_id);
    if(disableErr)throw disableErr;
    return NextResponse.json({success:true},{headers:noStore});
  } catch(e) {
    console.error("[terminals:revoke]",e instanceof Error?e.message:"unknown");
    return NextResponse.json({error:"Unable to revoke terminal"},{status:503,headers:noStore});
  }
}
