import { NextRequest } from "next/server";
import { requireSalesRole, salesApiError } from "@/lib/server/salesAuth";
import { buildShopAnalytics, type AnalyticsHistory, type AnalyticsItem } from "@/lib/shopAnalytics";
import { bangkokToday } from "@/lib/shopWarnings";

export const runtime = "nodejs";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PERIODS = [30, 90, 180, 365];
const CHUNK = 200;

function chunks<T>(list: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += CHUNK) out.push(list.slice(i, i + CHUNK));
  return out;
}

export async function GET(request: NextRequest) {
  try {
    const { admin } = await requireSalesRole(request, ["manager","salesman"]);
    const shopId = request.nextUrl.searchParams.get("shopId") ?? "";
    const days = Number(request.nextUrl.searchParams.get("days") ?? 90);
    if (!uuid.test(shopId)) return Response.json({error:"Invalid shop"}, {status:400});
    if (!PERIODS.includes(days)) return Response.json({error:"Invalid period"}, {status:400});

    const now = new Date();
    const today = bangkokToday(now);
    const from = new Date(Date.parse(today + "T00:00:00Z") - (days - 1) * 86_400_000)
      .toISOString().slice(0, 10);

    const { data: shop, error: shopError } = await admin.from("customers")
      .select("id,customer_code,customer_name").eq("id", shopId).maybeSingle();
    if (shopError) throw shopError;
    if (!shop) return Response.json({error:"Shop not found"}, {status:404});

    const { data: orders, error: orderError } = await admin.from("orders")
      .select("id,order_number,status,created_at,delivery_date,delivery_slot,final_amount,group_sequence,fulfillment_method")
      .eq("customer_id", shopId).gte("delivery_date", from).lte("delivery_date", today)
      .order("delivery_date", { ascending: true }).limit(5000);
    if (orderError) throw orderError;

    const ids = (orders ?? []).map(o => o.id);
    const items: AnalyticsItem[] = [], history: AnalyticsHistory[] = [];
    for (const group of chunks(ids)) {
      const [itemRows, historyRows] = await Promise.all([
        admin.from("order_items")
          .select("order_id,product_id,product_name_snapshot,unit_snapshot,requested_qty,confirmed_qty,actual_qty,actual_piece_qty,piece_price_per_kg_snapshot")
          .in("order_id", group).limit(20000),
        admin.from("order_history").select("order_id,from_status,to_status,created_at")
          .in("order_id", group).limit(50000),
      ]);
      if (itemRows.error || historyRows.error) throw itemRows.error ?? historyRows.error;
      items.push(...(itemRows.data ?? []));
      history.push(...(historyRows.data ?? []));
    }

    return Response.json({
      shop, period: { days, from, to: today },
      analytics: buildShopAnalytics(orders ?? [], items, history, now, today),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return salesApiError(error); }
}
