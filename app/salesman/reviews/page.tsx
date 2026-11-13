"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import LotusLoading from "@/components/LotusLoading";
import { supabase } from "@/lib/supabase";

type Change = {
  id: string; customer_id: string; field_name: string; previous_value: unknown;
  proposed_value: unknown; approved_baseline: unknown; status: string;
  created_at: string; customerName: string; customerCode: string;
  salesmanName: string; salesmanCode: string;
};
type Price = {
  id: string; customer_id: string; product_id: string; proposed_price: number;
  old_price: number|null; gp_pct: number|null; status: string;
  created_at: string; customerName: string; customerCode: string; productName: string;
  productSku: string; productUnit: string; salesmanName: string;
};
const FIELD: Record<string,string> = {
  customer_name:"ชื่อร้าน",customer_code:"เลข CV",has_no_cv:"ไม่มี CV",
  customer_type:"ประเภทร้าน",contact_name:"ชื่อผู้ติดต่อ",phone:"เบอร์โทร",
  delivery_address:"ที่อยู่จัดส่ง",delivery_map_url:"จุดส่ง 1 (Google Maps)",
  delivery_map_url_2:"จุดส่ง 2 (Google Maps)",delivery_location_1_name:"ชื่อจุดส่ง 1",
  delivery_location_2_name:"ชื่อจุดส่ง 2",rider_note:"หมายเหตุผู้ส่ง",notes:"หมายเหตุร้าน",
};
function format(value: unknown): string {
  if(value===null||value===undefined||value==="")return "—";
  if(typeof value==="boolean")return value?"ใช่":"ไม่ใช่";
  if(typeof value==="string")return value;
  return JSON.stringify(value);
}
function when(value:string){return new Date(value).toLocaleString("th-TH",{timeZone:"Asia/Bangkok",day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"});}

export default function SalesReviewPage(){
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState("");
  const [error,setError]=useState("");
  const [changes,setChanges]=useState<Change[]>([]);
  const [prices,setPrices]=useState<Price[]>([]);
  const [history,setHistory]=useState(false);
  const [page,setPage]=useState(0);
  const [more,setMore]=useState(false);
  const [refresh,setRefresh]=useState(0);

  useEffect(()=>{
    let active=true;
    async function load(){
      setLoading(true);setError("");
      try{
        const {data:{session}}=await supabase.auth.getSession();
        if(!session?.access_token)throw new Error("กรุณาเข้าสู่ระบบ Manager");
        const url="?status="+(history?"history":"pending")+"&page="+page;
        const init={headers:{Authorization:"Bearer "+session.access_token},cache:"no-store" as const};
        const [c,p]=await Promise.all([
          fetch("/api/sales/customer-changes"+url,init),
          fetch("/api/sales/prices"+url,init)
        ]);
        const [cd,pd]=await Promise.all([c.json(),p.json()]);
        if(!c.ok||!p.ok)throw new Error(cd.error??pd.error??"ไม่สามารถโหลดรายการรออนุมัติ");
        if(active){setChanges(cd.changes??[]);setPrices(pd.requests??[]);setMore(Boolean(cd.hasMore||pd.hasMore));}
      }catch(e){if(active)setError(e instanceof Error?e.message:"ไม่สามารถโหลดข้อมูล");}
      finally{if(active)setLoading(false);}
    }
    void load();return()=>{active=false;};
  },[history,page,refresh]);

  async function review(type:"customer"|"price",id:string,approve:boolean){
    if(busy)return;
    setBusy(id);setError("");
    try{
      const {data:{session}}=await supabase.auth.getSession();
      if(!session?.access_token)throw new Error("กรุณาเข้าสู่ระบบใหม่");
      const url=type==="customer"?"/api/sales/customer-changes":"/api/sales/prices";
      const response=await fetch(url,{method:"PATCH",headers:{
        "Content-Type":"application/json",Authorization:"Bearer "+session.access_token
      },body:JSON.stringify(type==="customer"
        ?{changeId:id,action:approve?"approve":"reject"}
        :{requestId:id,action:approve?"approve":"reject"})});
      const data=await response.json();
      if(!response.ok)throw new Error(data.error??"ไม่สามารถบันทึกผลการตรวจสอบ");
      setRefresh(v=>v+1);
    }catch(e){setError(e instanceof Error?e.message:"เกิดข้อผิดพลาด");}
    finally{setBusy("");}
  }

  const actionButtons=(type:"customer"|"price",id:string)=>!history&&
    <div className="mt-3 grid grid-cols-2 gap-2">
      <button type="button" disabled={Boolean(busy)} onClick={()=>void review(type,id,true)}
        className="min-h-11 rounded-xl bg-[#02B0AF] px-3 text-sm font-black text-white disabled:opacity-40">อนุมัติ</button>
      <button type="button" disabled={Boolean(busy)} onClick={()=>void review(type,id,false)}
        className="min-h-11 rounded-xl border border-[#DDA5A5] bg-[#FFF5F5] px-3 text-sm font-black text-[#A34A4A] disabled:opacity-40">
        {type==="customer"?"ปฏิเสธ / คืนค่าเดิม":"ปฏิเสธราคา"}
      </button>
    </div>;

  return <main className="min-h-screen bg-[#F3F8F7] px-3 pb-24 pt-5 text-[#17453F] sm:px-6">
    <div className="mx-auto max-w-4xl space-y-4">
      <Link href="/login" className="text-sm font-bold text-[#008C88]">← กลับหน้าหลัก Manager</Link>
      <header className="rounded-2xl border border-[#CBE7DE] bg-white p-5">
        <p className="text-xs font-extrabold text-[#008C88]">LOTUS’S B2B · MANAGER</p>
        <h1 className="mt-1 text-2xl font-black">ตรวจสอบการแก้ไขของฝ่ายขาย</h1>
        <p className="mt-2 text-sm leading-6 text-[#688277]">
          ข้อมูลลูกค้ามีผลทันทีแล้ว · กดปฏิเสธเพื่อคืนค่าก่อนแก้ไข
          ส่วนราคาที่ GP ไม่เกิน 7% ยังไม่มีผลจนกว่า Manager อนุมัติ
        </p>
        <div className="mt-4 flex gap-2">
          <button onClick={()=>{setHistory(false);setPage(0);}} className={`rounded-xl px-4 py-2 text-sm font-bold ${!history?"bg-[#02B0AF] text-white":"bg-[#EDF7F4]"}`}>รอตรวจสอบ</button>
          <button onClick={()=>{setHistory(true);setPage(0);}} className={`rounded-xl px-4 py-2 text-sm font-bold ${history?"bg-[#02B0AF] text-white":"bg-[#EDF7F4]"}`}>ประวัติทั้งหมด</button>
          <button onClick={()=>setRefresh(v=>v+1)} className="ml-auto rounded-xl border border-[#D6E7E2] px-3 text-sm">↻</button>
        </div>
      </header>
      {error&&<p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {loading?<LotusLoading message="กำลังโหลดรายการตรวจสอบ..."/>:<>
        <section className="space-y-2">
          <h2 className="text-lg font-black">ข้อมูลลูกค้า ({changes.length})</h2>
          {changes.map(change=><article key={change.id} className="rounded-xl border border-[#D8E8E2] bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div><p className="font-black">{change.customerName} <span className="text-xs font-medium text-[#738B80]">{change.customerCode}</span></p>
                <p className="mt-1 text-xs text-[#69877B]">{change.salesmanName} ({change.salesmanCode}) · {when(change.created_at)}</p></div>
              <span className="rounded-lg bg-[#FFF3D6] px-2 py-1 text-xs font-bold text-[#865F00]">{change.status}</span>
            </div>
            <p className="mt-3 text-sm font-black">{FIELD[change.field_name]??change.field_name}</p>
            <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
              <div className="min-w-0 break-words rounded-lg bg-[#F2F5F4] p-3">
                <p className="mb-1 text-xs font-bold text-[#71877F]">ก่อนแก้ไข</p>{format(change.previous_value)}
              </div>
              <div className="min-w-0 break-words rounded-lg bg-[#E5F7F2] p-3">
                <p className="mb-1 text-xs font-bold text-[#00817B]">ใช้งานอยู่</p>{format(change.proposed_value)}
              </div>
            </div>
            {JSON.stringify(change.approved_baseline)!==JSON.stringify(change.previous_value)&&<p className="mt-2 rounded-lg bg-[#FFF4DB] p-2 text-xs leading-5 text-[#86640D]">
              หากปฏิเสธ ระบบจะคืนค่าที่อนุมัติครั้งล่าสุด: {format(change.approved_baseline)}
            </p>}
            {actionButtons("customer",change.id)}
          </article>)}
          {changes.length===0&&<p className="rounded-xl bg-white p-4 text-sm text-[#6B8178]">ไม่มีรายการข้อมูลลูกค้าที่รอตรวจสอบ</p>}
        </section>
        <section className="space-y-2">
          <h2 className="text-lg font-black">ราคาพิเศษ ({prices.length})</h2>
          {prices.map(price=><article key={price.id} className="rounded-xl border border-[#D8E8E2] bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div><p className="font-black">{price.customerName}</p>
                <p className="mt-1 text-sm">{price.productName} · SKU {price.productSku}</p>
                <p className="mt-1 text-xs text-[#69877B]">{price.salesmanName} · {when(price.created_at)}</p></div>
              <span className="rounded-lg bg-[#FFF3D6] px-2 py-1 text-xs font-bold text-[#865F00]">{price.status}</span>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <div className="rounded-lg bg-[#F2F5F4] p-3"><p className="text-xs">ราคาเดิม</p>
                <p className="mt-1 font-black">{price.old_price===null?"—":Number(price.old_price).toFixed(2)}</p></div>
              <div className="rounded-lg bg-[#FFF4D8] p-3"><p className="text-xs">ราคาที่เสนอ</p>
                <p className="mt-1 font-black">{Number(price.proposed_price).toFixed(2)}</p></div>
              <div className="rounded-lg bg-[#E7F7F3] p-3"><p className="text-xs">GP</p>
                <p className="mt-1 font-black">{price.gp_pct===null?"N/A":Number(price.gp_pct).toFixed(2)+"%"}</p></div>
            </div>
            <p className="mt-1 text-xs text-[#6C857C]">ราคา/หน่วย: {price.productUnit}</p>
            {actionButtons("price",price.id)}
          </article>)}
          {prices.length===0&&<p className="rounded-xl bg-white p-4 text-sm text-[#6B8178]">ไม่มีรายการราคาที่รออนุมัติ</p>}
        </section>
        <div className="flex justify-between gap-2">
          <button disabled={page===0} onClick={()=>setPage(p=>Math.max(0,p-1))}
            className="rounded-lg border border-[#D6E6DF] bg-white px-4 py-2 text-sm disabled:opacity-40">ก่อนหน้า</button>
          <p className="text-sm text-[#68877A]">หน้า {page+1}</p>
          <button disabled={!more} onClick={()=>setPage(p=>p+1)}
            className="rounded-lg border border-[#D6E6DF] bg-white px-4 py-2 text-sm disabled:opacity-40">ถัดไป</button>
        </div>
      </>}
    </div>
  </main>;
}
