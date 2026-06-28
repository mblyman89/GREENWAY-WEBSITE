/**
 * Enable Next.js Draft Mode for a staff member, then redirect to the public
 * page they want to preview. While Draft Mode is on, public pages render the
 * DRAFT value of content blocks (via getContentForRender), so editors see
 * their unpublished changes live.
 *
 * GET /api/admin/preview/enable?path=/menu
 *
 * Gated on a valid staff session — random visitors cannot turn on Draft Mode.
 */
import { draftMode } from "next/headers";
import { redirect } from "next/navigation";
import { getStaffSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

function safePath(raw: string | null): string {
  if (!raw) return "/";
  // Only allow same-site absolute paths (prevent open redirect).
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}

export async function GET(request: Request) {
  const session = await getStaffSession();
  if (!session) {
    // Not signed in as staff — send to admin login.
    redirect("/admin/login");
  }

  const url = new URL(request.url);
  const path = safePath(url.searchParams.get("path"));

  const dm = await draftMode();
  dm.enable();

  redirect(path);
}
