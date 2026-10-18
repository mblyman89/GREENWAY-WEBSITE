import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * R73 S3: Website -> Merchandise -> "Merch Ad Card (on Shop)".
 * The ad card already has one home (Merch Studio, Publish & Ads tab, R71 S4),
 * so this nav entry just sends staff there rather than duplicating the editor.
 */
export default async function MerchAdCardPage() {
  await requirePermission("content.edit");
  redirect("/admin/merch-studio?tab=publish");
}
