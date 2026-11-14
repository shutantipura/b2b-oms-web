// A missing, empty, or zero-quantity basket is normal and should render the
// empty-cart view instead of a checkout failure. Keep genuine API/auth errors
// separate from this client-side display state.
export function cartHasPositiveQuantity(value: unknown): value is Record<string, number> {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.values(value).some(quantity => Number(quantity) > 0);
}
