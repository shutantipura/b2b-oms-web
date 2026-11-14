import { redirect } from "next/navigation";

// Staff creation, LINE linking and stage permissions now live in one place.
// Keep the old link alive for bookmarks, without exposing a second editor.
export default function LegacyStaffManagementRedirect() {
  redirect("/line-access");
}
