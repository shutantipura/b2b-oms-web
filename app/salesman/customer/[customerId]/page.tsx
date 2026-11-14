"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import LotusLoading from "@/components/LotusLoading";
import { supabase } from "@/lib/supabase";

type CustomerRecord = {
  id: string;
  customer_code: string;
  has_no_cv: boolean;
  customer_name: string;
  customer_type: string | null;
  contact_name: string | null;
  phone: string | null;
  notes: string | null;
  rider_note: string | null;
  delivery_address: string | null;
  delivery_map_url: string | null;
  delivery_map_url_2: string | null;
  delivery_location_1_name: string;
  delivery_location_2_name: string;
};
type Product = { id: string; sku: string; product_name: string; unit: string; normal_price: number };

const FIELDS: Array<{ key: keyof CustomerRecord; label: string; placeholder?: string }> = [
  { key: "customer_name", label: "ชื่อร้าน" },
  { key: "customer_type", label: "ประเภทร้าน" },
  { key: "contact_name", label: "ชื่อผู้ติดต่อ" },
  { key: "phone", label: "เบอร์โทรศัพท์" },
  { key: "delivery_location_1_name", label: "ชื่อจุดส่ง 1" },
  { key: "delivery_map_url", label: "Google Maps จุดส่ง 1" },
  { key: "delivery_location_2_name", label: "ชื่อจุดส่ง 2" },
  { key: "delivery_map_url_2", label: "Google Maps จุดส่ง 2" },
  { key: "rider_note", label: "ข้อความถึงผู้ส่งสินค้า" },
  { key: "notes", label: "หมายเหตุร้านค้า" },
];

async function salesFetch(path: string, method: "POST", payload: unknown) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("กรุณาเข้าสู่ระบบใหม่");
  const response = await fetch(path, {
    method, headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.access_token },
    body: JSON.stringify(payload), cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "บันทึกไม่สำเร็จ");
  return data;
}

export default function SalesmanCustomerEditor() {
  const params = useParams<{ customerId: string }>();
  const customerId = params.customerId;
  const [loading,setLoading]=useState(true);
  const [access,setAccess]=useState(false);
  const [customer,setCustomer]=useState<CustomerRecord|null>(null);
  const [values,setValues]=useState<Record<string,string|boolean>>({});
  const [saving,setSaving]=useState(false);
  const [message,setMessage]=useState("");
  const [priceMessage,setPriceMessage]=useState("");
  const [skuQuery,setSkuQuery]=useState("");
  const [products,setProducts]=useState<Product[]>([]);
  const [selectedProduct,setSelectedProduct]=useState<Product|null>(null);
  const [proposedPrice,setProposedPrice]=useState("");
  const [priceSaving,setPriceSaving]=useState(false);

  useEffect(()=>{
    let active=true;
    async function load(){
      try {
        const {data:{user},error:authError}=await supabase.auth.getUser();
        if(authError||!user) throw new Error("กรุณาเข้าสู่ระบบใหม่");
        const {data:staff,error:roleError}=await supabase.from("staff").select("account_type,is_active")
          .eq("auth_user_id",user.id).maybeSingle();
        if(roleError||!staff?.is_active||staff.account_type!=="salesman") throw new Error("หน้านี้สำหรับ Salesman เท่านั้น");
        const {data:record,error}=await supabase.from("customers")
          .select("id,customer_code,has_no_cv,customer_name,customer_type,contact_name,phone,notes,rider_note,delivery_address,delivery_map_url,delivery_map_url_2,delivery_location_1_name,delivery_location_2_name")
          .eq("id",customerId).eq("is_active",true).maybeSingle();
        if(error||!record) throw new Error("ไม่พบข้อมูลลูกค้า");
        if(!active)return;
        setCustomer(record as CustomerRecord);
        const mapped: Record<string,string|boolean>={};
        for(const field of FIELDS) mapped[field.key]=record[field.key] ?? "";
        mapped.has_no_cv=record.has_no_cv;
        setValues(mapped);setAccess(true);
      }catch(e){if(active)setMessage(e instanceof Error?e.message:"ไม่สามารถโหลดข้อมูลได้");}
      finally{if(active)setLoading(false);}
    }
    void load();return()=>{active=false;};
  },[customerId]);

  const dirty = useMemo(()=>{
    if(!customer)return {};
    const result: Record<string,string|boolean|null>={};
    for(const field of FIELDS){
      const key=field.key;
      const current=String(values[key]??"").trim();
      const old=String(customer[key]??"").trim();
      if(current!==old)result[key]=current||null;
    }
    if(Object.prototype.hasOwnProperty.call(result,"delivery_map_url")){
      result.delivery_address = result.delivery_map_url as string|null;
    }
    return result;
  },[customer,values]);

  async function saveChanges(){
    if(!customer||saving)return;
    if(!Object.keys(dirty).length){setMessage("ไม่มีข้อมูลที่เปลี่ยนแปลง");return;}
    if(!String(values.customer_name??"").trim()){setMessage("กรุณากรอกชื่อร้าน");return;}
    setSaving(true);setMessage("");
    try {
      const response=await salesFetch("/api/sales/customer-changes","POST",{customerId:customer.id,changes:dirty});
      const refreshed=await supabase.from("customers")
        .select("id,customer_code,has_no_cv,customer_name,customer_type,contact_name,phone,notes,rider_note,delivery_address,delivery_map_url,delivery_map_url_2,delivery_location_1_name,delivery_location_2_name")
        .eq("id",customer.id).single();
      if(refreshed.data) {
        setCustomer(refreshed.data as CustomerRecord);
        const normalized: Record<string,string|boolean>={};
        for(const field of FIELDS) normalized[field.key]=refreshed.data[field.key]??"";
        normalized.has_no_cv=refreshed.data.has_no_cv;
        setValues(normalized);
      }
      setMessage(`บันทึกแล้ว ${response.changedCount} รายการ · มีผลทันทีและส่งให้ Manager ตรวจสอบ`);
    } catch(e) {setMessage(e instanceof Error?e.message:"ไม่สามารถบันทึกได้");}
    finally {setSaving(false);}
  }

  async function findProducts(){
    setPriceMessage("");setSelectedProduct(null);
    const q=skuQuery.trim();
    if(!q){setProducts([]);return;}
    const safe=q.replace(/[%_,()]/g," ").trim();
    const {data,error}=await supabase.from("products")
      .select("id,sku,product_name,unit,normal_price")
      .eq("is_active",true).eq("is_customer_visible",true)
      .or(`sku.ilike.%${safe}%,product_name.ilike.%${safe}%`)
      .order("sales_score",{ascending:false}).limit(20);
    if(error){setPriceMessage(error.message);return;}
    setProducts((data??[]) as Product[]);
  }

  async function submitPrice(){
    if(!customer||!selectedProduct||priceSaving)return;
    const price=Number(proposedPrice);
    if(!Number.isFinite(price)||price<=0||Math.round(price*100)/100!==price){
      setPriceMessage("กรุณากรอกราคาเป็นตัวเลขบวก ไม่เกิน 2 ทศนิยม");return;
    }
    setPriceSaving(true);setPriceMessage("");
    try{
      const data=await salesFetch("/api/sales/prices","POST",{
        customerId:customer.id,productId:selectedProduct.id,price,
      });
      setPriceMessage(data.status==="auto_applied"
        ? "ราคาพิเศษมีผลทันที (GP มากกว่า 7%) · บันทึกประวัติแล้ว"
        : "ส่งให้ Manager อนุมัติแล้ว · ราคาปัจจุบันยังไม่เปลี่ยน");
      setProposedPrice("");
    }catch(e){setPriceMessage(e instanceof Error?e.message:"เสนอราคาไม่สำเร็จ");}
    finally{setPriceSaving(false);}
  }

  if(loading)return <LotusLoading message="กำลังโหลดข้อมูลลูกค้า..."/>;
  if(!access||!customer)return <main className="min-h-screen bg-[#F3F8F7] p-6"><div className="mx-auto max-w-md rounded-xl bg-white p-6"><p>{message||"ไม่มีสิทธิ์ใช้งาน"}</p><Link href="/salesman" className="mt-4 inline-block underline">กลับหน้าฝ่ายขาย</Link></div></main>;

  return <main className="min-h-screen bg-[#F3F8F7] px-3 pb-24 pt-4 text-[#17453F] sm:px-6">
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href="/salesman" className="text-sm font-bold text-[#008C88]">← กลับรายชื่อลูกค้า</Link>
      <header className="rounded-2xl bg-white p-4 shadow-sm">
        <p className="text-xs font-bold text-[#008C88]">LOTUS’S B2B · SALESMAN</p>
        <h1 className="mt-1 text-xl font-black">{customer.customer_name}</h1>
        <p className="text-sm text-[#69887C]">แก้ไขข้อมูลมีผลทันที · Manager ตรวจสอบย้อนหลัง</p>
      </header>
      <section className="rounded-2xl border border-[#D9EAE4] bg-white p-4">
        <h2 className="text-lg font-black">แก้ไขข้อมูลลูกค้า</h2>
        <p className="mt-2 text-sm text-[#69887C]">รหัสร้าน: {customer.customer_code} · บัญชี CV จัดการแยกในเมนู บัญชี CV</p>
        <Link href="/customers/shops" className="mt-1 inline-block text-sm font-bold text-[#008F8D]">เชื่อมบัญชี CV ของร้านค้า</Link>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {FIELDS.map(field=><label key={field.key} className="block text-sm">
            <span className="mb-1 block font-bold">{field.label}</span>
            <input value={String(values[field.key]??"")}
              onChange={e=>setValues(p=>({...p,[field.key]:e.target.value}))}
              className="min-h-11 w-full rounded-xl border border-[#D5E8E2] bg-white px-3 text-sm outline-none focus:border-[#02B0AF] disabled:bg-[#F3F5F4]"
            />
          </label>)}
        </div>
        <p className="mt-3 text-xs text-[#667D74]">จุดส่งใหม่มีผลต่อการเลือกสถานที่ในออเดอร์ถัดไป ไม่แก้ที่อยู่ของออเดอร์ที่มีอยู่แล้ว</p>
        <button onClick={()=>void saveChanges()} disabled={saving||!Object.keys(dirty).length}
          className="mt-4 min-h-12 w-full rounded-xl bg-[#02B0AF] px-4 font-black text-white disabled:opacity-50">
          {saving?"กำลังบันทึก...":`บันทึกทันที (${Object.keys(dirty).length} ฟิลด์)`}
        </button>
        {message&&<p role="status" className="mt-3 rounded-lg bg-[#EAF8F4] p-3 text-sm">{message}</p>}
      </section>
      <section className="rounded-2xl border border-[#D9EAE4] bg-white p-4">
        <h2 className="text-lg font-black">เสนอราคาพิเศษ</h2>
        <p className="mt-1 text-sm text-[#667D74]">GP มากกว่า 7% จะมีผลทันที · 7% หรือต่ำกว่า หรือไม่มีต้นทุน จะรอ Manager อนุมัติ</p>
        <div className="mt-3 flex gap-2">
          <input value={skuQuery} onChange={e=>setSkuQuery(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")void findProducts();}}
            className="min-h-11 min-w-0 flex-1 rounded-xl border border-[#D5E8E2] px-3 text-sm" placeholder="ค้นหา SKU หรือชื่อสินค้า"/>
          <button onClick={()=>void findProducts()} className="rounded-xl bg-[#02B0AF] px-4 text-sm font-bold text-white">ค้นหา</button>
        </div>
        {products.length>0&&<div className="mt-2 max-h-52 space-y-1 overflow-y-auto">
          {products.map(product=><button type="button" key={product.id}
            onClick={()=>{setSelectedProduct(product);setProducts([]);}}
            className="w-full rounded-lg border border-[#E1EDE8] p-2 text-left text-sm">
            <span className="font-bold">{product.sku}</span> · {product.product_name} ({product.unit})
          </button>)}
        </div>}
        {selectedProduct&&<div className="mt-3 rounded-xl bg-[#F1FAF7] p-3">
          <p className="text-sm font-black">{selectedProduct.product_name}</p>
          <p className="text-xs text-[#657E74]">SKU {selectedProduct.sku} · {selectedProduct.unit}</p>
          <label className="mt-3 block text-sm font-bold">ราคาที่เสนอ (บาท / {selectedProduct.unit})
            <input type="number" min="0.01" step="0.01" value={proposedPrice} onChange={e=>setProposedPrice(e.target.value)}
              className="mt-1 min-h-11 w-full rounded-lg border border-[#D2E6DF] px-3 text-base"/>
          </label>
          <button onClick={()=>void submitPrice()} disabled={priceSaving}
            className="mt-3 min-h-11 w-full rounded-lg bg-[#FFBE16] px-3 font-black text-[#4A3900] disabled:opacity-50">
            {priceSaving?"กำลังส่ง...":"เสนอราคาพิเศษ"}
          </button>
        </div>}
        {priceMessage&&<p role="status" className="mt-3 rounded-lg bg-[#FFF7DD] p-3 text-sm">{priceMessage}</p>}
      </section>
    </div>
  </main>;
}
