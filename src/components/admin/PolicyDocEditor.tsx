"use client";

/**
 * PolicyDocEditor — the row-by-row editor for one legal policy body
 * (Privacy Policy · Terms of Use · Consumer Health Data), SLICE 105b.
 *
 * The body is stored as ONE "richdoc" content block whose value is a JSON
 * document of heading/paragraph rows (see policy-doc-core.ts). This component
 * lets a novice edit that document safely WITHOUT ever seeing JSON:
 *   - each row is a heading or a paragraph (toggle),
 *   - add / remove / move up / move down,
 *   - a live "as customers see it" preview of the whole document,
 *   - Save draft (nothing goes live) and Publish (updates the public page),
 *   - a prominent legal-wording caution banner.
 *
 * It serializes rows into the hidden `draft_value` field and posts to the SAME
 * content-block store used everywhere else (draft → publish → revision), via
 * the thin server actions in ../../app/admin/legal-policies/actions.ts.
 */
import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/admin/ui";
import {
  parsePolicyDoc,
  rowsFromParagraphs,
  serializePolicyDoc,
  makeEmptyRow,
  type PolicyRow,
} from "@/lib/cms/policy-doc-core";

export type PolicyRevisionVM = {
  id: string;
  created_at: string;
  actor_email: string | null;
};

type Props = {
  docKey: string;
  /** Human label for this policy (e.g. "Privacy Policy"). */
  label: string;
  /** Public route so "View live page" opens the right page. */
  publicPath: string;
  /** Current draft JSON (what the editor should load). */
  draftJson: string | null;
  /** Current published JSON (for the "unpublished changes" hint). */
  publishedJson: string | null;
  /** Vetted hardcoded fallback paragraphs (used if both DB values are empty). */
  fallbackParagraphs: readonly string[];
  /** Newest-first publish history for restore. */
  revisions: PolicyRevisionVM[];
  saveDraftAction: (formData: FormData) => void;
  publishAction: (formData: FormData) => void;
  restoreAction: (formData: FormData) => void;
};

function initialRows(props: Props): PolicyRow[] {
  const fromDraft = parsePolicyDoc(props.draftJson);
  if (fromDraft && fromDraft.length > 0) return fromDraft;
  const fromPublished = parsePolicyDoc(props.publishedJson);
  if (fromPublished && fromPublished.length > 0) return fromPublished;
  return rowsFromParagraphs(props.fallbackParagraphs, props.docKey);
}

export function PolicyDocEditor(props: Props) {
  const {
    docKey,
    label,
    publicPath,
    publishedJson,
    revisions,
    saveDraftAction,
    publishAction,
    restoreAction,
  } = props;

  const [rows, setRows] = useState<PolicyRow[]>(() => initialRows(props));
  const [showPreview, setShowPreview] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const serialized = useMemo(() => serializePolicyDoc(rows), [rows]);

  // "Unpublished changes" = current editor rows differ from the published doc.
  const publishedRows = useMemo(() => parsePolicyDoc(publishedJson), [publishedJson]);
  const dirtyVsPublished = useMemo(
    () => serializePolicyDoc(publishedRows ?? []) !== serialized,
    [publishedRows, serialized],
  );

  const headingCount = rows.filter((r) => r.kind === "heading").length;
  const paragraphCount = rows.length - headingCount;

  function updateRow(id: string, patch: Partial<PolicyRow>) {
    setRows((cur) => cur.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }
  function removeRow(id: string) {
    setRows((cur) => cur.filter((r) => r.id !== id));
  }
  function moveRow(index: number, dir: -1 | 1) {
    setRows((cur) => {
      const next = [...cur];
      const target = index + dir;
      if (target < 0 || target >= next.length) return cur;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }
  function addRow(index: number, kind: "heading" | "paragraph") {
    setRows((cur) => {
      const next = [...cur];
      next.splice(index + 1, 0, makeEmptyRow(docKey, kind));
      return next;
    });
  }

  const cautionBanner = (
    <div className="rounded-[var(--admin-radius)] border-2 border-[var(--admin-gold)]/60 bg-[var(--admin-gold)]/10 px-4 py-3 text-sm text-[var(--admin-text)]">
      <strong className="font-black uppercase tracking-wide text-[var(--admin-gold)]">
        Heads up — this is legal wording.
      </strong>{" "}
      Changes here update what customers read on your <em>{label}</em> page. Consider having your
      attorney review edits before you Publish. Nothing goes live until you click{" "}
      <strong>Publish {label}</strong>. Every publish is saved to history so you can roll back.
    </div>
  );

  return (
    <div className="space-y-5">
      {cautionBanner}

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="rounded-full bg-[var(--admin-surface-2)] px-3 py-1 text-[var(--admin-text-muted)]">
          {rows.length} rows · {headingCount} headings · {paragraphCount} paragraphs
        </span>
        {dirtyVsPublished ? (
          <span className="rounded-full bg-[var(--admin-gold)]/15 px-3 py-1 font-semibold text-[var(--admin-gold)]">
            Unpublished changes
          </span>
        ) : (
          <span className="rounded-full bg-[var(--admin-accent-soft)] px-3 py-1 font-semibold text-[var(--admin-accent)]">
            Live &amp; up to date
          </span>
        )}
        <button
          type="button"
          onClick={() => setShowPreview((v) => !v)}
          className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] px-3 py-1 font-medium text-[var(--admin-text)] hover:bg-[var(--admin-surface-hover)]"
        >
          {showPreview ? "Hide" : "Show"} customer preview
        </button>
        <a
          href={publicPath}
          target="_blank"
          rel="noreferrer"
          className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] px-3 py-1 font-medium text-[var(--admin-text)] hover:bg-[var(--admin-surface-hover)]"
        >
          View live page ↗
        </a>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ---------- Editor column ---------- */}
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => addRow(-1, "heading")}
            className="w-full rounded-[var(--admin-radius-sm)] border border-dashed border-[var(--admin-border)] py-2 text-sm font-medium text-[var(--admin-text-muted)] hover:border-[var(--admin-accent)] hover:text-[var(--admin-accent)]"
          >
            + Add a section at the top
          </button>

          {rows.map((row, index) => (
            <div
              key={row.id}
              className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3"
            >
              <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                <div className="inline-flex overflow-hidden rounded-full border border-[var(--admin-border)]">
                  <button
                    type="button"
                    onClick={() => updateRow(row.id, { kind: "heading" })}
                    className={`px-3 py-1 font-semibold ${
                      row.kind === "heading"
                        ? "bg-[var(--admin-accent)] text-black"
                        : "text-[var(--admin-text-muted)]"
                    }`}
                  >
                    Heading
                  </button>
                  <button
                    type="button"
                    onClick={() => updateRow(row.id, { kind: "paragraph" })}
                    className={`px-3 py-1 font-semibold ${
                      row.kind === "paragraph"
                        ? "bg-[var(--admin-accent)] text-black"
                        : "text-[var(--admin-text-muted)]"
                    }`}
                  >
                    Paragraph
                  </button>
                </div>
                <span className="text-[var(--admin-text-muted)]">Row {index + 1}</span>
                <div className="ml-auto flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => moveRow(index, -1)}
                    disabled={index === 0}
                    aria-label="Move up"
                    className="rounded border border-[var(--admin-border)] px-2 py-1 text-[var(--admin-text)] hover:bg-[var(--admin-surface-hover)] disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => moveRow(index, 1)}
                    disabled={index === rows.length - 1}
                    aria-label="Move down"
                    className="rounded border border-[var(--admin-border)] px-2 py-1 text-[var(--admin-text)] hover:bg-[var(--admin-surface-hover)] disabled:opacity-30"
                  >
                    ↓
                  </button>
                  <Button
                    variant="danger"
                    size="sm"
                    type="button"
                    onClick={() => removeRow(row.id)}
                    aria-label="Delete row"
                  >
                    Delete
                  </Button>
                </div>
              </div>
              <textarea
                value={row.text}
                onChange={(e) => updateRow(row.id, { text: e.target.value })}
                rows={row.kind === "heading" ? 1 : 4}
                placeholder={row.kind === "heading" ? "Section heading…" : "Paragraph text…"}
                className={`w-full resize-y rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm text-[var(--admin-text)] placeholder:text-[var(--admin-text-faint)] focus:border-[var(--admin-accent)] focus:outline-none ${
                  row.kind === "heading" ? "font-bold" : ""
                }`}
              />
              <button
                type="button"
                onClick={() => addRow(index, "paragraph")}
                className="mt-2 text-xs font-medium text-[var(--admin-accent)] hover:underline"
              >
                + Add row below
              </button>
            </div>
          ))}

          {rows.length === 0 ? (
            <p className="text-sm text-[var(--admin-text-muted)]">
              This document is empty. Add a section or paragraph to begin.
            </p>
          ) : null}
        </div>

        {/* ---------- Preview column ---------- */}
        {showPreview ? (
          <div className="lg:sticky lg:top-4 lg:self-start">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">
              As customers see it
            </div>
            <div className="max-h-[70vh] overflow-auto rounded-[var(--admin-radius-lg)] border border-white/10 bg-black p-5 text-white">
              <div className="space-y-4 text-sm leading-7">
                {rows.map((row) =>
                  row.kind === "heading" ? (
                    <h2 key={row.id} className="pt-1 text-lg font-black text-white">
                      {row.text || <span className="text-white/40">(empty heading)</span>}
                    </h2>
                  ) : (
                    <p key={row.id} className="text-white/90">
                      {row.text || <span className="text-white/40">(empty paragraph)</span>}
                    </p>
                  ),
                )}
              </div>
            </div>
            <p className="mt-2 text-xs text-[var(--admin-text-muted)]">
              Preview shows plain text. Cross-references (like &ldquo;Terms of Use&rdquo;) become
              links on the live page automatically.
            </p>
          </div>
        ) : null}
      </div>

      {/* ---------- Save / Publish ---------- */}
      <form ref={formRef} className="flex flex-wrap items-center gap-3 border-t border-[var(--admin-border)] pt-4">
        <input type="hidden" name="block_key" value={docKey} />
        <input type="hidden" name="draft_value" value={serialized} />
        <Button type="submit" formAction={saveDraftAction} variant="save">
          Save draft
        </Button>
        <Button type="submit" formAction={publishAction} variant="primary">
          Publish {label}
        </Button>
        <span className="text-xs text-[var(--admin-text-muted)]">
          Save draft keeps it private; Publish updates the live page.
        </span>
      </form>

      {/* ---------- History / restore ---------- */}
      <div className="border-t border-[var(--admin-border)] pt-4">
        <button
          type="button"
          onClick={() => setShowHistory((v) => !v)}
          className="text-sm font-semibold text-[var(--admin-accent)] hover:underline"
        >
          {showHistory ? "Hide" : "Show"} publish history ({revisions.length})
        </button>
        {showHistory ? (
          revisions.length === 0 ? (
            <p className="mt-2 text-sm text-[var(--admin-text-muted)]">
              No published versions yet. Once you Publish, each version is saved here so you can
              restore it.
            </p>
          ) : (
            <ul className="mt-2 space-y-2">
              {revisions.map((rev) => (
                <li
                  key={rev.id}
                  className="flex flex-wrap items-center gap-3 rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] px-3 py-2 text-sm"
                >
                  <span className="text-[var(--admin-text-muted)]">
                    {new Date(rev.created_at).toLocaleString()}
                  </span>
                  {rev.actor_email ? (
                    <span className="text-[var(--admin-text-muted)]">by {rev.actor_email}</span>
                  ) : null}
                  <form action={restoreAction} className="ml-auto">
                    <input type="hidden" name="revision_id" value={rev.id} />
                    <button
                      type="submit"
                      className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] px-3 py-1 font-medium text-[var(--admin-text)] hover:bg-[var(--admin-surface-hover)]"
                    >
                      Restore into draft
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </div>
    </div>
  );
}
