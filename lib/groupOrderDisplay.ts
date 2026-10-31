// One commercial order may consist of several independently picked /x suborders.
// This is presentation-only: do not mutate orders, billing or pick audit rows.
export type GroupOrderBase = {
  id: string;
  order_number: number;
  group_root_order_id: string | null;
  group_sequence: number | null;
  status: string;
};

export type OrderListGroup<T extends GroupOrderBase> = {
  order: T;
  members: T[];
  consolidated: boolean;
};

const POST_PICKING = new Set([
  "awaiting_billing", "billing", "ready_for_delivery",
  "out_for_delivery", "awaiting_payment", "payment_submitted", "completed"
]);

export function isFinishedPicking(status: string): boolean {
  return POST_PICKING.has(status);
}

export function isConsolidatedGroup<T extends GroupOrderBase>(members: T[]): boolean {
  // Do not silently hide cancelled or unpicked suborders in the audit list.
  return members.length > 1 && members.every(m => isFinishedPicking(m.status));
}

export function orderDisplayNumber<T extends GroupOrderBase>(
  order: T, rootNumber: number | null
): string {
  return order.group_root_order_id && order.group_sequence != null
    ? `${rootNumber ?? order.order_number}/${order.group_sequence}`
    : String(order.order_number);
}

export function groupOrdersForManagement<T extends GroupOrderBase>(orders: T[]): OrderListGroup<T>[] {
  const byId = new Map(orders.map(order => [order.id, order]));
  const membersByRoot = new Map<string,T[]>();
  for (const order of orders) {
    if (!order.group_root_order_id) continue;
    const list = membersByRoot.get(order.group_root_order_id) ?? [];
    list.push(order);
    membersByRoot.set(order.group_root_order_id, list);
  }
  const hidden = new Set<string>();
  const grouped = new Map<string, OrderListGroup<T>>();
  for (const [rootId, members] of membersByRoot) {
    const root = byId.get(rootId);
    if (!root || !members.some(m => m.id === rootId) || !isConsolidatedGroup(members)) continue;
    // A group's delivery details must be consistent before collapsing them.
    for (const member of members) if (member.id !== rootId) hidden.add(member.id);
    grouped.set(rootId, {
      order: root,
      members: [...members].sort((a,b) => (a.group_sequence ?? 0) - (b.group_sequence ?? 0)),
      consolidated: true
    });
  }
  return orders.filter(order => !hidden.has(order.id))
    .map(order => grouped.get(order.id) ?? { order, members: [order], consolidated: false });
}
