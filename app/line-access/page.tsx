"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import LotusLoading from "@/components/LotusLoading";

type Role = "manager" | "salesman" | "staff" | "customer";
type LineAccount = {
  id: string;
  lineId: string;
  displayName: string | null;
  name: string | null;
  role: Role | null;
  active: boolean;
  createdAt: string;
  staffCode: string | null;
  stages: string[];
  customerCodes: string[];
};
type CustomerOption = { code: string; name: string };
type Draft = { name: string; role: Role | ""; stages: string[]; customerCodes: string[] };

const TASKS = [
  { id: "confirmation", name: "เช็คสต็อก" },
  { id: "picking", name: "Picking" },
  { id: "billing", name: "Billing" },
  { id: "delivery", name: "Delivery" },
  { id: "payment_verification", name: "Payment" },
];
const ROLES: Array<{id:Role; label:string; detail:string}> = [
  { id:"manager",label:"Manager",detail:"จัดการระบบและเข้าถึงลูกค้าทุกคน" },
  { id:"salesman",label:"Salesman",detail:"ดูแลลูกค้าและราคา เข้าถึงลูกค้าทุกคน" },
  { id:"staff",label:"Staff",detail:"ทำงานปฏิบัติการตามที่เลือก" },
  { id:"customer",label:"Customer",detail:"เข้าถึงเฉพาะร้านที่ผู้จัดการอนุญาต" },
];
function draftFor(user:LineAccount):Draft {
  return { name:user.name??user.displayName??"",role:user.role??"",
    stages:user.stages??[],customerCodes:user.customerCodes??[] };
}
function roleName(value:Role|null){return ROLES.find(r=>r.id===value)?.label??"รออนุมัติ";}
function displayCode(code:string){return /^NCV-/i.test(code)?"ไม่มี CV":code;}

export default function LineAccessPage(){
  const [users,setUsers]=useState<LineAccount[]>([]);
  const [customers,setCustomers]=useState<CustomerOption[]>([]);
  const [drafts,setDrafts]=useState<Record<string,Draft>>({});
  const [expanded,setExpanded]=useState<Record<string,boolean>>({});
  const [customerSearch,setCustomerSearch]=useState<Record<string,string>>({});
  const [search,setSearch]=useState("");
  const [filter,setFilter]=useState<"active"|"pending"|"all">("active");
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState("");
  const [message,setMessage]=useState("");

  async function reload(){
    setLoading(true);setMessage("");
    const {data,error}=await supabase.rpc("get_line_roles_admin");
    if(error){setMessage("ไม่สามารถโหลดสิทธิ์ LINE: "+error.message);setLoading(false);return;}
    const parsed=(data??{}) as {users?:LineAccount[];customers?:CustomerOption[]};
    const next=parsed.users??[];
    setUsers(next);setCustomers(parsed.customers??[]);
    setDrafts(Object.fromEntries(next.map(user=>[user.id,draftFor(user)])));
    setLoading(false);
  }
  useEffect(()=>{const timeout=window.setTimeout(()=>void reload(),0);
    return()=>window.clearTimeout(timeout);},[]);

  function update(id:string,patch:Partial<Draft>){
    setDrafts(prev=>({...prev,[id]:{...prev[id],...patch}}));
  }
  function toggle(id:string,key:"stages"|"customerCodes",value:string,checked:boolean){
    const draft=drafts[id];if(!draft)return;
    const current=draft[key]??[];
    update(id,{[key]:checked?[...new Set([...current,value])]:current.filter(x=>x!==value)});
  }
  const visible=useMemo(()=>{
    const q=search.trim().toLocaleLowerCase();
    return users.filter(u=>{
      if(filter==="active"&&!u.active)return false;
      if(filter==="pending"&&(!u.active||u.role!==null))return false;
      return !q||[u.name??"",u.displayName??"",u.lineId,u.staffCode??"",roleName(u.role)]
        .some(v=>v.toLocaleLowerCase().includes(q));
    });
  },[users,search,filter]);

  async function save(user:LineAccount,clear=false){
    const draft=drafts[user.id];
    if(!draft)return;
    const role=clear?null:draft.role||null;
    const name=draft.name.trim();
    if(!name){setMessage("กรุณากรอกชื่อบัญชีก่อน");return;}
    if(!clear&&!role){setMessage("กรุณาเลือกประเภทบัญชี");return;}
    if(clear&&!window.confirm(`ยกเลิกสิทธิ์ทั้งหมดของ ${name} ใช่หรือไม่? ประวัติการทำงานจะยังอยู่`))return;
    if(user.role==="manager"&&role!=="manager"&&!window.confirm("ยกเลิกสิทธิ์ Manager ของบัญชีนี้ใช่หรือไม่?"))return;
    if(role==="manager"&&user.role!=="manager"&&!window.confirm(`ให้สิทธิ์ Manager แก่ ${name} ใช่หรือไม่? บัญชีนี้จะสามารถจัดการระบบและอนุมัติ Manager คนอื่นได้`))return;
    setBusy(user.id);setMessage("");
    try{
      const {data,error}=await supabase.rpc("set_line_account_role",{
        p_line_user_row_id:user.id,
        p_name:name,
        p_role:role,
        p_stages:role==="staff"?draft.stages:[],
        p_customer_codes:role==="customer"?draft.customerCodes:[],
      });
      if(error)throw error;
      const result=data as {staffCode?:string|null}|null;
      setMessage(`บันทึกสำเร็จ: ${name} · ${roleName(role)}${result?.staffCode?" · "+result.staffCode:""}`);
      // Reload account changes without closing the current editor.
      const {data:nextData,error:nextError}=await supabase.rpc("get_line_roles_admin");
      if(nextError)throw nextError;
      const parsed=(nextData??{}) as {users?:LineAccount[];customers?:CustomerOption[]};
      setUsers(parsed.users??[]);
      setCustomers(parsed.customers??[]);
      setDrafts(prev=>{
        const next={...prev};
        for(const u of parsed.users??[])next[u.id]=draftFor(u);
        return next;
      });
    }catch(e){setMessage(e instanceof Error?e.message:"บันทึกสิทธิ์ไม่สำเร็จ");}
    finally{setBusy("");}
  }
  async function setLineActive(user:LineAccount,active:boolean){
    if(busy)return;
    if(!active&&user.role){
      setMessage("กรุณายกเลิกบทบาทและสิทธิ์ก่อนนำบัญชี LINE ออกจากรายการ");
      return;
    }
    const action=active?"เปิดใช้งาน":"ปิดใช้งาน";
    if(!window.confirm(`${action}บัญชี ${user.name||user.displayName||"LINE"} หรือไม่?`))return;
    setBusy(user.id);setMessage("");
    try{
      const {error}=await supabase.rpc("set_line_user_active_status",{
        p_line_user_row_id:user.id,p_active:active,
      });
      if(error)throw error;
      setUsers(previous=>previous.map(item=>item.id===user.id?{...item,active}:item));
      setMessage(`${action} LINE สำเร็จ · ประวัติการใช้งานยังคงอยู่`);
    }catch(e){setMessage(e instanceof Error?e.message:"ไม่สามารถเปลี่ยนสถานะ LINE");}
    finally{setBusy("");}
  }
  if(loading)return <LotusLoading message="กำลังโหลดบัญชี LINE และสิทธิ์การใช้งาน..."/>;
  return <main className="min-h-screen bg-[#F3F8F7] px-3 pb-24 pt-5 text-[#184D43] sm:px-6">
    <div className="mx-auto max-w-5xl space-y-4">
      <header className="rounded-[22px] border border-[#CBE5DC] bg-gradient-to-br from-[#E0F8F3] to-white p-5">
        <Link href="/login" className="text-sm font-bold text-[#008E88]">← กลับหน้าหลัก</Link>
        <p className="mt-3 text-xs font-black tracking-wide text-[#008E88]">LOTUS’S B2B · ADMIN</p>
        <h1 className="mt-1 text-2xl font-black">สิทธิ์บัญชี LINE</h1>
        <p className="mt-2 text-sm leading-6 text-[#627D73]">
          บัญชี LINE หนึ่งบัญชีเลือกได้เพียงหนึ่งประเภท · ระบบจะสร้างรหัสพนักงานและเชื่อม LINE อัตโนมัติ
        </p>
        <div className="mt-4 grid grid-cols-3 gap-2">
          <div className="rounded-xl bg-white/85 p-3 text-center">
            <p className="text-xs text-[#69847A]">บัญชี LINE</p>
            <p className="text-xl font-black">{users.length}</p>
          </div>
          <div className="rounded-xl bg-white/85 p-3 text-center">
            <p className="text-xs text-[#69847A]">อนุมัติแล้ว</p>
            <p className="text-xl font-black">{users.filter(u=>u.active&&u.role).length}</p>
          </div>
          <div className="rounded-xl bg-white/85 p-3 text-center">
            <p className="text-xs text-[#69847A]">รออนุมัติ</p>
            <p className="text-xl font-black">{users.filter(u=>u.active&&!u.role).length}</p>
          </div>
        </div>
      </header>

      {message&&<div role="status" className="rounded-xl border border-[#CFE6DE] bg-white p-3 text-sm">{message}</div>}
      <div className="flex flex-wrap gap-2">
        <input type="search" value={search} onChange={e=>setSearch(e.target.value)}
          placeholder="ค้นหาชื่อ LINE / ชื่อที่ตั้ง / รหัสพนักงาน"
          className="min-h-11 min-w-0 flex-1 rounded-xl border border-[#CFDED8] bg-white px-3 text-sm" />
        <button onClick={()=>void reload()} className="rounded-xl border border-[#CCE3DB] bg-white px-4 text-sm font-bold">รีเฟรช</button>
      </div>
      <div className="flex gap-2">
        {(["active","pending","all"] as const).map(v=><button key={v} onClick={()=>setFilter(v)}
          className={`rounded-xl px-4 py-2 text-sm font-bold ${filter===v?"bg-[#008D8C] text-white":"border border-[#D6E8E0] bg-white"}`}>
          {v==="active"?"ใช้งานอยู่":v==="pending"?"รออนุมัติ":"ทั้งหมด"}
        </button>)}
      </div>

      <section className="space-y-2.5">
      {visible.map(user=>{
        const draft=drafts[user.id]??draftFor(user);
        const isOpen=Boolean(expanded[user.id]);
        const isBusy=busy!=="";
        const q=(customerSearch[user.id]??"").trim().toLowerCase();
        const choices=customers.filter(c=>!q||[c.name,c.code,displayCode(c.code)].some(x=>x.toLowerCase().includes(q)));
        const selectedRole=draft.role;
        return <article key={user.id} className="overflow-hidden rounded-2xl border border-[#D6E8E0] bg-white shadow-sm">
          <button type="button" aria-expanded={isOpen} onClick={()=>setExpanded(prev=>({...prev,[user.id]:!prev[user.id]}))}
            className="flex w-full items-center justify-between gap-3 p-4 text-left">
            <span className="min-w-0 flex-1">
              <span className="block truncate font-black">{user.name||user.displayName||"LINE Account"}</span>
              <span className="mt-1 block truncate text-xs text-[#71877D]">
                {user.displayName||"LINE"} · {user.staffCode??"ไม่มีรหัสพนักงาน"}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-2">
              <span className={`rounded-lg px-2 py-1 text-[11px] font-bold ${!user.active?"bg-[#E7E7E7] text-gray-500":user.role?"bg-[#E0F7F2] text-[#008C81]":"bg-[#FFF1C6] text-[#8A6400]"}`}>
                {user.active?roleName(user.role):"ปิดใช้งาน"}
              </span>
              <span className="text-sm text-[#6F877E]">{isOpen?"▲":"▼"}</span>
            </span>
          </button>
          {isOpen&&<div className="space-y-4 border-t border-[#EDF4EF] p-4">
            <div>
              <label className="mb-1 block text-sm font-bold">ชื่อภายใน OMS</label>
              <input value={draft.name} onChange={e=>update(user.id,{name:e.target.value})}
                disabled={!user.active||isBusy} placeholder="เช่น สมชาย ใจดี"
                className="min-h-11 w-full rounded-xl border border-[#D3E7DE] px-3 text-base disabled:bg-gray-100" />
              <p className="mt-1 text-xs text-[#779085]">ไม่เปลี่ยนชื่อบัญชี LINE จริง</p>
            </div>
            <div>
              <p className="mb-2 text-sm font-black">ประเภทบัญชี (เลือกได้หนึ่งประเภท)</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {ROLES.map(role=><label key={role.id} className={`flex items-start gap-2 rounded-xl border p-3 ${selectedRole===role.id?"border-[#02B0AF] bg-[#EAF8F3]":"border-[#E0ECE6]"}`}>
                  <input type="radio" name={`role-${user.id}`} value={role.id} checked={selectedRole===role.id}
                    disabled={!user.active||isBusy}
                    onChange={()=>update(user.id,{role:role.id})}
                    className="mt-1 accent-[#008D8B]" />
                  <span><span className="block text-sm font-black">{role.label}</span>
                    <span className="mt-1 block text-xs leading-5 text-[#6E877C]">{role.detail}</span></span>
                </label>)}
              </div>
            </div>

            {selectedRole==="staff"&&<section className="rounded-xl border border-[#D7EAE2] bg-[#F8FCFA] p-3">
              <p className="font-black">งานที่พนักงานได้รับอนุญาต</p>
              <p className="mb-3 text-xs text-[#6E887C]">เลือกได้เฉพาะขั้นตอนที่ต้องทำจริง</p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {TASKS.map(task=><label key={task.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={draft.stages.includes(task.id)}
                    disabled={!user.active||isBusy}
                    onChange={e=>toggle(user.id,"stages",task.id,e.target.checked)}
                    className="accent-[#008D8B]"/>{task.name}
                </label>)}
              </div>
            </section>}

            {selectedRole==="customer"&&<section className="rounded-xl border border-[#D7EAE2] bg-[#F8FCFA] p-3">
              <p className="font-black">สิทธิ์ลูกค้า ({draft.customerCodes.length} ร้าน)</p>
              <p className="mt-1 text-xs leading-5 text-[#718A7D]">เลือกเฉพาะร้านที่ LINE บัญชีนี้สามารถสั่งสินค้าได้</p>
              <input type="search" placeholder="ค้นหาร้านหรือเลข CV" value={customerSearch[user.id]??""}
                onChange={e=>setCustomerSearch(prev=>({...prev,[user.id]:e.target.value}))}
                className="mt-3 min-h-11 w-full rounded-xl border border-[#D5E5DE] bg-white px-3 text-sm"/>
              <div className="mt-2 max-h-52 space-y-1 overflow-y-auto rounded-xl border border-[#E2EDE7] bg-white p-2">
                {choices.map(customer=><label key={customer.code}
                  className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-[#F1F8F4]">
                  <input type="checkbox" checked={draft.customerCodes.includes(customer.code)}
                    disabled={!user.active||isBusy}
                    onChange={e=>toggle(user.id,"customerCodes",customer.code,e.target.checked)}
                    className="accent-[#008D8B]"/>
                  <span className="min-w-0"><span className="block truncate font-semibold">{customer.name}</span>
                    <span className="block text-[11px] text-[#7C9087]">{displayCode(customer.code)}</span></span>
                </label>)}
                {choices.length===0&&<p className="p-3 text-sm text-[#7F968B]">ไม่พบลูกค้า</p>}
              </div>
            </section>}

            {(selectedRole==="manager"||selectedRole==="salesman")&&
              <div className="rounded-xl border border-[#CBE9E0] bg-[#EBFAF5] p-3 text-sm font-semibold text-[#007C76]">
                ✓ เข้าถึงลูกค้าทุกรายโดยอัตโนมัติ · ไม่ต้องติ๊กสิทธิ์รายร้าน
              </div>}
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <button onClick={()=>void save(user)} disabled={!user.active||isBusy}
                className="min-h-12 rounded-xl bg-[#008F8D] px-4 font-black text-white disabled:opacity-50">
                {busy===user.id?"กำลังบันทึก...":"บันทึกชื่อ บทบาท และสิทธิ์"}
              </button>
              {user.role&&<button onClick={()=>void save(user,true)} disabled={!user.active||isBusy}
                className="min-h-12 rounded-xl border border-[#E5B2B2] bg-white px-3 text-sm font-bold text-[#AF5353] disabled:opacity-50">
                ยกเลิกสิทธิ์
              </button>}
            </div>
            <div className="flex justify-end">
              <button type="button" onClick={()=>void setLineActive(user,!user.active)}
                disabled={isBusy||Boolean(user.active&&user.role)}
                className="rounded-lg border border-[#E3D1CC] px-3 py-2 text-xs font-bold text-[#806458] disabled:opacity-40">
                {user.active?"ปิดใช้งานบัญชี LINE":"เปิดใช้งานบัญชี LINE"}
              </button>
            </div>
            <p className="text-xs text-[#6A8378]">
              {user.staffCode? `รหัสพนักงาน: ${user.staffCode} · `:""}
              เปลี่ยนบทบาทแล้วสิทธิ์เดิมจะถูกเพิกถอน · เก็บประวัติการทำงานไว้
              {user.active&&user.role?" · หากต้องการปิดบัญชี ให้ยกเลิกสิทธิ์ก่อน":""}
            </p>
          </div>}
        </article>;
      })}
      {visible.length===0&&<div className="rounded-xl bg-white p-8 text-center text-sm text-[#6B847A]">ไม่พบบัญชี LINE</div>}
      </section>
      <footer className="text-center text-xs text-[#6B857A]">
        ข้อมูลร้านค้าและที่อยู่จัดการแยกที่ <Link href="/customers" className="font-bold underline">เมนูลูกค้า</Link>
      </footer>
    </div>
  </main>;
}
