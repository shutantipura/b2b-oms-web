"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Role = "manager" | "staff" | null;
type NavIconName = "home" | "tasks" | "orders" | "tower" | "kpi" | "customers" | "staff" | "line" | "catalog";

type NavItem = {
  href: string;
  label: string;
  icon: NavIconName;
};

const WORKSPACE_ROOTS = [
  "/login",
  "/tasks",
  "/orders",
  "/control-tower",
  "/customers",
  "/catalog",
  "/staff",
  "/staff-access",
  "/customer-line-access",
  "/line-access",
  "/kpi",
];

const GENERAL_NAV: NavItem[] = [
  { href: "/login", label: "หน้าหลัก", icon: "home" },
  { href: "/tasks", label: "งาน", icon: "tasks" },
  { href: "/orders", label: "คำสั่งซื้อ", icon: "orders" },
];

const MANAGER_NAV: NavItem[] = [
  { href: "/control-tower", label: "ศูนย์ควบคุม", icon: "tower" },
  { href: "/kpi", label: "KPI", icon: "kpi" },
  { href: "/customers", label: "ลูกค้า", icon: "customers" },
  { href: "/staff", label: "พนักงาน", icon: "staff" },
  { href: "/line-access", label: "สิทธิ์ LINE", icon: "line" },
  { href: "/catalog", label: "สินค้าและราคา", icon: "catalog" },
];

function NavIcon({ name }: { name: NavIconName }) {
  const path = {
    home: <><path d="m3 10 9-7 9 7" /><path d="M5 9v12h14V9" /><path d="M9 21v-8h6v8" /></>,
    tasks: <><rect x="4" y="4" width="16" height="16" rx="3" /><path d="m8 12 2.5 2.5L16 9" /></>,
    orders: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 3.5h6M9 10h6M9 14h6M9 18h4" /></>,
    tower: <><rect x="3" y="3" width="18" height="18" rx="3" /><path d="M7 16v-4m5 4V8m5 8v-6" /></>,
    kpi: <><path d="M3 18h18M5 15l5-5 4 3 5-7" /><path d="M16 6h3v3" /></>,
    customers: <><circle cx="9" cy="8" r="3" /><path d="M3.5 19v-2a5.5 5.5 0 0 1 11 0v2" /><path d="M17 6a3 3 0 0 1 0 6m2 7v-2a5 5 0 0 0-3.2-4.66" /></>,
    staff: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="M6 17a3 3 0 0 1 6 0m3-8h3m-3 4h3" /></>,
    line: <><path d="M10 13a5 5 0 0 0 7.07 0l2-2a5 5 0 0 0-7.07-7.07l-1.5 1.5" /><path d="M14 11a5 5 0 0 0-7.07 0l-2 2A5 5 0 0 0 12 20.07l1.5-1.5" /></>,
    catalog: <><path d="m12 2 9 5-9 5-9-5 9-5Zm-9 5v10l9 5 9-5V7M12 12v10" /></>,
  }[name];

  return (
    <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {path}
    </svg>
  );
}

function matchesRoute(pathname: string, root: string) {
  return pathname === root || pathname.startsWith(root + "/");
}

export default function OmsWorkspace({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "";
  const isWorkspace = WORKSPACE_ROOTS.some((root) => matchesRoute(pathname, root));
  const [role, setRole] = useState<Role>(null);

  useEffect(() => {
    if (!isWorkspace) return;

    let active = true;

    async function loadRole() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          if (active) setRole(null);
          return;
        }

        const { data, error } = await supabase
          .from("staff")
          .select("account_type")
          .eq("auth_user_id", user.id)
          .eq("is_active", true)
          .maybeSingle();

        if (!active) return;
        if (error || !data) {
          setRole(null);
        } else {
          setRole(data.account_type === "manager" ? "manager" : "staff");
        }
      } catch {
        if (active) setRole(null);
      }
    }

    void loadRole();
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      // Defer the query until the auth callback finishes.
      setTimeout(() => {
        if (active) void loadRole();
      }, 0);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [isWorkspace, pathname]);

  if (!isWorkspace) return <>{children}</>;

  const navItems = role === "manager"
    ? [...GENERAL_NAV, ...MANAGER_NAV]
    : GENERAL_NAV;
  const showNav = pathname !== "/login" || role !== null;

  return (
    <div className="oms-workspace">
      {showNav && (
        <header className="oms-topbar">
          <div className="oms-topbar-inner">
            <div className="oms-brand-row">
              <Link href="/login" className="oms-brand" aria-label="Lotus's B2B OMS หน้าหลัก">
                Lotus<span className="oms-brand-apostrophe">’s</span>
                <span className="oms-brand-b2b">B2B</span>
              </Link>
              <span className="oms-brand-caption">ระบบจัดการคำสั่งซื้อ</span>
              {role === "manager" && <span className="oms-role-tag">Manager</span>}
            </div>
            <nav className="oms-nav" aria-label="เมนูจัดการ OMS">
              {navItems.map((item) => {
                const active = matchesRoute(pathname, item.href)
                  || (item.href === "/staff" && matchesRoute(pathname, "/staff-access"))
                  || (item.href === "/line-access" && (
                    matchesRoute(pathname, "/customer-line-access")
                    || matchesRoute(pathname, "/staff-access")
                  ));
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="oms-nav-link"
                    aria-current={active ? "page" : undefined}
                    data-active={active ? "true" : undefined}
                  >
                    <NavIcon name={item.icon} />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </nav>
          </div>
        </header>
      )}
      <div className="oms-content">{children}</div>
    </div>
  );
}
