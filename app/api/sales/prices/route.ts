import { NextRequest } from "next/server";
import { requireSalesRole, salesApiError } from "@/lib/server/salesAuth";
export const runtime = "nodejs";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  try {
    const { admin, staff } = await requireSalesRole(request, ["salesman"]);
    const body = await request.json() as { customerId?: unknown; productId?: unknown; price?: unknown };
    if (typeof body.customerId !== "string" || !uuid.test(body.customerId) ||
      typeof body.productId !== "string" || !uuid.test(body.productId) ||
      typeof body.price !== "number" || !Number.isFinite(body.price) ||
      body.price <= 0 || body.price > 9999999 ||
      Math.round(body.price*100)/100 !== body.price) {
      return Response.json({ error: "Please select a customer, product, and a valid price (2 decimals)" }, { status: 400 });
    }
    // Price, cost and the > 7% GP decision are all evaluated together in
    // PostgreSQL, never from an untrusted client-supplied margin.
    const { data, error } = await admin.rpc("sales_submit_special_price", {
      p_customer_id: body.customerId,
      p_product_id: body.productId,
      p_staff_id: staff.id,
      p_price: body.price,
    });
    if (error) throw error;
    return Response.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return salesApiError(error); }
}

export async function GET(request: NextRequest) {
  try {
    const { admin, staff } = await requireSalesRole(request, ["manager", "salesman"]);
    const manager = staff.account_type === "manager";
    const status = request.nextUrl.searchParams.get("status") === "history" ? "history" : "pending";
    const customerId = request.nextUrl.searchParams.get("customerId");
    const page = Math.max(0,Math.min(100,Number(request.nextUrl.searchParams.get("page")) || 0));
    let query = admin.from("sales_special_price_requests")
      .select("id,customer_id,product_id,staff_id,old_price,proposed_price,gp_pct,status,created_at,reviewed_at")
      .order("created_at", { ascending: false }).range(page*40,page*40+39);
    if (!manager) query = query.eq("staff_id",staff.id);
    if (status === "pending") query = query.eq("status","pending");
    if (customerId && uuid.test(customerId)) query = query.eq("customer_id",customerId);
    const { data, error } = await query;
    if (error) throw error;
    const rows = data ?? [];
    const customerIds = [...new Set(rows.map(r => r.customer_id))];
    const productIds = [...new Set(rows.map(r => r.product_id))];
    const staffIds = [...new Set(rows.map(r => r.staff_id))];
    const [customers,products,staffNames] = await Promise.all([
      customerIds.length ? admin.from("customers").select("id,customer_name,customer_code").in("id",customerIds) : Promise.resolve({data:[],error:null}),
      productIds.length ? admin.from("products").select("id,sku,product_name,unit").in("id",productIds) : Promise.resolve({data:[],error:null}),
      staffIds.length ? admin.from("staff").select("id,staff_name,staff_code").in("id",staffIds) : Promise.resolve({data:[],error:null}),
    ]);
    if(customers.error || products.error || staffNames.error) throw customers.error ?? products.error ?? staffNames.error;
    const customerMap=new Map((customers.data??[]).map(r=>[r.id,r]));
    const productMap=new Map((products.data??[]).map(r=>[r.id,r]));
    const staffMap=new Map((staffNames.data??[]).map(r=>[r.id,r]));
    return Response.json({
      requests: rows.map(row=>({
        ...row,
        gp_pct: manager ? row.gp_pct : null,
        customerName: customerMap.get(row.customer_id)?.customer_name ?? "ลูกค้า",
        customerCode: customerMap.get(row.customer_id)?.customer_code ?? "",
        productName: productMap.get(row.product_id)?.product_name ?? "สินค้า",
        productSku: productMap.get(row.product_id)?.sku ?? "",
        productUnit: productMap.get(row.product_id)?.unit ?? "",
        salesmanName: staffMap.get(row.staff_id)?.staff_name ?? "Salesman",
      })),
      hasMore: rows.length===40,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return salesApiError(error); }
}

export async function PATCH(request: NextRequest) {
  try {
    const { admin, staff } = await requireSalesRole(request, ["manager"]);
    const body = await request.json() as { requestId?: unknown; action?: unknown };
    if (typeof body.requestId !== "string" || !uuid.test(body.requestId) ||
      !["approve","reject"].includes(String(body.action))) {
      return Response.json({ error: "Invalid review request" }, { status: 400 });
    }
    const { data, error } = await admin.rpc("sales_review_special_price", {
      p_request_id: body.requestId,
      p_manager_id: staff.id,
      p_approve: body.action === "approve",
    });
    if (error) throw error;
    return Response.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return salesApiError(error); }
}
