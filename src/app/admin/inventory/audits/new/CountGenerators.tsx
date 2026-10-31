/**
 * src/app/admin/inventory/audits/new/CountGenerators.tsx   (Fix Phase 4.4c · G-40 · owner D58)
 *
 * The owner, verbatim (D58): "Something like a vendor per day, broken into
 * chunks if a large vendor, or if small enough, to do on their own." and
 * "I also want options for initiating intelligent cycle counts."
 *
 * The tabs across the top of Plan a count, and the body for every generator
 * except "Never counted / overdue" (which is the planner's own risk list,
 * rendered by page.tsx as before). Every generator only PROPOSES: the owner
 * still names the count, writes why, creates it and releases it.
 */
import Link from "next/link";
import { Badge, Button, Field, Input, Textarea } from "@/components/admin/ui";
import { formatCents } from "@/lib/accounting/books-view-core";
import { extendCostCents, groupLotsByProduct, type AuditLot } from "@/lib/inventory/inventory-audit-core";
import {
  COUNT_GENERATORS,
  GENERATOR_HELP,
  GENERATOR_LABELS,
  MAX_CHUNK_LOTS,
  MIN_CHUNK_LOTS,
  type CountGenerator,
  type Picked,
  type RotationState,
  type VendorProposal,
} from "@/lib/inventory/count-generators-core";
import { createAuditAction, saveRotationSettingsAction, skipVendorAction } from "../actions";

const CARD = "rounded-2xl border border-white/10 bg-white/[0.02] p-5";
const P = "text-sm leading-relaxed text-[var(--admin-text-muted)]";
const H2 = "text-sm font-bold text-white";

/** The generator tabs. "due" is the default (the planner's risk list). */
export function GeneratorTabs({ active }: { active: CountGenerator | "import" }) {
  return (
    <nav className="flex flex-wrap gap-2" aria-label="Ways to pick a count" data-testid="count-generator-tabs">
      {COUNT_GENERATORS.map((g) => (
        <Link
          key={g}
          href={g === "due" ? "/admin/inventory/audits/new" : `/admin/inventory/audits/new?gen=${g}`}
          className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
            active === g
              ? "border-[var(--admin-accent)] bg-[var(--admin-accent)]/15 text-white"
              : "border-white/15 text-[var(--admin-text-muted)] hover:text-white"
          }`}
          aria-current={active === g ? "page" : undefined}
        >
          {GENERATOR_LABELS[g]}
        </Link>
      ))}
      {active === "import" ? (
        <span className="rounded-full border border-[var(--admin-accent)] bg-[var(--admin-accent)]/15 px-3 py-1.5 text-xs font-semibold text-white">
          Cultivera import flags
        </span>
      ) : null}
    </nav>
  );
}

/** The next rotation pointer, carried as hidden fields (sanitised again by the action). */
function NextPointerFields({ next }: { next: VendorProposal["next"] }) {
  return (
    <>
      <input type="hidden" name="nextVendorId" value={next.vendorId ?? ""} />
      <input type="hidden" name="nextVendorKey" value={next.vendorKey ?? ""} />
      <input type="hidden" name="nextVendorName" value={next.vendorName ?? ""} />
      <input type="hidden" name="nextChunk" value={String(next.chunk)} />
    </>
  );
}

export function GeneratorBody({
  gen,
  lots,
  picked,
  label,
  rationale,
  vendor,
  rotation,
  unread,
}: {
  gen: Exclude<CountGenerator, "due">;
  lots: readonly AuditLot[];
  picked: Picked;
  label: string;
  rationale: string;
  vendor: VendorProposal | null;
  rotation: RotationState;
  /** Exception sources that could not be read (the list may be short). */
  unread: string[];
}) {
  const byId = new Map(lots.map((l) => [l.lotId, l]));
  const chosen = picked.lotIds.map((id) => byId.get(id)).filter((l): l is AuditLot => !!l);
  const groups = [...groupLotsByProduct(chosen).values()];
  let value: number | null = 0;
  for (const l of chosen) {
    // A lot with no cost on file makes the total unknown (never invented as $0).
    if (value === null || l.unitCostMinorUnits === null || !Number.isInteger(l.unitCostMinorUnits) || !Number.isFinite(l.onHandQty)) value = null;
    else value += extendCostCents(l.onHandQty, l.unitCostMinorUnits);
  }

  return (
    <>
      <section className={CARD} data-testid={`generator-${gen}`}>
        <h2 className={H2}>{GENERATOR_LABELS[gen]}</h2>
        <p className={`mt-1 ${P}`}>{GENERATOR_HELP[gen]}</p>
        <p className={`mt-2 ${P}`}>
          {chosen.length} lot{chosen.length === 1 ? "" : "s"} across {groups.length} product{groups.length === 1 ? "" : "s"}
          {value === null ? "" : `, ${formatCents(value)} at cost`}.
          {picked.skippedOpen > 0
            ? ` ${picked.skippedOpen} lot${picked.skippedOpen === 1 ? " is" : "s are"} left out because ${picked.skippedOpen === 1 ? "it is" : "they are"} already on an open count (a lot is on one open count at a time).`
            : ""}
          {picked.deferredProducts > 0
            ? ` ${picked.deferredProducts} more product${picked.deferredProducts === 1 ? "" : "s"} qualified but did not fit; they stay for next time.`
            : ""}
        </p>
        {unread.length > 0 ? (
          <p className="mt-2 rounded-lg border border-[var(--admin-gold)]/35 bg-[var(--admin-gold)]/[0.06] px-3 py-2 text-xs text-white/85">
            Could not read: {unread.join(", ")}. The list below may be shorter than it should be.
          </p>
        ) : null}
      </section>

      {gen === "vendor" ? <VendorPanel vendor={vendor} rotation={rotation} /> : null}

      {chosen.length === 0 ? (
        <section className={CARD}>
          <h2 className={H2}>Nothing to propose here right now</h2>
          <p className={`mt-1 ${P}`}>
            {gen === "vendor"
              ? "No vendor has an open lot that is not already on an open count."
              : "No open lot matches this generator today. That is a good outcome; try another tab."}
          </p>
        </section>
      ) : (
        <form action={createAuditAction} className="space-y-5">
          <input type="hidden" name="gen" value={gen} />
          {gen === "vendor" && vendor ? <NextPointerFields next={vendor.next} /> : null}
          <section className={CARD}>
            <h2 className={H2}>Name it and say why</h2>
            <p className={`mt-1 ${P}`}>Pre-written from the generator. Change either before you create the count.</p>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <Field label="What to call this count" htmlFor="gen-label" required>
                <Input id="gen-label" name="label" required defaultValue={label} />
              </Field>
              <Field label="Why these products" htmlFor="gen-rationale" required>
                <Textarea id="gen-rationale" name="scopeRationale" required minLength={10} rows={3} defaultValue={rationale} />
              </Field>
            </div>
          </section>

          <section className={CARD}>
            <h2 className={H2}>What the system proposes, and why</h2>
            <p className={`mt-1 ${P}`}>
              Each lot says why it was picked. A product goes in whole: a lot of the same product rides along with the one picked.
            </p>
            <div className="mt-4 space-y-3">
              {groups.map((g) => (
                <div key={g[0]!.posProductKey ?? g[0]!.lotId} className="rounded-xl border border-white/10 bg-white/[0.015] p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-white">{g[0]!.productName ?? "Unnamed product"}</p>
                      <p className="text-xs text-[var(--admin-text-muted)]">
                        {g[0]!.vendorName ?? "Vendor not recorded"} &middot; {g.length} open lot{g.length === 1 ? "" : "s"}
                      </p>
                    </div>
                    {g.length > 1 ? <Badge tone="orange">Several open lots &mdash; count separately</Badge> : null}
                  </div>
                  <ul className="mt-3 space-y-1.5" data-testid="generator-why">
                    {g.map((l) => (
                      <li key={l.lotId} className="text-xs text-white/75">
                        <span className="mr-2 rounded-md border border-white/10 bg-black/30 px-2 py-0.5 font-mono text-[11px] text-white/70">
                          {l.lotCode ?? "NO LOT CODE"}
                        </span>
                        {(picked.why[l.lotId] ?? []).join(" ")}
                        <input type="hidden" name="lotId" value={l.lotId} />
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" variant="primary" size="lg">
              Create this count &mdash; {chosen.length} lots
            </Button>
            <p className="text-xs text-[var(--admin-text-muted)]">
              Creating it freezes today&apos;s quantities and costs. It is not on the count queue until you Release it.
            </p>
          </div>
        </form>
      )}
    </>
  );
}

function VendorPanel({ vendor, rotation }: { vendor: VendorProposal | null; rotation: RotationState }) {
  return (
    <section className={CARD} data-testid="vendor-rotation">
      <h2 className={H2}>The rotation</h2>
      {vendor ? (
        <p className={`mt-1 ${P}`}>
          Today: <span className="font-semibold text-white">{vendor.vendorName}</span>
          {vendor.chunkCount > 1 ? `, part ${vendor.chunkIndex + 1} of ${vendor.chunkCount}` : " (the whole vendor)"}. Creating this count moves
          the rotation on; so does Skip.
        </p>
      ) : (
        <p className={`mt-1 ${P}`}>No vendor to propose.</p>
      )}
      {rotation.lastPlannedOn ? (
        <p className={`mt-1 ${P}`}>
          Last vendor count planned {rotation.lastPlannedOn}
          {rotation.lastPlannedLabel ? ` (\u201c${rotation.lastPlannedLabel}\u201d)` : ""}.
        </p>
      ) : null}
      {vendor && vendor.upcoming.length > 0 ? (
        <div className="mt-3">
          <p className="text-xs font-semibold text-white">Coming up</p>
          <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-xs text-white/75" data-testid="vendor-upcoming">
            {vendor.upcoming.map((u, i) => (
              <li key={`${u.vendorName}-${i}`}>
                {u.vendorName} &middot; {u.chunkLabel}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      <div className="mt-4 flex flex-wrap items-end gap-4">
        <form action={saveRotationSettingsAction} className="flex items-end gap-2" data-testid="vendor-chunk-form">
          <Field label="Lots per vendor count" htmlFor="chunk-lots" help={`${MIN_CHUNK_LOTS} to ${MAX_CHUNK_LOTS}. A big vendor is split into counts of about this size.`}>
            <Input id="chunk-lots" name="chunkLots" type="number" min={MIN_CHUNK_LOTS} max={MAX_CHUNK_LOTS} step={1} defaultValue={String(rotation.chunkLots)} />
          </Field>
          <Button type="submit" variant="neutral" size="sm">
            Save
          </Button>
        </form>
        {vendor ? (
          <form action={skipVendorAction}>
            <NextPointerFields next={vendor.next} />
            <Button type="submit" variant="neutral" size="sm">
              Skip to the next one
            </Button>
          </form>
        ) : null}
      </div>
    </section>
  );
}
