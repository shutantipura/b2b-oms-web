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

test("Customers menu opens Shops list; Shop and CV tabs remain for Manager and Salesman",()=>{
  assert.match(manager,/redirect\("\/customers\/shops"\)/);
  assert.match(salesman,/href="\/customers\/shops"/);
  assert.match(salesman,/href="\/customers\/cv-accounts"/);
  assert.match(shopUI,/href="\/customers\/shops"/);
  assert.match(shopUI,/href="\/customers\/cv-accounts"/);
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
  assert.match(sql,/ADD COLUMN IF NOT EXISTS active_cv_number text/);
  assert.match(sql,/NEW.active_cv_number := NULL/);
  const billing=read("app/tasks/billing/[orderNumber]/page.tsx");
  assert.match(billing,/เลขบัญชี CV ที่อนุมัติแล้ว/);
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
  assert.match(sql,/REVOKE ALL ON FUNCTION public.enforce_shop_cv_integrity\(\)/);
  assert.match(shopUI,/CV ระงับ/);
  const detail=read("app/customers/[customerCode]/page.tsx");
  assert.match(detail,/CV Card สำหรับออกบิล/);
  assert.match(detail,/เปิดเมนูบัญชี CV/);
});


test("shop rows are collapsed by default with only name, CV status and LINE status",()=>{
  assert.match(shopUI,/aria-expanded=\{open\}/);
  assert.match(shopUI,/expanded===shop.id/);
  assert.match(shopUI,/เชื่อม CV แล้ว/);
  assert.match(shopUI,/เชื่อม LINE แล้ว/);
  assert.match(shopUI,/ยังไม่เชื่อม LINE/);
  assert.match(shopUI,/beingEdited&&draft\?/);
  assert.match(shopUI,/aria-label=\{`แก้ไขร้าน/);
  assert.match(shop,/lineLinked:/);
  assert.match(shop,/lineAccounts:/);
  assert.match(shop,/shopDetails/);
  assert.match(shop,/customer_line_users/);
});

test("existing CV Card image references are moved to CV Accounts without deleting stored photos",()=>{
  const migration=read("sql/cv_card_in_cv_accounts_20261114.sql");
  const detail=read("app/customers/[customerCode]/page.tsx");
  assert.match(migration,/ALTER TABLE public.cv_accounts\s+ADD COLUMN IF NOT EXISTS cv_card_storage_path/);
  assert.match(migration,/UPDATE public.cv_accounts cv\s+SET cv_card_storage_path = c.cv_card_storage_path/);
  assert.match(migration,/NEW.cv_card_storage_path := v_card/);
  assert.match(migration,/UPDATE public.customers SET cv_account_id=cv_account_id WHERE cv_account_id=v_cv/);
  assert.match(cv,/path.startsWith\("customer-cv\/"\)\?"order-files":"cv-documents"/);
  assert.match(cv,/cv_card_storage_path/);
  assert.match(cvUI,/CV Card สำหรับออกบิล/);
  assert.match(cvUI,/cvCardStoragePath/);
  assert.doesNotMatch(detail,/uploadCvCard\(/);
  assert.doesNotMatch(detail,/removeCvCard\(/);
  assert.match(detail,/เปิดเมนูบัญชี CV/);
});

test("CV Card replacements are compressed and manager-approved, never directly updated by a shop",()=>{
  const migration=read("sql/cv_card_in_cv_accounts_20261114.sql");
  assert.match(cv,/paths\(\[body.cvCardStoragePath\],1,staff.id\)/);
  assert.match(migration,/v_req.cv_card_storage_path/);
  assert.match(migration,/cv_card_storage_path=COALESCE/);
  assert.match(migration,/p_manager_id AND account_type='manager' AND is_active/);
  assert.match(migration,/length\(nullif\(cv_card_storage_path,''\)\)>0/);
  assert.match(upload,/\.webp\(\{quality:75/);
});
