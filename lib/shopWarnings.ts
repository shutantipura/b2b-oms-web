// Shop-level warnings shown on the Manager/Salesman Shops list.
// Payment due follows the KPI rule: 21:00 Asia/Bangkok on the delivery date.

export type ShopWarningKind = "no_cv" | "no_line" | "overdue_payment";

export type OverduePaymentOrder = {
  order_number: number;
  delivery_date: string;
  group_sequence: number | null;
};

const BANGKOK_OFFSET_HOURS = 7;
const PAYMENT_DUE_HOUR_BANGKOK = 21;

export function paymentDueAt(deliveryDate: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(deliveryDate);
  if (!match) return null;
  const [, y, m, d] = match.map(Number);
  return new Date(Date.UTC(y, m - 1, d, PAYMENT_DUE_HOUR_BANGKOK - BANGKOK_OFFSET_HOURS));
}

export function isPaymentOverdue(deliveryDate: string, now = new Date()): boolean {
  const due = paymentDueAt(deliveryDate);
  return due !== null && now.getTime() > due.getTime();
}

// Today's calendar date in Bangkok, used to pre-filter the order query.
export function bangkokToday(now = new Date()): string {
  return new Date(now.getTime() + BANGKOK_OFFSET_HOURS * 3600_000).toISOString().slice(0, 10);
}

// One bill per group: only the main order (/1) or ungrouped orders count.
export function overdueOrderNumbers(
  orders: OverduePaymentOrder[],
  now = new Date(),
): number[] {
  const numbers = new Set<number>();
  for (const order of orders) {
    if (order.group_sequence !== null && Number(order.group_sequence) !== 1) continue;
    if (isPaymentOverdue(order.delivery_date, now)) numbers.add(Number(order.order_number));
  }
  return [...numbers].sort((a, b) => a - b);
}

export function shopWarnings(shop: {
  cvAccount: { status: string } | null;
  lineLinked: boolean;
  overdueOrders: number[];
}): ShopWarningKind[] {
  const warnings: ShopWarningKind[] = [];
  if (shop.cvAccount?.status !== "approved") warnings.push("no_cv");
  if (!shop.lineLinked) warnings.push("no_line");
  if (shop.overdueOrders.length) warnings.push("overdue_payment");
  return warnings;
}
