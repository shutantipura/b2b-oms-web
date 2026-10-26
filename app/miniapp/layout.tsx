import type { ReactNode } from "react";

/**
 * Consistent text sizing for customer LINE WebViews (Android and iOS).
 * Do not affect the separate staff/manager workspace.
 */
export default function MiniappLayout({ children }: { children: ReactNode }) {
  return <div className="miniapp-shell">{children}</div>;
}
