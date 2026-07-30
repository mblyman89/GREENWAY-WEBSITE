"use client";

/**
 * MedicalPageEditor — the novice-safe editor for the public /medical page
 * (Website → Medical page, SLICE 107).
 *
 * Two jobs, one screen:
 *   1) HIDE THE WHOLE PAGE — a prominent Visible/Hidden switch (the
 *      medical.page.hidden "select" block). When Hidden, the page 404s and its
 *      menu link disappears from the site.
 *   2) EDIT THE COPY — each editable block (section eyebrows, titles, and the
 *      two bullet lists) is its own little form with Save draft / Publish and a
 *      History → restore disclosure, reusing the SAME content-store machinery
 *      as Site Content, so the public page stays byte-identical until a staff
 *      member edits and Publishes.
 *
 * COMPLIANCE GUARDRAILS (shown in-editor): the legal tax/limit fine print and
 * the purchase-limit TABLE are NOT editable here — they stay live from the
 * compliance engine so an edit can never overpromise, drop a citation, or
 * change the legal table (WAC 314-55-155: no therapeutic claims).
 */
import { useState } from "react";
import { Button } from "@/components/admin/ui";
import {
  MEDICAL_HIDE_BLOCK,
  MEDICAL_HIDE_OPTIONS,
  isMedicalPageHidden,
} from "@/lib/medical/medical-content-core";

export type MedicalRevisionVM = {
  id: string;
  created_at: string;
  actor_email: string | null;
};

export type MedicalBlockVM = {
  key: string;
  label: string;
  help: string | null;
  /** True when the field should render as a multi-line textarea. */
  multiline: boolean;
  draftValue: string;
  publishedValue: string;
  hasUnpublishedDraft: boolean;
  revisions: MedicalRevisionVM[];
};

/** One editable section (eyebrow + title + optional bullets) for grouped UI. */
export type MedicalSectionVM = {
  id: string;
  heading: string;
  blocks: MedicalBlockVM[];
};

type Actions = {
  saveDraftAction: (formData: FormData) => void | Promise<void>;
  publishAction: (formData: FormData) => void | Promise<void>;
  restoreAction: (formData: FormData) => void | Promise<void>;
};

type Props = Actions & {
  /** The medical.page.hidden select block (currently published value). */
  hideDraftValue: string;
  hidePublishedValue: string;
  hideHasUnpublishedDraft: boolean;
  hideRevisions: MedicalRevisionVM[];
  /** The editable copy blocks, grouped by section. */
  sections: MedicalSectionVM[];
};

function fmtWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

// ---------------------------------------------------------------------------
// History disclosure (shared by the hide switch + each copy block).
// ---------------------------------------------------------------------------
function History({
  blockKey,
  revisions,
  restoreAction,
}: {
  blockKey: string;
  revisions: MedicalRevisionVM[];
  restoreAction: (formData: FormData) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  if (revisions.length === 0) return null;
  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-xs font-semibold text-[var(--admin-text-muted)] underline underline-offset-2 hover:text-[var(--admin-text)]"
      >
        {open ? "Hide history" : `History (${revisions.length})`}
      </button>
      {open ? (
        <ul className="mt-2 space-y-2">
          {revisions.map((r) => (
            <li
              key={r.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-xs"
            >
              <span className="text-[var(--admin-text-muted)]">
                Published {fmtWhen(r.created_at)}
                {r.actor_email ? ` · ${r.actor_email}` : ""}
              </span>
              <form action={restoreAction} data-block={blockKey}>
                <input type="hidden" name="revision_id" value={r.id} />
                <Button type="submit" variant="neutral" size="sm">
                  Restore to draft
                </Button>
              </form>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The HIDE-PAGE switch (the medical.page.hidden select block).
// ---------------------------------------------------------------------------
function HideSwitch({
  hideDraftValue,
  hidePublishedValue,
  hideHasUnpublishedDraft,
  hideRevisions,
  saveDraftAction,
  publishAction,
  restoreAction,
}: {
  hideDraftValue: string;
  hidePublishedValue: string;
  hideHasUnpublishedDraft: boolean;
  hideRevisions: MedicalRevisionVM[];
} & Actions) {
  const [choice, setChoice] = useState(
    isMedicalPageHidden(hideDraftValue) ? "yes" : "no",
  );
  const publishedHidden = isMedicalPageHidden(hidePublishedValue);

  return (
    <section className="rounded-[var(--admin-radius)] border-2 border-[var(--admin-gold)]/50 bg-[var(--admin-surface)] p-5">
      <h2 className="text-lg font-black text-[var(--admin-text)]">Show or hide the whole page</h2>
      <p className="mt-1 text-sm text-[var(--admin-text-muted)]">
        Choose whether the public Medical page appears on your site. When set to{" "}
        <strong>Hidden</strong> and published, the page shows a “not found” message and its link is
        removed from the top menu and the mobile menu. Your staff Medical tools are not affected.
      </p>

      <div className="mt-3 rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm">
        Live right now:{" "}
        <strong className={publishedHidden ? "text-red-500" : "text-[var(--admin-accent)]"}>
          {publishedHidden ? "Hidden" : "Visible"}
        </strong>
        {hideHasUnpublishedDraft ? (
          <span className="text-[var(--admin-gold)]"> · you have an unpublished change</span>
        ) : null}
      </div>

      <form action={saveDraftAction} className="mt-4">
        <input type="hidden" name="block_key" value={MEDICAL_HIDE_BLOCK} />
        <input type="hidden" name="draft_value" value={choice} />
        <fieldset className="flex flex-wrap gap-3">
          <legend className="sr-only">Medical page visibility</legend>
          {MEDICAL_HIDE_OPTIONS.map((opt) => {
            const active = choice === opt.value;
            return (
              <label
                key={opt.value}
                className={`flex cursor-pointer items-center gap-2 rounded-[var(--admin-radius-sm)] border px-4 py-2 text-sm font-semibold transition ${
                  active
                    ? "border-[var(--admin-accent)] bg-[var(--admin-accent-soft)] text-[var(--admin-accent)]"
                    : "border-[var(--admin-border)] bg-[var(--admin-surface-2)] text-[var(--admin-text-muted)]"
                }`}
              >
                <input
                  type="radio"
                  name="medical_hidden_choice"
                  value={opt.value}
                  checked={active}
                  onChange={() => setChoice(opt.value)}
                  className="accent-[var(--admin-accent)]"
                />
                {opt.label}
              </label>
            );
          })}
        </fieldset>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="submit" variant="save">
            Save draft
          </Button>
          <Button type="submit" variant="primary" formAction={publishAction}>
            Publish {choice === "yes" ? "(hide the page)" : "(show the page)"}
          </Button>
        </div>
      </form>

      <History
        blockKey={MEDICAL_HIDE_BLOCK}
        revisions={hideRevisions}
        restoreAction={restoreAction}
      />
    </section>
  );
}

// ---------------------------------------------------------------------------
// A single editable copy block.
// ---------------------------------------------------------------------------
function CopyBlock({
  block,
  saveDraftAction,
  publishAction,
  restoreAction,
}: { block: MedicalBlockVM } & Actions) {
  const [value, setValue] = useState(block.draftValue);
  const dirty = value !== block.draftValue;

  return (
    <div className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label
          htmlFor={`f-${block.key}`}
          className="text-sm font-black text-[var(--admin-text)]"
        >
          {block.label}
        </label>
        {block.hasUnpublishedDraft ? (
          <span className="text-xs font-semibold text-[var(--admin-gold)]">
            Unpublished change
          </span>
        ) : null}
      </div>
      {block.help ? (
        <p className="mt-1 text-xs text-[var(--admin-text-muted)]">{block.help}</p>
      ) : null}

      <form action={saveDraftAction} className="mt-2">
        <input type="hidden" name="block_key" value={block.key} />
        {block.multiline ? (
          <textarea
            id={`f-${block.key}`}
            name="draft_value"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            rows={3}
            className="w-full rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 py-2 text-sm text-[var(--admin-text)]"
          />
        ) : (
          <input
            id={`f-${block.key}`}
            name="draft_value"
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-full rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 py-2 text-sm text-[var(--admin-text)]"
          />
        )}

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button type="submit" variant="save" size="sm">
            Save draft
          </Button>
          <Button type="submit" variant="primary" size="sm" formAction={publishAction}>
            Publish
          </Button>
          {dirty ? (
            <span className="text-xs text-[var(--admin-gold)]">
              Unsaved edits — Save draft to keep them.
            </span>
          ) : null}
        </div>
      </form>

      <History
        blockKey={block.key}
        revisions={block.revisions}
        restoreAction={restoreAction}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// The editor.
// ---------------------------------------------------------------------------
export function MedicalPageEditor({
  hideDraftValue,
  hidePublishedValue,
  hideHasUnpublishedDraft,
  hideRevisions,
  sections,
  saveDraftAction,
  publishAction,
  restoreAction,
}: Props) {
  return (
    <div className="space-y-6">
      {/* Compliance caution — always visible above the fields. */}
      <div className="rounded-[var(--admin-radius)] border-2 border-red-400/60 bg-red-500/10 p-4">
        <p className="text-sm font-black uppercase tracking-wide text-red-400">
          Keep it honest — Washington rules
        </p>
        <p className="mt-1 text-sm text-[var(--admin-text)]">
          Never add medical, curative, or therapeutic claims about cannabis (WAC 314-55-155). The
          tax and purchase-limit fine print and the limits <strong>table</strong> below are locked
          on purpose — they stay accurate from the compliance engine and can’t be edited here, so
          an edit can never overpromise or change the legal figures.
        </p>
      </div>

      <HideSwitch
        hideDraftValue={hideDraftValue}
        hidePublishedValue={hidePublishedValue}
        hideHasUnpublishedDraft={hideHasUnpublishedDraft}
        hideRevisions={hideRevisions}
        saveDraftAction={saveDraftAction}
        publishAction={publishAction}
        restoreAction={restoreAction}
      />

      <section className="space-y-5">
        <div>
          <h2 className="text-lg font-black text-[var(--admin-text)]">Edit the page copy</h2>
          <p className="mt-1 text-sm text-[var(--admin-text-muted)]">
            Each field is saved and published on its own. Save draft keeps a private change;
            Publish makes it live on the Medical page. Every publish is stored so you can roll back.
          </p>
        </div>

        {sections.map((sec) => (
          <div
            key={sec.id}
            className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4"
          >
            <h3 className="text-sm font-black uppercase tracking-wide text-[var(--admin-gold)]">
              {sec.heading}
            </h3>
            <div className="mt-3 space-y-3">
              {sec.blocks.map((b) => (
                <CopyBlock
                  key={b.key}
                  block={b}
                  saveDraftAction={saveDraftAction}
                  publishAction={publishAction}
                  restoreAction={restoreAction}
                />
              ))}
            </div>
          </div>
        ))}
      </section>

      <p className="text-xs text-[var(--admin-text-muted)]">
        Preview the live page any time at{" "}
        <a
          href="/medical"
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-2"
        >
          /medical
        </a>
        . The hero title/subtitle/intro can also be edited under Site Content.
      </p>
    </div>
  );
}
