/**
 * /admin/discovery/competitors - the owner-managed competitor roster.
 *
 * OWNER REQUEST (verbatim, standing rule 1):
 *   "I have the a list of competitors, is their a way for me to give the system
 *    a competitor specifically like I did to get the curated list, baked into
 *    the back office, so we don't have to make code edits to find other
 *    specific retailers and producer processors? I think that would be
 *    fantastic!"
 *
 * Before this screen the roster existed ONLY as a hardcoded SQL seed in
 * migration 0080. Adding a store meant an engineer editing SQL. Now the owner
 * maintains it himself, and it accepts producer/processors as well as
 * retailers.
 *
 * Styling uses the @/components/admin/ui token kit exclusively - no raw white
 * surfaces or hand-rolled input classes (the owner has been burned by
 * white-text-on-white-form before).
 */
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel, BackLink } from "@/components/admin/ux";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Field,
  Input,
  Section,
  Select,
  Textarea,
  type BadgeTone,
} from "@/components/admin/ui";
import { listAllCompetitors, getCompetitor } from "@/lib/discovery/competitors";
import { areaLabel, AREA_ORDER } from "@/lib/discovery/competitors";
import {
  COMPETITOR_KIND_LABELS,
  MAX_NOTE_LEN,
  MAX_TRADENAME_LEN,
  rowKind,
  summarizeRoster,
  type CompetitorKind,
} from "@/lib/discovery/competitor-roster-core";
import { saveCompetitorAction, setCompetitorActiveAction } from "./actions";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
function one(sp: SP, key: string): string | undefined {
  const v = sp[key];
  return (Array.isArray(v) ? v[0] : v) || undefined;
}

const KIND_TONE: Record<CompetitorKind, BadgeTone> = {
  retailer: "green",
  producer_processor: "orange",
  unknown: "neutral",
};

export default async function CompetitorRosterPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  await requirePermission("inventory.manage");
  const sp = await searchParams;

  const editLicense = one(sp, "edit");
  const [roster, editing] = await Promise.all([
    listAllCompetitors(),
    editLicense ? getCompetitor(editLicense) : Promise.resolve(null),
  ]);

  const summary = summarizeRoster(roster);
  const errorMsg = one(sp, "error");
  const warnMsg = one(sp, "warn");
  const saved = one(sp, "saved");
  const activated = one(sp, "activated");
  const deactivated = one(sp, "deactivated");
  const moved = one(sp, "moved");

  return (
    <div>
      <AdminPageHeader
        title="Competitor Roster"
        subtitle="The list of licenses the CCRS benchmarks track. Add a store or a producer/processor yourself - no code changes needed."
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Discovery", href: "/admin/discovery" },
              { label: "CCRS Benchmarks", href: "/admin/discovery/ccrs" },
              { label: "Competitor Roster" },
            ]}
          />
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        <BackLink fallback="/admin/discovery/ccrs" back={one(sp, "back")}>
          Back to CCRS Benchmarks
        </BackLink>

        {errorMsg ? (
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/10 p-4 text-sm text-[var(--admin-danger)]">
            {errorMsg}
          </div>
        ) : null}
        {saved ? (
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] p-4 text-sm text-[var(--admin-accent)]">
            Saved <strong>{saved}</strong>.
            {moved ? ` The previous license ${moved} was deactivated rather than deleted, so past benchmarks still make sense.` : ""}
          </div>
        ) : null}
        {activated ? (
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] p-4 text-sm text-[var(--admin-accent)]">
            {activated} is back on the tracked roster.
          </div>
        ) : null}
        {deactivated ? (
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-gold)]/40 bg-[var(--admin-gold-soft)] p-4 text-sm text-[var(--admin-gold)]">
            {deactivated} is no longer tracked. Its past benchmark history is kept.
          </div>
        ) : null}
        {warnMsg ? (
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-gold)]/40 bg-[var(--admin-gold-soft)] p-4 text-sm text-[var(--admin-gold)]">
            {warnMsg}
          </div>
        ) : null}

        <HelpPanel id="competitor-roster-help" title="What this list does" defaultOpen>
          <p>
            Every license on this roster gets tracked when you upload a monthly CCRS zip. That is
            how the benchmarks know which sales belong to which store.
          </p>
          <p className="mt-2">
            <strong>Retailer</strong> means a shop you compete with for the same customer - those
            are the ones used for price comparisons in your area.{" "}
            <strong>Producer / Processor</strong> means a grower or maker who sells wholesale -
            those are used for supply-side analysis and are deliberately kept out of retail price
            averages so they cannot skew them.
          </p>
          <p className="mt-2">
            The state&apos;s CCRS files do <em>not</em> say which is which - there is no license-type
            column in the data - so this is the one thing the system genuinely needs you to tell it.
            Anything left <strong>Unclassified</strong> is still listed and counted, but stays out of
            both comparisons until you classify it.
          </p>
          <p className="mt-2">
            Turning a store <strong>off</strong> stops tracking it going forward but keeps its
            history. Nothing here is ever permanently deleted.
          </p>
        </HelpPanel>

        <Section title="Roster at a glance">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <StatCard label="Tracked" value={summary.active} />
            <StatCard label="Retailers" value={summary.retailers} />
            <StatCard label="Producer / Processors" value={summary.producerProcessors} />
            <StatCard
              label="Unclassified"
              value={summary.unclassified}
              tone={summary.unclassified > 0 ? "warn" : undefined}
            />
            <StatCard label="Turned off" value={summary.inactive} />
          </div>
        </Section>

        <Card>
          <CardHeader
            title={editing ? `Edit ${editing.tradename}` : "Add a licensee"}
            subtitle={
              editing
                ? "Change any detail below, or turn this entry off further down the list."
                : "Enter the WSLCB license number exactly as it appears on the state's list."
            }
          />
          <form action={saveCompetitorAction} className="space-y-4">
            {editing ? (
              <input type="hidden" name="editing_license" value={editing.license_number} />
            ) : null}
            <input type="hidden" name="is_active_present" value="1" />

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="License number"
                required
                help="6 digits (10 for a lab). Leading zeros matter - type it exactly."
              >
                <Input
                  name="license_number"
                  defaultValue={editing?.license_number ?? ""}
                  placeholder="413541"
                  inputMode="numeric"
                  autoComplete="off"
                  required
                />
              </Field>

              <Field label="Business / store name" required>
                <Input
                  name="tradename"
                  defaultValue={editing?.tradename ?? ""}
                  placeholder="POT ZONE"
                  maxLength={MAX_TRADENAME_LEN}
                  autoComplete="off"
                  required
                />
              </Field>

              <Field
                label="What are they?"
                required
                help="The state's data doesn't tell us - this is the part only you can answer."
              >
                <Select name="kind" defaultValue={editing ? rowKind(editing) : "retailer"}>
                  <option value="retailer">{COMPETITOR_KIND_LABELS.retailer}</option>
                  <option value="producer_processor">
                    {COMPETITOR_KIND_LABELS.producer_processor}
                  </option>
                  <option value="unknown">{COMPETITOR_KIND_LABELS.unknown}</option>
                </Select>
              </Field>

              <Field
                label="Area"
                help="Used for neighborhood price comparisons between retailers."
              >
                <Select name="area" defaultValue={editing?.area ?? "other"}>
                  {AREA_ORDER.map((a) => (
                    <option key={a} value={a}>
                      {areaLabel(a)}
                    </option>
                  ))}
                  <option value="other">{areaLabel("other")}</option>
                </Select>
              </Field>

              <Field label="City">
                <Input
                  name="city"
                  defaultValue={editing?.city ?? ""}
                  placeholder="PORT ORCHARD"
                  autoComplete="off"
                />
              </Field>

              <Field label="County">
                <Input
                  name="county"
                  defaultValue={editing?.county ?? ""}
                  placeholder="KITSAP"
                  autoComplete="off"
                />
              </Field>
            </div>

            <Field label="Note" help="Anything you want to remember about this licensee.">
              <Textarea
                name="note"
                defaultValue={editing?.note ?? ""}
                maxLength={MAX_NOTE_LEN}
                placeholder="Opened a second location in 2026."
              />
            </Field>

            <label className="flex items-center gap-2 text-sm text-[var(--admin-text-muted)]">
              <input
                type="checkbox"
                name="is_active"
                value="1"
                defaultChecked={editing ? editing.is_active : true}
                className="admin-focus h-4 w-4 rounded border-[var(--admin-border-strong)] bg-[var(--admin-surface-2)]"
              />
              Track this licensee in the benchmarks
            </label>

            {editing?.is_self ? (
              <input type="hidden" name="is_self" value="1" />
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant={editing ? "save" : "confirm"}>
                {editing ? "Save changes" : "Add to roster"}
              </Button>
              {editing ? (
                <Button href="/admin/discovery/competitors" variant="neutral">
                  Cancel
                </Button>
              ) : null}
            </div>
          </form>
        </Card>

        <Section
          title={`Tracked licensees (${summary.total})`}
          description="Greenway is listed first, then everyone else alphabetically."
        >
          {roster.length === 0 ? (
            <Card>
              <p className="text-sm text-[var(--admin-text-muted)]">
                The roster is empty. Apply migration{" "}
                <code>0080_discovery_competitors.sql</code> to load the verified starting list, or
                add licensees above.
              </p>
            </Card>
          ) : (
            <div className="overflow-x-auto rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)]">
              <table className="w-full min-w-[820px] text-left text-sm">
                <thead className="bg-[var(--admin-surface-2)] text-[0.7rem] uppercase tracking-wide text-[var(--admin-text-muted)]">
                  <tr>
                    <th className="px-3 py-2 font-semibold">License</th>
                    <th className="px-3 py-2 font-semibold">Name</th>
                    <th className="px-3 py-2 font-semibold">Kind</th>
                    <th className="px-3 py-2 font-semibold">Area</th>
                    <th className="px-3 py-2 font-semibold">City</th>
                    <th className="px-3 py-2 font-semibold">Tracked</th>
                    <th className="px-3 py-2 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {[...roster]
                    .sort((a, b) => {
                      if (a.is_self !== b.is_self) return a.is_self ? -1 : 1;
                      if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
                      return a.tradename.localeCompare(b.tradename);
                    })
                    .map((c) => {
                      const kind = rowKind(c);
                      return (
                        <tr
                          key={c.license_number}
                          className={`border-t border-[var(--admin-border)] ${
                            c.is_active ? "" : "opacity-55"
                          }`}
                        >
                          <td className="px-3 py-2 font-mono text-[var(--admin-text)]">
                            {c.license_number}
                          </td>
                          <td className="px-3 py-2 text-[var(--admin-text)]">
                            {c.tradename}
                            {c.is_self ? (
                              <Badge tone="gold" className="ml-2">
                                Us
                              </Badge>
                            ) : null}
                          </td>
                          <td className="px-3 py-2">
                            <Badge tone={KIND_TONE[kind]}>{COMPETITOR_KIND_LABELS[kind]}</Badge>
                          </td>
                          <td className="px-3 py-2 text-[var(--admin-text-muted)]">
                            {areaLabel(c.area)}
                          </td>
                          <td className="px-3 py-2 text-[var(--admin-text-muted)]">
                            {c.city ?? "-"}
                          </td>
                          <td className="px-3 py-2">
                            {c.is_active ? (
                              <Badge tone="green">On</Badge>
                            ) : (
                              <Badge tone="neutral">Off</Badge>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex justify-end gap-2">
                              <Button
                                href={`/admin/discovery/competitors?edit=${encodeURIComponent(c.license_number)}`}
                                variant="neutral"
                                size="sm"
                              >
                                Edit
                              </Button>
                              {c.is_self ? null : (
                                <form action={setCompetitorActiveAction}>
                                  <input
                                    type="hidden"
                                    name="license_number"
                                    value={c.license_number}
                                  />
                                  <input
                                    type="hidden"
                                    name="active"
                                    value={c.is_active ? "0" : "1"}
                                  />
                                  <Button
                                    type="submit"
                                    variant={c.is_active ? "danger" : "confirm"}
                                    size="sm"
                                  >
                                    {c.is_active ? "Turn off" : "Turn on"}
                                  </Button>
                                </form>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "warn";
}) {
  return (
    <div
      className={`rounded-[var(--admin-radius-lg)] border p-4 ${
        tone === "warn"
          ? "border-[var(--admin-gold)]/40 bg-[var(--admin-gold-soft)]"
          : "border-[var(--admin-border)] bg-[var(--admin-surface)]"
      }`}
    >
      <div
        className={`text-2xl font-black ${
          tone === "warn" ? "text-[var(--admin-gold)]" : "text-[var(--admin-text)]"
        }`}
      >
        {value}
      </div>
      <div className="mt-1 text-[0.7rem] font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">
        {label}
      </div>
    </div>
  );
}
