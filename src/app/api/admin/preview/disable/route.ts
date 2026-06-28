/**
 * Disable Next.js Draft Mode and return to the given path (now showing the
 * published site). Safe to call by anyone — it only turns preview OFF.
 *
 * GET /api/admin/preview/disable?path=/menu
 */
import { draftMode } from "next/headers";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

function safePath(raw: string | null): string {
  if (!raw) return "/";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const path = safePath(url.searchParams.get("path"));

  const dm = await draftMode();
  dm.disable();

  redirect(path);
}
