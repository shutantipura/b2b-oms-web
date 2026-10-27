"use client";
import {useCallback,useEffect,useState} from "react";
import Link from "next/link";
import {supabase} from "@/lib/supabase";

const TASKS=[
  {id:"confirmation",label:"เช็คสต็อก"},
  {id:"picking",label:"จัดสินค้า"},
  {id:"billing",label:"ออกบิล"},
  {id:"delivery",label:"จัดส่ง"},
  {id:"payment_verification",label:"ตรวจสอบการชำระเงิน"},
];
type Terminal={
 id:string;label:string;last_seen_at:string|null;last_success_at:string|null;
 monitor_active:boolean;pending_count:number;revoked_at:string|null;
 app_version:string|null;staff:{staff_name:string;staff_code:string;is_active:boolean}|null;
};
type PendingTerminal={id:string;label:string;expires_at:string;staffId:string;staffCode:string};
type ResponseBody={
 terminals?:Terminal[];pending?:PendingTerminal[];label?:string;pairingCode?:string;expiresAt?:string;
 staffCode?:string;success?:boolean;error?:string;
};
async function managerRequest(url:string,init:RequestInit={}) {
 const {data:{session}}=await supabase.auth.getSession();
 if(!session)throw new Error("กรุณาเข้าสู่ระบบ Manager ผ่าน OMS");
 return fetch(url,{...init,cache:"no-store",headers:{
  "Content-Type":"application/json",Authorization:`Bearer ${session.access_token}`,...init.headers,
 }});
}
export default function TerminalsPage() {
 const [terminals,setTerminals]=useState<Terminal[]>([]);
 const [pending,setPending]=useState<PendingTerminal[]>([]);
 const [name,setName]=useState("Android-001");
 const [stages,setStages]=useState<string[]>(TASKS.map(s=>s.id));
 const [code,setCode]=useState("");
 const [expires,setExpires]=useState("");
 const [createdName,setCreatedName]=useState("");
 const [busy,setBusy]=useState(false);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState("");
 const refresh=useCallback(async()=>{
  try {
   const response=await managerRequest("/api/admin/terminals");
   const data=await response.json() as ResponseBody;
   if(!response.ok)throw new Error(data.error||"Cannot load terminals");
   setTerminals(data.terminals??[]);
   setPending(data.pending??[]);
   setError("");
  }catch(e){setError(e instanceof Error?e.message:"Unable to load terminals");}
  finally{setLoading(false);}
 },[]);
 useEffect(()=>{void refresh();const id=window.setInterval(()=>void refresh(),20000);
  return ()=>clearInterval(id)},[refresh]);

 async function create() {
  if(busy)return;
  if(!/^Android-[0-9]{3,5}$/i.test(name.trim())) {
    setError("กรุณาใช้ชื่อ เช่น Android-001");return;
  }
  if(!window.confirm(`สร้างบัญชี OMS Staff ชื่อ ${name.trim()} พร้อมสิทธิ์งานที่เลือก และรหัสจับคู่ใช้ครั้งเดียว?`))return;
  setBusy(true);setError("");setCode("");
  try{
   const r=await managerRequest("/api/admin/terminals",{method:"POST",
    body:JSON.stringify({name:name.trim(),taskPermissions:stages})});
   const data=await r.json() as ResponseBody;
   if(!r.ok||!data.pairingCode)throw new Error(data.error??"Cannot create terminal");
   setCode(data.pairingCode);setExpires(data.expiresAt??"");
   setCreatedName(data.label??name);
   await refresh();
  }catch(e){setError(e instanceof Error?e.message:"Could not create terminal");}
  finally{setBusy(false);}
 }
 async function reissue(item:PendingTerminal){
  if(busy)return;
  setBusy(true);setError("");setCode("");
  try{
   const response=await managerRequest("/api/admin/terminals",{method:"POST",
    body:JSON.stringify({reissueStaffId:item.staffId})});
   const data=await response.json() as ResponseBody;
   if(!response.ok||!data.pairingCode)throw new Error(data.error??"Cannot generate another code");
   setCode(data.pairingCode);setExpires(data.expiresAt??"");
   setCreatedName(data.label??item.label);
   await refresh();
  }catch(e){setError(e instanceof Error?e.message:"Cannot reissue enrollment code");}
  finally{setBusy(false);}
 }
 async function revoke(item:Terminal){
  if(!window.confirm(`ยกเลิก Android terminal ${item.label}?\n\nการทำเช่นนี้จะยกเลิก Alarm Pairing และปิดบัญชี OMS ของเครื่องนี้`))return;
  setBusy(true);setError("");
  try{
   const r=await managerRequest("/api/admin/terminals",{method:"DELETE",
    body:JSON.stringify({stationId:item.id})});
   const body=await r.json() as ResponseBody;
   if(!r.ok||!body.success)throw new Error(body.error||"Unable to revoke");
   await refresh();
  }catch(e){setError(e instanceof Error?e.message:"Unable to revoke");}
  finally{setBusy(false);}
 }
 function health(t:Terminal){
   if(t.revoked_at)return "ยกเลิกการใช้งาน";
   if(!t.last_seen_at)return "ลงทะเบียนแล้ว · รอสัญญาณ";
   if(Date.now()-Date.parse(t.last_seen_at)>90000)return "ไม่ออนไลน์";
   if(!t.monitor_active)return "ออนไลน์ · ปิดการตรวจสอบ";
   if(!t.last_success_at||Date.now()-Date.parse(t.last_success_at)>120000)
     return "ออนไลน์ · ตรวจ OMS ไม่สำเร็จ";
   return "ออนไลน์ · ตรวจ OMS สำเร็จ";
 }
 return (
  <main className="min-h-screen bg-[#F3F9F6] px-4 py-6 pb-28 text-[#194A43] sm:px-8">
   <div className="mx-auto max-w-3xl space-y-5">
    <Link href="/login" className="inline-block rounded-xl border bg-white px-4 py-2 font-semibold text-[#008E89]">
     ← หน้าหลัก Manager
    </Link>
    <section className="rounded-3xl border border-[#CDE5DE] bg-white p-5 sm:p-7">
     <p className="text-xs font-extrabold tracking-wider text-[#008E89]">LOTUS'S B2B / DEVICE MANAGEMENT</p>
     <h1 className="mt-2 text-2xl font-black">Android Terminals</h1>
     <p className="mt-2 text-sm leading-6 text-[#607E75]">
      หนึ่งเครื่อง = หนึ่งบัญชี OMS Staff + หนึ่ง Alarm Station โดยสร้างรหัสติดตั้งครั้งเดียว
      เมื่อติดตั้งแล้วเครื่องจะรับออเดอร์และเปิด OMS ด้วยบัญชีของเครื่องโดยอัตโนมัติ
     </p>
     <p className="mt-3 rounded-xl bg-[#FFF8E5] p-3 text-xs leading-5 text-[#785F24]">
      กรุณาสร้างรหัสเมื่อมีเครื่อง Android อยู่ด้วย เพราะรหัสหมดอายุใน 15 นาที
      หลังจับคู่แล้วไม่ต้องเข้าสู่ระบบ Staff ด้วยรหัสผ่านทุกครั้ง
     </p>
    </section>
    <section className="space-y-4 rounded-3xl border border-[#CDE5DE] bg-white p-5 sm:p-7">
     <h2 className="text-lg font-black">เพิ่ม Android Terminal</h2>
     <div>
      <label htmlFor="terminal-name" className="mb-1 block text-sm font-bold">ชื่อเครื่อง</label>
      <input id="terminal-name" value={name} onChange={e=>setName(e.target.value)}
       placeholder="Android-001" maxLength={18}
       className="h-12 w-full rounded-xl border border-[#C8E4DA] px-3 text-base"/>
     </div>
     <fieldset className="space-y-2">
      <legend className="mb-2 text-sm font-bold">สิทธิ์งานที่ต้องการให้เครื่องทำได้</legend>
      {TASKS.map(task=><label key={task.id}
       className="flex min-h-11 items-center gap-3 rounded-xl border border-[#E0ECE8] px-3 py-2">
        <input type="checkbox" checked={stages.includes(task.id)}
         onChange={e=>setStages(prev=>e.target.checked?[...prev,task.id]:prev.filter(x=>x!==task.id))}
         className="h-5 w-5 accent-[#02B0AF]"/>
        <span className="text-sm font-semibold">{task.label}</span>
       </label>)}
     </fieldset>
     <p className="text-xs leading-5 text-[#71877F]">เครื่องใช้บัญชี Staff ไม่ใช่ Manager; สิทธิ์งานแก้ไขภายหลังได้ในหน้า พนักงาน</p>
     <button type="button" disabled={busy} onClick={()=>void create()}
      className="min-h-12 w-full rounded-xl bg-[#02B0AF] px-5 py-3 font-black text-white disabled:opacity-40">
      {busy?"กำลังสร้างบัญชี...":"สร้างบัญชีและรหัสจับคู่เครื่อง"}
     </button>
     {code&&<div className="rounded-2xl border border-[#81CDC0] bg-[#E8F8F4] p-4">
       <p className="font-bold">รหัสสำหรับ {createdName} (ใช้ครั้งเดียว)</p>
       <p className="my-2 break-all font-mono text-lg font-extrabold tracking-wide text-[#006F6B]">{code}</p>
       <button onClick={()=>void navigator.clipboard?.writeText(code)}
        className="rounded-lg border border-[#6CB8AF] bg-white px-3 py-2 text-sm font-bold">คัดลอกรหัส</button>
       <p className="mt-2 text-xs">หมดอายุ: {expires?new Date(expires).toLocaleString("th-TH",{timeZone:"Asia/Bangkok"}):"—"}</p>
       <p className="mt-2 text-xs leading-5">เปิดแอป Android → จับคู่เครื่อง → วางรหัสนี้ แล้วใช้ Staff Mode ได้โดยไม่ต้องพิมพ์ username/password</p>
      </div>}
    </section>
    {error&&<p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-bold text-red-700">{error}</p>}
    <section className="space-y-3">
     <div className="flex items-center justify-between">
      <h2 className="text-lg font-black">Android Terminals</h2>
      <button onClick={()=>void refresh()} className="rounded-xl bg-white px-3 py-2 text-sm font-semibold text-[#008E89]">↻ รีเฟรช</button>
     </div>
     {loading&&<p className="text-sm">กำลังโหลด...</p>}
     {!loading&&!terminals.length&&!pending.length&&<p className="rounded-xl border bg-white p-4 text-sm text-[#668479]">
      ยังไม่มี Terminal ที่จับคู่สำเร็จ · สร้าง Terminal ใหม่เมื่อได้รับ Android Device
     </p>}
     {pending.map(p=><article key={p.staffId}
        className="rounded-2xl border border-[#EADAAE] bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
         <h3 className="text-base font-bold">{p.label} · {p.staffCode}</h3>
         <span className="rounded-full bg-[#FFF4D9] px-3 py-1 text-xs font-bold text-[#866000]">
          รอจับคู่ Android
         </span>
        </div>
        <p className="mt-2 text-xs text-[#6A8279]">
         รหัสล่าสุดหมดอายุ: {new Date(p.expires_at).toLocaleString("th-TH",{timeZone:"Asia/Bangkok"})}
        </p>
        <button type="button" disabled={busy} onClick={()=>void reissue(p)}
         className="mt-3 rounded-xl border border-[#A3DCD2] px-3 py-2 text-sm font-bold text-[#008E87] disabled:opacity-50">
          สร้างรหัสจับคู่ใหม่สำหรับบัญชีนี้
        </button>
       </article>)}
     {terminals.map(t=><article key={t.id} className="rounded-2xl border border-[#CDE5DE] bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
       <h3 className="text-lg font-bold">{t.label}</h3>
       <span className={`rounded-full px-3 py-1 text-xs font-bold ${!t.revoked_at&&t.last_seen_at&&Date.now()-Date.parse(t.last_seen_at)<90000&&t.monitor_active?"bg-[#DEF8EC] text-[#167953]":"bg-[#FFF2D9] text-[#916000]"}`}>{health(t)}</span>
      </div>
      <p className="mt-2 text-sm text-[#6A8279]">
       Staff: {t.staff?.staff_code??"—"} · {t.staff?.staff_name??"—"} · v{t.app_version??"—"}
      </p>
      <p className="mt-1 text-xs text-[#6A8279]">
       ล่าสุด: {t.last_seen_at?new Date(t.last_seen_at).toLocaleString("th-TH",{timeZone:"Asia/Bangkok"}):"ยังไม่มีสัญญาณ"}
       {" · "}ออเดอร์ยังไม่ได้รับทราบ: {t.pending_count}
      </p>
      {!t.revoked_at&&<button disabled={busy} onClick={()=>void revoke(t)}
       className="mt-3 rounded-xl border border-red-200 px-3 py-2 text-sm font-bold text-red-700 disabled:opacity-40">
       ยกเลิกเครื่องและปิดบัญชี OMS
      </button>}
     </article>)}
    </section>
   </div>
  </main>
 );
}
