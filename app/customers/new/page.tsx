import {redirect} from "next/navigation";
// Shops and CV numbers are independent; old customer creation must not bypass
// the Manager approval workflow for CV numbers.
export default function NewCustomerPage(){redirect("/customers/shops");}
