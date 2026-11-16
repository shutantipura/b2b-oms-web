"use client";

import {useCallback,useEffect,useState} from "react";
import Link from "next/link";
import {useParams} from "next/navigation";
import {supabase} from "@/lib/supabase";
import type {ProductStat,Rate,ShopAnalytics} from "@/lib/shopAnalytics";

type Response={
  shop:{id:string;customer_code:string;customer_name:string};
  period:{days:number;from:string;to:string};
  analytics:ShopAnalytics;
};
const PERIODS=[30,90,180,365] as const;
const WEEKDAYS=["อา","จ","อ","พ","พฤ","ศ","ส"];
const card="rounded-2xl border border-[#D5E8E1] bg-white p-4 sm:p-5";
const money=(v:number)=>"฿"+v.toLocaleString("th-TH",{minimumFractionDigits:0,maximumFractionDigits:0});
const qty=(v:number)=>v.toLocaleString("th-TH",{maximumFractionDigits:2});
const thaiDate=(d:string|null)=>d?new Date(d+"T00:00:00Z").toLocaleDateString("th-TH",
  {day:"numeric",month:"short",year:"2-digit",timeZone:"UTC"}):"—";

async function load(shopId:string,days:number):Promise<Response>{
  const {data:{session}}=await supabase.auth.getSession();
  if(!session?.access_token)throw new Error("กรุณาเข้าสู่ระบบด้วย LINE อีกครั้ง");
  const res=await fetch(`/api/customer-registry/shops/analytics?shopId=${encodeURIComponent(shopId)}&days=${days}`,
    {cache:"no-store",headers:{Authorization:"Bearer "+session.access_token}});
  const body=await res.json();
  if(!res.ok)throw new Error(body.error??"โหลดข้อมูลวิเคราะห์ไม่สำเร็จ");
  return body;
}

function Stat({label,value,note}:{label:string;value:string;note?:string}){
  return <div className="rounded-xl bg-[#F3F8F7] p-3">
    <p className="text-xs font-bold text-[#58776D]">{label}</p>
    <p className="mt-1 text-xl font-black text-[#17453F]">{value}</p>
    {note&&<p className="mt-0.5 text-xs text-[#789388]">{note}</p>}
  </div>;
}

// "Good" direction differs: high is good for on-time, low is good for shortages.
function RateTile({label,help,r,goodWhenHigh,threshold}:{
  label:string;help:string;r:Rate;goodWhenHigh:boolean;threshold:number;
}){
  const pct=r.rate===null?null:Math.round(r.rate*1000)/10;
  const bad=r.rate!==null&&(goodWhenHigh?r.rate<threshold:r.rate>threshold);
  return <div className={"rounded-xl border p-3 "+(bad?"border-[#FECACA] bg-[#FEF2F2]":"border-[#D5E8E1] bg-white")}>
    <p className="text-xs font-bold text-[#58776D]">{label}</p>
    <p className={"mt-1 text-2xl font-black "+(bad?"text-[#B91C1C]":"text-[#17453F]")}>
      {pct===null?"—":pct+"%"}
    </p>
    <p className="mt-0.5 text-xs text-[#789388]">
      {r.measured?`${r.hit} จาก ${r.measured} ออร์เดอร์`:"ยังไม่มีข้อมูลที่วัดได้"}
    </p>
    <p className="mt-1 text-[11px] leading-snug text-[#8AA197]">{help}</p>
  </div>;
}

function ProductTable({rows,mode}:{rows:ProductStat[];mode:"top"|"short"}){
  if(!rows.length)return <p className="py-4 text-center text-sm text-[#718A80]">
    {mode==="top"?"ยังไม่มีรายการสินค้าในช่วงเวลานี้":"ไม่พบสินค้าขาดในช่วงเวลานี้"}
  </p>;
  const max=Math.max(...rows.map(r=>mode==="top"?r.orderCount:r.shortCount));
  return <ol className="divide-y divide-[#E1EEE9]">
    {rows.map((p,i)=>{
      const n=mode==="top"?p.orderCount:p.shortCount;
      return <li key={p.key} className="flex items-center gap-3 py-2.5">
        <span className="w-5 shrink-0 text-right text-xs font-black text-[#8AA197]">{i+1}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-[#17453F]">{p.name}</p>
          <div className="mt-1 h-1.5 rounded-full bg-[#EEF5F2]">
            <div className={"h-1.5 rounded-full "+(mode==="top"?"bg-[#02B0AF]":"bg-[#E05252]")}
              style={{width:`${Math.max(6,n/max*100)}%`}}/>
          </div>
          <p className="mt-1 text-xs text-[#789388]">
            {mode==="top"
              ?`รวม ${qty(p.totalQty)} ${p.unit} · ล่าสุด ${thaiDate(p.lastDeliveryDate)}`
              :`สั่ง ${p.orderCount} ครั้ง · ขาด ${p.shortCount} ครั้ง`}
          </p>
        </div>
        <span className={"shrink-0 text-sm font-black "+(mode==="top"?"text-[#008F8D]":"text-[#B91C1C]")}>
          {n} ครั้ง
        </span>
      </li>;
    })}
  </ol>;
}

export default function ShopAnalyticsPage(){
  const params=useParams();
  const shopId=String(params.shopId??"");
  const [days,setDays]=useState<number>(90);
  const [data,setData]=useState<Response|null>(null);
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(true);

  const refresh=useCallback(async(period:number)=>{
    setLoading(true);setError("");
    try{setData(await load(shopId,period));}
    catch(e){setError(e instanceof Error?e.message:"โหลดข้อมูลวิเคราะห์ไม่สำเร็จ");}
    finally{setLoading(false);}
  },[shopId]);
  useEffect(()=>{
    let cancelled=false;
    load(shopId,days)
      .then(result=>{if(!cancelled){setData(result);setError("");}})
      .catch(e=>{if(!cancelled)setError(e instanceof Error?e.message:"โหลดข้อมูลวิเคราะห์ไม่สำเร็จ");})
      .finally(()=>{if(!cancelled)setLoading(false);});
    return()=>{cancelled=true;};
  },[shopId,days]);

  const a=data?.analytics;
  const maxWeekday=a?Math.max(1,...a.weekdayCounts):1;

  return <main className="min-h-screen bg-[#F3F8F7] px-3 py-5 pb-28 text-[#17453F] sm:px-6">
    <div className="mx-auto max-w-4xl space-y-4">
      <header className={card}>
        <Link href="/customers/shops" className="text-sm font-bold text-[#008F8D]">← กลับไปหน้าร้านค้า</Link>
        <h1 className="mt-3 text-2xl font-black">{data?.shop.customer_name??"ข้อมูลวิเคราะห์ร้านค้า"}</h1>
        <p className="mt-1 text-sm text-[#718A80]">
          ข้อมูลวิเคราะห์ร้านค้า{data&&` · ${thaiDate(data.period.from)} – ${thaiDate(data.period.to)} (ตามวันจัดส่ง)`}
        </p>
      </header>

      <nav aria-label="ช่วงเวลา" className="grid grid-cols-4 gap-1 rounded-xl bg-white p-1">
        {PERIODS.map(p=><button key={p} type="button" aria-pressed={days===p} disabled={loading&&days===p}
          onClick={()=>{if(p!==days){setLoading(true);setDays(p);}}}
          className={"rounded-lg p-2.5 text-center text-sm font-black "+
            (days===p?"bg-[#02B0AF] text-white":"text-[#008F8D]")}>
          {p===365?"1 ปี":`${p} วัน`}
        </button>)}
      </nav>

      {error&&<div role="alert" className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] p-3 text-sm text-[#B91C1C]">
        {error} <button type="button" onClick={()=>void refresh(days)} className="ml-2 font-bold underline">ลองอีกครั้ง</button>
      </div>}
      {loading&&!a&&<p className="py-10 text-center text-sm text-[#718A80]">กำลังโหลด...</p>}

      {a&&<div className={"space-y-4 transition-opacity "+(loading?"opacity-50":"")}>
        {a.orderCount===0?
          <section className={card}>
            <p className="py-6 text-center text-sm text-[#718A80]">
              ไม่มีคำสั่งซื้อในช่วงเวลานี้{a.cancelledCount?` (ยกเลิก ${a.cancelledCount} รายการ)`:""}
            </p>
          </section>:<>
        <section className={card} aria-labelledby="buying">
          <h2 id="buying" className="text-lg font-black">พฤติกรรมการสั่งซื้อ</h2>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Stat label="คำสั่งซื้อ" value={`${a.orderCount}`}
              note={a.cancelledCount?`ยกเลิกเพิ่มอีก ${a.cancelledCount}`:undefined}/>
            <Stat label="ความถี่" value={a.ordersPerWeek===null?"—":`${a.ordersPerWeek.toFixed(1)} ครั้ง/สัปดาห์`}
              note={a.avgDaysBetweenOrders===null?undefined:`เฉลี่ยทุก ${a.avgDaysBetweenOrders.toFixed(1)} วัน`}/>
            <Stat label="สั่งล่าสุด" value={a.daysSinceLastOrder===null?"—":
              a.daysSinceLastOrder===0?"วันนี้":`${a.daysSinceLastOrder} วันก่อน`}
              note={thaiDate(a.lastDeliveryDate)}/>
            <Stat label="ยอดเฉลี่ยต่อบิล" value={a.avgBasketAmount===null?"—":money(a.avgBasketAmount)}
              note={a.billedOrderCount?`จาก ${a.billedOrderCount} บิล · รวม ${money(a.totalBilledAmount)}`:"ยังไม่มีบิล"}/>
            <Stat label="สินค้าเฉลี่ยต่อออร์เดอร์" value={a.avgLinesPerOrder===null?"—":`${a.avgLinesPerOrder.toFixed(1)} รายการ`}/>
          </div>
          <div className="mt-4">
            <p className="text-xs font-bold text-[#58776D]">วันที่รับสินค้าบ่อย</p>
            <div className="mt-2 grid grid-cols-7 gap-1.5">
              {a.weekdayCounts.map((n,i)=><div key={i} className="text-center">
                <div className="flex h-16 items-end rounded-lg bg-[#F3F8F7] p-1">
                  <div className="w-full rounded-md bg-[#02B0AF]" style={{height:`${n?Math.max(10,n/maxWeekday*100):0}%`}}/>
                </div>
                <p className="mt-1 text-xs font-bold text-[#58776D]">{WEEKDAYS[i]}</p>
                <p className="text-[11px] text-[#8AA197]">{n}</p>
              </div>)}
            </div>
          </div>
        </section>

        <section className={card} aria-labelledby="service">
          <h2 id="service" className="text-lg font-black">ปัญหาที่ลูกค้าเจอ</h2>
          <p className="mt-1 text-xs text-[#789388]">ใช้เกณฑ์เดียวกับหน้า KPI · นับเฉพาะออร์เดอร์ที่วัดผลได้</p>
          <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
            <RateTile label="Short pick" r={a.shortPick} goodWhenHigh={false} threshold={0.1}
              help="จัดสินค้าได้น้อยกว่าที่ยืนยัน (KG เผื่อ 0.5)"/>
            <RateTile label="สินค้าไม่พอ (Short stock)" r={a.stockShortage} goodWhenHigh={false} threshold={0.1}
              help="ยืนยันได้น้อยกว่าที่สั่ง หรือ short pick"/>
            <RateTile label="ส่งตรงเวลา (DOT)" r={a.deliveryOnTime} goodWhenHigh threshold={0.9}
              help="ส่งถึงก่อนสิ้นสุดรอบจัดส่งที่เลือก"/>
            <RateTile label="ชำระตรงเวลา" r={a.paymentOnTime} goodWhenHigh threshold={0.9}
              help="ชำระเสร็จก่อน 21:00 ของวันจัดส่ง"/>
          </div>
        </section>

        <div className="grid gap-4 lg:grid-cols-2">
          <section className={card} aria-labelledby="top">
            <h2 id="top" className="text-lg font-black">สินค้าที่สั่งบ่อย</h2>
            <p className="mt-1 text-xs text-[#789388]">นับจำนวนออร์เดอร์ที่มีสินค้านี้</p>
            <div className="mt-2"><ProductTable rows={a.topProducts} mode="top"/></div>
          </section>
          <section className={card} aria-labelledby="short">
            <h2 id="short" className="text-lg font-black">สินค้าที่มักขาด</h2>
            <p className="mt-1 text-xs text-[#789388]">ยืนยันไม่ครบหรือจัดได้ไม่ครบ</p>
            <div className="mt-2"><ProductTable rows={a.shortedProducts} mode="short"/></div>
          </section>
        </div>
        </>}
      </div>}
    </div>
  </main>;
}
