import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { CHIP_ACTION, CHIP_NEUTRAL } from "@/components/admin/ui";
import { isAiConfigured } from "@/lib/ai/provider";
import { copilotModel } from "@/lib/ai/enrich-model";
import { enrichModelLine } from "@/lib/ai/enrich-model-core";
import { checkCompliance } from "@/lib/ai/compliance";
import { loadCopilotSession } from "@/lib/enrichment/copilot-server";
import { vendorOptionLabel, vendorPercent } from "@/lib/enrichment/worklist-core";
import { ACCEPT_ALL_THRESHOLD, FIELD_LABEL, evidenceLabel, isDraftFieldKey, parseEvidenceSource } from "@/lib/enrichment/ai-draft-v2-core";
import { EDIT_HINT, editKind, editText } from "@/lib/enrichment/draft-edit-core";
import {
  COPILOT_KEYS,
  copilotNext,
  copilotPhotoChoices,
  copilotUrl,
  parseSkips,
  publishBlockReason,
  sessionLine,
} from "@/lib/enrichment/copilot-core";
import { CopilotChat } from "@/components/admin/products/CopilotChat";
import { CopilotKeys } from "@/components/admin/products/CopilotKeys";
import {
  copilotAcceptAllAction,
  copilotAcceptDraftAction,
  copilotAttachPhotoAction,
  copilotDraftNowAction,
  copilotPublishAction,
  copilotRejectDraftAction,
  copilotSkipAction,
} from "./actions";

export const dynamic = "force-dynamic";
// Draft now (one all-fields call) runs inside the request.
export const maxDuration = 300;

/**
 * D244 R-5 (strategy slice E-6): the Enrichment Copilot. One vendor, on-hand
 * cards only, photo-less first; one card at a time with its lots, photos and
 * drafts, a keyboard flow, and a chat partner that proposes but never saves.
 */
export default async function CopilotPage({
  searchParams,
}: {
  searchParams: Promise<{ vendor?: string; key?: string; skip?: string; saved?: string; note?: string; error?: string }>;
}) {
  await requirePermission("products.enrich");
  const sp = await searchParams;
  const vendor = String(sp.vendor ?? "").trim().slice(0, 100);
  const skips = parseSkips(sp.skip);
  const note = typeof sp.note === "string" ? sp.note.trim().slice(0, 400) : "";
  const s = await loadCopilotSession(vendor, String(sp.key ?? "").trim(), skips);

  const header = (
    <AdminPageHeader
      title="Enrichment Copilot"
      subtitle="One vendor at a time, the products you have on hand, one card at a time. Photo first; words when you have time."
      breadcrumbs={<Breadcrumbs items={[{ label: "Product Intake", href: "/admin/catalog" }, { label: "Product Enrichment", href: "/admin/products" }, { label: "Copilot" }]} />}
      help={
        <HelpPanel
          id="copilot"
          title="How the Copilot works"
          steps={[
            "Pick a vendor. The session holds that vendor’s on-hand products (at least 1 unit in a lot) that are not published yet, the ones with no photo first.",
            "Attach a photo (press 1-9 for a recommended photo). A product goes live once it has a photo; the words can come later.",
            `Press D to draft every field now, then A to accept every draft at ${ACCEPT_ALL_THRESHOLD}% or better (best guesses too, flagged for a closer look).`,
            "Talk to the copilot on the right: ask for a shorter description, the strain type and potency from the lab certificate, or which photo is this product. It only suggests; Use this saves through the same compliance check.",
            "Press P to publish and go to the next card, N for next, S to skip (the card moves to the back).",
            "For hundreds of products at once, use Bulk AI instead (live, or the overnight batch at about half price).",
          ]}
        />
      }
    />
  );
  const flash = (
    <>
      {sp.saved && (
        <div data-testid="saved-banner" className="rounded-lg border border-[var(--admin-accent)]/40 bg-[var(--admin-accent)]/10 px-4 py-2 text-sm text-[var(--admin-accent)]">
          {note ? `Saved. ${note}` : "Saved."}
        </div>
      )}
      {sp.error && <div className="rounded-lg border border-[var(--admin-orange)]/40 bg-[var(--admin-orange)]/10 px-4 py-2 text-sm text-[var(--admin-orange)]">{sp.error}</div>}
    </>
  );

  if (!s.ok) {
    return (
      <div>
        {header}
        <div className="space-y-3 p-6">
          {flash}
          <p className="text-sm text-white/60">{s.reason}</p>
        </div>
      </div>
    );
  }

  const vendorPicker = (
    <form method="get" action="/admin/products/copilot" className="flex flex-wrap items-center gap-2" data-testid="copilot-vendor-picker">
      <label htmlFor="copilot-vendor" className="text-sm text-white/70">
        Vendor
      </label>
      <select
        id="copilot-vendor"
        name="vendor"
        defaultValue={s.vendorId}
        className="rounded border border-white/15 bg-black px-2 py-1 text-sm text-white"
      >
        <option value="">Choose a vendor…</option>
        {s.vendors
          .filter((p) => p.onHand > 0)
          .map((p) => (
            <option key={p.id} value={p.id}>
              {vendorOptionLabel(p)} · {vendorPercent(p)}% done
            </option>
          ))}
      </select>
      <button type="submit" className={CHIP_ACTION}>
        Start session
      </button>
      <span className="text-xs text-white/40">Copilot model: {enrichModelLine(copilotModel)}</span>
    </form>
  );

  if (!s.vendorId || !s.card) {
    return (
      <div>
        {header}
        <div className="space-y-4 p-6">
          {flash}
          {vendorPicker}
          {s.vendorId ? (
            <p className="text-sm text-[var(--admin-accent)]" data-testid="copilot-done">
              {sessionLine(s.vendorLabel, s.queue)} on-hand published. Nothing left for this vendor. Pick the next one above.
            </p>
          ) : (
            <p className="text-sm text-white/60">Pick a vendor to start. The vendors with on-hand products are listed with how far along they are.</p>
          )}
        </div>
      </div>
    );
  }

  const c = s.card;
  const next = copilotNext(s.queue, c.key) ?? "";
  const skip = skips.join(",");
  const hidden = { key: c.key, vendor: s.vendorId, skip, nextKey: next, identityKey: c.recommend.identityKey };
  const ctx = (
    <>
      <input type="hidden" name="key" value={c.key} />
      <input type="hidden" name="vendor" value={s.vendorId} />
      <input type="hidden" name="skip" value={skip} />
      <input type="hidden" name="nextKey" value={next} />
    </>
  );
  const hasImage = c.photos.length > 0;
  const blocked = publishBlockReason(hasImage);
  const choices = copilotPhotoChoices(c.recommend.tiles);
  const drafts = (c.pending ?? []).filter((d) => isDraftFieldKey(d.field_key));
  const eligible = drafts.filter((d) => Math.round((d.confidence ?? 0) * 100) >= ACCEPT_ALL_THRESHOLD || parseEvidenceSource(d.source).bestGuess).length;
  const pos = s.queue.todo.indexOf(c.key) + 1;
  const i = c.item;
  const fact = (label: string, v: string | number | null | undefined) =>
    v === null || v === undefined || v === "" ? null : (
      <div className="flex gap-2">
        <dt className="w-28 shrink-0 text-white/45">{label}</dt>
        <dd className="text-white/85">{v}</dd>
      </div>
    );

  return (
    <div>
      <CopilotKeys />
      {header}
      <div className="space-y-4 p-4 sm:p-6">
        {flash}
        {vendorPicker}

        {/* Session bar */}
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 rounded-lg border border-white/10 bg-black/90 p-3 backdrop-blur" data-testid="copilot-session-bar">
          <div className="min-w-[12rem]">
            <p className="text-sm font-bold text-white" data-testid="copilot-session-line">
              {sessionLine(s.vendorLabel, s.queue)} published
            </p>
            <p className="text-xs text-white/50">
              {s.queue.todo.length} to go · card {pos} of {s.queue.todo.length} · {s.queue.withPhoto} of {s.queue.onHand} have a photo
            </p>
            <div className="mt-1 h-1.5 w-48 overflow-hidden rounded bg-white/10">
              <div className="h-full bg-[var(--admin-accent)]" style={{ width: `${s.queue.onHand ? Math.floor((s.queue.done / s.queue.onHand) * 100) : 0}%` }} />
            </div>
          </div>
          <form action={copilotPublishAction}>
            {ctx}
            <button type="submit" className={CHIP_ACTION} data-copilot-key="p" data-testid="copilot-publish" disabled={!hasImage} title={blocked ?? "Publish and go to the next card (P)"}>
              Publish &amp; next <kbd className="ml-1 text-[0.65rem] opacity-60">P</kbd>
            </button>
          </form>
          {next ? (
            <Link href={copilotUrl({ vendor: s.vendorId, key: next, skip: skips })} className={CHIP_NEUTRAL} data-copilot-key="n">
              Next <kbd className="ml-1 text-[0.65rem] opacity-60">N</kbd>
            </Link>
          ) : null}
          <form action={copilotSkipAction}>
            {ctx}
            <button type="submit" className={CHIP_NEUTRAL} data-copilot-key="s" title="Move this card to the back of the session (S)">
              Skip <kbd className="ml-1 text-[0.65rem] opacity-60">S</kbd>
            </button>
          </form>
          <Link href={`/admin/products/${encodeURIComponent(c.key)}`} className="text-xs text-white/50 hover:text-white">
            Open the full product page ↗
          </Link>
          {blocked && <span className="text-xs text-[var(--admin-gold)]">{blocked}</span>}
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1.2fr)]">
          {/* 1. The product, its lots and lab certificates */}
          <section className="space-y-3 rounded-lg border border-white/10 p-3" data-testid="copilot-product">
            <h2 className="text-base font-bold text-white">{c.enrichment?.display_name || i.product_name || i.name}</h2>
            <dl className="space-y-1 text-sm">
              {fact("POS name", i.name)}
              {fact("Brand", i.brand_name)}
              {fact("Category", i.category)}
              {fact("Strain", i.strain_name)}
              {fact("Strain type", i.strain_type && i.strain_type !== "unknown" ? i.strain_type : "not set")}
              {fact("Potency", [i.thc ? `THC ${i.thc}` : "", i.cbd ? `CBD ${i.cbd}` : ""].filter(Boolean).join(" · ") || "not set")}
              {fact("Stock", `${c.row.inventoryStatus ?? "unknown"}${c.row.lotQty !== null ? ` · ${c.row.lotQty} on hand` : ""}`)}
              {fact("Status", c.row.enrichmentStatus ?? "draft")}
              {fact("Description", c.enrichment?.description ? "written" : "missing")}
            </dl>
            <div>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-white/50">Lots and lab certificates</h3>
              {c.lots && c.lots.lines.length ? (
                <ul className="space-y-1 text-xs text-white/70" data-testid="copilot-lots">
                  {c.lots.lines.map((l) => (
                    <li key={l} className="rounded bg-white/5 px-2 py-1 font-mono">
                      {l}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-white/40">No lot or certificate on file for this card.</p>
              )}
            </div>
          </section>

          {/* 2. Photos and drafts */}
          <section className="space-y-4 rounded-lg border border-white/10 p-3">
            <div data-testid="copilot-photos">
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-white/50">On this card</h3>
              {c.photos.length ? (
                <div className="flex flex-wrap gap-2">
                  {c.photos.map((p) => (
                    <div key={p.id} className={`h-24 w-24 overflow-hidden rounded border ${p.cover ? "border-[var(--admin-accent)]" : "border-white/15"}`}>
                      {p.url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.url} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                      ) : (
                        <span className="text-xs text-white/40">no preview</span>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-[var(--admin-gold)]">No photo yet. This is the one thing it needs to go live.</p>
              )}
              <h3 className="mb-1 mt-3 text-xs font-semibold uppercase tracking-wide text-white/50">Recommended photos (press 1-9)</h3>
              {choices.length ? (
                <div className="grid grid-cols-3 gap-2">
                  {choices.map((p) => (
                    <form key={p.id} action={copilotAttachPhotoAction} className="rounded border border-white/10 p-1">
                      {ctx}
                      <input type="hidden" name="mediaId" value={p.id} />
                      <input type="hidden" name="identityKey" value={c.recommend.identityKey} />
                      <button type="submit" className="block w-full text-left" data-copilot-key={`photo-${p.n}`} title={`Attach photo ${p.n} (${p.n})`}>
                        <div className="relative aspect-square overflow-hidden rounded bg-white/5">
                          {p.url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={p.url} alt={p.label} loading="lazy" decoding="async" className="h-full w-full object-cover" />
                          ) : null}
                          <span className="absolute left-1 top-1 rounded bg-black/80 px-1.5 text-xs font-bold text-white">{p.n}</span>
                          <span className="absolute bottom-1 right-1 rounded bg-black/80 px-1 text-[0.65rem] text-white/80">{p.confidence}%</span>
                        </div>
                        <span className="mt-1 block truncate text-[0.65rem] text-white/60">{p.chips.join(" · ") || p.label}</span>
                      </button>
                    </form>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-white/40">{c.recommend.emptyText ?? "No library photo looks like this product yet. Use the full product page to search or import one."}</p>
              )}
            </div>

            <div id="drafts" data-testid="copilot-drafts">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-white/50">Drafts waiting ({drafts.length})</h3>
                <form action={copilotDraftNowAction}>
                  {ctx}
                  <button type="submit" className={CHIP_NEUTRAL} data-copilot-key="d" disabled={!isAiConfigured} title="Draft every field now (D)">
                    ⚡ Draft now <kbd className="ml-1 text-[0.65rem] opacity-60">D</kbd>
                  </button>
                </form>
                <form action={copilotAcceptAllAction}>
                  {ctx}
                  <button type="submit" className={CHIP_ACTION} data-copilot-key="a" disabled={eligible === 0} title={`Accept every draft at ${ACCEPT_ALL_THRESHOLD}% or better, plus best guesses (A)`}>
                    Accept all ≥{ACCEPT_ALL_THRESHOLD}% ({eligible}) <kbd className="ml-1 text-[0.65rem] opacity-60">A</kbd>
                  </button>
                </form>
              </div>
              {c.pending === null ? (
                <p className="text-sm text-amber-200">The drafts could not be read just now. Refresh to try again.</p>
              ) : drafts.length === 0 ? (
                <p className="text-xs text-white/40">No drafts. Press D to draft every field, or ask the copilot.</p>
              ) : (
                <ul className="space-y-2">
                  {drafts.map((r) => {
                    const ev = parseEvidenceSource(r.source);
                    const pct = Math.round((r.confidence ?? 0) * 100);
                    const flags = checkCompliance(editText(r.field_key, r.suggested_value)).flags;
                    return (
                      <li key={r.id} className="rounded-lg border border-white/10 bg-black p-2 text-sm">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="font-semibold text-white">{isDraftFieldKey(r.field_key) ? FIELD_LABEL[r.field_key] : r.field_key}</span>
                          <span className={`rounded px-1.5 py-0.5 font-semibold ${pct >= ACCEPT_ALL_THRESHOLD ? "bg-[var(--admin-accent-soft)] text-[var(--admin-accent)]" : "bg-[var(--admin-gold-soft)] text-[var(--admin-gold)]"}`}>{pct}%</span>
                          {ev.bestGuess && <span className="rounded border border-amber-400/40 px-1.5 py-0.5 text-amber-200">best guess</span>}
                          {flags.length > 0 && <span className="text-red-400">⚠ {flags.length} flag{flags.length > 1 ? "s" : ""}</span>}
                          {ev.evidence.map((id) => (
                            <span key={id} className="rounded-full border border-white/15 px-1.5 py-0.5 text-white/50">
                              {evidenceLabel(id)}
                            </span>
                          ))}
                        </div>
                        <form action={copilotAcceptDraftAction} className="mt-1" data-testid="copilot-draft-form">
                          {ctx}
                          <input type="hidden" name="id" value={r.id} />
                          <label className="sr-only" htmlFor={`cd-${r.id}`}>
                            Edit {isDraftFieldKey(r.field_key) ? FIELD_LABEL[r.field_key] : r.field_key}
                          </label>
                          <textarea
                            id={`cd-${r.id}`}
                            name="editedValue"
                            defaultValue={editText(r.field_key, r.suggested_value)}
                            rows={editKind(r.field_key) === "seo" || String(r.suggested_value ?? "").length > 120 ? 3 : 1}
                            className="w-full resize-y rounded border border-white/15 bg-white/5 px-2 py-1 text-sm text-white/85 focus:border-[var(--admin-accent)] focus:outline-none"
                          />
                          <div className="mt-1 flex flex-wrap items-center gap-2">
                            <button type="submit" className={CHIP_ACTION}>
                              Save &amp; accept
                            </button>
                            <button type="submit" formAction={copilotRejectDraftAction} className={CHIP_NEUTRAL}>
                              Reject
                            </button>
                            <span className="text-[0.65rem] text-white/40">{EDIT_HINT[editKind(r.field_key)]}</span>
                          </div>
                        </form>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>

          {/* 3. The chat */}
          <section id="chat" className="rounded-lg border border-white/10 p-3">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/50">Talk to the copilot (press /)</h3>
            <CopilotChat
              key={c.key}
              hidden={hidden}
              photoChoices={choices}
              attachedPhotos={c.photos.map((p, n) => ({ id: p.id, label: `attached photo ${n + 1}` }))}
              aiReady={isAiConfigured}
            />
          </section>
        </div>

        <details className="rounded-lg border border-white/10 p-3 text-xs text-white/60" data-testid="copilot-keys-help">
          <summary className="cursor-pointer font-semibold text-white/80">Keyboard</summary>
          <ul className="mt-2 grid gap-1 sm:grid-cols-2">
            {COPILOT_KEYS.map((k) => (
              <li key={k.key}>
                <kbd className="mr-2 rounded border border-white/20 px-1.5">{k.key}</kbd>
                {k.label}
              </li>
            ))}
          </ul>
        </details>
      </div>
    </div>
  );
}
