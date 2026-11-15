import type { ReactNode } from "react";

// Icons are decorative; navigation labels remain fully accessible.
// Centralizing route-to-icon mapping keeps Manager, Staff and Salesman consistent.
const icons: Record<string, ReactNode> = {
  "/tasks": <>
    <rect x="5" y="4" width="14" height="17" rx="2" />
    <path d="M9 4V3h6v1M8.5 10h7M8.5 14h2.5M13 14l1.5 1.5L17 12.8" />
  </>,
  "/orders": <>
    <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" />
    <path d="M9 8h6M9 12h6M9 16h3" />
  </>,
  "/miniapp?portal=customer": <>
    <circle cx="9" cy="20" r="1" />
    <circle cx="19" cy="20" r="1" />
    <path d="M2 3h3l2.4 12.2a2 2 0 0 0 2 1.8H19a2 2 0 0 0 2-1.6l1-7.4H6" />
  </>,
  "/customers": <>
    <path d="M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 4.2a4 4 0 0 1 0 7.6M22 20v-2a4 4 0 0 0-3-3.87" />
    <circle cx="9" cy="7" r="4" />
  </>,
  "/catalog": <>
    <path d="M3 12V4a1 1 0 0 1 1-1h8l9 9a2 2 0 0 1 0 2.8l-6.2 6.2a2 2 0 0 1-2.8 0L3 12Z" />
    <circle cx="7.5" cy="7.5" r="1" />
  </>,
  "/stock-management": <>
    <rect x="2" y="9" width="9" height="11" rx="1" />
    <rect x="13" y="9" width="9" height="11" rx="1" />
    <path d="M7 9V4h10v5M6 14h1M17 14h1M11 4V2M13 4V2" />
  </>,
  "/salesman/reviews": <>
    <rect x="4" y="3" width="16" height="18" rx="2" />
    <path d="M8 8h8M8 12h4M11 16l2 2 4-4" />
  </>,
  "/kpi": <>
    <path d="M3 3v18h18M7 17v-5M12 17V8M17 17V5" />
  </>,
  "/line-access": <>
    <path d="M12 2l8 4v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6l8-4Z" />
    <path d="m8.5 12 2.3 2.3L16 9" />
  </>,
  "/terminals": <>
    <rect x="2" y="4" width="15" height="12" rx="2" />
    <path d="M7 20h5M9.5 16v4" />
    <rect x="18.5" y="8" width="3.5" height="12" rx="1" />
  </>,
  "/salesman": <>
    <rect x="3" y="7" width="18" height="14" rx="2" />
    <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12c4.5 3 13.5 3 18 0M11 13h2" />
  </>,
  "/miniapp?portal=accountant": <>
    <rect x="4" y="3" width="16" height="18" rx="2" />
    <path d="M8 8h8M8 12h2M14 12h2M8 16h2M14 16h2" />
  </>,
};

export function HomeMenuIcon({ href, size = 20 }: { href: string; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {icons[href] ?? <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>}
    </svg>
  );
}
