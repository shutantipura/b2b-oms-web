"use client";

import {useCallback,useEffect,useMemo,useState,type FormEvent} from "react";
import Link from "next/link";
import {supabase} from "@/lib/supabase";

type CV={id:string;cv_number:string;status:string};
type LinkedLine={id:string;name:string};
type Shop={
  id:string;customer_code:string;customer_name:string;contact_name:string|null;
  phone:string|null;is_active:boolean;has_no_cv:boolean;cv_account_id:string|null;
  cvAccount:CV|null;lineLinked:boolean;lineAccounts:LinkedLine[];
  delivery_map_url:string|null;delivery_map_url_2:string|null;
  delivery_location_1_name:string|null;delivery_location_2_name:string|null;
  rider_note:string|null;notes:string|null;customer_type:string|null;
};
type LineCustomer={id:string;display_name:string|null;internal_name:string|null};
type EditFields=Pick<Shop,"customer_name"|"phone"|"contact_name"|"delivery_map_url"|
  "delivery_map_url_2"|"delivery_location_1_name"|"delivery_location_2_name"|"rider_note">;
const inputClass="min-h-11 w-full rounded-xl border border-[#CFE5DE] bg-white px-3 py-2 text-sm outline-none focus:border-[#02B0AF]";
const badge="rounded-full px-2.5 py-1 text-xs font-extrabold";
const editKeys=[
  ["customer_name","ชื่อร้าน"],["contact_name","ชื่อผู้ติดต่อ"],["phone","เบอร์โทร"],
  ["delivery_location_1_name","ชื่อจุดส่ง 1"],["delivery_map_url","Google Maps จุดส่ง 1"],
  ["delivery_location_2_name","ชื่อจุดส่ง 2"],["delivery_map_url_2","Google Maps จุดส่ง 2"],
  ["rider_note","หมายเหตุถึงไรเดอร์"],
] as const;
async function api(method:"GET"|"POST"|"PATCH"="GET",body?:unknown){
  const {data:{session}}=await supabase.auth.getSession();
  if(!session?.access_token)throw new Error("กรุณาเข้าสู่ระบบด้วย LINE อีกครั้ง");
  const response=await fetch("/api/customer-registry/shops",{
    method,cache:"no-store",
    headers:{Authorization:"Bearer "+session.access_token,
      ...(body?{"Content-Type":"application/json"}:{})},
    body:body?JSON.stringify(body):undefined,
  });
  const result=await response.json();
  if(!response.ok)throw new Error(result.error??"ดำเนินการไม่สำเร็จ");
  return result;
}
function fields(shop:Shop):EditFields{
  return {
    customer_name:shop.customer_name,contact_name:shop.contact_name,phone:shop.phone,
    delivery_map_url:shop.delivery_map_url,delivery_map_url_2:shop.delivery_map_url_2,
    delivery_location_1_name:shop.delivery_location_1_name,
    delivery_location_2_name:shop.delivery_location_2_name,rider_note:shop.rider_note,
  };
}
export default function ShopsPage(){
  const [shops,setShops]=useState<Shop[]>([]),[cvs,setCVs]=useState<CV[]>([]);
  const [owners,setOwners]=useState<LineCustomer[]>([]);
  const [search,setSearch]=useState(""),[expanded,setExpanded]=useState<string|null>(null);
  const [editing,setEditing]=useState<string|null>(null);
  const [draft,setDraft]=useState<EditFields|null>(null);
  const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true);
  const [message,setMessage]=useState(""),[showNew,setShowNew]=useState(false);
  const [form,setForm]=useState({shopName:"",phone:"",contactName:"",deliveryMapUrl:"",
    deliveryMapUrl2:"",customerType:"restaurant",lineUserId:""});

  const reload=useCallback(async()=>{
    try{
      const data=await api();
      setShops(data.shops??[]);setCVs(data.approvedCV??[]);setOwners(data.customers??[]);
    }catch(error){setMessage(error instanceof Error?error.message:"โหลดข้อมูลร้านค้าไม่สำเร็จ");}
    finally{setLoading(false);}
  },[]);
  useEffect(()=>{void reload();},[reload]);
  const visible=useMemo(()=>shops.filter(shop=>
    [shop.customer_name,shop.customer_code,shop.cvAccount?.cv_number??"",
      shop.contact_name??"",shop.phone??""]
    .some(s=>s.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
  ),[shops,search]);

  async function perform(body:unknown,success:string){
    setBusy(true);setMessage("");
    try{await api("PATCH",body);setMessage(success);await reload();return true;}
    catch(error){setMessage(error instanceof Error?error.message:"บันทึกข้อมูลไม่สำเร็จ");return false;}
    finally{setBusy(false);}
  }
  async function createShop(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setBusy(true);setMessage("");
    try{
      const data=await api("POST",form);
      setMessage(data.warning??"สร้างร้านค้าใหม่แล้ว · ไม่มี CV โดยอัตโนมัติ");
      setShowNew(false);
      setForm({shopName:"",phone:"",contactName:"",deliveryMapUrl:"",
        deliveryMapUrl2:"",customerType:"restaurant",lineUserId:""});
      await reload();
    }catch(error){setMessage(error instanceof Error?error.message:"สร้างร้านไม่สำเร็จ");}
    finally{setBusy(false);}
  }
  async function saveEdit(shopId:string,event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(!draft)return;
    const success=await perform({shopId,shopDetails:draft},"บันทึกข้อมูลร้านค้าเรียบร้อยแล้ว");
    if(success){setEditing(null);setDraft(null);}
  }
  function toggle(shopId:string){
    if(editing===shopId){setEditing(null);setDraft(null);}
    setExpanded(current=>current===shopId?null:shopId);
  }
  const shopStatus=(shop:Shop)=>
    shop.cvAccount?.status==="approved"?"เชื่อม CV แล้ว":shop.cvAccount?"CV ระงับ":"ไม่มี CV";

  return <main className="min-h-screen bg-[#F3F8F7] px-3 py-5 pb-28 text-[#17453F] sm:px-6">
    <div className="mx-auto max-w-4xl space-y-4">
      <header className="rounded-2xl border border-[#CEE7DF] bg-white p-4 sm:p-5">
        <Link href="/login" className="text-sm font-bold text-[#008F8D]">← กลับหน้าหลัก</Link>
        <h1 className="mt-3 text-2xl font-black">ร้านค้า</h1>
        <p className="mt-1 text-sm text-[#718A80]">ค้นหาและจัดการร้านค้า · แตะรายการเพื่อดูรายละเอียด</p>
      </header>
      <nav className="grid grid-cols-2 gap-1 rounded-xl bg-white p-1">
        <Link href="/customers/shops" aria-current="page" className="rounded-lg bg-[#02B0AF] p-3 text-center text-sm font-black text-white">ร้านค้า</Link>
        <Link href="/customers/cv-accounts" className="rounded-lg p-3 text-center text-sm font-black text-[#008F8D]">บัญชี CV</Link>
      </nav>
      {message&&<p role="status" className="rounded-xl border border-[#C5E7DB] bg-white p-3 text-sm">{message}</p>}
      <div className="flex items-center justify-between gap-2">
        <span className="font-bold">{loading?"กำลังโหลด...":`${shops.length} ร้านค้า`}</span>
        <button type="button" onClick={()=>setShowNew(x=>!x)}
          className="min-h-11 rounded-xl bg-[#02B0AF] px-4 text-sm font-black text-white">+ สร้างร้านค้า</button>
      </div>
      {showNew&&<form onSubmit={e=>void createShop(e)} className="grid gap-3 rounded-2xl border border-[#CFE7DE] bg-white p-4 sm:grid-cols-2">
        <h2 className="sm:col-span-2 text-lg font-black">สร้างร้านค้า · ไม่มี CV โดยอัตโนมัติ</h2>
        {([["shopName","ชื่อร้าน *"],["phone","เบอร์โทร *"],["contactName","ผู้ติดต่อ"],
          ["deliveryMapUrl","Google Maps จุดส่ง 1 *"],["deliveryMapUrl2","Google Maps จุดส่ง 2"]] as const).map(([key,label])=>
          <label key={key} className="text-sm font-bold">{label}
            <input className={"mt-1 "+inputClass} value={form[key]}
              required={["shopName","phone","deliveryMapUrl"].includes(key)}
              onChange={e=>setForm(v=>({...v,[key]:e.target.value}))}/>
          </label>)}
        <label className="text-sm font-bold">ประเภทลูกค้า
          <select className={"mt-1 "+inputClass} value={form.customerType}
            onChange={e=>setForm(v=>({...v,customerType:e.target.value}))}>
            <option value="restaurant">ร้านอาหาร</option><option value="grocery">โชห่วย</option>
            <option value="hotel">โรงแรม</option><option value="cafe">คาเฟ่</option>
            <option value="other">อื่น ๆ</option>
          </select>
        </label>
        <label className="text-sm font-bold">บัญชี LINE ลูกค้า (ไม่บังคับ)
          <select className={"mt-1 "+inputClass} value={form.lineUserId}
            onChange={e=>setForm(v=>({...v,lineUserId:e.target.value}))}>
            <option value="">ยังไม่เชื่อม LINE</option>
            {owners.map(o=><option key={o.id} value={o.id}>{o.internal_name||o.display_name||o.id}</option>)}
          </select>
        </label>
        <button type="submit" disabled={busy}
          className="sm:col-span-2 min-h-11 rounded-xl bg-[#02B0AF] font-black text-white disabled:opacity-50">
          {busy?"กำลังบันทึก...":"สร้างร้านค้า"}
        </button>
      </form>}
      <input aria-label="ค้นหาร้านค้า" type="search" value={search}
        onChange={e=>setSearch(e.target.value)} className={inputClass}
        placeholder="ค้นหาชื่อร้าน รหัสร้าน ผู้ติดต่อ หรือ CV"/>
      <section className="space-y-2" aria-label="รายชื่อร้านค้า">
        {visible.map(shop=>{
          const open=expanded===shop.id,beingEdited=editing===shop.id;
          const status=shopStatus(shop);
          return <article key={shop.id} className="overflow-hidden rounded-2xl border border-[#D5E8E1] bg-white">
            <button type="button" aria-expanded={open} aria-controls={`shop-detail-${shop.id}`}
              onClick={()=>toggle(shop.id)}
              className="flex min-h-[84px] w-full items-center justify-between gap-2 px-4 py-3 text-left">
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-base font-black text-[#17453F]">{shop.customer_name}</h2>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className={badge+" "+(shop.cvAccount?.status==="approved"
                    ?"bg-[#E2F7F1] text-[#008F8D]":"bg-[#FFF2DB] text-[#916400]")}>
                    {status}
                  </span>
                  <span className={badge+" "+(shop.lineLinked
                    ?"bg-[#E2F7F1] text-[#008F8D]":"bg-[#F0F2F3] text-[#71818A]")}>
                    {shop.lineLinked?"เชื่อม LINE แล้ว":"ยังไม่เชื่อม LINE"}
                  </span>
                </div>
              </div>
              <svg className={"h-5 w-5 shrink-0 text-[#58867D] transition-transform "+(open?"rotate-180":"")}
                viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                <path d="m6 9 6 6 6-6"/>
              </svg>
            </button>
            {open&&<div id={`shop-detail-${shop.id}`} className="border-t border-[#E1EEE9] px-4 pb-4 pt-3">
              <div className="mb-3 flex justify-end">
                <button type="button" aria-label={`แก้ไขร้าน ${shop.customer_name}`} disabled={busy}
                  onClick={()=>{setEditing(beingEdited?null:shop.id);setDraft(beingEdited?null:fields(shop));}}
                  className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-[#EAF8F5] px-3 text-sm font-extrabold text-[#008F8D]">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
                    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4L16.5 3.5Z"/>
                  </svg>
                  {beingEdited?"ยกเลิกแก้ไข":"แก้ไข"}
                </button>
              </div>
              {beingEdited&&draft?
                <form className="grid gap-3 sm:grid-cols-2" onSubmit={event=>void saveEdit(shop.id,event)}>
                  {editKeys.map(([key,label])=><label key={key} className="text-sm font-semibold">
                    {label}
                    <input value={draft[key]??""} required={key==="customer_name"||key==="phone"}
                      onChange={e=>setDraft(d=>d?{...d,[key]:e.target.value}:d)}
                      className={"mt-1 "+inputClass}/>
                  </label>)}
                  <button type="submit" disabled={busy}
                    className="min-h-11 rounded-xl bg-[#02B0AF] px-4 font-black text-white sm:col-span-2 disabled:opacity-50">
                    {busy?"กำลังบันทึก...":"บันทึกการแก้ไข"}
                  </button>
                </form>:
                <div className="space-y-2 text-sm text-[#58776D]">
                  <p><strong className="text-[#17453F]">ผู้ติดต่อ:</strong> {shop.contact_name||"—"}</p>
                  <p><strong className="text-[#17453F]">โทรศัพท์:</strong> {shop.phone||"—"}</p>
                  <p><strong className="text-[#17453F]">รหัสร้าน OMS:</strong> {shop.customer_code}</p>
                  <div><strong className="text-[#17453F]">จุดส่ง:</strong>
                    <div className="mt-1 space-y-1">
                      {shop.delivery_map_url?<a href={shop.delivery_map_url} target="_blank" rel="noopener noreferrer"
                        className="block font-bold text-[#008F8D]">📍 {shop.delivery_location_1_name||shop.customer_name} · Google Maps</a>:
                        <p>ยังไม่มีจุดส่ง</p>}
                      {shop.delivery_map_url_2&&<a href={shop.delivery_map_url_2} target="_blank" rel="noopener noreferrer"
                        className="block font-bold text-[#008F8D]">📍 {shop.delivery_location_2_name||"จุดส่ง 2"} · Google Maps</a>}
                    </div>
                  </div>
                  {shop.rider_note&&<p><strong>หมายเหตุไรเดอร์:</strong> {shop.rider_note}</p>}
                </div>}
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="text-xs font-black text-[#4D746A]">บัญชี CV ที่อนุมัติแล้ว
                  <select value={shop.cv_account_id??""} disabled={busy}
                    onChange={e=>void perform({shopId:shop.id,cvAccountId:e.target.value||null},"ปรับการเชื่อม CV แล้ว")}
                    className={"mt-1 "+inputClass}>
                    <option value="">ไม่มี CV</option>
                    {shop.cvAccount?.status==="deactivated"&&<option disabled value={shop.cvAccount.id}>
                      {shop.cvAccount.cv_number} (CV ระงับ)
                    </option>}
                    {cvs.map(cv=><option key={cv.id} value={cv.id}>{cv.cv_number}</option>)}
                  </select>
                </label>
                <label className="text-xs font-black text-[#4D746A]">เพิ่มสิทธิ์ร้านให้บัญชี LINE ลูกค้า
                  <select value="" disabled={busy} className={"mt-1 "+inputClass}
                    onChange={e=>{if(e.target.value)void perform({shopId:shop.id,lineUserId:e.target.value},"เพิ่มสิทธิ์ LINE แล้ว");}}>
                    <option value="">เลือกบัญชี LINE</option>
                    {owners.map(o=><option key={o.id} value={o.id}>{o.internal_name||o.display_name||o.id}</option>)}
                  </select>
                </label>
              </div>
              <p className="mt-2 text-xs text-[#789388]">บัญชี LINE ที่เชื่อมแล้ว: {shop.lineAccounts.length?
                shop.lineAccounts.map(a=>a.name).join(", "):"ไม่มี"}</p>
              <Link href={`/customers/${encodeURIComponent(shop.customer_code)}`}
                className="mt-3 inline-flex min-h-10 items-center rounded-xl bg-[#EAF8F5] px-4 text-xs font-bold text-[#008F8D]">
                ประวัติคำสั่งซื้อและข้อมูลเพิ่มเติม
              </Link>
            </div>}
          </article>;
        })}
        {!loading&&!visible.length&&<p className="py-10 text-center text-sm text-[#718A80]">ไม่พบร้านค้าที่ค้นหา</p>}
      </section>
    </div>
  </main>;
}
