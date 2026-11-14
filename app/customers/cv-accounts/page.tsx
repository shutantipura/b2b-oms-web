"use client";

import {useCallback,useEffect,useMemo,useState} from "react";
import Link from "next/link";
import {supabase} from "@/lib/supabase";

type CV={id:string;cv_number:string;status:string;legacy_import:boolean;
  shop_photos:string[];id_card_path:string|null;registration_photos:string[];
  created_at:string;updated_at:string};
type Request={id:string;action:"create"|"amend";cv_account_id:string|null;cv_number:string;
  shop_photos:string[];id_card_path:string|null;registration_photos:string[];status:string;
  created_by:string;created_at:string;reviewed_at:string|null};
type Docs={shopPhotos:string[];idCardPath:string;registrationPhotos:string[]};
const blank:Docs={shopPhotos:[],idCardPath:"",registrationPhotos:[]};
const field="w-full min-h-11 rounded-xl border border-[#CFE5DE] bg-white px-3 py-2 text-sm outline-none focus:border-[#02B0AF]";
async function api(path:string,method:"GET"|"POST"|"PATCH"="GET",body?:unknown){
  const {data:{session}}=await supabase.auth.getSession();
  if(!session?.access_token)throw new Error("กรุณาเข้าสู่ระบบพนักงานอีกครั้ง");
  const res=await fetch(path,{method,headers:{"Authorization":"Bearer "+session.access_token,
    ...(body?{"Content-Type":"application/json"}:{})},body:body?JSON.stringify(body):undefined,cache:"no-store"});
  const data=await res.json();if(!res.ok)throw new Error(data.error??"ดำเนินการไม่สำเร็จ");return data;
}
function PhotoSet({paths,urls}:{paths:string[];urls:Record<string,string|null>}){
  return <div className="mt-2 flex flex-wrap gap-2">{paths.map((p,i)=>
    urls[p]?<a key={p} href={urls[p]??"#"} target="_blank" rel="noopener noreferrer"
      className="block overflow-hidden rounded-xl border border-[#CDE7E1]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={urls[p]??""} alt={`เอกสาร ${i+1}`} className="h-20 w-20 object-cover"/>
    </a>:<span key={p} className="rounded-lg bg-[#F3F7F4] px-3 py-2 text-xs">รูป {i+1}</span>)}
    {!paths.length&&<span className="text-xs text-[#82988E]">ยังไม่มีรูป</span>}
  </div>;
}
export default function CVAccountsPage(){
  const [accounts,setAccounts]=useState<CV[]>([]),[requests,setRequests]=useState<Request[]>([]);
  const [signed,setSigned]=useState<Record<string,string|null>>({}),[isManager,setIsManager]=useState(false);
  const [search,setSearch]=useState(""),[mode,setMode]=useState<"create"|"amend">("create");
  const [cvNumber,setCVNumber]=useState(""),[selectedId,setSelectedId]=useState("");
  const [docs,setDocs]=useState<Docs>(blank),[busy,setBusy]=useState(false);
  const [message,setMessage]=useState(""),[showForm,setShowForm]=useState(false);
  const load=useCallback(async()=>{
    try{const data=await api("/api/customer-registry/cv-accounts");
      setAccounts(data.accounts??[]);setRequests(data.requests??[]);
      setSigned(data.photos??{});setIsManager(Boolean(data.isManager));}
    catch(e){setMessage(e instanceof Error?e.message:"ไม่สามารถโหลดบัญชี CV");}
  },[]);
  useEffect(()=>{void load();},[load]);
  const filtered=useMemo(()=>accounts.filter(a=>a.cv_number.includes(search.trim())),[accounts,search]);
  const pending=requests.filter(r=>r.status==="pending");
  async function upload(files:FileList|null,key:"shopPhotos"|"registrationPhotos"|"idCardPath"){
    if(!files?.length)return;
    const max=key==="shopPhotos"?3:key==="registrationPhotos"?2:1;
    const chosen=Array.from(files).slice(0,max);
    setBusy(true);setMessage("");
    try{
      const batch:{path:string;url:string|null}[]=[];
      for(const file of chosen){
        const {data:{session}}=await supabase.auth.getSession();
        if(!session?.access_token)throw new Error("เซสชันหมดอายุ");
        const form=new FormData();form.append("image",file);
        const response=await fetch("/api/customer-registry/cv-accounts/upload",
          {method:"POST",headers:{Authorization:"Bearer "+session.access_token},
            body:form,cache:"no-store"});
        const data=await response.json();
        if(!response.ok)throw new Error(data.error??"อัปโหลดรูปไม่สำเร็จ");
        batch.push({path:data.path,url:data.url??null});
      }
      setDocs(prev=>({...prev,[key]:key==="idCardPath"?batch[0].path:batch.map(x=>x.path)}));
      setSigned(prev=>({...prev,...Object.fromEntries(batch.map(x=>[x.path,x.url]))}));
      setMessage("บีบอัดและอัปโหลดแล้ว "+batch.length+" รูป");
    }catch(e){setMessage(e instanceof Error?e.message:"อัปโหลดไม่สำเร็จ");}
    finally{setBusy(false);}
  }
  async function submit(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault();setBusy(true);setMessage("");
    try{
      await api("/api/customer-registry/cv-accounts","POST",{
        action:mode,cvNumber,cvAccountId:mode==="amend"?selectedId:null,...docs,
      });
      setMessage("ส่งคำขอแล้ว · รอ Manager อนุมัติ ก่อนมีผล");
      setDocs(blank);setCVNumber("");setSelectedId("");setShowForm(false);await load();
    }catch(e){setMessage(e instanceof Error?e.message:"ส่งคำขอไม่สำเร็จ");}
    finally{setBusy(false);}
  }
  async function action(body:Record<string,unknown>){
    setBusy(true);setMessage("");
    try{await api("/api/customer-registry/cv-accounts","PATCH",body);
      setMessage("ดำเนินการสำเร็จ");await load();}
    catch(e){setMessage(e instanceof Error?e.message:"ดำเนินการไม่สำเร็จ");}
    finally{setBusy(false);}
  }
  const photoInput=(key:"shopPhotos"|"registrationPhotos"|"idCardPath",label:string,max:number,required=false)=>{
    const values=key==="idCardPath"?(docs.idCardPath?[docs.idCardPath]:[]):docs[key];
    return <div className="rounded-xl border border-[#D8EAE5] bg-[#FAFDFC] p-3">
      <label className="block text-sm font-bold">{label} {required&&<span className="text-[#CC8500]">*</span>}
        <input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" multiple={max>1}
          className="mt-2 block w-full text-xs" disabled={busy} onChange={e=>void upload(e.target.files,key)}/>
      </label>
      <p className="mt-1 text-xs text-[#7A9289]">สูงสุด {max} รูป · บีบอัดเป็น WebP · เก็บส่วนตัว</p>
      <PhotoSet paths={values} urls={signed}/>
    </div>;
  };
  return <main className="min-h-screen bg-[#F3F8F7] px-3 py-5 text-[#17453F] sm:px-6">
    <div className="mx-auto max-w-5xl space-y-4">
      <header className="rounded-2xl border border-[#CEE7DF] bg-white p-5">
        <Link href="/login" className="text-sm font-bold text-[#008F8D]">← กลับหน้าหลัก</Link>
        <p className="mt-4 text-xs font-bold tracking-wider text-[#008F8D]">LOTUS’S B2B · CUSTOMERS</p>
        <h1 className="mt-1 text-2xl font-black">บัญชี CV</h1>
        <p className="mt-2 text-sm text-[#718A80]">เลข CV 10 หลัก · Manager ต้องอนุมัติบัญชีใหม่และการแก้ไขรูปทุกครั้ง · Manager ระงับบัญชีได้</p>
      </header>
      <nav className="grid grid-cols-2 gap-2 rounded-xl bg-white p-1">
        <Link href="/customers/shops" className="rounded-lg px-3 py-3 text-center text-sm font-black text-[#008F8D]">ร้านค้า</Link>
        <Link href="/customers/cv-accounts" aria-current="page" className="rounded-lg bg-[#02B0AF] px-3 py-3 text-center text-sm font-black text-white">บัญชี CV</Link>
      </nav>
      {message&&<p role="status" className="rounded-xl border border-[#C5E7DB] bg-white p-3 text-sm">{message}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-bold">{accounts.length} บัญชี CV · คำขอรออนุมัติ {pending.length}</p>
        <button onClick={()=>{setShowForm(v=>!v);setDocs(blank);}} className="min-h-11 rounded-xl bg-[#02B0AF] px-4 font-black text-white">
          + สร้าง / แก้ไขบัญชี CV
        </button>
      </div>
      {showForm&&<form onSubmit={e=>void submit(e)} className="space-y-3 rounded-2xl border border-[#CEE7DF] bg-white p-5">
        <h2 className="font-black">ส่งคำขอ (ต้องรอ Manager อนุมัติ)</h2>
        <div className="grid grid-cols-2 gap-2">
          {(["create","amend"] as const).map(value=><button type="button" key={value}
            onClick={()=>{setMode(value);setDocs(blank);}}
            className={"min-h-11 rounded-xl text-sm font-black "+(mode===value?
              "bg-[#02B0AF] text-white":"bg-[#E8F8F5] text-[#008F8D]")}>
            {value==="create"?"สร้างบัญชี CV":"แก้ไขรูปบัญชีเดิม"}
          </button>)}
        </div>
        {mode==="create"?<label className="block text-sm font-bold">เลข CV 10 หลัก
          <input value={cvNumber} onChange={e=>setCVNumber(e.target.value.replace(/\D/g,"").slice(0,10))}
            required pattern="[0-9]{10}" inputMode="numeric" className={"mt-1 "+field} placeholder="0000000000"/>
        </label>:<label className="block text-sm font-bold">เลือกบัญชี CV ที่อนุมัติแล้ว
          <select required className={"mt-1 "+field} value={selectedId} onChange={e=>setSelectedId(e.target.value)}>
            <option value="">เลือกบัญชี CV</option>
            {accounts.filter(a=>a.status==="approved").map(a=><option key={a.id} value={a.id}>{a.cv_number}</option>)}
          </select>
          <p className="mt-2 text-xs font-medium text-[#718A80]">การแก้ไขรูปจะไม่แทนรูปที่ใช้อยู่จนกว่าจะผ่านอนุมัติ</p>
        </label>}
        {photoInput("shopPhotos","รูปร้านค้า",3,mode==="create")}
        {photoInput("idCardPath","บัตรประชาชน",1,mode==="create")}
        {photoInput("registrationPhotos","ใบสมัคร CV",2,mode==="create")}
        <button disabled={busy} className="min-h-12 w-full rounded-xl bg-[#02B0AF] px-5 font-black text-white disabled:opacity-50">
          {busy?"กำลังบันทึก...":"ส่งคำขออนุมัติ"}
        </button>
      </form>}
      {!!pending.length&&<section className="rounded-2xl border border-[#F1D68A] bg-[#FFFBED] p-4">
        <h2 className="font-black">รออนุมัติ ({pending.length})</h2>
        <div className="mt-3 space-y-3">{pending.map(r=><article key={r.id} className="rounded-xl border border-[#F3E0AF] bg-white p-3">
          <div className="flex flex-wrap justify-between gap-2"><div><p className="font-black">CV {r.cv_number}</p>
            <p className="text-xs text-[#6A8377]">{r.action==="create"?"เปิดบัญชีใหม่":"แก้ไขเอกสาร"} · {new Date(r.created_at).toLocaleString("th-TH")}</p></div>
            <span className="text-xs font-black text-[#AE7700]">รอ Manager อนุมัติ</span></div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
            <div>รูปร้าน<PhotoSet paths={r.shop_photos} urls={signed}/></div>
            <div>บัตรประชาชน<PhotoSet paths={r.id_card_path?[r.id_card_path]:[]} urls={signed}/></div>
            <div>ใบสมัคร<PhotoSet paths={r.registration_photos} urls={signed}/></div>
          </div>
          {isManager&&<div className="mt-3 flex gap-2">
            <button disabled={busy} onClick={()=>void action({operation:"approve",requestId:r.id})}
              className="min-h-11 flex-1 rounded-xl bg-[#02B0AF] font-black text-white">อนุมัติ</button>
            <button disabled={busy} onClick={()=>void action({operation:"reject",requestId:r.id})}
              className="min-h-11 flex-1 rounded-xl border border-[#E7B7A9] text-sm font-black text-[#B95137]">ไม่อนุมัติ</button>
          </div>}
        </article>)}</div>
      </section>}
      <input aria-label="ค้นหาบัญชี CV" placeholder="ค้นหาเลข CV 10 หลัก" value={search} onChange={e=>setSearch(e.target.value)} className={field}/>
      <section className="grid gap-3">
        {filtered.map(cv=><article key={cv.id} className="rounded-2xl border border-[#D4E7E1] bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-black">CV {cv.cv_number}</h3>
            <span className={"rounded-full px-3 py-1 text-xs font-black "+(cv.status==="approved"?
              "bg-[#E4F7F0] text-[#008F8D]":"bg-[#FFF0E6] text-[#A34722]")}>
              {cv.status==="approved"?"อนุมัติแล้ว":"ระงับบัญชี"}
            </span>
          </div>
          {cv.legacy_import&&<p className="mt-1 text-xs text-[#718B80]">นำเข้าจาก CV เดิม · เอกสารสามารถเพิ่มภายหลังโดยส่งคำขออนุมัติ</p>}
          <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
            <div>รูปร้าน<PhotoSet paths={cv.shop_photos} urls={signed}/></div>
            <div>บัตรประชาชน<PhotoSet paths={cv.id_card_path?[cv.id_card_path]:[]} urls={signed}/></div>
            <div>ใบสมัคร<PhotoSet paths={cv.registration_photos} urls={signed}/></div>
          </div>
          {isManager&&<button disabled={busy}
            onClick={()=>void action({operation:cv.status==="approved"?"deactivate":"reactivate",cvAccountId:cv.id})}
            className="mt-3 min-h-10 rounded-xl border border-[#DFB4A5] px-4 text-sm font-bold text-[#A44D39]">
            {cv.status==="approved"?"ระงับบัญชี CV":"เปิดใช้งานบัญชีอีกครั้ง"}
          </button>}
        </article>)}
        {!filtered.length&&<p className="py-12 text-center text-sm text-[#718A80]">ไม่พบบัญชี CV</p>}
      </section>
    </div>
  </main>;
}
