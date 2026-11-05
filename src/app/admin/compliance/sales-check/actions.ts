"use server";

/**
 * /admin/compliance/sales-check: the lot repair buttons (D183, round slice S6).
 *
 * Owner only (requireBooksAccess): these change what CCRS is told. Partner AI
 * Level 2 (D184) may PROPOSE these repairs; only these audited actions apply
 * them. Each one re-checks against fresh data before writing (the page can be
 * minutes old) and changes no stock and no money.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireBooksAccess } from "@/lib/accounting/books-access";
import { correctCount, moveSaleLine, SALES_CHECK_PAGE } from "@/lib/compliance/ccrs-completeness-store";

function s(fd: FormData, k: string): string {
  return String(fd.get(k) ?? "").trim();
}

function back(q: string): never {
  redirect(`${SALES_CHECK_PAGE}?${q}#lots`);
}

export async function moveSaleLineAction(fd: FormData): Promise<void> {
  const session = await requireBooksAccess();
  const quantity = Number(s(fd, "quantity"));
  const out = await moveSaleLine(
    {
      kind: "move",
      lineId: s(fd, "lineId"),
      detailId: s(fd, "detailId"),
      quantity: Number.isFinite(quantity) ? quantity : 0,
      fromLotId: s(fd, "fromLotId"),
      fromExt: s(fd, "fromExt"),
      toLotId: s(fd, "toLotId"),
      toExt: s(fd, "toExt"),
      toLotCode: s(fd, "toLotCode") || null,
      sameProductKey: s(fd, "sameProductKey") === "1",
    },
    { id: session.profile.id, email: session.email },
  );
  revalidatePath(SALES_CHECK_PAGE);
  back(out.ok ? `saved=${encodeURIComponent(out.message)}` : `error=${encodeURIComponent(out.error)}`);
}

export async function correctCountAction(fd: FormData): Promise<void> {
  const session = await requireBooksAccess();
  const quantity = Number(s(fd, "quantity"));
  const out = await correctCount(
    { kind: "count", lotId: s(fd, "lotId"), ext: s(fd, "ext"), quantity: Number.isFinite(quantity) ? quantity : 0 },
    { id: session.profile.id, email: session.email },
  );
  revalidatePath(SALES_CHECK_PAGE);
  back(out.ok ? `saved=${encodeURIComponent(out.message)}` : `error=${encodeURIComponent(out.error)}`);
}
