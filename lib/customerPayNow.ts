export type PaymentReadyOrder = {
  orderNumber: number;
  finalAmount: number | null;
};

// An incomplete bill must not make a partial sum look like the full amount due.
// Add in satang to avoid floating-point display errors such as 0.1 + 0.2.
export function summarizeOutstandingPayments(orders: PaymentReadyOrder[]): {
  count: number;
  totalAmount: number | null;
} {
  let totalSatang = 0;
  for (const order of orders) {
    const amount = order.finalAmount;
    if (amount === null || !Number.isFinite(amount) || amount < 0) {
      return { count: orders.length, totalAmount: null };
    }
    const satang = Math.round(amount * 100);
    if (!Number.isSafeInteger(satang) || !Number.isSafeInteger(totalSatang + satang)) {
      return { count: orders.length, totalAmount: null };
    }
    totalSatang += satang;
  }
  return { count: orders.length, totalAmount: totalSatang / 100 };
}

type PaymentOrderRow = {
  order_number: number;
  status: string;
  group_sequence: number | null;
  group_root_order_id?: string | null;
  final_amount: number | string | null;
};

type PaymentRoot = { order_number: number; final_amount: number | string | null };

// Only the main order of a grouped bill may be paid. Child /2, /3, ...
// orders must never create separate payment buttons for the same invoice.
export function getPaymentReadyOrders(
  orders: PaymentOrderRow[],
  rootsById: Map<string, PaymentRoot> = new Map(),
): PaymentReadyOrder[] {
  const seen = new Set<number>();
  const payable: PaymentReadyOrder[] = [];

  for (const order of orders) {
    const root = order.group_root_order_id
      ? rootsById.get(order.group_root_order_id)
      : null;
    const paymentOrderNumber = root?.order_number ?? order.order_number;
    if (order.status !== "awaiting_payment" ||
        (order.group_sequence !== null && Number(order.group_sequence) !== 1) ||
        seen.has(paymentOrderNumber)) continue;

    seen.add(paymentOrderNumber);
    const billedAmount = root?.final_amount ?? order.final_amount;
    const amount = billedAmount === null ? null : Number(billedAmount);
    payable.push({
      orderNumber: paymentOrderNumber,
      finalAmount: amount !== null && Number.isFinite(amount) ? amount : null,
    });
  }

  return payable;
}
