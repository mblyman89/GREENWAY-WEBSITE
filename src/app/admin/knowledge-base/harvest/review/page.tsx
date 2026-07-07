/**
 * /admin/knowledge-base/harvest/review — the harvest review inbox (Slice H5).
 *
 * Review economics from KB_HARVEST_STRATEGY.md §5: vendor-grouped review (not
 * field-grouped), confidence lanes, and per-vendor batch-accept. The goal is
 * ≤ ~3 minutes of reviewer time per harvested vendor:
 *
 *  • FAST lane   — clean, confident, non-thin drafts. One click accepts the
 *    whole lane for a vendor; every draft is re-verified server-side and
 *    re-scanned by the S-4 compliance gate before any write.
 *  • STANDARD    — writable drafts that missed a fast-lane bar (low
 *    confidence, thin, or compliance-flagged). Reviewed one by one.
 *  • REFERENCE   — research_* drafts (products/images/logos). Read-only;
 *    reviewed on the vendor page where the image picker lives.
 *  • PROSPECT    — drafts for discovery leads. Dark inventory; they unlock
 *    when the lead is promoted to a vendor.
 *
 * Drafts-only lifecycle preserved end-to-end.
 */
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs } from "@/components/admin/ux";
import { HelpPanel } from "@/components/admin/ux/HelpPanel";
import { AiProvenanceBadge } from "@/components/admin/ai/AiProvenanceBadge";
import { AiComplianceFlags } from "@/components/admin/ai/AiComplianceFlags";
import { KbFlash } from "../../KbFlash";
import { loadHarvestInbox, type InboxDraft, type InboxGroup } from "@/lib/kb/review-inbox";
import {
  acceptDraftAction,
  rejectDraftAction,
  batchAcceptVendorAction,
  closeSupersededAction,
} from "./actions";

export const dynamic = "force-dynamic";

const FIELD_LABELS: Record<string, string> = {
  about: "About",
  mission_statement: "Mission statement",
  product_philosophy: "Product philosophy",
  research_products: "Product lineup (reference)",
  research_images: "Image candidates (reference)",
  research_logos: "Logo candidates (reference)",
  research_discovery: "Candidate websites found by search (reference)",
};

function fieldLabel(key: string): string {
  return FIELD_LABELS[key] ?? key;
}

/** Compact draft row for the standard lane (full text + accept/reject). */
function DraftRow({ draft, entityNote }: { draft: InboxDraft; entityNote: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/40 p-3">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold text-[#7ed957]">
          {fieldLabel(draft.field_key)}
          <span className="ml-2 font-normal text-white/40">{entityNote}</span>
        </span>
        <AiProvenanceBadge source={draft.source} confidence={draft.confidence} />
      </div>
      <p className="whitespace-pre-wrap text-sm text-white/85">{draft.suggested_value}</p>
      {draft.complianceFlags.length > 0 && (
        <div className="mt-2">
          <AiComplianceFlags flags={draft.complianceFlags} showCleanState={false} />
        </div>
      )}
      <div className="mt-2 flex gap-2">
        {draft.blockingFlags.length === 0 ? (
          <form action={acceptDraftAction}>
            <input type="hidden" name="suggestionId" value={draft.id} />
            <button
              type="submit"
              className="rounded-full bg-[#7ed957] px-4 py-1.5 text-xs font-bold text-black transition hover:brightness-110"
            >
              ✓ Accept & save
            </button>
          </form>
        ) : (
          <span className="rounded-full border border-red-400/40 bg-red-400/10 px-3 py-1.5 text-[10px] font-semibold text-red-300">
            Blocked — edit on the vendor page before accepting
          </span>
        )}
        <form action={rejectDraftAction}>
          <input type="hidden" name="suggestionId" value={draft.id} />
          <button
            type="submit"
            className="rounded-full border border-white/20 px-4 py-1.5 text-xs font-semibold text-white/70 transition hover:border-red-400 hover:text-red-300"
          >
            ✕ Reject
          </button>
        </form>
      </div>
    </div>
  );
}

function entityNote(d: InboxDraft): string {
  return d.entity_type === "brand" ? "brand" : "vendor";
}

function VendorGroup({ group }: { group: InboxGroup }) {
  const total = group.fast.length + group.standard.length + group.reference.length + group.prospect.length;
  return (
    <div className="rounded-xl border border-white/10 bg-[#0a0a0a] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-bold text-white">{group.displayName}</h3>
          <span className="text-[10px] text-white/40">
            {total} draft{total === 1 ? "" : "s"}
          </span>
        </div>
        {group.href && (
          <Link href={group.href} className="text-xs text-[#5ec1ff] hover:underline">
            {group.isProspect ? "Open discovery →" : "Open vendor page →"}
          </Link>
        )}
      </div>

      {/* FAST lane — per-vendor batch accept */}
      {group.fast.length > 0 && (
        <div className="mb-3 rounded-lg border border-[#7ed957]/30 bg-[#7ed957]/5 p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-bold text-[#7ed957]">
              ⚡ Fast lane — {group.fast.length} clean draft{group.fast.length === 1 ? "" : "s"}
            </span>
            <form action={batchAcceptVendorAction}>
              <input type="hidden" name="vendorLabel" value={group.displayName} />
              {group.fast.map((d) => (
                <input key={d.id} type="hidden" name="suggestionIds" value={d.id} />
              ))}
              <button
                type="submit"
                className="rounded-full bg-[#7ed957] px-4 py-1.5 text-xs font-bold text-black transition hover:brightness-110"
              >
                ✓ Accept all {group.fast.length}
              </button>
            </form>
          </div>
          <ul className="space-y-2">
            {group.fast.map((d) => (
              <li key={d.id} className="rounded border border-white/10 bg-black/30 p-2">
                <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold text-white/80">
                    {fieldLabel(d.field_key)}
                    <span className="ml-2 font-normal text-white/40">{entityNote(d)}</span>
                  </span>
                  <div className="flex items-center gap-2">
                    <AiProvenanceBadge source={d.source} confidence={d.confidence} />
                    <form action={rejectDraftAction}>
                      <input type="hidden" name="suggestionId" value={d.id} />
                      <button
                        type="submit"
                        className="text-[10px] text-white/40 transition hover:text-red-300"
                        title="Reject just this draft"
                      >
                        ✕
                      </button>
                    </form>
                  </div>
                </div>
                <p className="line-clamp-3 whitespace-pre-wrap text-xs text-white/70">{d.suggested_value}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* STANDARD lane — one-by-one */}
      {group.standard.length > 0 && (
        <div className="mb-3 space-y-2">
          <span className="text-xs font-semibold text-[#ffd700]">
            🔍 Needs a closer look ({group.standard.length})
          </span>
          {group.standard.map((d) => (
            <DraftRow key={d.id} draft={d} entityNote={entityNote(d)} />
          ))}
        </div>
      )}

      {/* REFERENCE + PROSPECT — pointers, not editors */}
      {(group.reference.length > 0 || group.prospect.length > 0) && (
        <div className="flex flex-wrap gap-2 text-[10px] text-white/40">
          {group.reference.length > 0 && (
            <span className="rounded-full border border-white/15 px-2 py-1">
              📎 {group.reference.length} reference draft{group.reference.length === 1 ? "" : "s"}
              {group.href && !group.isProspect ? (
                <>
                  {" — review on the "}
                  <Link href={`${group.href}#ai-drafts`} className="text-[#5ec1ff] hover:underline">
                    vendor page
                  </Link>
                </>
              ) : null}
            </span>
          )}
          {group.prospect.length > 0 && (
            <span className="rounded-full border border-white/15 px-2 py-1">
              🌱 {group.prospect.length} prospect draft{group.prospect.length === 1 ? "" : "s"} — unlocks when
              the lead is promoted to a vendor
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export default async function HarvestReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string; error?: string }>;
}) {
  await requirePermission("vendors.manage");
  const { msg, error } = await searchParams;

  const inbox = await loadHarvestInbox();
  const totalActionable = inbox.totals.fast + inbox.totals.standard;

  return (
    <div>
      <AdminPageHeader
        title="Harvest review"
        subtitle="Vendor-grouped drafts in confidence lanes — batch-accept the clean ones, focus on the rest"
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Knowledge Base", href: "/admin/knowledge-base" },
              { label: "Harvest Console", href: "/admin/knowledge-base/harvest" },
              { label: "Review" },
            ]}
          />
        }
        help={
          <HelpPanel id="harvest-review-help" title="How the lanes work">
            <p>
              Every pending vendor and brand draft is triaged into a lane. <strong>Fast lane</strong>{" "}
              drafts are confident, non-thin, and compliance-clean — accept a whole vendor in one
              click. <strong>Needs a closer look</strong> drafts missed one of those bars and get
              individual review. Reference drafts (product lineups, image candidates) are reviewed
              on the vendor page; prospect drafts wait until you promote the lead.
            </p>
            <p className="mt-2">
              Every accept — single or batch — re-runs the WA I-502 compliance scan at the moment
              of acceptance. A blocked draft is skipped, never force-published.
            </p>
          </HelpPanel>
        }
        action={
          <Link href="/admin/knowledge-base/harvest" className="text-sm text-white/60 hover:text-white">
            ← Harvest Console
          </Link>
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        <KbFlash msg={msg} error={error} />

        {/* Totals strip */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-[#7ed957]/30 bg-[#7ed957]/5 p-3">
            <p className="text-2xl font-bold text-[#7ed957]">{inbox.totals.fast}</p>
            <p className="text-[10px] uppercase tracking-wide text-white/50">Fast lane</p>
          </div>
          <div className="rounded-lg border border-[#ffd700]/30 bg-[#ffd700]/5 p-3">
            <p className="text-2xl font-bold text-[#ffd700]">{inbox.totals.standard}</p>
            <p className="text-[10px] uppercase tracking-wide text-white/50">Closer look</p>
          </div>
          <div className="rounded-lg border border-white/15 bg-white/5 p-3">
            <p className="text-2xl font-bold text-white/70">{inbox.totals.reference}</p>
            <p className="text-[10px] uppercase tracking-wide text-white/50">Reference</p>
          </div>
          <div className="rounded-lg border border-white/15 bg-white/5 p-3">
            <p className="text-2xl font-bold text-white/70">{inbox.totals.prospect}</p>
            <p className="text-[10px] uppercase tracking-wide text-white/50">Prospect (dark)</p>
          </div>
        </div>

        {/* Superseded cleanup */}
        {inbox.supersededCount > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/15 bg-white/5 px-4 py-3">
            <p className="text-xs text-white/60">
              {inbox.supersededCount} older duplicate draft{inbox.supersededCount === 1 ? "" : "s"} superseded
              by a newer re-harvest of the same field.
            </p>
            <form action={closeSupersededAction}>
              <button
                type="submit"
                className="rounded-full border border-white/20 px-4 py-1.5 text-xs font-semibold text-white/70 transition hover:border-white/50 hover:text-white"
              >
                🧹 Close duplicates
              </button>
            </form>
          </div>
        )}

        {/* Vendor groups */}
        {inbox.groups.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-[#0a0a0a] p-8 text-center">
            <p className="text-sm text-white/60">
              No pending vendor or brand drafts. Start a harvest from the{" "}
              <Link href="/admin/knowledge-base/harvest" className="text-[#5ec1ff] hover:underline">
                Harvest Console
              </Link>{" "}
              to fill this inbox.
            </p>
          </div>
        ) : (
          <>
            <p className="text-xs text-white/40">
              {inbox.groups.length} vendor group{inbox.groups.length === 1 ? "" : "s"} ·{" "}
              {totalActionable} actionable draft{totalActionable === 1 ? "" : "s"} — biggest one-click wins
              first.
            </p>
            <div className="space-y-4">
              {inbox.groups.map((g) => (
                <VendorGroup key={g.vendorKey} group={g} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
