"use client";

import {useCallback,useEffect,useMemo,useState} from "react";
import Link from "next/link";
import {supabase} from "@/lib/supabase";

type CV={id:string;cv_number:string;status:string};
type Shop={id:string;customer_code:string;customer_name:string;contact_name:string|null;
  phone:string|null;is_active:boolean;has_no_cv:boolean;cv_account_id:string|null;cvAccount:CV|null};
type LineCustomer={id:string;display_name:string|null;internal_name:string|null};

async function api(path:string,method:"GET"|"POST"|"PATCH"="GET",body?:unknown){
  const {data:{session}}=await supabase.auth.getSession();
  if(!session?.access_token)throw new Error("กรุณาเข้าสู่ระบบพนักงานอีกครั้ง");
  const response=await fetch(path,{method,headers:{"Authorization":"Bearer "+session.access_token,
    ...(body?{"Content-Type":"application/json"}:{})},body:body?JSON.stringify(body):undefined,cache:"no-store"});
  const result=await response.json();
  if(!response.ok)throw new Error(result.error??"โหลดข้อมูลไม่สำเร็จ");
  return result;
}
const field="w-full min-h-11 rounded-xl border border-[#CFE5DE] bg-white px-3 py-2 text-sm outline-none focus:border-[#02B0AF]";
export default function ShopsPage(){
  const [shops,setShops]=useState<Shop[]>([]),[cvs,setCVs]=useState<CV[]>([]);
  const [owners,setOwners]=useState<LineCustomer[]>([]),[search,setSearch]=useState("");
  const [form,setForm]=useState({shopName:"",phone:"",contactName:"",deliveryMapUrl:"",
    deliveryMapUrl2:"",customerType:"restaurant",lineUserId:""});
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(""),[showNew,setShowNew]=useState(false);
  const reload=useCallback(async()=>{
    try{
      const result=await api("/api/customer-registry/shops");
      setShops(result.shops??[]);setCVs(result.approvedCV??[]);setOwners(result.customers??[]);
    }catch(e){setMessage(e instanceof Error?e.message:"โหลดข้อมูลไม่ได้");}
  },[]);
  useEffect(()=>{void reload();},[reload]);
  const filtered=useMemo(()=>shops.filter(shop=>
    [shop.customer_name,shop.customer_code,shop.cvAccount?.cv_number??"",shop.contact_name??""]
      .some(text=>text.toLowerCase().includes(search.trim().toLowerCase()))),[shops,search]);
  async function createShop(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault();setBusy(true);setMessage("");
    try{
      const result=await api("/api/customer-registry/shops","POST",form);
      setMessage(result.warning??"สร้างร้านค้าแล้ว · ค่าเริ่มต้นไม่มี CV");
      setForm({shopName:"",phone:"",contactName:"",deliveryMapUrl:"",
        deliveryMapUrl2:"",customerType:"restaurant",lineUserId:""});
      setShowNew(false);await reload();
    }catch(e){setMessage(e instanceof Error?e.message:"สร้างร้านไม่สำเร็จ");}
    finally{setBusy(false);}
  }
  async function link(shop:Shop,cvId:string){
    setBusy(true);setMessage("");
    try{
      await api("/api/customer-registry/shops","PATCH",{shopId:shop.id,cvAccountId:cvId||null});
      setMessage("ปรับบัญชี CV ของร้าน "+shop.customer_name+" แล้ว");await reload();
    }catch(e){setMessage(e instanceof Error?e.message:"เชื่อมต่อ CV ไม่สำเร็จ");}
    finally{setBusy(false);}
  }
  async function assign(shop:Shop,userId:string){
    if(!userId)return;
    setBusy(true);setMessage("");
    try{await api("/api/customer-registry/shops","PATCH",{shopId:shop.id,lineUserId:userId});
      setMessage("มอบสิทธิ์เข้าถึงร้าน "+shop.customer_name+" แล้ว");}
    catch(e){setMessage(e instanceof Error?e.message:"มอบสิทธิ์ไม่สำเร็จ");}
    finally{setBusy(false);}
  }
  return <main className="min-h-screen bg-[#F3F8F7] px-3 py-5 text-[#17453F] sm:px-6">
    <div className="mx-auto max-w-5xl space-y-4">
      <header className="rounded-2xl border border-[#CEE7DF] bg-white p-5">
        <Link href="/login" className="text-sm font-bold text-[#008F8D]">← กลับหน้าหลัก</Link>
        <p className="mt-4 text-xs font-bold tracking-wider text-[#008F8D]">LOTUS’S B2B · CUSTOMERS</p>
        <h1 className="mt-1 text-2xl font-black">ร้านค้า</h1>
        <p className="mt-2 text-sm text-[#718A80]">ร้านค้าเป็นหน่วยสั่งซื้อใน OMS · ร้านใหม่เริ่มจาก ไม่มี CV และเลือกเชื่อมบัญชี CV ที่ผ่านอนุมัติแล้วภายหลัง</p>
      </header>
      <nav className="grid grid-cols-2 gap-2 rounded-xl bg-white p-1">
        <Link href="/customers/shops" aria-current="page" className="rounded-lg bg-[#02B0AF] px-3 py-3 text-center text-sm font-black text-white">ร้านค้า</Link>
        <Link href="/customers/cv-accounts" className="rounded-lg px-3 py-3 text-center text-sm font-black text-[#008F8D]">บัญชี CV</Link>
      </nav>
      {message&&<p role="status" className="rounded-xl border border-[#C5E7DB] bg-white p-3 text-sm">{message}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-bold">{shops.length} ร้านค้า</span>
        <button onClick={()=>setShowNew(x=>!x)} className="min-h-11 rounded-xl bg-[#02B0AF] px-4 font-black text-white">+ สร้างร้านค้า</button>
      </div>
      {showNew&&<form onSubmit={e=>void createShop(e)} className="grid gap-3 rounded-2xl border border-[#CFE7DE] bg-white p-5 sm:grid-cols-2">
        <h2 className="sm:col-span-2 text-lg font-black">สร้างร้านค้าใหม่ <span className="text-sm font-medium text-[#8A7353]">ไม่มี CV โดยอัตโนมัติ</span></h2>
        {([["shopName","ชื่อร้านค้า *"],["phone","เบอร์โทรศัพท์ *"],
          ["contactName","ผู้ติดต่อ"],["deliveryMapUrl","Google Maps จุดส่ง 1 *"],
          ["deliveryMapUrl2","Google Maps จุดส่ง 2 (ไม่บังคับ)"]] as const).map(([key,label])=>
          <label key={key} className="text-sm font-bold">{label}
            <input className={"mt-1 "+field} value={form[key]} required={["shopName","phone","deliveryMapUrl"].includes(key)}
              onChange={e=>setForm(p=>({...p,[key]:e.target.value}))}/>
          </label>)}
        <label className="text-sm font-bold">ประเภทลูกค้า
          <select className={"mt-1 "+field} value={form.customerType} onChange={e=>setForm(p=>({...p,customerType:e.target.value}))}>
            <option value="restaurant">ร้านอาหาร</option><option value="grocery">โชห่วย</option>
            <option value="hotel">โรงแรม</option><option value="cafe">คาเฟ่</option><option value="other">อื่น ๆ</option>
          </select>
        </label>
        <label className="sm:col-span-2 text-sm font-bold">มอบสิทธิ์ร้านให้บัญชี LINE ลูกค้า (ไม่บังคับ)
          <select className={"mt-1 "+field} value={form.lineUserId} onChange={e=>setForm(p=>({...p,lineUserId:e.target.value}))}>
            <option value="">ยังไม่มอบสิทธิ์</option>
            {owners.map(o=><option key={o.id} value={o.id}>{o.internal_name||o.display_name||o.id}</option>)}
          </select>
        </label>
        <button disabled={busy} type="submit" className="sm:col-span-2 min-h-12 rounded-xl bg-[#02B0AF] px-5 font-black text-white disabled:opacity-50">
          {busy?"กำลังบันทึก...":"สร้างร้านค้า (ไม่มี CV)"}
        </button>
      </form>}
      <input aria-label="ค้นหาร้านค้า" placeholder="ค้นหาชื่อร้าน รหัสร้าน หรือเลข CV" className={field} value={search} onChange={e=>setSearch(e.target.value)}/>
      <div className="grid gap-3">
        {filtered.map(shop=><article key={shop.id} className="rounded-2xl border border-[#D3E5DF] bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="text-base font-black">{shop.customer_name}</h2>
              <p className="mt-1 text-xs text-[#758E84]">รหัสร้าน OMS: {shop.customer_code}</p>
              <p className="mt-1 text-sm text-[#668075]">{shop.contact_name||"ไม่มีผู้ติดต่อ"} · {shop.phone||"ไม่มีเบอร์โทร"}</p>
            </div>
            <span className={"rounded-full px-3 py-1 text-xs font-black "+(shop.cvAccount?
              "bg-[#E4F7F2] text-[#008F8D]":"bg-[#FFF3D5] text-[#946B00]")}>
              {shop.cvAccount?(shop.cvAccount.status==="approved"?"CV ":"CV ระงับ · ")+shop.cvAccount.cv_number:"ไม่มี CV"}
            </span>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <label className="text-xs font-bold text-[#57776D]">บัญชี CV ที่อนุมัติแล้ว
              <select value={shop.cv_account_id??""} onChange={e=>void link(shop,e.target.value)} disabled={busy} className={"mt-1 "+field}>
                <option value="">ไม่มี CV</option>
                {shop.cvAccount?.status==="deactivated"&&<option value={shop.cvAccount.id} disabled>{shop.cvAccount.cv_number} (ระงับ)</option>}
                {cvs.map(c=><option key={c.id} value={c.id}>{c.cv_number}</option>)}
              </select>
            </label>
            <label className="text-xs font-bold text-[#57776D]">มอบสิทธิ์ร้านให้บัญชี LINE ลูกค้า
              <select defaultValue="" onChange={e=>void assign(shop,e.target.value)} disabled={busy} className={"mt-1 "+field}>
                <option value="">เลือกบัญชีเพื่อมอบสิทธิ์</option>
                {owners.map(o=><option key={o.id} value={o.id}>{o.internal_name||o.display_name||o.id}</option>)}
              </select>
            </label>
          </div>
          <Link href={`/customers/${encodeURIComponent(shop.customer_code)}`} className="mt-3 inline-flex min-h-10 items-center rounded-lg bg-[#EDF9F6] px-4 text-xs font-bold text-[#008F8D]">
            ข้อมูลร้านและประวัติคำสั่งซื้อ
          </Link>
        </article>)}
        {!filtered.length&&<p className="py-12 text-center text-sm text-[#718A80]">ไม่พบร้านค้าที่ค้นหา</p>}
      </div>
    </div>
  </main>;
}
