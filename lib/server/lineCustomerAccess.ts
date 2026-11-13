import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Evaluates all-customer LINE privileges from the *current* authorized staff
 * relationship, never from the editable line_users.user_type field.
 * Rights vanish immediately if the LINE staff link is revoked, the staff account
 * is deactivated or its role is changed. Nothing is persisted into customer links.
 */
export async function hasAutomaticLineCustomerAccess(
  admin: SupabaseClient, verifiedLineUserId: string,
): Promise<boolean> {
  const { data: link, error: linkError } = await admin
    .from("staff_line_users")
    .select("staff_id")
    .eq("line_user_id", verifiedLineUserId)
    .eq("is_authorized", true)
    .maybeSingle();
  if (linkError) throw new Error("Could not verify LINE staff access");
  if (!link) return false;
  const { data: staff, error: staffError } = await admin
    .from("staff")
    .select("id, is_active, account_type")
    .eq("id", link.staff_id)
    .maybeSingle();
  if (staffError) throw new Error("Could not verify staff account");
  return Boolean(staff?.is_active && (
    staff.account_type === "manager" || staff.account_type === "salesman"
  ));
}

export type LineCustomerAccessRow = {
  id: string;
  customer_code: string;
  customer_name: string;
  has_no_cv: boolean;
  is_active: boolean;
  delivery_address: string | null;
  delivery_map_url: string | null;
  delivery_map_url_2: string | null;
  delivery_location_1_name: string;
  delivery_location_2_name: string;
};

export type LineCustomerAccessLink = {
  customer_id: string;
  can_order: boolean;
  customers: LineCustomerAccessRow | LineCustomerAccessRow[] | null;
};

const CUSTOMER_FIELDS = [
  "id", "customer_code", "customer_name", "has_no_cv", "is_active",
  "delivery_address", "delivery_map_url", "delivery_map_url_2",
  "delivery_location_1_name", "delivery_location_2_name",
].join(",");

export async function loadAuthorizedLineCustomerLinks(
  admin: SupabaseClient, verifiedLineUserId: string, lineUserRowId: string,
): Promise<{ data: LineCustomerAccessLink[] | null; error: Error | null }> {
  try {
    if (await hasAutomaticLineCustomerAccess(admin, verifiedLineUserId)) {
      const { data, error } = await admin.from("customers")
        .select("id,customer_code,customer_name,has_no_cv,is_active,delivery_address,delivery_map_url,delivery_map_url_2,delivery_location_1_name,delivery_location_2_name").eq("is_active", true)
        .order("customer_name", { ascending: true });
      if (error) throw error;
      return {
        data: (data ?? []).map((customer) => ({
          customer_id: customer.id as string,
          can_order: true,
          customers: customer as LineCustomerAccessRow,
        })),
        error: null,
      };
    }
    const { data, error } = await admin.from("customer_line_users")
      .select(`customer_id,can_order,customers (${CUSTOMER_FIELDS})`)
      .eq("line_user_id", lineUserRowId).eq("can_order", true);
    if (error) throw error;
    return { data: (data ?? []) as unknown as LineCustomerAccessLink[], error: null };
  } catch (error) {
    return { data: null, error: error instanceof Error ? error : new Error("Unable to load customer access") };
  }
}
