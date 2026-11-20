/**
 * /admin/books/unbooked-sales  (D261, owner only)
 *
 * Sales the books refused, with a button to re-post them (40 per click), a
 * box to post one order by number (e.g. a sale never attempted), and the list
 * of sales that booked with a FLAG to fix: a lot topped up because the count
 * said zero, a duplicate card costed by barcode, or a line with no lot or cost
 * anywhere that was left out.
 */
import { requireBooksAccess } from "@/lib/accounting/books-access";
import { readUnbooked, type UnbookedRow } from "@/lib/accounting/unbooked-sales-store";
import { repostUnbookedAction } from "./actions";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const usd = (c: number) => `$${(c / 100).toFixed(2)}`;

function Table({ rows, testId }: { rows: UnbookedRow[]; testId: string }) {
  if (rows.length === 0) return <p className="text-sm text-gray-500">None.</p>;
  return (
    <table className="w-full text-sm" data-testid={testId}>
      <thead>
        <tr className="text-left text-gray-500">
          <th className="py-1 pr-3">Order</th>
          <th className="py-1 pr-3">Completed</th>
          <th className="py-1 pr-3">Total</th>
          <th className="py-1">Note</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.orderId + r.note.slice(0, 20)} className="border-t align-top">
            <td className="py-1 pr-3 whitespace-nowrap">
              <a className="underline" href={`/admin/orders/${r.orderId}`}>{r.orderNumber}</a>
            </td>
            <td className="py-1 pr-3 whitespace-nowrap">{r.at.slice(0, 10)}</td>
            <td className="py-1 pr-3">{usd(r.totalCents)}</td>
            <td className="py-1 text-xs">{r.note}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default async function UnbookedSalesPage({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  await requireBooksAccess();
  const { msg } = await searchParams;
  const { refused, flagged } = await readUnbooked();
  const refusedTotal = refused.reduce((a, r) => a + r.totalCents, 0);
  return (
    <div className="space-y-6 p-6">
      <h1 className="text-2xl font-semibold">Sales not in the books</h1>
      {msg ? <p className="rounded border bg-yellow-50 p-3 text-sm" data-testid="unbooked-msg">{msg}</p> : null}
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Refused: {refused.length} sale(s), {usd(refusedTotal)}</h2>
        <p className="text-sm text-gray-600">
          Re-post books the good lines, costs short products from their own lot (flagged below), and leaves out only lines with no lot or cost anywhere.
        </p>
        <form action={repostUnbookedAction} className="flex flex-wrap items-center gap-2">
          <input name="order" placeholder="Order number (optional, e.g. GWY-PMLA3F)" className="rounded border px-2 py-1 text-sm" />
          <button className="rounded bg-green-700 px-3 py-1 text-sm text-white" data-testid="unbooked-repost">Re-post (40 per click, or the one order)</button>
        </form>
        <Table rows={refused} testId="unbooked-refused" />
      </section>
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Booked with a flag to fix: {flagged.length}</h2>
        <p className="text-sm text-gray-600">Recount the lots named here (they were topped up so the sale could book), and fix any duplicate card or left-out product.</p>
        <Table rows={flagged} testId="unbooked-flagged" />
      </section>
    </div>
  );
}
