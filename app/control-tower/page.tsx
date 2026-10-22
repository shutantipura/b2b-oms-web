import { redirect } from "next/navigation";

export default function ControlTowerRedirect() {
  redirect("/staff?tab=responsibilities");
}
