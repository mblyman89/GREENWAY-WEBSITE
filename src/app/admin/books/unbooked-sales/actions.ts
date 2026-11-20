"use server";
/** D261: re-post refused sales into the books (owner only). */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireBooksAccess } from "@/lib/accounting/books-access";

export async function repostUnbookedAction(formData: FormData) {
  await requireBooksAccess();
  const orderNumber = String(formData.get("order") ?? "").trim() || undefined;
  const { repostUnbooked } = await import("@/lib/accounting/unbooked-sales-store");
  let msg: string;
  try {
    const r = await repostUnbooked({ orderNumber, max: 40 });
    msg = `Booked ${r.posted}.` + (r.failed.length ? ` Still refused ${r.failed.length}: ${r.failed.slice(0, 5).join(" | ")}` : "");
  } catch (err) {
    msg = `Stopped: ${err instanceof Error ? err.message : String(err)}`;
  }
  revalidatePath("/admin/books/unbooked-sales");
  redirect(`/admin/books/unbooked-sales?msg=${encodeURIComponent(msg.slice(0, 900))}`);
}
