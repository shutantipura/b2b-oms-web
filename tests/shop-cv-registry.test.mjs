import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read = path => readFileSync(new URL("../"+path,import.meta.url),"utf8");
const sql=read("sql/shop_cv_account_registry.sql");
const shop=read("app/api/customer-registry/shops/route.ts");
const cv=read("app/api/customer-registry/cv-accounts/route.ts");
const upload=read("app/api/customer-registry/cv-accounts/upload/route.ts");
const shopUI=read("app/customers/shops/page.tsx");
const cvUI=read("app/customers/cv-accounts/page.tsx");
const manager=read("app/customers/page.tsx");
const salesman=read("app/salesman/page.tsx");
const edit=read("app/salesman/customer/[customerId]/page.tsx");
const oldRoute=read("app/customers/new/page.tsx");
const oldSalesRoute=read("app/api/sales/customer-changes/route.ts");

test("customer sidebar and salesman offer the new distinct Shop and CV submenus",()=>{
  for(const page of [manager,salesman]){
    assert.match(page,/href="\/customers\/shops"/);
    assert.match(page,/href="\/customers\/cv-accounts"/);
  }
  assert.match(shopUI,/ร้านค้า/);
  assert.match(cvUI,/บัญชี CV/);
});
test("new shops never fabricate CV numbers and can assign active LINE customers",()=>{
  assert.match(shop,/customer_code:code,has_no_cv:true/);
  assert.match(shop,/cv_account_id:null/);
  assert.match(shop,/\.eq\("assigned_role","customer"\)/);
  assert.match(shop,/\.upsert\(\{line_user_id:lineUserId,customer_id:shop.id,can_order:true\}/);
  assert.match(shop,/\.eq\("status","approved"\)/);
  assert.match(shopUI,/ไม่มี CV โดยอัตโนมัติ/);
  assert.match(sql,/ALTER TABLE public\.customers\s+ADD COLUMN IF NOT EXISTS cv_account_id/);
});
test("legacy 10-digit CV numbers become approved blank records, preserving OMS shop codes",()=>{
  assert.match(sql,/WHERE c.has_no_cv = false AND c.customer_code ~ '\^\[0-9\]\{10\}\$'/);
  assert.match(sql,/legacy_import/);
  assert.match(sql,/INSERT INTO public.cv_accounts/);
  assert.match(sql,/UPDATE public.customers c SET cv_account_id/);
  assert.match(sql,/Shop ID is permanent/);
  assert.match(oldRoute,/redirect\("\/customers\/shops"\)/);
  assert.doesNotMatch(oldSalesRoute,/customer_code", "has_no_cv"/);
  assert.doesNotMatch(edit,/key: "customer_code"/);
});
test("CV application requires manager review with complete documentation and audit",()=>{
  assert.match(sql,/CREATE TABLE IF NOT EXISTS public.cv_account_requests/);
  assert.match(sql,/cardinality\(shop_photos\)>=1/);
  assert.match(sql,/cardinality\(registration_photos\)=2/);
  assert.match(cv,/registrationPhotos.length!==2/);
  assert.match(cv,/cv_review_account_request/);
  assert.match(sql,/p_manager_id AND account_type='manager' AND is_active/);
  assert.match(sql,/CREATE UNIQUE INDEX IF NOT EXISTS cv_only_one_pending_create/);
  assert.match(sql,/REVOKE ALL ON FUNCTION public.cv_review_account_request/);
  assert.match(cvUI,/รอ Manager อนุมัติ/);
  assert.match(cvUI,/แก้ไขรูปบัญชีเดิม/);
});
test("CV images use server compression and private short-lived access",()=>{
  assert.match(upload,/import sharp from "sharp"/);
  assert.match(upload,/\.resize\(\{width:1600,height:1600/);
  assert.match(upload,/\.webp\(\{quality:75/);
  assert.match(upload,/admin\.storage\.from\("cv-documents"\)/);
  assert.match(sql,/VALUES\('cv-documents','cv-documents',false/);
  assert.match(sql,/ALTER TABLE public.cv_accounts ENABLE ROW LEVEL SECURITY/);
  assert.match(sql,/ALTER TABLE public.cv_account_requests ENABLE ROW LEVEL SECURITY/);
  assert.match(cv,/staff.account_type==="manager"/);
  assert.match(cv,/createSignedUrl\(path,300\)/);
});
test("deactivation blocks new CV links, preserves audit and uses No CV billing mode",()=>{
  assert.match(sql,/cv_set_account_active/);
  assert.match(sql,/NEW.has_no_cv := \(v_status IS DISTINCT FROM 'approved'\)/);
  assert.match(sql,/UPDATE public.customers SET cv_account_id=cv_account_id WHERE cv_account_id=p_cv_id/);
  assert.match(sql,/A shop may only link an approved active CV account/);
  assert.match(shopUI,/CV ระงับ/);
  const detail=read("app/customers/[customerCode]/page.tsx");
  assert.match(detail,/CV Card สำหรับออกบิล/);
  assert.match(detail,/เปิดเมนูบัญชี CV/);
});
