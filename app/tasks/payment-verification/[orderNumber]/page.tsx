import { redirect } from "next/navigation";

/**
 * Payment verification is no longer a separate task.
 * The payment slip is uploaded from /orders/[orderNumber]/payment,
 * and Supabase completes the order after the slip is registered.
 */
export default function LegacyPaymentVerificationPage() {
  redirect("/tasks");
}
