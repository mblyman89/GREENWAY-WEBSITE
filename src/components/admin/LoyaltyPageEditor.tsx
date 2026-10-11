"use client";

/**
 * LoyaltyPageEditor — the novice-safe editor for the FRIENDLY copy on the
 * public /loyalty page (Website → Loyalty page, SLICE 108).
 *
 * Each editable block (the signup-form helper/button/thank-you and the program
 * terms headings) is its own little form with Save draft / Publish and a
 * History → restore disclosure, reusing the SAME content-store machinery as
 * Site Content, so the public page stays byte-identical until a staff member
 * edits and Publishes.
 *
 * COMPLIANCE GUARDRAILS (shown in-editor and enforced in code):
 *   - R41 S5 (owner directive R41 Q9): the marketing-consent disclosure IS
 *     editable here, with a live wording checklist; only an empty paragraph
 *     is refused (client + server).
 *   - Every NUMBER on the program-terms card (points earned/redeemed, dollar
 *     value, member tiers) is LIVE from the register's loyalty settings and is
 *     NOT editable here — so the public page can never advertise terms that
 *     differ from what the register actually pays. A read-only snapshot of the
 *     live numbers is shown for reference, with a deep link to where they are
 *     actually set (CRM → Loyalty Program).
 */
import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/admin/ui";
import {
  DEFAULT_CONSENT_TEXT,
  LOYALTY_CONSENT_BLOCK,
  MAX_CONSENT_TEXT,
  checkConsentText,
} from "@/lib/loyalty/loyalty-consent-core";

export type LoyaltyRevisionVM = {
  id: string;
  created_at: string;
  actor_email: string | null;
};

export type LoyaltyBlockVM = {
  key: string;
  label: string;
  help: string | null;
  /** True when the field should render as a multi-line textarea. */
  multiline: boolean;
  draftValue: string;
  publishedValue: string;
  hasUnpublishedDraft: boolean;
  revisions: LoyaltyRevisionVM[];
};

/** One editable section (signup form / program terms) for grouped UI. */
export type LoyaltySectionVM = {
  id: string;
  heading: string;
  description?: string;
  blocks: LoyaltyBlockVM[];
};

/** Read-only snapshot of the LIVE program numbers (from loyalty-store). */
export type LoyaltyLiveTermsVM = {
  lines: string[];
  tiers: { name: string; thresholdLabel: string; perkLabel: string }[];
};

type Actions = {
  saveDraftAction: (formData: FormData) => void | Promise<void>;
  publishAction: (formData: FormData) => void | Promise<void>;
  restoreAction: (formData: FormData) => void | Promise<void>;
};

type Props = Actions & {
  sections: LoyaltySectionVM[];
  liveTerms: LoyaltyLiveTermsVM;
  /** R41 S5: true = migration 0264 applied; false = not yet; null = unknown. */
  consentRecording?: boolean | null;
};

function fmtWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

// ---------------------------------------------------------------------------
// History disclosure (shared by each copy block).
// ---------------------------------------------------------------------------
function History({
  blockKey,
  revisions,
  restoreAction,
}: {
  blockKey: string;
  revisions: LoyaltyRevisionVM[];
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
// A single editable copy block.
// ---------------------------------------------------------------------------
function CopyBlock({
  block,
  saveDraftAction,
  publishAction,
  restoreAction,
}: { block: LoyaltyBlockVM } & Actions) {
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
// R41 S5 — the marketing-consent paragraph (owner directive R41 Q9). Same
// draft → publish → history machinery as every block, plus:
//   - a large textarea that keeps the line breaks you type,
//   - a live checklist (checkConsentText) with the reason + source per item,
//   - a preview of how it sits next to the checkbox,
//   - Publish is locked only while the paragraph is EMPTY, or while there are
//     unsaved edits (Publish makes the SAVED draft live, so you save first).
// ---------------------------------------------------------------------------
function ConsentBlock({
  block,
  saveDraftAction,
  publishAction,
  restoreAction,
  consentRecording,
}: { block: LoyaltyBlockVM; consentRecording: boolean | null } & Actions) {
  const [value, setValue] = useState(block.draftValue);
  const dirty = value !== block.draftValue;
  const check = checkConsentText(value);
  const savedCheck = checkConsentText(block.draftValue);
  const publishLocked = dirty || savedCheck.blocking;
  const isDefault = value === DEFAULT_CONSENT_TEXT;

  return (
    <div className="rounded-[var(--admin-radius-sm)] border-2 border-[var(--admin-gold)]/50 bg-[var(--admin-surface-2)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={`f-${block.key}`} className="text-sm font-black text-[var(--admin-text)]">
          {block.label}
        </label>
        {block.hasUnpublishedDraft ? (
          <span className="text-xs font-semibold text-[var(--admin-gold)]">Unpublished change</span>
        ) : null}
      </div>
      {block.help ? (
        <p className="mt-1 text-xs text-[var(--admin-text-muted)]">{block.help}</p>
      ) : null}

      <form action={saveDraftAction} className="mt-2">
        <input type="hidden" name="block_key" value={block.key} />
        <textarea
          id={`f-${block.key}`}
          name="draft_value"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          rows={9}
          maxLength={MAX_CONSENT_TEXT}
          aria-describedby={`f-${block.key}-check`}
          className="w-full rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 py-2 text-sm leading-6 text-[var(--admin-text)]"
        />
        <p className="mt-1 text-xs text-[var(--admin-text-muted)]">
          {value.length} / {MAX_CONSENT_TEXT} characters. Press Enter to start a new line; the line
          breaks show on the live page.
        </p>

        <div
          id={`f-${block.key}-check`}
          className="mt-3 rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3"
        >
          <p className="text-xs font-black uppercase tracking-wide text-[var(--admin-text-muted)]">
            Wording checklist{" "}
            <span className="font-semibold normal-case">
              {check.blocking
                ? "— the paragraph can't be empty"
                : check.warnings === 0
                  ? "— everything is covered"
                  : `— ${check.warnings} item${check.warnings === 1 ? "" : "s"} to look at (you can still publish)`}
            </span>
          </p>
          <ul className="mt-2 space-y-2" aria-live="polite">
            {check.items.map((item) => (
              <li key={item.code} className="text-sm">
                <div className="flex gap-2">
                  <span
                    aria-hidden="true"
                    className={
                      item.ok
                        ? "font-black text-[var(--admin-accent)]"
                        : item.code === "W-EMPTY"
                          ? "font-black text-red-600"
                          : "font-black text-[var(--admin-gold)]"
                    }
                  >
                    {item.ok ? "✓" : item.code === "W-EMPTY" ? "✕" : "⚠"}
                  </span>
                  <span className="text-[var(--admin-text)]">
                    <span className="sr-only">{item.ok ? "Covered: " : "Missing: "}</span>
                    {item.label}{" "}
                    <span className="text-xs text-[var(--admin-text-muted)]">
                      ({item.level === "law" ? "federal rule" : item.level === "practice" ? "industry practice" : "store rule"})
                    </span>
                  </span>
                </div>
                {!item.ok ? (
                  <p className="ml-6 mt-0.5 text-xs text-[var(--admin-text-muted)]">
                    {item.explain}{" "}
                    <a href={item.source} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                      Source
                    </a>
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-[var(--admin-text-muted)]">
            This checklist is a helper, not legal advice. Only an empty paragraph is blocked.
          </p>
        </div>

        <div className="mt-3">
          <p className="text-xs font-black uppercase tracking-wide text-[var(--admin-text-muted)]">
            Preview (next to the checkbox)
          </p>
          <div className="mt-1 flex gap-3 rounded-2xl border border-white/10 bg-black p-4 text-sm leading-6 text-zinc-300">
            <span aria-hidden="true" className="mt-1 h-5 w-5 shrink-0 rounded border border-zinc-500 bg-white" />
            <span className="whitespace-pre-line">{value.trim() ? value : DEFAULT_CONSENT_TEXT}</span>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button type="submit" variant="save" size="sm">
            Save draft
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            formAction={publishAction}
            disabled={publishLocked}
            aria-disabled={publishLocked}
          >
            Publish
          </Button>
          {!isDefault ? (
            <Button type="button" variant="neutral" size="sm" onClick={() => setValue(DEFAULT_CONSENT_TEXT)}>
              Put back the original wording
            </Button>
          ) : null}
          {dirty ? (
            <span className="text-xs text-[var(--admin-gold)]">
              Unsaved edits — Save draft first, then Publish.
            </span>
          ) : savedCheck.blocking ? (
            <span className="text-xs text-red-600">The saved draft is empty, so it can&apos;t be published.</span>
          ) : null}
        </div>
      </form>

      <p className="mt-3 text-xs text-[var(--admin-text-muted)]">
        {consentRecording === true
          ? "Each new signup saves the exact published wording it agreed to. Customers who signed up before you change this keep the wording they agreed to."
          : consentRecording === false
            ? "Apply migration 0264 so each signup records the exact wording (see docs/MIGRATIONS_TO_RUN.md). Until then signups still work, but the wording isn't saved with them."
            : "Couldn't check whether migration 0264 is applied."}
      </p>

      <History blockKey={block.key} revisions={block.revisions} restoreAction={restoreAction} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Read-only "live numbers" panel — shows what the register pays, without
// making any of it editable text.
// ---------------------------------------------------------------------------
function LiveTermsPanel({ liveTerms }: { liveTerms: LoyaltyLiveTermsVM }) {
  return (
    <section className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
      <h2 className="text-lg font-black text-[var(--admin-text)]">
        The program numbers shown on this page are live
      </h2>
      <p className="mt-1 text-sm text-[var(--admin-text-muted)]">
        These figures come straight from your register&rsquo;s loyalty settings, so the public page
        can never advertise different terms than what customers actually earn and redeem. They are
        shown here for reference only — to change them, go to{" "}
        <Link
          href="/admin/loyalty"
          className="font-semibold text-[var(--admin-accent)] underline underline-offset-2"
        >
          CRM → Loyalty Program
        </Link>
        .
      </p>

      <ul className="mt-3 space-y-1.5 text-sm text-[var(--admin-text)]">
        {liveTerms.lines.map((line) => (
          <li key={line} className="flex gap-2">
            <span className="text-[var(--admin-accent)]">•</span>
            <span>{line}</span>
          </li>
        ))}
      </ul>

      {liveTerms.tiers.length > 0 ? (
        <div className="mt-4 overflow-hidden rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)]">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--admin-border)] bg-[var(--admin-surface-2)] text-xs font-black uppercase tracking-wide text-[var(--admin-text-muted)]">
                <th className="px-3 py-2">Tier</th>
                <th className="px-3 py-2">Lifetime points</th>
                <th className="px-3 py-2">Perk</th>
              </tr>
            </thead>
            <tbody>
              {liveTerms.tiers.map((t) => (
                <tr key={t.name} className="border-b border-[var(--admin-border)] last:border-b-0">
                  <td className="px-3 py-2 font-black text-[var(--admin-text)]">{t.name}</td>
                  <td className="px-3 py-2 text-[var(--admin-text-muted)]">{t.thresholdLabel}</td>
                  <td className="px-3 py-2 text-[var(--admin-text-muted)]">
                    {t.perkLabel || "Member perks"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// The editor.
// ---------------------------------------------------------------------------
export function LoyaltyPageEditor({
  sections,
  liveTerms,
  saveDraftAction,
  publishAction,
  restoreAction,
  consentRecording = null,
}: Props) {
  return (
    <div className="space-y-6">
      {/* Compliance caution — always visible above the fields. */}
      <div className="rounded-[var(--admin-radius)] border-2 border-[var(--admin-gold)]/60 bg-[var(--admin-gold)]/10 p-4">
        <p className="text-sm font-black uppercase tracking-wide text-[var(--admin-gold)]">
          What you can and can&rsquo;t change here
        </p>
        <p className="mt-1 text-sm text-[var(--admin-text)]">
          You can edit the friendly wording below (the signup button, the birthday note, the
          thank-you message, the <strong>marketing-consent paragraph</strong>, and the
          &ldquo;Program terms&rdquo; headings). The consent paragraph is your legal wording: a
          checklist under it tells you if a usual part is missing, and an empty paragraph can&rsquo;t
          be published. The <strong>program numbers</strong> (points, dollar value, member tiers)
          stay live from your register settings so this page can never promise terms the register
          doesn&rsquo;t actually pay.
        </p>
      </div>

      <LiveTermsPanel liveTerms={liveTerms} />

      <section className="space-y-5">
        <div>
          <h2 className="text-lg font-black text-[var(--admin-text)]">Edit the page wording</h2>
          <p className="mt-1 text-sm text-[var(--admin-text-muted)]">
            Each field is saved and published on its own. Save draft keeps a private change; Publish
            makes it live on the Loyalty page. Every publish is stored so you can roll back.
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
            {sec.description ? (
              <p className="mt-1 text-xs text-[var(--admin-text-muted)]">{sec.description}</p>
            ) : null}
            <div className="mt-3 space-y-3">
              {sec.blocks.map((b) =>
                b.key === LOYALTY_CONSENT_BLOCK ? (
                  <ConsentBlock
                    key={b.key}
                    block={b}
                    saveDraftAction={saveDraftAction}
                    publishAction={publishAction}
                    restoreAction={restoreAction}
                    consentRecording={consentRecording}
                  />
                ) : (
                <CopyBlock
                  key={b.key}
                  block={b}
                  saveDraftAction={saveDraftAction}
                  publishAction={publishAction}
                  restoreAction={restoreAction}
                />
                ),
              )}
            </div>
          </div>
        ))}
      </section>

      <p className="text-xs text-[var(--admin-text-muted)]">
        Preview the live page any time at{" "}
        <a
          href="/loyalty"
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-2"
        >
          /loyalty
        </a>
        . The hero banner image, title, and subtitle can be edited under Site Content and the page
        section builder.
      </p>
    </div>
  );
}
