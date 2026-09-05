import Link from "next/link";
import { Input, Select } from "@/components/admin/ui";
import {
  INVENTORY_FACETS,
  facetOptions,
  UNSET_FACET_VALUE,
  type FilterableLot,
  type InventoryFilterState,
} from "@/lib/inventory/inventory-filter-core";
import { FacetCombobox } from "@/components/admin/inventory/FacetCombobox";
import { countActiveIn } from "@/lib/inventory/facet-typeahead-core";
import {
  activeFilterChips,
  clearAllFiltersHref,
  clearFacetHref,
  toggleFacetHref,
  type RawParams,
} from "@/lib/inventory/inventory-url-core";

/**
 * ────────────────────────────────────────────────────────────────────────────
 * SLICE 13 — the inventory filter panel.
 *
 * A SERVER COMPONENT, ON PURPOSE. Every control is either a plain form field
 * (submitted by GET) or a link. There is no client-side state, which means:
 *   * the URL is always the complete truth about what is on screen,
 *   * a filtered view can be bookmarked or sent to someone,
 *   * the panel can never disagree with the table below it.
 * That is the pre-existing doctrine of this page and this panel keeps it.
 *
 * WHY FACETS ARE CHECKBOX LINKS AND NOT A <select multiple>
 * ---------------------------------------------------------------------------
 * A multi-select needs ctrl-click to add a second value and gives no count,
 * no search, and no indication of what is selected once it scrolls. These are
 * checkboxes that navigate on click: one click adds a vendor, one click
 * removes it, and each one carries the number of lots behind it so the owner
 * can see where the inventory actually is before clicking.
 *
 * WHY THE COUNTS COME FROM THE UNFILTERED SET
 * ---------------------------------------------------------------------------
 * Options are built from every lot, not from the currently-visible ones. If
 * they were built from the filtered set, selecting vendor A would erase every
 * other vendor from the list and the owner could never switch to vendor B
 * without first clearing the filter. Showing the full menu with real counts is
 * what makes this feel like a tool rather than a maze.
 * ────────────────────────────────────────────────────────────────────────────
 */

/**
 * ───────────────────────────────────────────────────────────────────────────
 * SLICE 14 — CONTAINING THE POWER.
 *
 * The owner's verdict on Slice 13 was "great, but very overwhelming", and that
 * is a correctness problem, not a decorating problem: "if my employees are
 * overwhelmed, they won't use it and it'll all be for naught."
 *
 * What made it overwhelming was not the number of filters, it was that ALL of
 * them were on screen simultaneously — twelve open, scrolling facet boxes plus
 * ten tri-state dropdowns plus seven range pairs. Nothing was hidden, so
 * nothing had priority, and the eye had nowhere to land.
 *
 * Three changes, each grounded in published enterprise-UX guidance rather than
 * taste:
 *
 * 1. EVERY FACET IS NOW ONE CLOSED CONTROL (FacetCombobox). Click to open a
 *    searchable list, type to narrow, click to add, and selections appear as
 *    removable pills. "Provide a search mechanism for dropdown menus with a
 *    large number of values"; "additive lozenges … are a great way to convey
 *    that meaning." (Pencil & Paper, Filter UX Design Patterns.)
 *
 * 2. PROGRESSIVE DISCLOSURE. The everyday controls — search and the facets —
 *    are visible immediately. Flags, potency/stock/cost ranges and dates are
 *    real filters but not daily ones, so they collapse into labelled sections
 *    that OPEN THEMSELVES when they contain something active. Power stays; the
 *    wall does not.
 *
 * 3. THE COUNT STAYS VISIBLE. Each collapsed section shows how many of its
 *    filters are engaged, and the existing chip row still lists every active
 *    filter with a one-click removal. Redundancy is the point: "it's easy for
 *    a user to forget they even selected filters at all."
 *
 * What did NOT change: the URL is still the single source of truth, every
 * option is still a real link, and facet counts still come from the unfiltered
 * set. Those doctrines are why this page can be bookmarked and trusted.
 * ───────────────────────────────────────────────────────────────────────────
 */

/** Param keys owned by each collapsible section, for the "N active" badge. */
const FLAG_PARAMS = [
  "coaState",
  "sampleState",
  "medicalState",
  "lowThc",
  "otherwiseTaken",
  "labPassed",
  "hasExpiry",
  "hasReceived",
  "hasCost",
  "hasStrainType",
] as const;

const RANGE_PARAMS = [
  "thcMin",
  "thcMax",
  "cbdMin",
  "cbdMax",
  "qtyMin",
  "qtyMax",
  "soldMin",
  "soldMax",
  "costMin",
  "costMax",
] as const;

const DATE_PARAMS = ["recvFrom", "recvTo", "expFrom", "expTo", "expiring"] as const;

/**
 * A collapsible group of advanced controls.
 *
 * `defaultOpen` is driven by whether the section actually holds an active
 * filter, so a filter can never be applied-but-hidden. Built on <details> so
 * the disclosure needs no JavaScript and survives a reload.
 */
function AdvancedSection({
  title,
  hint,
  activeCount,
  children,
}: {
  title: string;
  hint: string;
  activeCount: number;
  children: React.ReactNode;
}) {
  return (
    <details
      open={activeCount > 0}
      className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)]"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2">
        <span className="flex items-center gap-2 text-[0.7rem] font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">
          {title}
          {activeCount > 0 && (
            <span className="rounded-full bg-[var(--admin-accent-soft)] px-1.5 py-0.5 text-[0.6rem] font-semibold text-[var(--admin-accent)]">
              {activeCount}
            </span>
          )}
        </span>
        <span className="text-[0.65rem] text-[var(--admin-text-faint)]">{hint}</span>
      </summary>
      <div className="border-t border-[var(--admin-border)] px-3 py-3">{children}</div>
    </details>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="mb-1 block text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
      {children}
    </label>
  );
}

/**
 * A tri-state dropdown. THREE options, not two, because NULL MEANS UNKNOWN in
 * this database: a lot with no answer recorded for "is this medical?" is not
 * the same as a lot recorded as not-medical. Collapsing those two would let
 * "no" quietly absorb every unanswered row, which is how a filter starts
 * lying. "Unknown" is a first-class choice and is often the most useful one —
 * it is the worklist of what still needs attention.
 */
function TriStateField({
  name,
  label,
  value,
  yesLabel,
  noLabel,
  unknownLabel = "Unknown",
}: {
  name: string;
  label: string;
  value: string | undefined;
  yesLabel: string;
  noLabel: string;
  unknownLabel?: string;
}) {
  const safe = value === "yes" || value === "no" || value === "unknown" ? value : "";
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <Select name={name} defaultValue={safe} aria-label={label}>
        <option value="">Any</option>
        <option value="yes">{yesLabel}</option>
        <option value="no">{noLabel}</option>
        <option value="unknown">{unknownLabel}</option>
      </Select>
    </div>
  );
}

/** A min/max pair. Either side alone is a perfectly good filter. */
function RangeField({
  label,
  minName,
  maxName,
  minValue,
  maxValue,
  placeholderMin,
  placeholderMax,
  type = "number",
  step,
  help,
}: {
  label: string;
  minName: string;
  maxName: string;
  minValue: string | undefined;
  maxValue: string | undefined;
  placeholderMin?: string;
  placeholderMax?: string;
  type?: "number" | "date";
  step?: string;
  help?: string;
}) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <div className="flex items-center gap-1.5">
        <Input
          name={minName}
          type={type}
          step={step}
          defaultValue={minValue ?? ""}
          placeholder={placeholderMin}
          aria-label={`${label} minimum`}
          className="px-2 py-1.5 text-xs"
        />
        <span className="text-xs text-[var(--admin-text-faint)]">to</span>
        <Input
          name={maxName}
          type={type}
          step={step}
          defaultValue={maxValue ?? ""}
          placeholder={placeholderMax}
          aria-label={`${label} maximum`}
          className="px-2 py-1.5 text-xs"
        />
      </div>
      {help ? (
        <p className="mt-1 text-[0.65rem] text-[var(--admin-text-faint)]">{help}</p>
      ) : null}
    </div>
  );
}

export function InventoryFilterPanel({
  raw,
  state,
  allLots,
  activeCount,
  open,
}: {
  /** The incoming query params, verbatim. */
  raw: RawParams;
  /** The parsed filter state (garbage already discarded). */
  state: InventoryFilterState;
  /** EVERY lot — facet options are built from the unfiltered set (see above). */
  allLots: FilterableLot[];
  /** How many filters are engaged, for the badge. */
  activeCount: number;
  /** Whether the panel starts expanded. */
  open: boolean;
}) {
  const chips = activeFilterChips(raw, state);
  const one = (k: string): string | undefined => {
    const v = raw[k];
    return Array.isArray(v) ? v[0] : v;
  };

  return (
    <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)]">
      {/*
        <details> gives a real disclosure with zero JavaScript, so the panel
        works on a server-rendered page and survives a reload with its state
        in the markup rather than in a hook.
      */}
      <details open={open}>
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
          <span className="flex items-center gap-2 text-sm font-semibold text-[var(--admin-text)]">
            Filters
            {activeCount > 0 && (
              <span className="rounded-full bg-[var(--admin-accent-soft)] px-2 py-0.5 text-[0.65rem] font-semibold text-[var(--admin-accent)]">
                {activeCount} active
              </span>
            )}
          </span>
          <span className="text-xs text-[var(--admin-text-faint)]">
            Vendors, brands, types, potency, dates, flags and more
          </span>
        </summary>

        <div className="border-t border-[var(--admin-border)] px-4 py-4">
          {/*
            ONE form, submitted by GET. Every scalar control below is a field
            in it, so "Apply" sets them all at once and the browser builds the
            query string — no hand-rolled URL assembly, no encoding bugs.
          */}
          <form method="get" className="space-y-5">
            {/*
              Params owned by OTHER features ride along as hidden fields.
              Without these, applying a filter from inside the received-date
              worklist (or a vendor cross-link, or bulk-fill mode) would
              silently drop that context and the owner would think the queue
              had emptied itself.
            */}
            {INVENTORY_FACETS.map((facet) =>
              (state.facets[facet.param] ?? []).map((v) => (
                <input key={`${facet.param}-${v}`} type="hidden" name={facet.param} value={v} />
              )),
            )}
            {one("status") && <input type="hidden" name="status" value={one("status")} />}
            {one("vendor") && <input type="hidden" name="vendor" value={one("vendor")} />}
            {one("needsReceivedDate") === "1" && (
              <input type="hidden" name="needsReceivedDate" value="1" />
            )}
            {["missingProductLink", "emptyActive", "missingExpiry", "unknownCost"].map((k) =>
              one(k) === "1" ? <input key={k} type="hidden" name={k} value="1" /> : null,
            )}
            {one("sc") && <input type="hidden" name="sc" value={one("sc")} />}
            {one("sd") && <input type="hidden" name="sd" value={one("sd")} />}

            {/* ── Search ─────────────────────────────────────────────────── */}
            <div>
              <FieldLabel>Search</FieldLabel>
              <Input
                name="q"
                defaultValue={one("q") ?? ""}
                placeholder="Product, lot code, POS key, vendor, brand, strain, notes…"
                aria-label="Search inventory"
              />
              <p className="mt-1 text-[0.65rem] text-[var(--admin-text-faint)]">
                Partial words, words in any order, and small typos all work. Searches twelve
                fields, not just the product name.
              </p>
            </div>

            {/* ── Flags (tri-state) ──────────────────────────────────────── */}
            <AdvancedSection
              title="Flags & paperwork"
              hint="COA, samples, medical, lab results, missing fields"
              activeCount={countActiveIn(raw, FLAG_PARAMS)}
            >
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                <TriStateField
                  name="coaState"
                  label="COA"
                  value={one("coaState")}
                  yesLabel="Has COA"
                  noLabel="Missing COA"
                  unknownLabel="Missing COA"
                />
                <TriStateField
                  name="sampleState"
                  label="Sample"
                  value={one("sampleState")}
                  yesLabel="Samples only"
                  noLabel="Exclude samples"
                  unknownLabel="Not recorded"
                />
                <TriStateField
                  name="medicalState"
                  label="Medical"
                  value={one("medicalState")}
                  yesLabel="Medical only"
                  noLabel="Non-medical"
                  unknownLabel="Not recorded"
                />
                <TriStateField
                  name="lowThc"
                  label="Low-THC liquid"
                  value={one("lowThc")}
                  yesLabel="Low-THC only"
                  noLabel="Not low-THC"
                  unknownLabel="Not recorded"
                />
                <TriStateField
                  name="otherwiseTaken"
                  label="Otherwise taken"
                  value={one("otherwiseTaken")}
                  yesLabel="Taken"
                  noLabel="Not taken"
                  unknownLabel="Not recorded"
                />
                <TriStateField
                  name="labPassed"
                  label="Lab result"
                  value={one("labPassed")}
                  yesLabel="Passed"
                  noLabel="Failed"
                  unknownLabel="No result recorded"
                />
                <TriStateField
                  name="hasExpiry"
                  label="Expiry date"
                  value={one("hasExpiry")}
                  yesLabel="On file"
                  noLabel="Missing"
                  unknownLabel="Missing"
                />
                <TriStateField
                  name="hasReceived"
                  label="Received date"
                  value={one("hasReceived")}
                  yesLabel="On file"
                  noLabel="Missing"
                  unknownLabel="Missing"
                />
                <TriStateField
                  name="hasCost"
                  label="Unit cost"
                  value={one("hasCost")}
                  yesLabel="On file"
                  noLabel="Missing"
                  unknownLabel="Missing"
                />
                <TriStateField
                  name="hasStrainType"
                  label="Strain type"
                  value={one("hasStrainType")}
                  yesLabel="On file"
                  noLabel="Missing"
                  unknownLabel="Missing"
                />
              </div>
            </AdvancedSection>

            {/* ── Numeric ranges ─────────────────────────────────────────── */}
            <AdvancedSection
              title="Potency, stock & cost"
              hint="THC, CBD, on hand, sold, unit cost"
              activeCount={countActiveIn(raw, RANGE_PARAMS)}
            >
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                <RangeField
                  label="THC %"
                  minName="thcMin"
                  maxName="thcMax"
                  minValue={one("thcMin")}
                  maxValue={one("thcMax")}
                  placeholderMin="min"
                  placeholderMax="max"
                  step="0.01"
                  help="Lots with no COA are excluded from a potency range."
                />
                <RangeField
                  label="CBD %"
                  minName="cbdMin"
                  maxName="cbdMax"
                  minValue={one("cbdMin")}
                  maxValue={one("cbdMax")}
                  placeholderMin="min"
                  placeholderMax="max"
                  step="0.01"
                  help="For any CBD at all, set min to 0.01."
                />
                <RangeField
                  label="On hand"
                  minName="qtyMin"
                  maxName="qtyMax"
                  minValue={one("qtyMin")}
                  maxValue={one("qtyMax")}
                  placeholderMin="min"
                  placeholderMax="max"
                  step="0.01"
                />
                <RangeField
                  label="Sold"
                  minName="soldMin"
                  maxName="soldMax"
                  minValue={one("soldMin")}
                  maxValue={one("soldMax")}
                  placeholderMin="min"
                  placeholderMax="max"
                  step="0.01"
                />
                <RangeField
                  label="Unit cost (cents)"
                  minName="costMin"
                  maxName="costMax"
                  minValue={one("costMin")}
                  maxValue={one("costMax")}
                  placeholderMin="min"
                  placeholderMax="max"
                  help="Stored in cents, so $12.50 is 1250."
                />
              </div>
            </AdvancedSection>

            {/* ── Date ranges ────────────────────────────────────────────── */}
            <AdvancedSection
              title="Dates"
              hint="Received, expiry, expiring soon"
              activeCount={countActiveIn(raw, DATE_PARAMS)}
            >
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <RangeField
                  label="Received between"
                  minName="recvFrom"
                  maxName="recvTo"
                  minValue={one("recvFrom")}
                  maxValue={one("recvTo")}
                  type="date"
                />
                <RangeField
                  label="Expires between"
                  minName="expFrom"
                  maxName="expTo"
                  minValue={one("expFrom")}
                  maxValue={one("expTo")}
                  type="date"
                />
                <div>
                  <FieldLabel>Expiring within</FieldLabel>
                  <Select
                    name="expiring"
                    defaultValue={one("expiring") ?? ""}
                    aria-label="Expiry window"
                  >
                    <option value="">Any date</option>
                    <option value="7">Within 7 days</option>
                    <option value="14">Within 14 days</option>
                    <option value="30">Within 30 days</option>
                    <option value="60">Within 60 days</option>
                    <option value="90">Within 90 days</option>
                  </Select>
                </div>
              </div>
            </AdvancedSection>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="submit"
                className="rounded-[var(--admin-radius)] bg-[var(--admin-accent)] px-4 py-2 text-xs font-semibold text-black transition hover:opacity-90"
              >
                Apply filters
              </button>
              <Link
                href={clearAllFiltersHref(raw)}
                className="text-xs text-[var(--admin-text-faint)] underline-offset-2 hover:text-[var(--admin-text)] hover:underline"
              >
                Clear everything
              </Link>
            </div>
          </form>

          {/* ── Facets ─────────────────────────────────────────────────
              Each facet is ONE CLOSED CONTROL that opens into a searchable
              list. Twelve of these fit in a few rows instead of filling the
              screen with twelve open scrollboxes.

              Still links, still outside the <form>: clicking an option
              navigates, so the URL remains the single source of truth. The
              typeahead only narrows what is displayed — it never becomes the
              mechanism by which a filter is applied. */}
          <div className="mt-5 border-t border-[var(--admin-border)] pt-4">
            <p className="mb-2 text-[0.7rem] font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">
              Narrow by value
            </p>
            <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {INVENTORY_FACETS.map((facet) => {
                const options = facetOptions(allLots, facet);
                if (options.length === 0) return null;
                const selected = state.facets[facet.param] ?? [];
                /*
                  Compute the toggle link for every option HERE, on the server.

                  This used to be `hrefFor={(value) => ...}`, and it took the
                  page down: React cannot serialise a function from a Server
                  Component into a Client Component, so the render threw with
                  "Functions cannot be passed directly to Client Components."
                  Sending plain strings keeps the boundary crossable, and every
                  option stays a real <a href> so filtering still works with no
                  JavaScript at all.
                */
                const withHrefs = options.map((option) => ({
                  ...option,
                  href: toggleFacetHref(raw, facet.param, option.value, selected),
                }));
                return (
                  <FacetCombobox
                    key={facet.param}
                    label={facet.label}
                    options={withHrefs}
                    selected={selected}
                    unsetValue={UNSET_FACET_VALUE}
                    clearHref={clearFacetHref(raw, facet.param)}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </details>

      {/* ── Active filter chips ────────────────────────────────────────────
          Always visible, even when the panel is collapsed. A filter the owner
          cannot SEE is the reason people stop trusting a list: the row count
          looks wrong and there is nothing on screen explaining why. */}
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-[var(--admin-border)] px-4 py-2.5">
          <span className="text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
            Active
          </span>
          {chips.map((chip, i) => (
            <Link
              key={`${chip.group}-${chip.label}-${i}`}
              href={chip.href}
              className="inline-flex items-center gap-1 rounded-full border border-[var(--admin-border-strong)] bg-[var(--admin-surface-2)] px-2 py-0.5 text-[0.7rem] text-[var(--admin-text-muted)] transition hover:border-[var(--admin-danger)] hover:text-[var(--admin-text)]"
              title={`Remove: ${chip.group} ${chip.label}`}
            >
              <span className="text-[var(--admin-text-faint)]">{chip.group}:</span>
              <span className="max-w-[14rem] truncate">{chip.label}</span>
              <span aria-hidden="true" className="text-[var(--admin-text-faint)]">
                {"\u00d7"}
              </span>
            </Link>
          ))}
          <Link
            href={clearAllFiltersHref(raw)}
            className="ml-1 text-[0.65rem] text-[var(--admin-text-faint)] underline-offset-2 hover:text-[var(--admin-text)] hover:underline"
          >
            clear all
          </Link>
        </div>
      )}
    </div>
  );
}

export default InventoryFilterPanel;
