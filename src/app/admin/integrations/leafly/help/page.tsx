/**
 * src/app/admin/integrations/leafly/help/page.tsx   (Slice B)
 *
 * THE LEAFLY HANDBOOK.
 *
 * "knowing how to use the powerful system is just as important as having a
 *  powerful system, as we wouldn't be able to take advantage of all it has to
 *  offer otherwise."
 *
 * One page that holds everything about Leafly: the two priority walkthroughs
 * (push & preview first, the orders dashboard second -- an order asserted in
 * CI, because the owner named that priority and priorities are the first thing
 * a refactor loses), the four secondary surfaces, the first-time checklist,
 * and the handful of ideas that explain the rest.
 *
 * It is a SERVER component holding CLIENT components. The content is static
 * data compiled into the bundle, so there is nothing to fetch and nothing that
 * can fail to load: a help page that can show an error state is a help page
 * that will be unavailable exactly when something is broken.
 */
import Link from "next/link";

import { requireStaff } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs } from "@/components/admin/ux";
import { Card, CardHeader } from "@/components/admin/ui";
import { LeaflyWalkthrough } from "@/components/admin/leafly/LeaflyWalkthrough";
import { LeaflyFirstTimeChecklist } from "@/components/admin/leafly/LeaflyFirstTimeChecklist";
import {
  BIG_IDEAS,
  ORDERS_DASHBOARD,
  OTHER_SURFACES,
  PUSH_AND_PREVIEW,
  helperCoverage,
} from "@/lib/leafly/helper-core";

export const dynamic = "force-dynamic";

export default async function LeaflyHelpPage() {
  await requireStaff();
  const coverage = helperCoverage();

  return (
    <div>
      <AdminPageHeader
        title="Leafly, explained"
        subtitle="Every screen, every button, and why each one behaves the way it does."
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Integrations", href: "/admin/integrations" },
              { label: "Leafly", href: "/admin/integrations/leafly" },
              { label: "Help" },
            ]}
          />
        }
      />

      <div className="mx-auto max-w-4xl space-y-6 px-5 py-6 sm:px-8">
        {/* Start with the ideas, not the buttons. Someone who understands the
            six facts below can reason about a screen they have never seen;
            someone who has only memorised button positions cannot. */}
        <Card>
          <CardHeader
            title="Six things that explain almost everything"
            subtitle="Read these once and the rest of the integration stops being surprising."
          />
          <div className="mt-3 space-y-4">
            {BIG_IDEAS.map((idea) => (
              <div
                key={idea.title}
                className="border-b border-[var(--admin-border)] pb-4 last:border-b-0 last:pb-0"
              >
                <h3 className="text-sm font-semibold text-[var(--admin-text)]">
                  {idea.title}
                </h3>
                <p className="mt-1 text-sm text-[var(--admin-muted)]">
                  {idea.body}
                </p>
              </div>
            ))}
          </div>
        </Card>

        <LeaflyFirstTimeChecklist />

        {/* The owner's stated first priority. */}
        <LeaflyWalkthrough walkthrough={PUSH_AND_PREVIEW} />

        {/* The owner's stated second priority. */}
        <LeaflyWalkthrough walkthrough={ORDERS_DASHBOARD} />

        <div className="space-y-6">
          {OTHER_SURFACES.map((w) => (
            <LeaflyWalkthrough key={w.id} walkthrough={w} />
          ))}
        </div>

        <Card>
          <CardHeader
            title="What this handbook covers"
            subtitle="Counted from the content itself, so it cannot overstate."
          />
          <p className="mt-3 text-sm text-[var(--admin-muted)]">
            {coverage.walkthroughs} walkthroughs, {coverage.steps} steps,{" "}
            {coverage.features} controls explained, {coverage.fixes} problems
            diagnosed and {coverage.faqs} questions answered.
          </p>
          <p className="mt-2 text-sm text-[var(--admin-muted)]">
            Every button name here is checked against the real source code on
            every push. If someone renames a button and forgets this page, the
            build fails rather than leaving you hunting for a control that no
            longer exists.
          </p>
          <p className="mt-3 text-sm">
            <Link
              href="/admin/integrations/leafly"
              className="text-[var(--admin-accent)] underline"
            >
              Back to the Leafly page
            </Link>
          </p>
        </Card>
      </div>
    </div>
  );
}
