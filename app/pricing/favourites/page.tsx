import { redirect } from "next/navigation";

export default function PricingFavouritesRedirect() {
  redirect("/customers/favourites");
}
