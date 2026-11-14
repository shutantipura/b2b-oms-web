import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { hasAutomaticLineCustomerAccess } from "@/lib/server/lineCustomerAccess";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Row = Record<string, unknown>;
type LineVerify = { sub?: string };
const PAGE_SIZE = 800;
const money = (v: unknown) => v === null || v === undefined ? null : Number(v);
const num = (v: unknown) => Number(v ?? 0) || 0;
const txt = (v: unknown) => typeof v === "string" ? v : "";
const response = (body: unknown, status = 200) => NextResponse.json(body, {
  status, headers: { "Cache-Control": "private, no-store, max-age=0" },
});

async function allRows(admin: SupabaseClient, table: string, fields: string, sort = "id"): Promise<Row[]> {
  const all: Row[] = [];
  for (let offset = 0; offset < 100000; offset += PAGE_SIZE) {
    const { data, error } = await admin.from(table).select(fields)
      .order(sort, { ascending: true }).range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error("Could not load " + table + ": " + error.message);
    all.push(...((data ?? []) as unknown as Row[]));
    if (!data || data.length < PAGE_SIZE) return all;
  }
  throw new Error("Report too large to load safely");
}

async function authorize(idToken: unknown) {
  if (typeof idToken !== "string" || idToken.length < 20 || idToken.length > 15000) {
    throw Object.assign(new Error("LINE sign-in is required"), { status: 401 });
  }
  const channelId = process.env.LINE_CHANNEL_ID;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!channelId || !url || !secret) throw new Error("Accountant configuration is incomplete");
  const check = await fetch("https://api.line.me/oauth2/v2.1/verify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ id_token: idToken, client_id: channelId }).toString(),
    cache: "no-store", signal: AbortSignal.timeout(10000),
  });
  const identity = await check.json() as LineVerify;
  if (!check.ok || !identity.sub) {
    throw Object.assign(new Error("LINE identity could not be verified"), { status: 401 });
  }
  const admin = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: user, error } = await admin.from("line_users")
    .select("id,line_user_id,internal_name,assigned_role,is_active")
    .eq("line_user_id", identity.sub).maybeSingle();
  if (error || !user?.is_active) {
    throw Object.assign(new Error("This LINE account is not active"), { status: 403 });
  }
  let role: "accountant" | "manager";
  if (user.assigned_role === "accountant") role = "accountant";
  else if (user.assigned_role === "manager" && await hasAutomaticLineCustomerAccess(admin, identity.sub)) role = "manager";
  else throw Object.assign(new Error("Accountant or Manager role required"), { status: 403 });
  return { admin, user, role };
}

async function fullReport(admin: SupabaseClient) {
  const [orders, items, histories, customers, overrides, audit, actors] = await Promise.all([
    allRows(admin,"orders","id,order_number,customer_id,status,created_at,completed_at,delivery_date,delivery_slot,final_amount,group_root_order_id,group_sequence,fulfillment_method,delivery_address,cancellation_reason"),
    allRows(admin,"order_items","id,order_id,product_id,product_name_snapshot,unit_snapshot,unit_price_snapshot,piece_price_per_kg_snapshot,actual_qty,actual_piece_qty,unit_cost_at_billing,cost_recorded_at_billing"),
    allRows(admin,"order_history","id,order_id,action,created_at"),
    allRows(admin,"customers","id,customer_code,customer_name"),
    allRows(admin,"accountant_order_item_costs","order_item_id,unit_cost,created_at,entered_by_line_user_id","order_item_id"),
    allRows(admin,"accountant_cost_entry_audit","id,batch_id,order_item_id,old_unit_cost,new_unit_cost,quantity_at_entry,entered_by_line_user_id,reason,created_at"),
    allRows(admin,"line_users","id,internal_name,display_name"),
  ]);
  const productIds = [...new Set(items.map(r => txt(r.product_id)).filter(Boolean))];
  const [products, costs] = await Promise.all([
    productIds.length ? admin.from("products").select("id,sku,product_name,unit,normal_price").in("id",productIds) : Promise.resolve({data:[],error:null}),
    productIds.length ? admin.from("product_costs").select("product_id,cost,updated_at").in("product_id",productIds) : Promise.resolve({data:[],error:null}),
  ]);
  if (products.error || costs.error) throw new Error("Could not load product costs");
  const productMap = new Map((products.data??[]).map((r: Row)=>[txt(r.id),r]));
  const masterCostMap = new Map((costs.data??[]).map((r: Row)=>[txt(r.product_id),r]));
  const customerMap = new Map(customers.map(r=>[txt(r.id),r]));
  const orderMap = new Map(orders.map(r=>[txt(r.id),r]));
  const overrideMap = new Map(overrides.map(r=>[txt(r.order_item_id),r]));
  const actorMap = new Map(actors.map(r=>[txt(r.id),txt(r.internal_name)||txt(r.display_name)]));
  const billMap = new Map<string,string>();
  for (const event of histories) {
    if(event.action!=="billing_completed") continue;
    const id=txt(event.order_id),ts=txt(event.created_at);
    if(!billMap.has(id)||ts<(billMap.get(id)??""))billMap.set(id,ts);
  }
  const linesByRoot = new Map<string,Row[]>();
  for(const line of items) {
    const order = orderMap.get(txt(line.order_id));
    if(!order) continue;
    const root=txt(order.group_root_order_id)||txt(order.id);
    const lines=linesByRoot.get(root)??[];
    lines.push(line);
    linesByRoot.set(root,lines);
  }
  const membersByRoot=new Map<string,Row[]>();
  for(const order of orders) {
    const root=txt(order.group_root_order_id)||txt(order.id);
    const members=membersByRoot.get(root)??[];
    members.push(order);membersByRoot.set(root,members);
  }
  const lineDetails=items.map(line=>{
    const product=productMap.get(txt(line.product_id));
    const currentCost=masterCostMap.get(txt(line.product_id));
    const correction=overrideMap.get(txt(line.id));
    const billed=money(line.unit_cost_at_billing);
    const assigned=money(correction?.unit_cost);
    // Current master costs are reference-only; never turn an unknown
    // historical cost into a seemingly confirmed financial number.
    const unitCost=billed??assigned;
    const quantity=money(line.actual_qty);
    const unitPrice=money(line.piece_price_per_kg_snapshot)??num(line.unit_price_snapshot);
    const missingHistorical=quantity===null || (quantity>0&&billed===null&&assigned===null);
    return {
      id:txt(line.id),orderId:txt(line.order_id),productId:txt(line.product_id),
      sku:txt(product?.sku),name:txt(line.product_name_snapshot)||txt(product?.product_name),
      unit:money(line.piece_price_per_kg_snapshot)!==null?"กก.":txt(line.unit_snapshot),quantity,
      sellingPricePerUnit:unitPrice,productSales:quantity===null?null:Math.round(quantity*unitPrice*100)/100,
      billedCostPerUnit:billed,assignedCostPerUnit:assigned,currentCostPerUnit:money(currentCost?.cost),
      effectiveCostPerUnit:unitCost,totalCost:quantity===null||unitCost===null?null:Math.round(quantity*unitCost*100)/100,
      missingHistorical,hasCostSnapshot:!missingHistorical,
    };
  });
  const detailsMap=new Map(lineDetails.map(x=>[x.id,x]));
  const detailByRoot=new Map<string,typeof lineDetails>();
  for(const [root,lines] of linesByRoot) {
    detailByRoot.set(root,lines.map(line=>detailsMap.get(txt(line.id))).filter((l):l is typeof lineDetails[number]=>Boolean(l)));
  }
  const rows=orders.map(order=>{
    const id=txt(order.id),root=txt(order.group_root_order_id)||id;
    const isRoot=id===root;
    const members=membersByRoot.get(root)??[];
    const billAt=billMap.get(root)??null;
    const rootLines=detailByRoot.get(root)??[];
    const missingCostLines=rootLines.filter(line=>line.missingHistorical&&((line.quantity??0)>0||line.quantity===null)).length;
    const costsComplete=missingCostLines===0 && rootLines.every(l=>l.totalCost!==null || l.quantity===0);
    const productSales=rootLines.reduce((s,l)=>s+(l.productSales??0),0);
    const knownCost=rootLines.reduce((s,l)=>s+(l.totalCost??0),0);
    const rootOrder=orderMap.get(root)??order;
    const finalAmount=money(rootOrder.final_amount);
    const counted=Boolean(isRoot&&billAt&&order.status==="completed"&&finalAmount!==null&&members.every(m=>m.status==="completed"));
    const customer=customerMap.get(txt(order.customer_id));
    return {
      id,rootId:root,orderNumber:num(order.order_number),customerId:txt(order.customer_id),
      customerName:txt(customer?.customer_name),customerCode:txt(customer?.customer_code),
      status:txt(order.status),isRoot,groupSequence:money(order.group_sequence),
      deliveryDate:txt(order.delivery_date),deliverySlot:txt(order.delivery_slot),
      fulfillmentMethod:txt(order.fulfillment_method),
      createdAt:txt(order.created_at),completedAt:txt(order.completed_at),
      billingAt:billAt,finalAmount:money(order.final_amount),counted,
      billedProductSales:productSales,netBillAdjustment:finalAmount===null?null:Math.round((finalAmount-productSales)*100)/100,
      recordedCost:Math.round(knownCost*100)/100,missingCostLines,
      costsComplete, grossProfit:counted&&costsComplete?Math.round((finalAmount!-knownCost)*100)/100:null,
      gpPercent:counted&&costsComplete&&finalAmount!>0?Math.round(10000*(finalAmount!-knownCost)/finalAmount!)/100:null,
      lines:isRoot?rootLines:[],deliveryAddress:txt(order.delivery_address),
      cancellationReason:txt(order.cancellation_reason),
    };
  });
  const audited=audit.map(r=>({
    id:num(r.id),batchId:txt(r.batch_id),orderItemId:txt(r.order_item_id),
    oldCost:money(r.old_unit_cost),newCost:num(r.new_unit_cost),
    quantity:money(r.quantity_at_entry),reason:txt(r.reason),createdAt:txt(r.created_at),
    accountantName:actorMap.get(txt(r.entered_by_line_user_id))??"Accountant",
    sku:detailsMap.get(txt(r.order_item_id))?.sku??"",
    productName:detailsMap.get(txt(r.order_item_id))?.name??"",
  }));
  return { orders:rows,lines:lineDetails, audit:audited,asOf:new Date().toISOString() };
}
function billingDate(value: string): string {
  if (!value) return "";
  const date=new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone:"Asia/Bangkok",year:"numeric",month:"2-digit",day:"2-digit",
  }).formatToParts(date);
  const p=(type:string)=>parts.find(x=>x.type===type)?.value??"";
  return p("year")+"-"+p("month")+"-"+p("day");
}

export async function POST(req:NextRequest) {
  try {
    const body=await req.json() as Row;
    const {admin,user,role}=await authorize(body.idToken);
    const action=txt(body.action)||"overview";
    if(action==="save-cost") {
      if(role!=="accountant") return response({error:"Only Accountant may fill historical costs"},403);
      const ids=body.orderItemIds;
      const amount=body.unitCost;
      const reason=typeof body.reason==="string"?body.reason:"";
      if(!Array.isArray(ids)||ids.length===0||ids.length>100||
        ids.some(x=>typeof x!=="string"||! /^[0-9a-f-]{36}$/i.test(x))||
        typeof amount!=="number"||!Number.isFinite(amount)||amount<0||amount>99999999 ||
        reason.length>500) return response({error:"Invalid cost batch"},400);
      const {data,error}=await admin.rpc("accountant_fill_missing_costs",{
        p_actor_line_user_row_id:user.id,p_order_item_ids:ids,p_unit_cost:amount,p_reason:reason,
      });
      if(error) return response({error:error.message},409);
      return response({result:data});
    }
    if(action==="catalog") {
      const search=txt(body.search).trim().slice(0,80).replace(/[,()%]/g," ");
      if(search.length<2) return response({products:[],prices:[]});
      const {data,error}=await admin.from("products")
        .select("id,sku,product_name,unit,normal_price")
        .or("sku.ilike.%"+search+"%,product_name.ilike.%"+search+"%")
        .order("product_name").limit(40);
      if(error)throw new Error(error.message);
      const ids=(data??[]).map(r=>r.id);
      const [costs,prices]=await Promise.all([
        ids.length?admin.from("product_costs").select("product_id,cost,updated_at").in("product_id",ids):Promise.resolve({data:[],error:null}),
        ids.length?admin.from("customer_prices").select("customer_id,product_id,agreed_price,is_active").in("product_id",ids).eq("is_active",true):Promise.resolve({data:[],error:null}),
      ]);
      if(costs.error||prices.error)throw new Error("Could not load reference prices");
      const byCost=new Map((costs.data??[]).map(r=>[r.product_id,r]));
      const customerIds=[...new Set((prices.data??[]).map(p=>p.customer_id))];
      const {data:shopNames,error:shopError}=customerIds.length
        ? await admin.from("customers").select("id,customer_name,customer_code").in("id",customerIds)
        : {data:[],error:null};
      if(shopError)throw new Error("Could not load customer names for special prices");
      const shopMap=new Map((shopNames??[]).map(c=>[c.id,c]));
      return response({
        products:(data??[]).map(p=>({...p,masterCost:byCost.get(p.id)?.cost??null})),
        prices:(prices.data??[]).map(p=>({
          ...p,customerName:shopMap.get(p.customer_id)?.customer_name??"",
          customerCode:shopMap.get(p.customer_id)?.customer_code??"",
        })),
      });
    }
    if(action==="order-files") {
      const orderId=txt(body.orderId);
      if(!/^[0-9a-f-]{36}$/i.test(orderId))return response({error:"Invalid order"},400);
      const {data:orders,error:oerr}=await admin.from("orders").select("id,group_root_order_id").eq("id",orderId).maybeSingle();
      if(oerr||!orders)return response({error:"Order not found"},404);
      const root=orders.group_root_order_id??orders.id;
      // A grouped commercial bill may hold images on any /x member.
      const {data:members,error:memberError}=await admin.from("orders")
        .select("id").or("id.eq."+root+",group_root_order_id.eq."+root);
      if(memberError)throw new Error("Could not load grouped order members");
      const memberIds=[...new Set([root,orderId,...(members??[]).map(m=>m.id)])];
      const {data:files,error:ferr}=await admin.from("order_files")
        .select("id,order_id,file_type,storage_path,created_at,is_current")
        .in("order_id",memberIds).eq("is_current",true)
        .in("file_type",["bill","bill_2","payment_slip","payment_slip_2"])
        .order("created_at",{ascending:true});
      if(ferr)throw new Error("Could not load files");
      const photos=await Promise.all((files??[]).map(async file=>{
        const {data,error}=await admin.storage.from("order-files").createSignedUrl(file.storage_path,600);
        return {id:file.id,fileType:file.file_type,createdAt:file.created_at,url:error?null:data?.signedUrl??null};
      }));
      return response({files:photos});
    }
    if(action!=="overview")return response({error:"Unsupported action"},400);
    const report=await fullReport(admin);
    return response({...report,role,accountantName:txt(user.internal_name),todayBangkok:billingDate(new Date().toISOString())});
  }catch(error) {
    const status=typeof error==="object"&&error&&"status" in error?Number((error as {status:unknown}).status):500;
    if(status===500) console.error("[accountant] request error",error instanceof Error?error.message:"unknown");
    return response({error:error instanceof Error?error.message:"Unexpected reporting error"},status);
  }
}
