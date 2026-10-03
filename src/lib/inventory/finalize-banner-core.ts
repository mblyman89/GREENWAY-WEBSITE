/**
 * R23 (owner fix 1) — the ONE banner a manifest page shows after Finalize.
 *
 * The bug: finalizeIntakeAction ALWAYS redirects with
 *   ?finalized=<status>&accepted=<n>&rejected=<n>&drafts=<n>&held=<n>
 * and the page rendered three independent banners keyed on the RAW strings.
 * `rejected=0` is a truthy string, so every clean finalize showed a RED
 * "Whole manifest rejected at the dock" bar sandwiched between two green
 * bars — the delivery looked refused when it had been accepted.
 *
 * The real whole-manifest reject (rejectManifestAction) redirects with
 * `?rejected=1` and NO `finalized`. So the two flows are told apart by the
 * presence of `finalized`, never by the truthiness of a count string.
 *
 * Enterprise pattern (status-message hierarchy, e.g. Atlassian / GOV.UK
 * "notification banner"): ONE banner per outcome, its tone set by the
 * outcome, with secondary facts as calm sub-lines — refusals are a normal
 * dock decision, not an error. Pure: no I/O.
 */

export type FinalizeBannerTone = "green" | "gold" | "neutral";

export type FinalizeBannerParams = {
  finalized?: string;
  accepted?: string;
  rejected?: string;
  drafts?: string;
  held?: string;
};

export type FinalizeBanner = {
  kind: "finalized" | "whole_reject" | "accepted_only";
  tone: FinalizeBannerTone;
  headline: string;
  /** Calm secondary facts, one sentence each, already pluralised. */
  details: string[];
  /** >0 → render the "review drafts" link. */
  drafts: number;
  /** >0 → point at the Issues tab. */
  held: number;
};

/** A query count → a non-negative integer. Garbage, negatives, absent → 0. */
export function parseCount(raw: string | undefined): number {
  if (typeof raw !== "string" || !/^\d{1,9}$/.test(raw.trim())) return 0;
  return Number(raw.trim());
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function finalizeBanner(p: FinalizeBannerParams): FinalizeBanner | null {
  const finalized = typeof p.finalized === "string" && p.finalized.trim() !== "" ? p.finalized.trim() : null;
  const accepted = parseCount(p.accepted);
  const rejected = parseCount(p.rejected);
  const drafts = parseCount(p.drafts);
  const held = parseCount(p.held);

  if (finalized) {
    const details: string[] = [];
    if (rejected > 0) {
      details.push(
        `${plural(rejected, "line was", "lines were")} refused at the dock — refused product never entered inventory and is not owed for. This is a normal dock decision, not an error.`,
      );
    }
    if (held > 0) {
      details.push(
        `${plural(held, "lot is", "lots are")} held in quarantine until the missing paperwork is fixed — see the Issues tab.`,
      );
    }
    if (finalized === "accepted") {
      return {
        kind: "finalized",
        tone: "green",
        headline: `Delivery accepted — ${plural(accepted, "lot", "lots")} activated and on hand.`,
        details,
        drafts,
        held,
      };
    }
    if (finalized === "partially_accepted") {
      return {
        kind: "finalized",
        tone: "gold",
        headline: `Delivery partially accepted — ${plural(accepted, "lot", "lots")} activated and on hand.`,
        details,
        drafts,
        held,
      };
    }
    if (finalized === "rejected") {
      return {
        kind: "finalized",
        tone: "neutral",
        headline: "Finalized with nothing accepted — no lot was activated, so no vendor bill was raised.",
        details,
        drafts,
        held,
      };
    }
    return {
      kind: "finalized",
      tone: "neutral",
      headline: `Finalized — ${plural(accepted, "lot", "lots")} activated.`,
      details,
      drafts,
      held,
    };
  }

  if (rejected > 0) {
    return {
      kind: "whole_reject",
      tone: "neutral",
      headline: "You rejected this whole manifest at the dock.",
      details: [
        "Refused product never entered inventory (nothing destroyed). No CCRS filing on our end — ask the vendor to Update or Delete their manifest.",
      ],
      drafts: 0,
      held: 0,
    };
  }

  if (accepted > 0) {
    return {
      kind: "accepted_only",
      tone: "green",
      headline: `Accepted — ${plural(accepted, "lot", "lots")} activated and on hand.`,
      details: [],
      drafts,
      held: 0,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Pure self-tests (registered in scripts/compliance/run-pure-selftests.ts).
// ---------------------------------------------------------------------------
export function __runFinalizeBannerCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL finalize-banner-core: " + msg);
    passed += 1;
  };

  // parseCount
  ok(parseCount("0") === 0, "0 → 0");
  ok(parseCount("12") === 12, "12 → 12");
  ok(parseCount(" 3 ") === 3, "trimmed");
  ok(parseCount(undefined) === 0, "absent → 0");
  ok(parseCount("") === 0, "empty → 0");
  ok(parseCount("-2") === 0, "negative → 0");
  ok(parseCount("abc") === 0, "garbage → 0");
  ok(parseCount("1.5") === 0, "decimal → 0");
  ok(parseCount("9999999999") === 0, "absurd length → 0");

  // THE BUG: a clean finalize carries rejected=0 — no reject banner, one green banner.
  const clean = finalizeBanner({ finalized: "accepted", accepted: "12", rejected: "0", drafts: "0", held: "0" });
  ok(clean !== null && clean.kind === "finalized", "clean finalize → one finalized banner");
  ok(clean!.tone === "green", "clean finalize is green");
  ok(clean!.headline === "Delivery accepted — 12 lots activated and on hand.", "clean headline");
  ok(clean!.details.length === 0, "rejected=0 adds no refusal line");
  ok(!clean!.headline.toLowerCase().includes("reject"), "no reject wording on a clean accept");
  ok(clean!.drafts === 0 && clean!.held === 0, "no drafts/held");

  // Singular
  const one = finalizeBanner({ finalized: "accepted", accepted: "1", rejected: "0" });
  ok(one!.headline === "Delivery accepted — 1 lot activated and on hand.", "singular lot");

  // Partial: refusals are a calm detail, gold tone.
  const part = finalizeBanner({ finalized: "partially_accepted", accepted: "5", rejected: "2", drafts: "3", held: "1" });
  ok(part!.tone === "gold", "partial is gold");
  ok(part!.headline.startsWith("Delivery partially accepted — 5 lots"), "partial headline");
  ok(part!.details.length === 2, "refused + held lines");
  ok(part!.details[0].startsWith("2 lines were refused at the dock"), "refused line plural");
  ok(part!.details[0].includes("not an error"), "refusal explained as normal");
  ok(part!.details[1].startsWith("1 lot is held in quarantine"), "held line singular");
  ok(part!.details[1].includes("Issues tab"), "held points at Issues");
  ok(part!.drafts === 3 && part!.held === 1, "drafts/held carried");
  const oneRef = finalizeBanner({ finalized: "partially_accepted", accepted: "5", rejected: "1" });
  ok(oneRef!.details[0].startsWith("1 line was refused"), "refused line singular");
  ok(oneRef!.details.length === 1, "held=absent adds nothing");

  // Finalize with nothing accepted is neutral, never red.
  const none = finalizeBanner({ finalized: "rejected", accepted: "0", rejected: "4" });
  ok(none!.kind === "finalized" && none!.tone === "neutral", "finalize-rejected is neutral finalized");
  ok(none!.headline.includes("no vendor bill"), "explains no bill");
  ok(none!.details.length === 1, "4 refused detail");

  // Unknown status → neutral generic.
  const odd = finalizeBanner({ finalized: "weird", accepted: "2" });
  ok(odd!.tone === "neutral" && odd!.headline === "Finalized — 2 lots activated.", "unknown status generic");
  ok(finalizeBanner({ finalized: "  ", rejected: "1" })!.kind === "whole_reject", "blank finalized is absent");

  // The REAL whole-manifest reject (?rejected=1, no finalized).
  const whole = finalizeBanner({ rejected: "1" });
  ok(whole!.kind === "whole_reject", "rejected=1 alone → whole reject");
  ok(whole!.tone === "neutral", "whole reject is a confirmation, not an error");
  ok(whole!.details[0].includes("Update or Delete"), "CCRS guidance kept");
  ok(finalizeBanner({ rejected: "0" }) === null, "rejected=0 alone → nothing");

  // Legacy accepted-only.
  const acc = finalizeBanner({ accepted: "3", drafts: "2" });
  ok(acc!.kind === "accepted_only" && acc!.tone === "green" && acc!.drafts === 2, "accepted-only");
  ok(finalizeBanner({ accepted: "0" }) === null, "accepted=0 alone → nothing");
  ok(finalizeBanner({}) === null, "no params → nothing");

  return { passed, failed: 0 };
}
