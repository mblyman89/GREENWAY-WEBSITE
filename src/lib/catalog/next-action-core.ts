/**
 * src/lib/catalog/next-action-core.ts
 *
 * W4 — next-action guidance parity across the intake pipeline. PURE module
 * (no React, no I/O — vitest-testable), porting the pattern the owner already
 * approved on the manifest review screen (guided-accept-core's whatDoIDoHere):
 * every surface answers, in plain English, "what do I do here?" with ONE
 * primary action — so an employee never has to guess which button matters.
 *
 * Three surfaces, three helpers:
 *   1. poWhatDoIDoHere(status, hasVendorEmail)  — PO detail page.
 *   2. draftsWhatDoIDoHere(view, counts)        — Product Onboarding tabs.
 *   3. discoveryWhatDoIDoHere(counts)           — Discovery page.
 *
 * Each returns { text, primaryAction } where primaryAction names the ONE
 * button that advances the work (null when the stage is terminal / idle).
 * Unknown statuses degrade to safe generic copy rather than guessing.
 */

export type NextAction = {
  /** Plain-English "what do I do here?" line. */
  text: string;
  /**
   * The label of the ONE button that advances this stage, exactly as it
   * appears on the page — or null when there is nothing to press (terminal
   * stages, empty queues). The page uses this to emphasize that button.
   */
  primaryAction: string | null;
};

// ---------------------------------------------------------------------------
// 1. Purchase order detail (status chain: draft→submitted→sent→partial→received;
//    cancelled from any non-terminal — see po-core.evaluatePoTransition)
// ---------------------------------------------------------------------------

export function poWhatDoIDoHere(status: string, hasVendorEmail: boolean): NextAction {
  switch (status) {
    case "draft":
      return {
        text: hasVendorEmail
          ? "This PO is a draft — the vendor hasn't seen it. Check the lines and quantities below, then press “Send to vendor” to email it and move it along."
          : "This PO is a draft — the vendor hasn't seen it. Check the lines below, then press “Send to vendor.” Heads up: no vendor email is on file, so it will only be marked Sent — export or print it to deliver it yourself.",
        primaryAction: "Send to vendor",
      };
    case "submitted":
      return {
        text: hasVendorEmail
          ? "Submitted internally, but the vendor still hasn't seen it. Press “Send to vendor” to email it out."
          : "Submitted internally, but the vendor still hasn't seen it. Press “Send to vendor” to mark it Sent (no vendor email on file — export or print to deliver it yourself).",
        primaryAction: "Send to vendor",
      };
    case "sent":
      return {
        text: "Sent — now you wait for the truck. When product arrives, receive each line below against what was actually delivered (short lines are normal; receive what came).",
        primaryAction: "Receive",
      };
    case "partial":
      return {
        text: "Partially received — some lines are still outstanding. When the rest arrives, receive the remaining lines below; the PO completes itself when everything is in.",
        primaryAction: "Receive",
      };
    case "received":
      return {
        text: "Done — everything on this PO has been received. Nothing left to do here.",
        primaryAction: null,
      };
    case "cancelled":
      return {
        text: "This PO was cancelled — the vendor should not ship against it. Nothing left to do here.",
        primaryAction: null,
      };
    default:
      return {
        text: "Review this purchase order and move it along the pipeline.",
        primaryAction: null,
      };
  }
}

// ---------------------------------------------------------------------------
// 2. Product Onboarding (drafts page tabs: draft | approved | dismissed)
// ---------------------------------------------------------------------------

export function draftsWhatDoIDoHere(
  view: "draft" | "approved" | "dismissed",
  counts: { draft: number; approved: number; dismissed: number },
): NextAction {
  if (view === "draft") {
    if (counts.draft === 0) {
      return {
        text: "All clear — no new products waiting for review. New drafts appear here automatically when you accept a manifest with products that aren't on the menu yet.",
        primaryAction: null,
      };
    }
    return {
      text: `${counts.draft} new product${counts.draft === 1 ? "" : "s"} below ${counts.draft === 1 ? "is" : "are"} blocked from the menu until you act. For each one: check the details, set the retail price, then press “Approve” — or “Dismiss” if it isn't really a new product.`,
      primaryAction: "Approve",
    };
  }
  if (view === "approved") {
    return {
      text: "These products are approved and staged for the menu. Nothing to do here — this tab is your record of what you've validated.",
      primaryAction: null,
    };
  }
  return {
    text: "These drafts were dismissed as not-new-products. If one was dismissed by mistake, press “Restore” to send it back to the review queue.",
    primaryAction: null,
  };
}

// ---------------------------------------------------------------------------
// 3. Discovery (leads funnel: capture → qualify → promote to PO)
// ---------------------------------------------------------------------------

export function discoveryWhatDoIDoHere(counts: {
  openProductLeads: number;
  shortlisted: number;
  openVendorLeads: number;
}): NextAction {
  if (counts.shortlisted > 0) {
    return {
      text: `${counts.shortlisted} shortlisted product lead${counts.shortlisted === 1 ? "" : "s"} ${counts.shortlisted === 1 ? "is" : "are"} ready to order — press “Start PO from lead” to prefill a purchase order. You confirm every line before anything is sent.`,
      primaryAction: "Start PO from lead",
    };
  }
  if (counts.openProductLeads > 0) {
    return {
      text: `${counts.openProductLeads} open product lead${counts.openProductLeads === 1 ? "" : "s"} to qualify — research each one and set its status (shortlist the winners, dismiss the rest). Shortlisted leads unlock “Start PO from lead.”`,
      primaryAction: null,
    };
  }
  if (counts.openVendorLeads > 0) {
    return {
      text: `No product leads yet, but ${counts.openVendorLeads} vendor lead${counts.openVendorLeads === 1 ? "" : "s"} to work — qualify the vendors you'd buy from, then add their standout products as product leads.`,
      primaryAction: null,
    };
  }
  return {
    text: "No open leads. Add a candidate vendor or product below (or import a list) whenever something catches your eye — this is the front door of the whole pipeline.",
    primaryAction: null,
  };
}

// ---------------------------------------------------------------------------
// Tests (tsx-runnable, house pattern)
// ---------------------------------------------------------------------------
export function __runNextActionCoreTests(): { passed: number } {
  let passed = 0;
  const assert = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL next-action-core: " + msg);
    passed += 1;
  };

  // PO chain — every real status has copy; the actionable ones name a button.
  assert(poWhatDoIDoHere("draft", true).primaryAction === "Send to vendor", "draft → send");
  assert(poWhatDoIDoHere("submitted", true).primaryAction === "Send to vendor", "submitted → send");
  assert(poWhatDoIDoHere("sent", true).primaryAction === "Receive", "sent → receive");
  assert(poWhatDoIDoHere("partial", true).primaryAction === "Receive", "partial → receive");
  assert(poWhatDoIDoHere("received", true).primaryAction === null, "received terminal");
  assert(poWhatDoIDoHere("cancelled", true).primaryAction === null, "cancelled terminal");
  assert(poWhatDoIDoHere("???", true).primaryAction === null, "unknown degrades");
  assert(
    poWhatDoIDoHere("draft", false).text.includes("no vendor email"),
    "draft no-email caveat",
  );
  assert(
    !poWhatDoIDoHere("draft", true).text.includes("no vendor email"),
    "draft with email has no caveat",
  );

  // Drafts tabs.
  const zero = { draft: 0, approved: 3, dismissed: 1 };
  assert(draftsWhatDoIDoHere("draft", zero).primaryAction === null, "empty review = idle");
  const some = { draft: 2, approved: 0, dismissed: 0 };
  assert(draftsWhatDoIDoHere("draft", some).primaryAction === "Approve", "review → approve");
  assert(draftsWhatDoIDoHere("draft", some).text.includes("2 new products"), "plural drafts");
  assert(
    draftsWhatDoIDoHere("draft", { ...some, draft: 1 }).text.includes("1 new product below is"),
    "singular draft",
  );
  assert(draftsWhatDoIDoHere("approved", zero).primaryAction === null, "approved idle");
  assert(draftsWhatDoIDoHere("dismissed", zero).text.includes("Restore"), "dismissed mentions restore");

  // Discovery funnel priority: shortlisted > open products > open vendors > idle.
  assert(
    discoveryWhatDoIDoHere({ openProductLeads: 5, shortlisted: 2, openVendorLeads: 1 })
      .primaryAction === "Start PO from lead",
    "shortlisted wins",
  );
  assert(
    discoveryWhatDoIDoHere({ openProductLeads: 3, shortlisted: 0, openVendorLeads: 9 })
      .text.includes("3 open product leads"),
    "open products next",
  );
  assert(
    discoveryWhatDoIDoHere({ openProductLeads: 0, shortlisted: 0, openVendorLeads: 1 })
      .text.includes("1 vendor lead"),
    "vendor leads next",
  );
  assert(
    discoveryWhatDoIDoHere({ openProductLeads: 0, shortlisted: 0, openVendorLeads: 0 })
      .primaryAction === null,
    "idle",
  );

  return { passed };
}
