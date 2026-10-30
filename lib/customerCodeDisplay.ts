/** Display-only label. Always retain the real code for URLs, API calls and orders. */
export function displayCustomerCode(customerCode: string, hasNoCv?: boolean | null): string {
  return hasNoCv || /^NCV-/i.test(customerCode.trim()) ? "ไม่มี CV" : customerCode;
}
