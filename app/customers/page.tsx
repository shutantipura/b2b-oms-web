import {redirect} from "next/navigation";

// Customers is now the Shops list. The former statistics/customer-card page
// is intentionally not rendered; deep links to individual shops still work.
export default function CustomersLandingPage(){
  redirect("/customers/shops");
}
