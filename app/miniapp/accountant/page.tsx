"use client";

import {useEffect,useMemo,useState} from "react";
import Link from "next/link";
import LotusBrand from "@/components/LotusBrand";
import LotusLoading from "@/components/LotusLoading";
import {lineApiFetch} from "@/lib/lineSession";

type Item={id:string;orderId:string;productId:string;sku:string;name:string;unit:string;quantity:number|null;
 sellingPricePerUnit:number;productSales:number|null;billedCostPerUnit:number|null;assignedCostPerUnit:number|null;
 currentCostPerUnit:number|null;effectiveCostPerUnit:number|null;totalCost:number|null;missingHistorical:boolean};
type Order={id:string;rootId:string;orderNumber:number;customerId:string;customerName:string;customerCode:string;
 status:string;isRoot:boolean;createdAt:string;completedAt:string;billingAt:string|null;finalAmount:number|null;
 deliveryDate:string;deliverySlot:string;counted:boolean;billedProductSales:number;netBillAdjustment:number|null;
 recordedCost:number;missingCostLines:number;costsComplete:boolean;grossProfit:number|null;gpPercent:number|null;otherBillDifference:number|null;lines:Item[]};
type Audit={id:number;batchId:string;orderItemId:string;newCost:number;quantity:number|null;reason:string;
 createdAt:string;accountantName:string;sku:string;productName:string};
type Report={orders:Order[];lines:Item[];audit:Audit[];asOf:string;todayBangkok:string;
 role:"manager"|"accountant";accountantName:string};
type Price={customer_id:string;product_id:string;agreed_price:number;customerName:string;customerCode:string};
type Product={id:string;sku:string;product_name:string;unit:string;normal_price:number;masterCost:number|null};
type Photo={id:string;fileType:string;createdAt:string;url:string|null};
type Tab="orders"|"finance"|"reports"|"costs";
const cash=(v:number|null|undefined)=>v===null||v===undefined?"N/A":
 "฿"+Number(v).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
const timestamp=(v:string|null|undefined)=>!v?"—":new Date(v).toLocaleString("en-GB",{timeZone:"Asia/Bangkok",dateStyle:"short",timeStyle:"short"});
function bangkokDate(v:string|null|undefined){
 if(!v)return "";
 const parts=new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Bangkok",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(v));
 const x=(s:string)=>parts.find(p=>p.type===s)?.value??"";
 return x("year")+"-"+x("month")+"-"+x("day");
}
const statusText=(s:string)=>({
 completed:"Completed",cancelled:"Cancelled",awaiting_payment:"Awaiting payment",
 payment_submitted:"Payment submitted",awaiting_billing:"Awaiting billing",awaiting_picking:"Picking queue",
 picking:"Picking",awaiting_confirmation:"Stock check",ready_for_delivery:"Delivery ready",
 out_for_delivery:"In delivery"
} as Record<string,string>)[s]??s;
const field="min-h-11 w-full rounded-xl border border-[#D9E9E1] bg-white px-3 py-2 text-sm";

export default function AccountantPage(){
 const [token,setToken]=useState("");
 const [report,setReport]=useState<Report|null>(null);
 const [loading,setLoading]=useState(true);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const [message,setMessage]=useState("");
 const [tab,setTab]=useState<Tab>("orders");
 const [query,setQuery]=useState("");
 const [status,setStatus]=useState("all");
 const [from,setFrom]=useState("");
 const [to,setTo]=useState("");
 const [order,setOrder]=useState<Order|null>(null);
 const [photos,setPhotos]=useState<Photo[]>([]);
 const [skuGroup,setSkuGroup]=useState("");
 const [selectedIds,setSelectedIds]=useState<string[]>([]);
 const [unitCost,setUnitCost]=useState("");
 const [reason,setReason]=useState("");
 const [confirm,setConfirm]=useState(false);
 const [productSearch,setProductSearch]=useState("");
 const [products,setProducts]=useState<Product[]>([]);
 const [specials,setSpecials]=useState<Price[]>([]);

 async function call(idToken:string,action:string,extra:Record<string,unknown>={}){
  const res=await lineApiFetch("/api/line/accountant",{
   method:"POST",headers:{"Content-Type":"application/json"},
   body:JSON.stringify({idToken,action,...extra}),cache:"no-store"
  });
  const json=await res.json() as Record<string,unknown>;
  if(!res.ok)throw new Error(typeof json.error==="string"?json.error:"Accountant request failed");
  return json;
 }
 async function reload(idToken:string){
  const next=await call(idToken,"overview") as unknown as Report;
  setReport(next);
  setFrom(p=>p||next.todayBangkok.slice(0,8)+"01");
  setTo(p=>p||next.todayBangkok);
  setOrder(p=>p?next.orders.find(o=>o.id===p.id)??null:null);
 }
 useEffect(()=>{
  let disposed=false;
  (async()=>{
   try{
    const module=await import("@line/liff");
    const liff=module.default;
    const liffId=process.env.NEXT_PUBLIC_LINE_LIFF_ID;
    if(!liffId)throw new Error("LINE LIFF configuration missing");
    await liff.init({liffId,withLoginOnExternalBrowser:true});
    if(!liff.isLoggedIn()){liff.login({redirectUri:window.location.origin+"/miniapp/accountant"});return;}
    const next=liff.getIDToken();
    if(!next)throw new Error("กรุณาเข้าสู่ระบบ LINE ใหม่");
    if(disposed)return;
    setToken(next);
    const json=await call(next,"overview") as unknown as Report;
    if(disposed)return;
    setReport(json);
    setFrom(json.todayBangkok.slice(0,8)+"01");setTo(json.todayBangkok);
   }catch(e){if(!disposed)setError(e instanceof Error?e.message:"Cannot sign in");}
   finally{if(!disposed)setLoading(false);}
  })();
  return()=>{disposed=true;};
 },[]);
 const completed=useMemo(()=>report?.orders.filter(o=>o.counted && o.billingAt &&
   (!from||bangkokDate(o.billingAt)>=from)&&(!to||bangkokDate(o.billingAt)<=to))??[],
   [report,from,to]);
 const financial=useMemo(()=>{
  const sales=completed.reduce((v,o)=>v+(o.finalAmount??0),0);
  const complete=completed.filter(o=>o.costsComplete);
  const covered=complete.reduce((v,o)=>v+(o.finalAmount??0),0);
  const profit=complete.reduce((v,o)=>v+(o.grossProfit??0),0);
  return {sales,covered,profit,allGP:complete.length===completed.length?profit:null,
   percent:complete.length===completed.length&&sales>0?100*profit/sales:null,
   bills:completed.length,coverage:sales>0?covered/sales*100:100,
   missing:completed.reduce((v,o)=>v+o.missingCostLines,0),
   adjustments:completed.reduce((v,o)=>v+(o.netBillAdjustment??0),0)};
 },[completed]);
 const filtered=useMemo(()=>report?.orders.filter(o=>{
  if(status==="completed"&&o.status!=="completed")return false;
  if(status==="cancelled"&&o.status!=="cancelled")return false;
  if(status==="pending"&&["completed","cancelled"].includes(o.status))return false;
  const term=query.trim().toLowerCase();
  return !term||[String(o.orderNumber),o.customerName,o.customerCode].some(s=>s.toLowerCase().includes(term));
 }).sort((a,b)=>b.orderNumber-a.orderNumber)??[],[report,status,query]);
 const missing=useMemo(()=>report?.lines.filter(l=>l.missingHistorical&&(l.quantity??0)>0&&
  report.orders.some(o=>o.id===l.orderId&&o.status==="completed"))??[],[report]);
 const groups=useMemo(()=>{
  const map=new Map<string,Item[]>();
  for(const line of missing){
   const key=line.productId+"|"+line.unit;
   map.set(key,[...(map.get(key)??[]),line]);
  }
  return [...map.entries()].map(([key,lines])=>({key,lines,sku:lines[0].sku,name:lines[0].name,unit:lines[0].unit}))
   .sort((a,b)=>b.lines.length-a.lines.length);
 },[missing]);
 const group=groups.find(g=>g.key===skuGroup);
 const chosen=group?.lines.filter(l=>selectedIds.includes(l.id))??[];
 const qty=chosen.reduce((v,l)=>v+(l.quantity??0),0);
 const costValid=unitCost.trim()!==""&&Number.isFinite(Number(unitCost))&&Number(unitCost)>=0&&
  Number(unitCost)<=99999999&&(Number(unitCost)>0||reason.trim()!=="");
 async function selectOrder(value:Order){
  setOrder(value);setPhotos([]);
  try{
   const x=await call(token,"order-files",{orderId:value.id});
   setPhotos((x.files??[]) as Photo[]);
  }catch(e){setError(e instanceof Error?e.message:"Cannot load bills or slips");}
 }
 async function save(){
  if(!group||chosen.length===0||!costValid||report?.role!=="accountant")return;
  setConfirm(false);setBusy(true);setError("");
  try{
   const x=await call(token,"save-cost",{orderItemIds:chosen.map(l=>l.id),unitCost:Number(unitCost),reason});
   setMessage("บันทึกต้นทุนพร้อม Audit Trail: "+JSON.stringify(x.result));
   setSelectedIds([]);setUnitCost("");setReason("");
   await reload(token);
  }catch(e){setError(e instanceof Error?e.message:"บันทึกต้นทุนไม่สำเร็จ");}
  finally{setBusy(false);}
 }
 async function lookup(){
  if(productSearch.trim().length<2)return;
  setBusy(true);setError("");
  try{
   const x=await call(token,"catalog",{search:productSearch});
   setProducts((x.products??[]) as Product[]);
   setSpecials((x.prices??[]) as Price[]);
  }catch(e){setError(e instanceof Error?e.message:"Lookup failed");}
  finally{setBusy(false);}
 }
 async function exportXlsx(kind:"orders"|"products"|"missing"|"audit"){
  if(!report)return;
  setBusy(true);
  try{
   const XLSX=await import("xlsx");
   const o=completed.map(row=>({
    "Order":row.orderNumber,"Customer":row.customerName,"CV":row.customerCode,
    "Billing date TH":bangkokDate(row.billingAt),"Completed at":row.completedAt,
    "Final bill THB":row.finalAmount,"Product sales before adjustment":row.billedProductSales,
    "Manager bill adjustment":row.netBillAdjustment,"Other bill difference":row.otherBillDifference,
    "GP THB":row.grossProfit,"GP percent":row.gpPercent,
    "Missing cost lines":row.missingCostLines,"As of":report.asOf
   }));
   const p=completed.flatMap(row=>row.lines.map(line=>({
    "Billing date":bangkokDate(row.billingAt),"Order":row.orderNumber,
    "Customer":row.customerName,"SKU":line.sku,"Product":line.name,"Unit":line.unit,
    "Quantity":line.quantity,"Sales per unit":line.sellingPricePerUnit,
    "Product sales":line.productSales,"Cost at billing":line.billedCostPerUnit,
    "Accountant cost":line.assignedCostPerUnit,"Current master cost":line.currentCostPerUnit,
    "Effective historical cost/unit":line.missingHistorical?null:line.effectiveCostPerUnit,
    "Total product cost":line.missingHistorical?null:line.totalCost,
    "Product GP":line.missingHistorical||line.productSales===null||line.totalCost===null?null:line.productSales-line.totalCost,
    "Historical cost complete":!line.missingHistorical
   })));
   const m=missing.map(line=>({SKU:line.sku,Product:line.name,OrderItem:line.id,Unit:line.unit,
    Quantity:line.quantity,CurrentMasterCost:line.currentCostPerUnit}));
   const a=report.audit.map(entry=>({
    Batch:entry.batchId,SKU:entry.sku,Product:entry.productName,OrderItem:entry.orderItemId,
    Cost:entry.newCost,Quantity:entry.quantity,Actor:entry.accountantName,Time:entry.createdAt,Reason:entry.reason
   }));
   const rows=kind==="orders"?o:kind==="products"?p:kind==="missing"?m:a;
   const wb=XLSX.utils.book_new();
   XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(rows.length?rows:[{"No records":""}]),"Accountant");
   XLSX.writeFile(wb,"Lotus_B2B_"+kind+"_"+from+"_"+to+".xlsx");
  }catch(e){setError(e instanceof Error?e.message:"Excel export failed");}
  finally{setBusy(false);}
 }
 if(loading)return <LotusLoading message="กำลังโหลดข้อมูลการเงิน..."/>;
 if(!report)return <main className="min-h-screen bg-[#F3F8F7] p-6">
  <LotusBrand/><h1 className="mt-6 text-xl font-black">Accountant access unavailable</h1>
  <p className="mt-2 text-sm text-red-600">{error}</p><Link href="/miniapp" className="mt-4 block text-[#008F8D]">← กลับหน้าหลัก</Link></main>;
 return <main className="min-h-screen bg-[#F3F8F7] pb-24 text-[#17453F]">
  <div className="mx-auto max-w-5xl space-y-3 px-3 pt-4 sm:px-6">
   <header className="rounded-2xl border border-[#D1E8DF] bg-white p-5">
    <div className="flex items-center justify-between">
     {report.role==="manager"
      ? <Link href="/miniapp" className="text-xs font-bold text-[#008F8D]">← กลับหน้าหลัก</Link>
      : <button type="button" onClick={()=>void import("@line/liff").then(m=>m.default.closeWindow())}
          className="text-xs font-bold text-[#008F8D]">✕ ปิดหน้าบัญชี</button>}
     <span className="rounded-full bg-[#E7F9F3] px-3 py-1 text-xs font-black text-[#008F8D]">{report.role==="accountant"?"Accountant":"Manager"}</span>
    </div>
    <p className="mt-3 text-[11px] font-extrabold tracking-widest text-[#008F8D]">LOTUS’S B2B · FINANCIAL</p>
    <h1 className="text-2xl font-black">พื้นที่บัญชี</h1>
    <p className="mt-2 text-sm text-[#708980]">ดูบิล สลิป ต้นทุนและกำไร · ไม่สามารถยืนยันชำระเงินหรือทำงานปฏิบัติการ</p>
    <p className="mt-2 text-xs text-[#889B91]">ข้อมูล ณ {timestamp(report.asOf)}</p>
   </header>
   {(error||message)&&<p role="alert" className="rounded-xl border border-amber-200 bg-white p-3 text-sm">{error||message}</p>}
   <div className="grid grid-cols-4 gap-1 rounded-xl bg-white p-1">
    {([["orders","ออเดอร์"],["finance","การเงิน"],["reports","Excel"],["costs","ต้นทุน"]] as [Tab,string][])
     .map(([value,label])=><button key={value} onClick={()=>setTab(value)}
      className={"min-h-11 rounded-lg px-2 text-xs font-black "+(value===tab?"bg-[#02B0AF] text-white":"text-[#668076]")}>{label}</button>)}
   </div>
   {(tab==="finance"||tab==="reports")&&<div className="rounded-2xl bg-white p-4">
    <p className="mb-2 text-sm font-black">วันที่ Billing completed (เวลาไทย) · เฉพาะออเดอร์ Completed</p>
    <div className="flex gap-2"><input type="date" aria-label="From" value={from} onChange={e=>setFrom(e.target.value)} className={field}/>
     <input type="date" aria-label="To" value={to} onChange={e=>setTo(e.target.value)} className={field}/></div>
   </div>}
   {tab==="finance"&&<div className="space-y-3">
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
     {([["Completed sales",cash(financial.sales)],["Total bills",String(financial.bills)],
      ["Average sales/bill",cash(financial.bills?financial.sales/financial.bills:null)],
      ["Manager bill adjustments",cash(financial.adjustments)],
      ["Gross profit",cash(financial.allGP)],
      ["GP%",financial.percent===null?"N/A":financial.percent.toFixed(2)+"%"]]).map(([label,value])=>
       <div key={label} className="rounded-xl bg-white p-4">
        <p className="text-xs text-[#82948B]">{label}</p><p className="mt-1 break-words text-lg font-black">{value}</p>
       </div>)}
    </div>
    <div className="rounded-xl bg-white p-4">
     <h2 className="font-black">Cost completeness · ต้นทุนครบถ้วน</h2>
     <p className="mt-2 text-2xl font-black text-[#008F8D]">{financial.coverage.toFixed(1)}%</p>
     <p className="mt-1 text-xs text-[#738D81]">{cash(financial.covered)} / {cash(financial.sales)} · ขาดต้นทุนย้อนหลัง {financial.missing} บรรทัด</p>
     {financial.missing>0&&<p className="mt-2 text-xs text-amber-700">GP รวมเป็น N/A จนกว่าต้นทุนครบ · GP เฉพาะบิลต้นทุนครบ {cash(financial.profit)}</p>}
    </div>
    <p className="rounded-xl bg-white p-4 text-xs leading-6 text-[#768E83]">
     ยอดขายรับรู้ตามวันออกบิล (Thailand) เมื่อออเดอร์ Completed เท่านั้น · รายงานย้อนหลังปรับได้ ·
     ส่วนต่างบิลผู้จัดการแยกจากสินค้าตามจริง ไม่กระจายเข้ารายสินค้า
    </p>
   </div>}
   {tab==="orders"&&<div className="space-y-2">
    <div className="rounded-xl bg-white p-3">
     <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="เลขออเดอร์, ร้าน, CV" className={field}/>
     <div className="mt-2 flex flex-wrap gap-1.5">
      {["all","pending","completed","cancelled"].map(value=><button key={value} onClick={()=>setStatus(value)}
       className={"rounded-full px-3 py-1.5 text-xs font-bold "+(status===value?"bg-[#008F8D] text-white":"bg-[#EEF7F3]")}>
       {value==="all"?"All":value}</button>)}
     </div>
    </div>
    <p className="text-xs text-[#8C9A91]">{filtered.length} orders</p>
    {filtered.map(value=><button key={value.id} onClick={()=>void selectOrder(value)}
     className="flex w-full items-center justify-between gap-2 rounded-xl border border-[#E0EBE5] bg-white p-3 text-left">
     <span className="min-w-0"><strong className="block text-sm">#{value.orderNumber}{!value.isRoot?" · /x":""}</strong>
      <span className="block truncate text-xs text-[#72897F]">{value.customerName}</span>
      <span className="block text-[11px] text-[#8B9E94]">Billing {bangkokDate(value.billingAt)||"—"}</span></span>
     <span className="shrink-0 text-right"><span className="block text-xs font-bold text-[#008F8D]">{statusText(value.status)}</span>
      <strong className="block text-sm">{cash(value.finalAmount)}</strong>
      {value.missingCostLines>0&&value.isRoot&&<span className="text-[11px] text-amber-700">ขาดต้นทุน {value.missingCostLines}</span>}</span>
    </button>)}
   </div>}
   {tab==="reports"&&<div className="space-y-3 rounded-xl bg-white p-4">
    <h2 className="text-lg font-black">Financial Excel reports</h2>
    <p className="text-xs text-[#80958B]">รายงานยอดขายอิงวันที่บิลและ Completed เท่านั้น · อ้างอิงวันเวลาที่ดึงข้อมูล</p>
    {([["orders","ยอดขายแยกออเดอร์"],["products","ยอดสินค้าและต้นทุน"],["missing","ต้นทุนที่ขาด"],["audit","ประวัติกรอกต้นทุน"]] as
     ["orders"|"products"|"missing"|"audit",string][])
     .map(([kind,label])=><button key={kind} disabled={busy} onClick={()=>void exportXlsx(kind)}
      className="flex min-h-14 w-full items-center justify-between rounded-xl border border-[#E0EEE7] px-3 text-sm font-bold disabled:opacity-40">
       {label}<span className="text-[#008F8D]">.xlsx ↓</span></button>)}
   </div>}
   {tab==="costs"&&<div className="space-y-3">
    <div className="rounded-xl bg-white p-4">
     <h2 className="text-lg font-black">ต้นทุนที่ขาดย้อนหลัง</h2>
     <p className="mt-1 text-xs leading-5 text-[#708B80]">เลือก SKU และออเดอร์ แล้วกรอกต้นทุนต่อหน่วยย้อนหลัง · ไม่เปลี่ยนบิลหรือราคาและต้นทุนมาสเตอร์</p>
     <p className="mt-2 text-sm font-black text-amber-700">{missing.length} บรรทัดต้องตรวจสอบ</p>
     {report.role==="manager"&&<p className="mt-2 text-xs">Manager ดูข้อมูลได้ แต่กรอกต้นทุนย้อนหลังได้เฉพาะ Accountant</p>}
     <select className={field+" mt-3"} value={skuGroup} onChange={e=>{setSkuGroup(e.target.value);setSelectedIds([]);setUnitCost("");setReason("");}}>
      <option value="">เลือก SKU ที่ขาดต้นทุน</option>
      {groups.map(g=><option key={g.key} value={g.key}>{g.sku} · {g.name} ({g.unit}) · {g.lines.length}</option>)}
     </select>
     {group&&<div className="mt-3 space-y-2">
      {group.lines.map(line=>{const o=report.orders.find(v=>v.id===line.orderId);return <label key={line.id}
       className="flex items-start gap-3 rounded-xl border border-[#DDEAE4] p-3 text-xs">
       <input type="checkbox" className="mt-0.5 accent-[#008F8D]" checked={selectedIds.includes(line.id)}
        disabled={report.role!=="accountant"||busy}
        onChange={e=>setSelectedIds(old=>e.target.checked?[...old,line.id]:old.filter(id=>id!==line.id))}/>
       <span><strong>#{o?.orderNumber} · {o?.customerName}</strong>
        <span className="block text-[#82988D]">{line.quantity} {line.unit} · ต้นทุน ณ Billing: N/A</span>
        <span className="block text-[#82988D]">ต้นทุนมาสเตอร์ปัจจุบัน: {cash(line.currentCostPerUnit)}</span>
       </span></label>})}
      {report.role==="accountant"&&<>
       <label className="block text-xs font-bold">ต้นทุนต่อ {group.unit} (บาท)</label>
       <input type="number" min="0" step="0.0001" value={unitCost} onChange={e=>setUnitCost(e.target.value)} className={field}/>
       <label className="block text-xs font-bold">เหตุผล / อ้างอิง (บังคับหากต้นทุน 0)</label>
       <textarea maxLength={500} rows={2} value={reason} onChange={e=>setReason(e.target.value)}
        placeholder="ใบสั่งซื้อซัพพลายเออร์ / อ้างอิงต้นทุน" className={field}/>
       <p className="rounded-xl bg-[#F1F9F5] p-3 text-xs">เลือก {chosen.length} รายการ · {qty.toFixed(3)} {group.unit} ·
        ต้นทุนรวม {costValid?cash(qty*Number(unitCost)):"—"}</p>
       <button disabled={busy||chosen.length===0||!costValid} onClick={()=>setConfirm(true)}
        className="min-h-12 w-full rounded-xl bg-[#008F8D] font-black text-white disabled:opacity-40">ตรวจสอบก่อนบันทึก</button>
      </>}
     </div>}
    </div>
    <div className="rounded-xl bg-white p-4">
     <h2 className="font-black">ประวัติต้นทุนย้อนหลัง</h2>
     {report.audit.length===0&&<p className="mt-2 text-xs text-[#8B998F]">ยังไม่มีรายการ</p>}
     {report.audit.slice().reverse().slice(0,100).map(a=><div key={a.id} className="border-b border-[#EEF2EF] py-2 text-xs">
      <strong>{a.sku} · {cash(a.newCost)}/หน่วย</strong>
      <span className="block text-[#7D8E84]">{a.accountantName} · {timestamp(a.createdAt)} · Batch {a.batchId.slice(0,8)}</span>
      {a.reason&&<span className="block">{a.reason}</span>}
     </div>)}
    </div>
    <div className="rounded-xl bg-white p-4">
     <h2 className="font-black">ราคาขายและต้นทุนมาสเตอร์ (ดูอย่างเดียว)</h2>
     <div className="mt-3 flex gap-2">
      <input className={field} placeholder="SKU หรือชื่อสินค้า" value={productSearch} onChange={e=>setProductSearch(e.target.value)}/>
      <button disabled={busy||productSearch.length<2} onClick={()=>void lookup()}
       className="rounded-xl bg-[#008F8D] px-3 text-sm font-bold text-white disabled:opacity-40">ค้นหา</button>
     </div>
     {products.map(p=><div key={p.id} className="mt-2 rounded-xl border border-[#E2EFE7] p-3 text-xs">
      <strong>{p.sku} · {p.product_name}</strong>
      <p className="mt-1">ราคาปกติ {cash(p.normal_price)} · ต้นทุนมาสเตอร์ {cash(p.masterCost)} / {p.unit}</p>
      <p className="mt-1 font-bold">ราคาพิเศษลูกค้า {specials.filter(x=>x.product_id===p.id).length} รายการ</p>
      {specials.filter(x=>x.product_id===p.id).map(sp=>
       <p key={sp.customer_id} className="mt-1 text-[#687F74]">{sp.customerName} ({sp.customerCode}) · {cash(sp.agreed_price)} / {p.unit}</p>)}
     </div>)}
    </div>
   </div>}
  </div>
  {order&&<div className="fixed inset-0 z-50 overflow-y-auto bg-black/40 p-3 sm:p-8">
   <div className="mx-auto max-w-2xl rounded-2xl bg-white p-4">
    <div className="flex items-center justify-between"><h2 className="text-lg font-black">Order #{order.orderNumber}</h2>
     <button className="min-h-11 px-3 font-bold" onClick={()=>setOrder(null)}>ปิด ✕</button></div>
    <p className="text-sm text-[#748E83]">{order.customerName} · {statusText(order.status)}</p>
    <p className="mt-2 text-xs">Billing {timestamp(order.billingAt)} · Completed {timestamp(order.completedAt)}</p>
    <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
     {[["Final bill",cash(order.finalAmount)],["Product sales",cash(order.billedProductSales)],
       ["Manager adjustment",cash(order.netBillAdjustment)],["Other bill difference",cash(order.otherBillDifference)],["Order GP",cash(order.grossProfit)]]
      .map(([label,val])=><div key={label} className="rounded-lg bg-[#F3FAF6] p-3">
       <span>{label}</span><strong className="mt-1 block">{val}</strong></div>)}
    </div>
    {order.missingCostLines>0&&<p className="mt-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">ขาดต้นทุน {order.missingCostLines} รายการ · GP ยังไม่ครบ</p>}
    <div className="mt-3 overflow-x-auto"><table className="min-w-[520px] text-left text-xs">
     <thead><tr>{["SKU / รายการ","Qty","ขาย","ต้นทุน/หน่วย","GP"].map(label=><th key={label} className="p-2">{label}</th>)}</tr></thead>
     <tbody>{order.lines.map(l=><tr key={l.id} className="border-t">
      <td className="p-2">{l.sku} · {l.name}</td><td className="p-2">{l.quantity} {l.unit}</td>
      <td className="p-2">{cash(l.productSales)}</td><td className="p-2">{l.missingHistorical?"N/A":cash(l.effectiveCostPerUnit)}</td>
      <td className="p-2">{l.missingHistorical||l.productSales===null||l.totalCost===null?"N/A":cash(l.productSales-l.totalCost)}</td>
     </tr>)}</tbody></table></div>
    <h3 className="mt-4 font-black">รูปบิลและสลิป (ดูอย่างเดียว)</h3>
    {photos.length===0&&<p className="mt-2 text-xs text-[#82958B]">ไม่มีรูป หรือรูปถูกลบตามนโยบายจัดเก็บ</p>}
    <div className="mt-2 grid grid-cols-2 gap-2">{photos.map(photo=><div key={photo.id} className="rounded-xl border p-2">
     <p className="mb-1 text-xs font-bold">{photo.fileType}</p>
     {photo.url?<a href={photo.url} target="_blank" rel="noopener noreferrer">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={photo.url} alt={photo.fileType} className="max-h-56 w-full rounded-lg object-contain"/></a>
      :<p className="text-xs text-red-600">รูปไม่พร้อมใช้งาน</p>}
    </div>)}</div>
   </div>
  </div>}
  {confirm&&group&&<div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4">
   <div className="w-full max-w-lg rounded-2xl bg-white p-5">
    <h2 className="text-xl font-black">ยืนยันบันทึกต้นทุน</h2>
    <p className="mt-2 text-sm">{group.sku} · {group.name}</p>
    <p className="mt-2 text-sm">เลือก {chosen.length} รายการ · {qty.toFixed(3)} {group.unit}</p>
    <p className="mt-2 text-xl font-black">{cash(Number(unitCost))} / {group.unit}</p>
    <p className="mt-2 text-sm font-black">รวมต้นทุน {cash(qty*Number(unitCost))}</p>
    <p className="mt-2 text-xs text-[#81958B]">บันทึกทั้งหมดหรือไม่บันทึกเลย · เก็บ Audit Trail · ไม่แก้ต้นทุนมาสเตอร์และบิล</p>
    <div className="mt-4 grid grid-cols-2 gap-2">
     <button className="min-h-12 rounded-xl border" onClick={()=>setConfirm(false)}>ยกเลิก</button>
     <button className="min-h-12 rounded-xl bg-[#008F8D] font-black text-white" disabled={busy} onClick={()=>void save()}>ยืนยันบันทึก</button>
    </div>
   </div>
  </div>}
 </main>;
}
