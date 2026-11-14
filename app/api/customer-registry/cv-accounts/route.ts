import { NextRequest } from "next/server";
import { requireSalesRole,salesApiError } from "@/lib/server/salesAuth";

export const runtime = "nodejs";
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const number=/^[0-9]{10}$/;
const asText=(v:unknown)=>typeof v==="string"?v.trim():"";
function paths(input:unknown,max:number,staffId:string) {
  if(!Array.isArray(input)||input.length>max)throw new Error("Invalid document count");
  return input.map(p=>{
    if(typeof p!=="string" || !p.startsWith("pending/"+staffId+"/") ||
      !/^pending\/[0-9a-f-]+\/[0-9a-f-]+\.webp$/.test(p))throw new Error("Invalid document upload path");
    return p;
  }) as string[];
}
export async function GET(request:NextRequest){
  try{
    const {admin,staff}=await requireSalesRole(request,["manager","salesman"]);
    const [accounts,requests]=await Promise.all([
      admin.from("cv_accounts").select("id,cv_number,status,legacy_import,shop_photos,id_card_path,registration_photos,cv_card_storage_path,created_at,updated_at").order("cv_number").limit(1500),
      admin.from("cv_account_requests").select("id,action,cv_account_id,cv_number,status,shop_photos,id_card_path,registration_photos,cv_card_storage_path,created_by,reviewed_by,created_at,reviewed_at,review_note")
        .order("created_at",{ascending:false}).limit(1500),
    ]);
    if(accounts.error || requests.error)throw accounts.error ?? requests.error;
    const visibleRequests=(requests.data ?? []).filter(r=>staff.account_type==="manager" || r.created_by===staff.id);
    // Signed previews are short-lived and never exposed in a public bucket.
    // National ID photos are sensitive. Salesmen only receive signed
    // previews of their own requests; approved records are Manager-only.
    const entries=[...(staff.account_type==="manager"?(accounts.data??[]):[]),...visibleRequests];
    const allPaths=[...new Set(entries.flatMap(x=>[
      ...(x.shop_photos??[]),...(x.id_card_path?[x.id_card_path]:[]),...(x.registration_photos??[]),
      ...(x.cv_card_storage_path?[x.cv_card_storage_path]:[])
    ]))];
    const signed=await Promise.all(allPaths.map(async path=>{
      const bucket=path.startsWith("customer-cv/")?"order-files":"cv-documents";
      const {data,error}=await admin.storage.from(bucket).createSignedUrl(path,300);
      return [path,error?null:data?.signedUrl??null] as const;
    }));
    return Response.json({accounts:accounts.data??[],requests:visibleRequests,
      photos:Object.fromEntries(signed),isManager:staff.account_type==="manager"},
      {headers:{"Cache-Control":"no-store"}});
  }catch(error){return salesApiError(error);}
}
export async function POST(request:NextRequest){
  try{
    const {admin,staff}=await requireSalesRole(request,["manager","salesman"]);
    const body=await request.json() as Record<string,unknown>;
    const action=asText(body.action);
    if(!["create","amend"].includes(action))return Response.json({error:"Invalid request type"},{status:400});
    const shopPhotos=paths(body.shopPhotos??[],3,staff.id);
    const registrationPhotos=paths(body.registrationPhotos??[],2,staff.id);
    const idCardPath=body.idCardPath ? paths([body.idCardPath],1,staff.id)[0] : null;
    const cvCardPath=body.cvCardStoragePath ? paths([body.cvCardStoragePath],1,staff.id)[0] : null;
    if(action==="create" && (!shopPhotos.length||registrationPhotos.length!==2||!idCardPath))
      return Response.json({error:"กรุณาแนบรูปร้าน บัตรประชาชน และใบสมัคร CV ครบ 2 รูปก่อนส่งอนุมัติ"},{status:400});
    if(action==="amend" && (!shopPhotos.length&&!registrationPhotos.length&&!idCardPath&&!cvCardPath))
      return Response.json({error:"เลือกภาพที่ต้องการแก้ไขอย่างน้อยหนึ่งช่อง"},{status:400});
    const docs=[...shopPhotos,...registrationPhotos,...(idCardPath?[idCardPath]:[]),
      ...(cvCardPath?[cvCardPath]:[])];
    for(const path of docs){
      const {data,error}=await admin.storage.from("cv-documents").info(path);
      if(error||!data) return Response.json({error:"Uploaded document missing: "+path},{status:400});
    }
    let cvNumber=asText(body.cvNumber),cvAccountId:null|string=null;
    if(action==="create"){
      if(!number.test(cvNumber))return Response.json({error:"เลข CV ต้องมี 10 หลัก"},{status:400});
      const {data}=await admin.from("cv_accounts").select("id").eq("cv_number",cvNumber).maybeSingle();
      if(data)return Response.json({error:"เลข CV นี้มีบัญชีอยู่แล้ว"},{status:409});
    }else{
      cvAccountId=asText(body.cvAccountId);
      if(!uuid.test(cvAccountId))return Response.json({error:"Invalid CV account"},{status:400});
      const {data,error}=await admin.from("cv_accounts").select("id,cv_number,status")
        .eq("id",cvAccountId).maybeSingle();
      if(error||!data||data.status!=="approved")return Response.json({error:"Only approved CV accounts can be amended"},{status:400});
      cvNumber=data.cv_number;
    }
    const {data,error}=await admin.from("cv_account_requests").insert({
      action,cv_account_id:cvAccountId,cv_number:cvNumber,
      shop_photos:shopPhotos,registration_photos:registrationPhotos,
      id_card_path:idCardPath,cv_card_storage_path:cvCardPath,created_by:staff.id,status:"pending",
    }).select("id").single();
    if(error)throw error;
    return Response.json({requestId:data.id,status:"pending"},{status:201,headers:{"Cache-Control":"no-store"}});
  }catch(error){return salesApiError(error);}
}
export async function PATCH(request:NextRequest){
  try{
    const {admin,staff}=await requireSalesRole(request,["manager"]);
    const body=await request.json() as Record<string,unknown>;
    const operation=asText(body.operation);
    if(operation==="approve"||operation==="reject"){
      const id=asText(body.requestId);
      if(!uuid.test(id))return Response.json({error:"Invalid request"},{status:400});
      const {data,error}=await admin.rpc("cv_review_account_request",{
        p_request_id:id,p_manager_id:staff.id,p_approve:operation==="approve",p_note:asText(body.note)||null,
      });
      if(error)throw error;
      return Response.json({ok:true,cvAccountId:data},{headers:{"Cache-Control":"no-store"}});
    }
    if(operation==="deactivate"||operation==="reactivate"){
      const id=asText(body.cvAccountId);
      if(!uuid.test(id))return Response.json({error:"Invalid CV account"},{status:400});
      const {error}=await admin.rpc("cv_set_account_active",{
        p_cv_id:id,p_manager_id:staff.id,p_active:operation==="reactivate",
      });
      if(error)throw error;
      return Response.json({ok:true},{headers:{"Cache-Control":"no-store"}});
    }
    return Response.json({error:"Unsupported CV operation"},{status:400});
  }catch(error){return salesApiError(error);}
}
