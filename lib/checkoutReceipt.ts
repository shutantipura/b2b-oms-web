/** Persisted, non-sensitive checkout acknowledgement for LINE WebView reloads.
 * A confirmed order should not turn into an empty-cart screen on remount.
 */
export type CheckoutReceipt = {
  customerCode: string;
  orderNumber: number;
  displayNumber: string;
  grouped: boolean;
  savedAt: number;
};

export const CHECKOUT_RECEIPT_MAX_AGE_MS = 48 * 60 * 60 * 1000;

export function checkoutReceiptKey(customerCode: string): string {
  return `b2b-checkout-receipt-${customerCode.trim().toUpperCase()}`;
}

export function parseCheckoutReceipt(
  raw: string | null,
  customerCode: string,
  now = Date.now(),
): CheckoutReceipt | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const data = value as Record<string, unknown>;
    const normalizedCode = customerCode.trim().toUpperCase();
    if (data.customerCode !== normalizedCode ||
        typeof data.orderNumber !== "number" ||
        !Number.isSafeInteger(data.orderNumber) || data.orderNumber <= 0 ||
        typeof data.displayNumber !== "string" ||
        !/^\d+(?:\/\d+)?$/.test(data.displayNumber) ||
        typeof data.grouped !== "boolean" ||
        typeof data.savedAt !== "number" ||
        !Number.isFinite(data.savedAt) ||
        data.savedAt > now + 60_000 ||
        now - data.savedAt > CHECKOUT_RECEIPT_MAX_AGE_MS) {
      return null;
    }
    return {
      customerCode: normalizedCode,
      orderNumber: data.orderNumber,
      displayNumber: data.displayNumber,
      grouped: data.grouped,
      savedAt: data.savedAt,
    };
  } catch {
    return null;
  }
}
