/**
 * src/lib/compliance/sales-limit-gate-core.ts  (Slice 109)
 *
 * PURE authoritative decision for "may this sale be COMMITTED given the WA
 * single-transaction possession limits?" — turning the sales-limit evaluation
 * from *advisory* into a *hard gate at the point of sale*.
 *
 * Owner's decision (recorded verbatim in the roadmap): HARD BLOCK by default,
 * with a permission-gated, LOGGED manager override. This core encodes exactly
 * that policy and NOTHING else does the deciding — the server action just loads
 * facts (evaluation + settings + who is overriding) and calls this.
 *
 * Grounded in the statutory single-transaction limits already modeled in
 * sales-limits-core.ts (RCW 69.50.360 / WAC 314-55-095 recreational carry
 * limits; the 3× medical limits for a carded patient/provider per RCW 69.51A).
 * This module adds only the *enforcement policy*, not new limit numbers.
 *
 * No I/O — tsx-testable via __runSalesLimitGateTests().
 */

export type SalesLimitDecision = "allow" | "override_applied" | "block";

export type SalesLimitGateInput = {
  /** True when ANY bucket is over the limit (from evaluateCart). */
  blocked: boolean;
  /** Enforcement master switch (owner setting). */
  enforce: boolean;
  /** When true, an over-limit cart is a HARD block (owner setting). */
  hardBlock: boolean;
  /** Human-readable over-limit reasons (from evaluateCart). */
  reasons: string[];
  /** Override request, if a manager is authorizing an over-limit sale. */
  override?: {
    /** Whether the actor HAS the override permission (checked by the caller). */
    permitted: boolean;
    /** Staff id performing the override (for the audit trail). */
    actorId?: string | null;
    /** Non-empty justification the manager typed. Required for a valid override. */
    reason?: string | null;
  } | null;
};

export type SalesLimitGateVerdict = {
  decision: SalesLimitDecision;
  /** True only when the sale may be committed. */
  allowed: boolean;
  /** True when the cart is over-limit and enforcement would block it. */
  overLimit: boolean;
  /** True when a valid override was applied to permit an over-limit sale. */
  overrideApplied: boolean;
  /**
   * True when the sale is blocked BUT a valid manager override *could* unblock
   * it — i.e. the UI should offer the override path rather than a dead end.
   */
  overrideAvailable: boolean;
  /** Why the sale is blocked / what override is needed. */
  messages: string[];
  /** The over-limit reasons carried through for logging. */
  reasons: string[];
};

/** Non-empty trimmed string. */
function hasText(v: string | null | undefined): boolean {
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * Decide whether an over-limit sale may proceed. PURE.
 *
 * Policy:
 *   • enforcement OFF  → always allow (advisory only).
 *   • within limit     → allow.
 *   • over limit, soft (hardBlock=false) → allow, but flagged (caller warns).
 *   • over limit, hard → BLOCK, unless a VALID override is supplied:
 *       an override is valid only when it is `permitted` (actor has the
 *       permission) AND carries a non-empty `reason`. A valid override yields
 *       `override_applied` (allowed=true, logged by the caller).
 */
export function decideSalesLimitGate(input: SalesLimitGateInput): SalesLimitGateVerdict {
  const reasons = input.reasons ?? [];

  // Not enforcing, or not over limit → clean allow.
  if (!input.enforce || !input.blocked) {
    return {
      decision: "allow",
      allowed: true,
      overLimit: false,
      overrideApplied: false,
      overrideAvailable: false,
      messages: [],
      reasons,
    };
  }

  // Over limit. Soft mode: allowed but flagged (no override needed).
  if (!input.hardBlock) {
    return {
      decision: "allow",
      allowed: true,
      overLimit: true,
      overrideApplied: false,
      overrideAvailable: false,
      messages: ["Cart exceeds the transaction limit (advisory — enforcement is not set to hard block)."],
      reasons,
    };
  }

  // Over limit + hard block. Evaluate the override, if any.
  const ov = input.override ?? null;
  const permitted = ov?.permitted === true;
  const reasonOk = hasText(ov?.reason);

  if (ov && permitted && reasonOk) {
    return {
      decision: "override_applied",
      allowed: true,
      overLimit: true,
      overrideApplied: true,
      overrideAvailable: true,
      messages: ["Over-limit sale AUTHORIZED by a permitted manager override (logged)."],
      reasons,
    };
  }

  // Blocked. Explain precisely what is (or isn't) available.
  const messages: string[] = [
    "Sale BLOCKED — cart exceeds the WA single-transaction limit.",
    ...reasons,
  ];
  if (ov && permitted && !reasonOk) {
    messages.push("A manager override requires a written reason before it can be applied.");
  } else if (ov && !permitted) {
    messages.push("An override was attempted but this user lacks the override permission — a manager must authorize.");
  } else {
    messages.push("A manager with the override permission may authorize this sale with a written reason.");
  }

  return {
    decision: "block",
    allowed: false,
    overLimit: true,
    overrideApplied: false,
    // The override path exists whenever hard-block is on; whether THIS actor can
    // use it is signaled in the messages.
    overrideAvailable: true,
    messages,
    reasons,
  };
}

// ── Self-tests (tsx) ─────────────────────────────────────────────────────────

export function __runSalesLimitGateTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`FAIL: ${msg}`);
    }
  };

  const overReasons = ["Concentrate: 0.3 oz exceeds the 0.25 oz recreational limit (over by 0.05 oz)."];

  // Enforcement OFF → allow regardless of over-limit.
  {
    const v = decideSalesLimitGate({ blocked: true, enforce: false, hardBlock: true, reasons: overReasons });
    ok(v.allowed && v.decision === "allow" && !v.overLimit, "enforcement off → allow");
  }

  // Within limit → allow.
  {
    const v = decideSalesLimitGate({ blocked: false, enforce: true, hardBlock: true, reasons: [] });
    ok(v.allowed && v.decision === "allow", "within limit → allow");
  }

  // Over limit, soft block → allow but flagged.
  {
    const v = decideSalesLimitGate({ blocked: true, enforce: true, hardBlock: false, reasons: overReasons });
    ok(v.allowed && v.overLimit && !v.overrideApplied && v.decision === "allow", "soft over-limit → allow flagged");
    ok(v.messages.some((m) => /advisory/.test(m)), "soft mode explains advisory");
  }

  // Over limit, hard block, NO override → block.
  {
    const v = decideSalesLimitGate({ blocked: true, enforce: true, hardBlock: true, reasons: overReasons });
    ok(!v.allowed && v.decision === "block", "hard over-limit no override → block");
    ok(v.overrideAvailable, "override path advertised");
    ok(v.messages.some((m) => /manager .*override/i.test(m)), "block explains manager override");
    ok(v.reasons.length === 1, "reasons carried for logging");
  }

  // Hard block + override permitted + reason → override_applied (allowed).
  {
    const v = decideSalesLimitGate({
      blocked: true,
      enforce: true,
      hardBlock: true,
      reasons: overReasons,
      override: { permitted: true, actorId: "mgr-1", reason: "Verified two separate legal purchasers." },
    });
    ok(v.allowed && v.decision === "override_applied" && v.overrideApplied, "valid override → allowed");
  }

  // Hard block + override permitted but NO reason → still blocked.
  {
    const v = decideSalesLimitGate({
      blocked: true,
      enforce: true,
      hardBlock: true,
      reasons: overReasons,
      override: { permitted: true, actorId: "mgr-1", reason: "   " },
    });
    ok(!v.allowed && v.decision === "block", "override without reason → block");
    ok(v.messages.some((m) => /written reason/.test(m)), "block asks for written reason");
  }

  // Hard block + override attempted by NON-permitted user → blocked.
  {
    const v = decideSalesLimitGate({
      blocked: true,
      enforce: true,
      hardBlock: true,
      reasons: overReasons,
      override: { permitted: false, actorId: "clerk-1", reason: "please" },
    });
    ok(!v.allowed && v.decision === "block", "unpermitted override → block");
    ok(v.messages.some((m) => /lacks the override permission/.test(m)), "block explains missing permission");
  }

  if (failed === 0) console.log(`sales-limit-gate-core: all ${passed} tests passed`);
  return { passed, failed };
}
