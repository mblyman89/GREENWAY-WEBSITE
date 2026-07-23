/**
 * src/components/admin/ai/AiDraftCard.tsx
 *
 * A consistent, brand-styled card for a single AI DRAFT suggestion awaiting
 * staff review. Shows the field label, the drafted value, provenance (model),
 * optional compliance flags, and Accept / Reject buttons wired to the caller's
 * server actions via hidden inputs.
 *
 * Server component (presentational). The Accept/Reject forms post to the
 * server actions you pass in; the hidden fields you pass in `hiddenFields` are
 * included in BOTH forms so the action gets all the ids it needs.
 */
import type { ReactNode } from "react";
import { Button } from "@/components/admin/ui";
import { AiComplianceFlags } from "./AiComplianceFlags";
import { AiProvenanceBadge } from "./AiProvenanceBadge";

export function AiDraftCard({
  fieldLabel,
  value,
  model,
  source,
  confidence,
  flags = [],
  acceptAction,
  rejectAction,
  hiddenFields,
  acceptLabel = "✓ Accept & save",
  rejectLabel = "✕ Reject",
  referenceOnly = false,
  footer,
}: {
  fieldLabel: string;
  value: string | null;
  model?: string | null;
  /** Provenance of the facts: model | kb | pos | crawl:<url> (migration 0018). */
  source?: string | null;
  /** 0..1 grounding confidence (migration 0018). */
  confidence?: number | null;
  flags?: string[];
  acceptAction: (formData: FormData) => void | Promise<void>;
  rejectAction: (formData: FormData) => void | Promise<void>;
  /** Hidden input name→value pairs included in both Accept and Reject forms. */
  hiddenFields: Record<string, string>;
  acceptLabel?: string;
  rejectLabel?: string;
  /**
   * Reference-only drafts (e.g. the crawler's research_products lineup or
   * research_images candidates) are for staff to READ and copy from — they
   * never write to a profile field, so the Accept button is hidden and the
   * reject button becomes "Dismiss".
   */
  referenceOnly?: boolean;
  footer?: ReactNode;
}) {
  const hidden = Object.entries(hiddenFields);
  return (
    <div className="rounded-lg border border-white/10 bg-black/40 p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-[var(--admin-accent)]">{fieldLabel}</span>
        <span className="text-[10px] text-white/30">{model ?? "ai"}</span>
      </div>
      <div className="mb-2">
        <AiProvenanceBadge source={source} confidence={confidence} />
      </div>
      <p className="whitespace-pre-wrap text-sm text-white/85">{value}</p>

      {flags.length > 0 && (
        <div className="mt-2">
          <AiComplianceFlags flags={flags} showCleanState={false} />
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {!referenceOnly && (
          <form action={acceptAction}>
            {hidden.map(([k, v]) => (
              <input key={k} type="hidden" name={k} value={v} />
            ))}
            <Button type="submit" variant="confirm" size="sm">
              {acceptLabel}
            </Button>
          </form>
        )}
        <form action={rejectAction}>
          {hidden.map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          <Button type="submit" variant="neutral" size="sm">
            {referenceOnly ? "✕ Dismiss" : rejectLabel}
          </Button>
        </form>
      </div>

      {footer && <div className="mt-2">{footer}</div>}
    </div>
  );
}
