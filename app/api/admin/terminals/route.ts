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
    const [{data:stations,error:stationErr},{data:codes,error:codeErr}]=await Promise.all([
      db.from("alarm_stations").select(
        "id,label,created_at,last_seen_at,last_success_at,monitor_active,pending_count,revoked_at,dedicated_staff_id,app_version"
      ).not("dedicated_staff_id","is",null).order("created_at",{ascending:false}).limit(300),
      db.from("alarm_station_pairing_codes")
        .select("id,label,expires_at,created_at,dedicated_staff_id")
        .not("dedicated_staff_id","is",null).is("consumed_at",null)
        .order("created_at",{ascending:false}).limit(300),
    ]);
    if(stationErr)throw stationErr;
    if(codeErr)throw codeErr;
    const stationRows=stations??[];
    const pairingRows=codes??[];
    const staffIds=[...new Set([
      ...stationRows.map(x=>x.dedicated_staff_id),
      ...pairingRows.map(x=>x.dedicated_staff_id),
    ].filter((id):id is string=>!!id))];
    const {data:staff,error:staffErr}=staffIds.length
      ?await db.from("staff").select("id,staff_name,staff_code,is_active,account_type").in("id",staffIds)
      :{data:[],error:null};
    if(staffErr)throw staffErr;
    const staffMap=new Map((staff??[]).filter(x=>x.account_type==="staff").map(x=>[x.id,x]));
    const latestStation=new Map<string,(typeof stationRows)[number]>();
    const activeStation=new Map<string,(typeof stationRows)[number]>();
    for(const row of stationRows) {
      const id=row.dedicated_staff_id;
      if(!id||!staffMap.has(id))continue;
      if(!latestStation.has(id))latestStation.set(id,row);
      if(!row.revoked_at&&!activeStation.has(id))activeStation.set(id,row);
    }
    const pendingMap=new Map<string,{id:string;label:string;expires_at:string;staffId:string;staffCode:string}>();
    for(const code of pairingRows) {
      const id=code.dedicated_staff_id;
      if(!id||activeStation.has(id)||pendingMap.has(id))continue;
      const identity=staffMap.get(id);
      if(!identity?.is_active)continue;
      pendingMap.set(id,{
        id:code.id,label:identity.staff_name,expires_at:code.expires_at,
        staffId:id,staffCode:identity.staff_code,
      });
    }
    const terminals=[...latestStation.entries()].flatMap(([id,latest])=>{
      const identity=staffMap.get(id);
      const station=activeStation.get(id)??latest;
      // An activated account awaiting a fresh code is represented once in pending.
      if(!identity||(identity.is_active&&!activeStation.has(id)&&pendingMap.has(id)))return [];
      return [{...station,staff:identity}];
    });
    const inactive=(staff??[])
      .filter(identity=>!identity.is_active&&!latestStation.has(identity.id)
        &&identity.account_type==="staff")
      .map(identity=>({id:identity.id,label:identity.staff_name,
        staffCode:identity.staff_code}));
    return NextResponse.json({
      terminals,pending:[...pendingMap.values()],inactive,
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
    const activateId=typeof body.activateStaffId==="string"?body.activateStaffId:"";
    if(reissueId||activateId){
      if(reissueId&&activateId)
        return NextResponse.json({error:"Choose one account action"},{status:400,headers:noStore});
      const staffId=activateId||reissueId;
      if(!uuid.test(staffId))
        return NextResponse.json({error:"Invalid staff ID"},{status:400,headers:noStore});
      const {data:identity,error:staffErr}=await db.from("staff")
        .select("id,staff_name,staff_code,account_type,is_active")
        .eq("id",staffId).maybeSingle();
      if(staffErr)throw staffErr;
      if(!identity||identity.account_type!=="staff"||
        !/^Android-[0-9]{3,5}$/i.test(identity.staff_name))
        return NextResponse.json({error:"Not a dedicated terminal account"},{status:403,headers:noStore});
      const {data:proof,error:proofErr}=await db.from("alarm_station_pairing_codes")
        .select("id").eq("dedicated_staff_id",staffId).limit(1);
      if(proofErr)throw proofErr;
      if(!proof?.length)
        return NextResponse.json({error:"Account has no terminal enrollment history"},
          {status:403,headers:noStore});
      if(activateId?identity.is_active:!identity.is_active)
        return NextResponse.json({error:activateId?"Account already active":"Account is inactive"},
          {status:409,headers:noStore});
      const {data:station,error:stationErr}=await db.from("alarm_stations")
        .select("id").eq("dedicated_staff_id",staffId)
        .is("revoked_at",null).limit(1);
      if(stationErr)throw stationErr;
      if(station?.length)
        return NextResponse.json({error:"Unpair or deactivate the current station first"},
          {status:409,headers:noStore});
      // Retire every outstanding code before issuing a fresh, single-use one.
      const now=new Date().toISOString();
      const {error:expireErr}=await db.from("alarm_station_pairing_codes")
        .update({expires_at:now}).eq("dedicated_staff_id",staffId)
        .is("consumed_at",null).gt("expires_at",now);
      if(expireErr)throw expireErr;
      const newCode=randomBytes(16).toString("hex").toUpperCase();
      const expiresAt=new Date(Date.now()+15*60*1000).toISOString();
      const {error:pairErr}=await db.from("alarm_station_pairing_codes").insert({
        code_hash:hash(newCode),label:identity.staff_name,
        expires_at:expiresAt,dedicated_staff_id:staffId,
      });
      if(pairErr)throw pairErr;
      if(activateId) {
        const {error:activateErr}=await db.from("staff")
          .update({is_active:true}).eq("id",staffId).eq("is_active",false);
        if(activateErr)throw activateErr;
      }
      return NextResponse.json({success:true,label:identity.staff_name,
        staffCode:identity.staff_code,pairingCode:newCode,expiresAt},{headers:noStore});
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

/** Deactivates a terminal identity and revokes its station, without deleting history. */
export async function DELETE(request:NextRequest) {
  try {
    const db=await manager(request);if(!db)return forbidden();
    const body=await request.json().catch(()=>({}));
    const stationId=typeof body.stationId==="string"?body.stationId:"";
    let staffId=typeof body.staffId==="string"?body.staffId:"";
    if(stationId){
      if(!uuid.test(stationId))
        return NextResponse.json({error:"Invalid station"},{status:400,headers:noStore});
      const {data:station,error:stationErr}=await db.from("alarm_stations")
        .select("id,dedicated_staff_id").eq("id",stationId).maybeSingle();
      if(stationErr)throw stationErr;
      if(!station?.dedicated_staff_id)
        return NextResponse.json({error:"Not a dedicated terminal"},{status:404,headers:noStore});
      staffId=station.dedicated_staff_id;
    }
    if(!uuid.test(staffId))
      return NextResponse.json({error:"Invalid terminal account"},{status:400,headers:noStore});
    const {data:identity,error:identityErr}=await db.from("staff")
      .select("id,staff_name,account_type").eq("id",staffId).maybeSingle();
    if(identityErr)throw identityErr;
    if(!identity||identity.account_type!=="staff"||
      !/^Android-[0-9]{3,5}$/i.test(identity.staff_name))
      return NextResponse.json({error:"Not a dedicated terminal account"},
        {status:403,headers:noStore});
    if(!stationId){
      const {data:proof,error:proofErr}=await db.from("alarm_station_pairing_codes")
        .select("id").eq("dedicated_staff_id",staffId).limit(1);
      if(proofErr)throw proofErr;
      if(!proof?.length)
        return NextResponse.json({error:"Account has no terminal enrollment history"},
          {status:403,headers:noStore});
    }
    const now=new Date().toISOString();
    const {error:revokeErr}=await db.from("alarm_stations")
      .update({revoked_at:now}).eq("dedicated_staff_id",staffId)
      .is("revoked_at",null);
    if(revokeErr)throw revokeErr;
    const {error:disableErr}=await db.from("staff").update({is_active:false})
      .eq("id",staffId);
    if(disableErr)throw disableErr;
    const {error:expireErr}=await db.from("alarm_station_pairing_codes")
      .update({expires_at:now}).eq("dedicated_staff_id",staffId)
      .is("consumed_at",null).gt("expires_at",now);
    if(expireErr)throw expireErr;
    return NextResponse.json({success:true},{headers:noStore});
  } catch(e) {
    console.error("[terminals:deactivate]",e instanceof Error?e.message:"unknown");
    return NextResponse.json({error:"Unable to deactivate terminal"},{status:503,headers:noStore});
  }
}
