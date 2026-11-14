export type LinePortal = "choose" | "customer" | "staff";

type LinePortalAccess = {
  hasCustomerAccess?: boolean;
  hasStaffAccess?: boolean;
  staff?: { accountType?: string } | null;
};

// The Manager role includes all customer accounts, but is still a staff
// workspace by default. Entering customer ordering requires the explicit link
// on the Manager home or the explicit ?portal=customer URL.
export function defaultLinePortal(access: LinePortalAccess): LinePortal {
  if (access.hasStaffAccess && access.staff?.accountType === "manager") return "staff";
  if (access.hasStaffAccess && access.hasCustomerAccess) return "choose";
  if (access.hasCustomerAccess) return "customer";
  if (access.hasStaffAccess) return "staff";
  return "choose";
}

export function shouldAutoOpenLineStaff(
  access: LinePortalAccess | null | undefined,
  portal: LinePortal,
): boolean {
  return Boolean(
    access?.hasStaffAccess &&
    portal === "staff" &&
    (access.staff?.accountType === "manager" || !access.hasCustomerAccess)
  );
}
