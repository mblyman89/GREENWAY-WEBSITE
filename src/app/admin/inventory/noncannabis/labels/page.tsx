/**
 * /admin/inventory/noncannabis/labels — Label Studio for MANY other-inventory
 * items at once (D177 S5).
 *
 * Owner: glass and other non-cannabis goods "that don't have barcodes" need a
 * label, and the studio "should be connected to receiving". Non-cannabis goods
 * are received by keyed-in vendor invoice (0112), so this page takes:
 *   ?invoice=<uuid>  every product on that invoice; copies default to the
 *                    pieces received on it (qty is a whole count, 0112 CHECK qty > 0)
 *   ?drafts=1        every staged draft (just received, not yet on sale)
 *   ?ids=a,b,c       any chosen items (UUIDs only; junk is dropped, max 200)
 *
 * Non-cannabis items are NOT reported to CCRS; these are price/SKU labels so
 * the register can scan them (SKU or the manufacturer UPC — mergeNcBarcodes).
 */
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { getStoreProfile } from "@/lib/admin/store-profile-store";
import { pacificToday } from "@/lib/reports/timezone";
import { ncSubject } from "@/lib/printing/label-layout-core";
import {
  copiesFromInvoiceLines,
  labelLoadErrorText,
  MAX_BATCH_IDS,
  ncSourceFromRow,
  parseLabelIdList,
  suggestedCopiesForNc,
} from "@/lib/printing/label-studio-core";
import {
  getNcInvoiceForLabels,
  listNcDraftsForLabels,
  listNcProductsForLabels,
  type NcLabelRow,
} from "@/lib/printing/label-batch-store";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { LabelStudio, type StudioItem } from "@/components/admin/labels/LabelStudio";
import { listLabelTemplatesAction } from "@/app/admin/labels/actions";

export const dynamic = "force-dynamic";

const LINK = "text-xs text-[var(--admin-text-muted)] underline hover:text-[var(--admin-accent)]";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function Shell({ subtitle, children }: { subtitle: string; children: React.ReactNode }) {
  return (
    <div>
      <AdminPageHeader
        title="Label Studio"
        subtitle={subtitle}
        action={
          <Link href="/admin/inventory/noncannabis" className={LINK}>
            ← Back to other inventory
          </Link>
        }
      />
      {children}
    </div>
  );
}

function Notice({ tone, children }: { tone: "danger" | "muted"; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl px-5 py-8">
      <div
        role={tone === "danger" ? "alert" : undefined}
        className={
          tone === "danger"
            ? "rounded-[var(--admin-radius-lg)] bg-[var(--admin-danger-soft)] p-4 text-sm text-[var(--admin-danger)]"
            : "rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] p-4 text-sm text-[var(--admin-text-muted)]"
        }
      >
        {children}
      </div>
    </div>
  );
}

export default async function NonCannabisBatchLabelsPage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string | string[]; invoice?: string; drafts?: string }>;
}) {
  await requirePermission("inventory.manage");
  const sp = await searchParams;
  const [profile, saved] = await Promise.all([getStoreProfile(), listLabelTemplatesAction("nc")]);
  const ctx = { storeName: profile.storeName || profile.legalEntity || "Greenway", printedOn: pacificToday() };

  let rows: NcLabelRow[] = [];
  let heading = "Other inventory";
  let copiesFor: (row: NcLabelRow) => { copies: number; suggested: number | null } = (row) => ({
    copies: 1,
    suggested: suggestedCopiesForNc(row.qty_on_hand),
  });
  let suggestLabel = "One per piece on hand";
  const notes: string[] = [];

  const invoiceId = typeof sp.invoice === "string" ? sp.invoice.trim().toLowerCase() : "";
  if (invoiceId) {
    if (!UUID_RE.test(invoiceId)) {
      return (
        <Shell subtitle="Vendor invoice">
          <Notice tone="danger">That invoice link is not valid. Open the invoice from Other Inventory and try again.</Notice>
        </Shell>
      );
    }
    const inv = await getNcInvoiceForLabels(invoiceId);
    if (!inv.ok) {
      return (
        <Shell subtitle="Vendor invoice">
          <Notice tone="danger">{labelLoadErrorText(inv.code, inv.message)}</Notice>
        </Shell>
      );
    }
    if (!inv.invoice) {
      return (
        <Shell subtitle="Vendor invoice">
          <Notice tone="danger">That vendor invoice was not found. It may have been removed.</Notice>
        </Shell>
      );
    }
    const received = copiesFromInvoiceLines(inv.invoice.lines);
    heading = [`Invoice #${inv.invoice.invoiceNumber}`, inv.invoice.vendorName, inv.invoice.invoiceDate].filter(Boolean).join(" · ");
    const loaded = await listNcProductsForLabels([...received.keys()]);
    if (!loaded.ok) {
      return (
        <Shell subtitle={heading}>
          <Notice tone="danger">{labelLoadErrorText(loaded.code, loaded.message)}</Notice>
        </Shell>
      );
    }
    rows = loaded.rows;
    const gone = inv.invoice.lines.filter((l) => !l.product_id).length + (received.size - rows.length);
    if (gone > 0) notes.push(`${gone} invoice line${gone === 1 ? "" : "s"} no longer link to a product and were left out.`);
    copiesFor = (row) => {
      const n = received.get(String(row.id).toLowerCase()) ?? null;
      return { copies: 1, suggested: n };
    };
    suggestLabel = "One per piece received";
  } else if (sp.drafts === "1") {
    heading = "Staged drafts (just received)";
    const loaded = await listNcDraftsForLabels();
    if (!loaded.ok) {
      return (
        <Shell subtitle={heading}>
          <Notice tone="danger">{labelLoadErrorText(loaded.code, loaded.message)}</Notice>
        </Shell>
      );
    }
    rows = loaded.rows;
  } else {
    const parsed = parseLabelIdList(sp.ids);
    if (parsed.dropped > 0) notes.push(`${parsed.dropped} entr${parsed.dropped === 1 ? "y was" : "ies were"} not a valid item id and were ignored.`);
    if (parsed.capped) notes.push(`Only the first ${MAX_BATCH_IDS} items are shown — print in smaller groups.`);
    const loaded = await listNcProductsForLabels(parsed.ids);
    if (!loaded.ok) {
      return (
        <Shell subtitle={heading}>
          <Notice tone="danger">{labelLoadErrorText(loaded.code, loaded.message)}</Notice>
        </Shell>
      );
    }
    rows = loaded.rows;
    const missing = parsed.ids.length - rows.length;
    if (missing > 0) notes.push(`${missing} item${missing === 1 ? " was" : "s were"} not found and left out.`);
  }

  const items: StudioItem[] = rows.map((row) => {
    const c = copiesFor(row);
    return { subject: ncSubject(ncSourceFromRow(row), ctx), copies: c.copies, suggestedCopies: c.suggested };
  });

  return (
    <Shell subtitle={`${heading} · ${items.length} item${items.length === 1 ? "" : "s"}`}>
      {notes.length > 0 ? (
        <div className="mx-auto max-w-6xl px-5 pt-4 sm:px-8">
          <ul className="rounded-[var(--admin-radius)] border border-[var(--admin-gold)]/40 bg-[var(--admin-gold)]/10 px-4 py-2 text-xs text-[var(--admin-text)]">
            {notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {items.length === 0 ? (
        <Notice tone="muted">
          Nothing to label here. Pick items from <Link href="/admin/inventory/noncannabis" className="underline">Other inventory</Link>, or
          print a single item from its 🏷 Print label link.
        </Notice>
      ) : (
        <LabelStudio kind="nc" items={items} contextLine={heading} suggestLabel={suggestLabel} saved={saved} />
      )}
    </Shell>
  );
}
