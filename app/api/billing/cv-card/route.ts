import {NextRequest} from "next/server";
import {createClient} from "@supabase/supabase-js";

export const runtime="nodejs";
const uuid=/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;

// A billing worker only needs the CV Card image, never an ID card,
// shop photograph or registration document. This endpoint signs one path.
export async function GET(request:NextRequest){
  const failure=(message:string,status:number)=>Response.json({error:message},{status,headers:{"Cache-Control":"no-store"}});
  const bearer=request.headers.get("authorization")??"";
  const token=bearer.startsWith("Bearer ")?bearer.slice(7):"";
  const customerId=request.nextUrl.searchParams.get("customerId")??"";
  if(!token)return failure("กรุณาเข้าสู่ระบบ",401);
  if(!uuid.test(customerId))return failure("Invalid customer",400);
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key=process.env.SUPABASE_SECRET_KEY??process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key)return failure("Server unavailable",503);
  const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user},error:authError}=await admin.auth.getUser(token);
  if(authError||!user)return failure("Session expired",401);
  const {data:staff,error:staffError}=await admin.from("staff")
    .select("id,account_type,is_active").eq("auth_user_id",user.id).maybeSingle();
  if(staffError||!staff?.is_active)return failure("Staff authorization required",403);
  if(staff.account_type!=="manager"){
    const {data:permission,error:permissionError}=await admin.from("staff_task_permissions")
      .select("staff_id").eq("staff_id",staff.id).eq("stage","billing").maybeSingle();
    if(permissionError||!permission)return failure("Billing permission required",403);
  }
  const {data:customer,error:customerError}=await admin.from("customers")
    .select("cv_card_storage_path").eq("id",customerId).maybeSingle();
  if(customerError||!customer)return failure("Customer not found",404);
  const path=customer.cv_card_storage_path as string|null;
  if(!path)return failure("No approved CV Card",404);
  const bucket=path.startsWith("customer-cv/")?"order-files":
    /^pending\/[0-9a-f-]+\/[0-9a-f-]+\.webp$/.test(path)?"cv-documents":null;
  if(!bucket)return failure("Unrecognized CV Card storage path",400);
  const {data,error}=await admin.storage.from(bucket).createSignedUrl(path,300);
  if(error||!data?.signedUrl)return failure("Cannot read CV Card",404);
  return Response.json({url:data.signedUrl},{headers:{"Cache-Control":"no-store"}});
}
