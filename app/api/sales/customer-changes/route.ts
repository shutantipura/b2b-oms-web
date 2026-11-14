import { NextRequest } from "next/server";
import { requireSalesRole, salesApiError } from "@/lib/server/salesAuth";
export const runtime = "nodejs";

const EDITABLE = new Set([
  "customer_name", "customer_type", "contact_name",
  "phone", "delivery_address", "delivery_map_url", "delivery_map_url_2",
  "delivery_location_1_name", "delivery_location_2_name", "rider_note", "notes",
]);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  try {
    const { admin, staff } = await requireSalesRole(request, ["salesman"]);
    const body = await request.json() as { customerId?: unknown; changes?: unknown };
    if (typeof body.customerId !== "string" || !uuid.test(body.customerId) ||
      !body.changes || typeof body.changes !== "object" ||
      Array.isArray(body.changes)) return Response.json({ error: "Invalid changes" }, { status: 400 });
    const changes = body.changes as Record<string, unknown>;
    const keys = Object.keys(changes);
    if (!keys.length || keys.length > EDITABLE.size || keys.some(k => !EDITABLE.has(k)))
      return Response.json({ error: "One or more customer fields cannot be edited" }, { status: 400 });
    if (keys.some(k => changes[k] !== null && (typeof changes[k] !== "string" || (changes[k] as string).length > 1000)))
      return Response.json({ error: "Invalid customer field value" }, { status: 400 });
    const { data, error } = await admin.rpc("sales_submit_customer_changes", {
      p_customer_id: body.customerId,
      p_staff_id: staff.id,
      p_changes: changes,
    });
    if (error) throw error;
    return Response.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return salesApiError(error); }
}

export async function GET(request: NextRequest) {
  try {
    const { admin } = await requireSalesRole(request, ["manager"]);
    const status = request.nextUrl.searchParams.get("status") === "history" ? "history" : "pending";
    const customerId = request.nextUrl.searchParams.get("customerId");
    const page = Math.max(0,Math.min(100,Number(request.nextUrl.searchParams.get("page")) || 0));
    let query = admin.from("sales_customer_change_audit").select("*")
      .order("created_at", { ascending: false }).range(page*40,page*40+39);
    if (status === "pending") query = query.eq("status", "pending");
    if (customerId && uuid.test(customerId)) query = query.eq("customer_id",customerId);
    const { data, error } = await query;
    if (error) throw error;
    const rows = data ?? [];
    const customerIds = [...new Set(rows.map(r => r.customer_id as string))];
    const staffIds = [...new Set(rows.map(r => r.staff_id as string))];
    const [customers, staff] = await Promise.all([
      customerIds.length ? admin.from("customers").select("id,customer_name,customer_code").in("id",customerIds) : Promise.resolve({data:[],error:null}),
      staffIds.length ? admin.from("staff").select("id,staff_name,staff_code").in("id",staffIds) : Promise.resolve({data:[],error:null}),
    ]);
    if(customers.error || staff.error) throw customers.error ?? staff.error;
    const customerMap = new Map((customers.data ?? []).map(c=>[c.id,c]));
    const staffMap = new Map((staff.data ?? []).map(s=>[s.id,s]));
    return Response.json({
      changes: rows.map(row=>({
        ...row,
        customerName: customerMap.get(row.customer_id)?.customer_name ?? "ลูกค้า",
        customerCode: customerMap.get(row.customer_id)?.customer_code ?? "",
        salesmanName: staffMap.get(row.staff_id)?.staff_name ?? "Salesman",
        salesmanCode: staffMap.get(row.staff_id)?.staff_code ?? "",
      })),
      hasMore: rows.length === 40,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return salesApiError(error); }
}

export async function PATCH(request: NextRequest) {
  try {
    const { admin, staff } = await requireSalesRole(request, ["manager"]);
    const body = await request.json() as { changeId?: unknown; action?: unknown };
    if (typeof body.changeId !== "string" || !uuid.test(body.changeId) ||
      !["approve","reject"].includes(String(body.action))) {
      return Response.json({ error: "Invalid review request" }, { status: 400 });
    }
    const { data, error } = await admin.rpc("sales_review_customer_change", {
      p_change_id: body.changeId,
      p_manager_id: staff.id,
      p_approve: body.action === "approve",
    });
    if (error) throw error;
    return Response.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return salesApiError(error); }
}
