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
  // Each LINE account has one assigned role. OMS staff, including mixed-
  // access Managers and Salesmen, enter their own operational home by default.
  // Customer ordering remains available via explicit ?portal=customer links.
  if (access.hasStaffAccess) return "staff";
  if (access.hasCustomerAccess) return "customer";
  return "choose";
}

export function shouldAutoOpenLineStaff(
  access: LinePortalAccess | null | undefined,
  portal: LinePortal,
): boolean {
  return Boolean(
    access?.hasStaffAccess &&
    portal === "staff" &&
    Boolean(access.staff)
  );
}
