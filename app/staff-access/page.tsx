import { redirect } from "next/navigation";

// Legacy access editor retired. All account identities and permissions are now
// managed in the unified LINE Authorization screen, even for old bookmarks.
export default function LegacyAccessEditorRedirect() {
  redirect("/line-access");
}
