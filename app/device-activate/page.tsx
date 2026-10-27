"use client";
import {useEffect,useState} from "react";
import {supabase} from "@/lib/supabase";
import LotusBrand from "@/components/LotusBrand";

declare global {
 interface Window { __terminalAuthTokenHash?:string; }
}
export default function DeviceActivationPage(){
 const [message,setMessage]=useState("กำลังเชื่อมต่อบัญชี OMS ของเครื่อง...");
 const [failed,setFailed]=useState(false);
 useEffect(()=>{
  let alive=true,started=false;
  const complete=async()=>{
   if(started||!alive)return;
   const hash=window.__terminalAuthTokenHash;
   if(!hash||!/^[a-zA-Z0-9_-]{30,500}$/.test(hash))return;
   started=true;
   delete window.__terminalAuthTokenHash;
   try{
    // Native code sets this one-time hash only inside the trusted HTTPS WebView.
    const {data,error}=await supabase.auth.verifyOtp({token_hash:hash,type:"magiclink"});
    if(error||!data.user)throw new Error("ไม่สามารถเปิดบัญชี OMS ของเครื่องได้");
    const {data:staff,error:staffErr}=await supabase.from("staff")
      .select("id,staff_name,account_type")
      .eq("auth_user_id",data.user.id).eq("is_active",true).maybeSingle();
    if(staffErr||!staff||staff.account_type!=="staff"){
      await supabase.auth.signOut();
      throw new Error("บัญชี Android Terminal ถูกปิดใช้งานหรือไม่มีสิทธิ์");
    }
    if(alive){setMessage("เข้าสู่ระบบ "+staff.staff_name+" สำเร็จ");window.location.replace("/login");}
   }catch(e){
    if(alive){setMessage(e instanceof Error?e.message:"เข้าสู่ระบบไม่สำเร็จ");setFailed(true);}
   }
  };
  window.addEventListener("terminal-auth-token",complete);
  void complete();
  const timeout=window.setTimeout(()=>{
   if(!started&&alive){setMessage("ไม่ได้รับข้อมูลการเข้าใช้งานจาก Android กรุณากลับไปหน้า Alarm");setFailed(true);}
  },12000);
  return ()=>{alive=false;window.removeEventListener("terminal-auth-token",complete);window.clearTimeout(timeout);};
 },[]);
 return (
  <main className="flex min-h-screen items-center justify-center bg-[#F2F9F6] p-5">
   <div className="w-full max-w-md rounded-3xl border border-[#CDE5DC] bg-white p-6 text-center shadow-sm">
    <LotusBrand size="md"/>
    <p className="mt-7 font-black text-[#11584D]">Android Terminal · Staff Mode</p>
    <p role="status" className="mt-4 text-sm leading-6 text-[#678078]">{message}</p>
    {failed&&<p className="mt-5 rounded-xl bg-[#FFF6E2] p-3 text-sm text-[#906016]">
      โปรดกลับหน้า Alarm และตรวจสอบการจับคู่เครื่องกับ Manager
    </p>}
   </div>
  </main>
 );
}
