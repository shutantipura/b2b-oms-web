import { NextRequest } from "next/server";
import { requireSalesRole, salesApiError } from "@/lib/server/salesAuth";

export const runtime = "nodejs";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const s = (value: unknown, max = 200) => typeof value === "string" ? value.trim().slice(0,max) : "";
const validMap = (value: string) => {
  try { return ["http:","https:"].includes(new URL(value).protocol); }
  catch { return false; }
};

export async function GET(request: NextRequest) {
  try {
    const { admin } = await requireSalesRole(request, ["manager","salesman"]);
    const [shops, accounts, owners] = await Promise.all([
      admin.from("customers").select("id,customer_code,customer_name,contact_name,phone,has_no_cv,is_active,cv_account_id,delivery_map_url,created_at")
        .order("customer_name", { ascending: true }).limit(2000),
      admin.from("cv_accounts").select("id,cv_number,status").order("cv_number"),
      admin.from("line_users").select("id,display_name,internal_name,is_active,assigned_role")
        .eq("assigned_role","customer").eq("is_active",true).limit(2000),
    ]);
    if (shops.error || accounts.error || owners.error) throw shops.error ?? accounts.error ?? owners.error;
    const cvById = new Map((accounts.data ?? []).map(c => [c.id,c]));
    return Response.json({
      shops: (shops.data ?? []).map(shop => ({
        ...shop, cvAccount: shop.cv_account_id ? cvById.get(shop.cv_account_id) ?? null : null,
      })),
      approvedCV: (accounts.data??[]).filter(c=>c.status==="approved"), customers: owners.data ?? [],
    },{ headers: {"Cache-Control":"no-store"}});
  } catch (error) { return salesApiError(error); }
}

export async function POST(request: NextRequest) {
  try {
    const { admin } = await requireSalesRole(request, ["manager","salesman"]);
    const body = await request.json() as Record<string,unknown>;
    const shopName=s(body.shopName,160),phone=s(body.phone,50),contact=s(body.contactName,120);
    const mapUrl=s(body.deliveryMapUrl,1200), extraMap=s(body.deliveryMapUrl2,1200);
    const lineUserId=s(body.lineUserId,60);
    if (!shopName || !phone || !validMap(mapUrl) || (extraMap && (!validMap(extraMap)||extraMap===mapUrl))) {
      return Response.json({error:"กรุณาระบุชื่อร้าน เบอร์โทร และลิงก์ Google Maps ที่ถูกต้อง"}, {status:400});
    }
    if (lineUserId) {
      if (!uuid.test(lineUserId)) return Response.json({error:"Invalid LINE customer"}, {status:400});
      const {data:owner,error:ownerError}=await admin.from("line_users")
        .select("id").eq("id",lineUserId).eq("is_active",true).eq("assigned_role","customer").maybeSingle();
      if (ownerError || !owner) return Response.json({error:"LINE customer is not active or approved"}, {status:400});
    }
    // Always generate an independent internal shop code; no CV number is
    // created or implied by creating a shop.
    const code = "SHOP-" + crypto.randomUUID().replaceAll("-","").slice(0,20).toUpperCase();
    const {data:shop,error}=await admin.from("customers").insert({
      customer_code:code,has_no_cv:true,customer_name:shopName,
      customer_type:s(body.customerType,50)||null,contact_name:contact||null,phone,
      delivery_map_url:mapUrl,delivery_address:mapUrl,
      delivery_map_url_2:extraMap||null,
      delivery_location_1_name:s(body.locationName1,60)||shopName,
      delivery_location_2_name:s(body.locationName2,60)||"จุดส่ง 2",
      cv_account_id:null,is_active:true,
    }).select("id,customer_code,customer_name").single();
    if (error || !shop) throw error ?? new Error("Cannot create shop");
    if (lineUserId) {
      const {error:linkError}=await admin.from("customer_line_users")
        .upsert({line_user_id:lineUserId,customer_id:shop.id,can_order:true},
          {onConflict:"line_user_id,customer_id"});
      if (linkError) {
        // Keep the new shop even if account linking fails, but tell the caller.
        return Response.json({shop,warning:"สร้างร้านแล้ว แต่ยังผูกกับบัญชี LINE ไม่สำเร็จ: "+linkError.message});
      }
    }
    return Response.json({shop},{status:201,headers:{"Cache-Control":"no-store"}});
  } catch (error) { return salesApiError(error); }
}

export async function PATCH(request: NextRequest) {
  try {
    const { admin } = await requireSalesRole(request, ["manager","salesman"]);
    const body = await request.json() as Record<string,unknown>;
    const customerId=s(body.shopId,60);
    if (!uuid.test(customerId)) return Response.json({error:"Invalid shop"}, {status:400});
    if (!Object.hasOwn(body,"cvAccountId") && !Object.hasOwn(body,"lineUserId"))
      return Response.json({error:"No changes supplied"}, {status:400});
    if (Object.hasOwn(body,"cvAccountId")) {
      const cvId=body.cvAccountId;
      if (cvId !== null && (typeof cvId!=="string" || !uuid.test(cvId)))
        return Response.json({error:"Invalid CV account"}, {status:400});
      if (cvId) {
        const {data:cv,error}=await admin.from("cv_accounts").select("id").eq("id",cvId)
          .eq("status","approved").maybeSingle();
        if (error || !cv) return Response.json({error:"Only approved active CV accounts can be linked"}, {status:400});
      }
      const {error}=await admin.from("customers").update({cv_account_id:cvId})
        .eq("id",customerId).select("id").single();
      if(error) throw error;
    }
    if (Object.hasOwn(body,"lineUserId") && body.lineUserId !== null) {
      const user=s(body.lineUserId,60);
      if(!uuid.test(user)) return Response.json({error:"Invalid LINE customer"}, {status:400});
      const {data:owner,error}=await admin.from("line_users").select("id").eq("id",user)
        .eq("is_active",true).eq("assigned_role","customer").maybeSingle();
      if(error || !owner)return Response.json({error:"LINE customer account not found"}, {status:400});
      const {error:linkError}=await admin.from("customer_line_users")
        .upsert({line_user_id:user,customer_id:customerId,can_order:true},
          {onConflict:"line_user_id,customer_id"});
      if(linkError)throw linkError;
    }
    return Response.json({ok:true},{headers:{"Cache-Control":"no-store"}});
  } catch(error){return salesApiError(error);}
}
