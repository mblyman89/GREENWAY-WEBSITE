/**
 * SLICE 8 — the BULK FILL panel.
 *
 * Design is taken from the enterprise patterns researched this round, adapted
 * where cannabis-traceability stakes conflict with convenience:
 *
 *  - Basis Design System "Bulk Editing": an explicit bulk-edit MODE entered from
 *    a button above the table; the selection COUNT is carried in the action
 *    button; the edit step has a CONTEXTUAL HEADER naming the field, the count
 *    and the item type; and a CHANGES PREVIEW precedes any write.
 *  - Eleken "Bulk actions UX": eligibility is communicated, never hidden —
 *    skipped rows are listed WITH their reason rather than silently dropped;
 *    the result summary distinguishes filled / skipped / failed.
 *  - Pencil & Paper "Data Table Design": deliberate FRICTION for high-stakes
 *    data (a two-step confirm, not inline auto-save), and numbers right-aligned
 *    with tabular figures.
 *
 * Rejected on purpose: optimistic UI and undo-after-the-fact. A write that lands
 * in a state traceability table is confirmed BEFORE it happens, not reversed
 * after. That is also standing rule 3 (drafts-only), so the preview step serves
 * the research and the rules at once.
 *
 * This is a SERVER component: it renders from the URL's query string, which the
 * server action round-trips. No client JavaScript is required for the preview →
 * confirm flow, so it cannot desynchronise from the server's decision.
 */
import Link from "next/link";
import {
  BULK_FILLABLE_FIELDS,
  fieldLabel,
  type BulkFillField,
} from "@/lib/inventory/bulk-fill-core";
import { bulkFillLotsAction } from "@/app/admin/inventory/actions";

export type BulkFillPanelProps = {
  /** Lots currently visible in the table — the pool a selection is drawn from. */
  visibleLotIds: readonly string[];
  /** Query-string state round-tripped by the server action. */
  field?: string;
  value?: string;
  previewCount?: string;
  skippedCount?: string;
  previewIds?: string;
  doneCount?: string;
  failedCount?: string;
  error?: string;
};

function isField(v: string | undefined): v is BulkFillField {
  return !!v && (BULK_FILLABLE_FIELDS as readonly string[]).includes(v);
}

/** Placeholder + input type per field, so the owner is guided, not guessed at. */
function inputProps(field: BulkFillField): { type: string; placeholder: string; hint: string } {
  switch (field) {
    case "expires_on":
      return {
        type: "date",
        placeholder: "YYYY-MM-DD",
        hint: "Read the expiration date off the physical package or the COA.",
      };
    case "unit_cost_minor_units":
      return {
        type: "text",
        placeholder: "12.50",
        hint: "Read the unit cost off the vendor invoice. Dollars — stored to the cent.",
      };
    case "pos_product_key":
      return {
        type: "text",
        placeholder: "SKU-1234",
        hint: "The catalog key that links this lot to a product.",
      };
  }
}

export default function BulkFillPanel(props: BulkFillPanelProps) {
  const {
    visibleLotIds,
    field,
    value,
    previewCount,
    skippedCount,
    previewIds,
    doneCount,
    failedCount,
    error,
  } = props;

  const selectedField = isField(field) ? field : null;
  const nPreview = Number(previewCount ?? "");
  const nSkipped = Number(skippedCount ?? "");
  const nDone = Number(doneCount ?? "");
  const nFailed = Number(failedCount ?? "");
  const hasPreview = Number.isFinite(nPreview) && (previewCount ?? "") !== "";
  const hasResult = Number.isFinite(nDone) && (doneCount ?? "") !== "";
  const confirmIds = (previewIds ?? "").split(",").filter(Boolean);

  return (
    <section className="mb-6 rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
      <header className="mb-4">
        <h2 className="text-base font-semibold text-[var(--admin-text)]">
          Bulk fill — complete what the Cultivera import left blank
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-[var(--admin-text-muted)]">
          The one-time POS import recorded that some fields were missing and would be{" "}
          <em>set during enrichment</em>. This fills those blanks across many lots at once.
          It can only turn a <strong>blank</strong> into a value, only on lots from that
          one-time import, and it never overwrites a value that is already there.
        </p>
      </header>

      {/* ---- result banner (after an apply) ------------------------------ */}
      {hasResult && (
        <div className="mb-4 rounded-[var(--admin-radius)] border border-[var(--admin-green,#2f9e44)]/40 bg-[var(--admin-green,#2f9e44)]/10 px-4 py-3 text-sm">
          <p className="font-medium text-[var(--admin-text)]">
            Filled {nDone} {nDone === 1 ? "lot" : "lots"}.
          </p>
          {Number.isFinite(nSkipped) && nSkipped > 0 && (
            <p className="mt-1 text-[var(--admin-text-muted)]">
              {nSkipped} skipped — already had a value, not from the one-time import, or
              destroyed. Nothing existing was overwritten.
            </p>
          )}
          {Number.isFinite(nFailed) && nFailed > 0 && (
            <p className="mt-1 text-[var(--admin-orange)]">
              {nFailed} could not be written — re-run to retry those.
            </p>
          )}
        </div>
      )}

      {/* ---- error banner ------------------------------------------------ */}
      {error && (
        <div className="mb-4 rounded-[var(--admin-radius)] border border-[var(--admin-orange)]/40 bg-[var(--admin-orange)]/10 px-4 py-3 text-sm text-[var(--admin-text)]">
          {error}
        </div>
      )}

      {/* ---- STEP 2: the changes preview + confirm ----------------------- */}
      {hasPreview && selectedField ? (
        <div className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
          {/* Contextual header: field, count, item type (Basis). */}
          <h3 className="text-sm font-semibold text-[var(--admin-text)]">
            Review before saving — {fieldLabel(selectedField)} on {nPreview}{" "}
            {nPreview === 1 ? "lot" : "lots"}
          </h3>
          <p className="mt-1 text-sm text-[var(--admin-text-muted)]">
            Nothing has been saved yet.{" "}
            {nPreview > 0 ? (
              <>
                <strong className="text-[var(--admin-text)]">{nPreview}</strong>{" "}
                {nPreview === 1 ? "lot has" : "lots have"} a blank{" "}
                {fieldLabel(selectedField).toLowerCase()} and will be set to{" "}
                <strong className="text-[var(--admin-text)]">{value}</strong>.
              </>
            ) : (
              <>None of the selected lots can be filled.</>
            )}
          </p>
          {Number.isFinite(nSkipped) && nSkipped > 0 && (
            <p className="mt-2 text-sm text-[var(--admin-orange)]">
              {nSkipped} of the lots you selected will be skipped: they already have a
              value, are not from the one-time Cultivera import, or are destroyed. Those
              are protected and will not be changed.
            </p>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            {nPreview > 0 && (
              <form action={bulkFillLotsAction}>
                <input type="hidden" name="mode" value="apply" />
                <input type="hidden" name="field" value={selectedField} />
                <input type="hidden" name="value" value={value ?? ""} />
                {confirmIds.map((id) => (
                  <input key={id} type="hidden" name="lot_ids" value={id} />
                ))}
                <button
                  type="submit"
                  className="rounded-[var(--admin-radius)] bg-[var(--admin-accent)] px-4 py-2 text-sm font-semibold text-black"
                >
                  Save {nPreview} {nPreview === 1 ? "change" : "changes"}
                </button>
              </form>
            )}
            <Link
              href="/admin/inventory?bulk=1"
              className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] px-4 py-2 text-sm text-[var(--admin-text-muted)]"
            >
              Cancel
            </Link>
          </div>
        </div>
      ) : (
        /* ---- STEP 1: choose field + value, preview -------------------- */
        <form action={bulkFillLotsAction} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="mode" value="preview" />
          {/* The selection. Defaults to every lot the current filters show, so
              the owner can pair this with the SLICE 7 gap worklists: filter to
              "missing expiry", then fill them all. */}
          {visibleLotIds.map((id) => (
            <input key={id} type="hidden" name="lot_ids" value={id} />
          ))}

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wide text-[var(--admin-text-faint)]">
              Field
            </span>
            <select
              name="field"
              defaultValue={selectedField ?? "expires_on"}
              className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm text-[var(--admin-text)]"
            >
              {BULK_FILLABLE_FIELDS.map((f) => (
                <option key={f} value={f}>
                  {fieldLabel(f)}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wide text-[var(--admin-text-faint)]">
              Value
            </span>
            <input
              name="value"
              defaultValue={value ?? ""}
              placeholder={inputProps(selectedField ?? "expires_on").placeholder}
              className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm text-[var(--admin-text)]"
            />
          </label>

          {/* Selection count carried in the button (Basis). */}
          <button
            type="submit"
            className="rounded-[var(--admin-radius)] bg-[var(--admin-accent)] px-4 py-2 text-sm font-semibold text-black"
          >
            Preview fill for {visibleLotIds.length}{" "}
            {visibleLotIds.length === 1 ? "lot" : "lots"}
          </button>

          <Link
            href="/admin/inventory"
            className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] px-4 py-2 text-sm text-[var(--admin-text-muted)]"
          >
            Exit bulk fill
          </Link>

          <p className="w-full text-xs text-[var(--admin-text-faint)]">
            {inputProps(selectedField ?? "expires_on").hint} Applies to the{" "}
            {visibleLotIds.length} {visibleLotIds.length === 1 ? "lot" : "lots"} matching
            your current filters — narrow the filters first to target a smaller set.
          </p>
        </form>
      )}
    </section>
  );
}
