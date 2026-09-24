/**
 * scripts/recon/l33-mutation-sweep.mts  (SLICE L-33 — D2)
 *
 * "TEST THE TESTS." — the owner, in the governing instruction for this slice.
 *
 * A green suite proves nothing on its own. It proves the tests RAN; it does
 * not prove they would have NOTICED. This script establishes the second thing
 * the only way it can be established: by deliberately breaking the code, one
 * change at a time, and requiring the suite to go red each time.
 *
 * HOW TO READ THE RESULT
 * ----------------------
 *   KILLED   — the mutation was introduced and the suite caught it. Good.
 *              This is the only acceptable outcome.
 *
 *   SURVIVED — the mutation was introduced, the code now behaves differently,
 *              and EVERY TEST STILL PASSED. This is a hole. Somewhere there is
 *              a behaviour nobody is checking, and it will be broken one day
 *              by someone who ran the suite first and believed it.
 *
 *   INERT    — the anchor text was not found, so nothing was actually changed
 *              and the "pass" is meaningless. This is treated as a FAILURE,
 *              not a skip. An inert mutation is the most dangerous result of
 *              the three, because it looks like a pass in a summary line: the
 *              sweep reports "0 survived" while having tested nothing at all.
 *              Earlier slices in this repository hit exactly that, which is
 *              why it is failed loudly here.
 *
 * SAFETY
 * ------
 * Every mutation is applied to a file, verified to have changed it, and then
 * reverted from an in-memory copy of the original in a `finally` block. A
 * crash mid-run cannot leave a mutated file behind, and the script re-verifies
 * every touched file byte-for-byte at the end before reporting.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..");

type Mutation = {
  /** What this mutation pretends a careless change would look like. */
  name: string;
  file: string;
  from: string;
  to: string;
  /** Why the suite MUST catch it — the cost of the real version of this bug. */
  why: string;
};

const MUTATIONS: Mutation[] = [
  // ── §1 The owner's hard constraint ──────────────────────────────────────
  {
    name: "re-couple acknowledge to confirm (remove the actor gate)",
    file: "src/lib/leafly/order-ack-server.ts",
    from: 'const actor = input.actor ?? "human";',
    to: 'const actor = "human";',
    why:
      "This is the owner's explicit constraint: 'It can't be acknowledge and " +
      "confirm in the same step.' With the gate neutered, the machine would " +
      "confirm every order on arrival, telling every shopper their order is " +
      "accepted before anyone has looked at it.",
  },
  {
    name: "default the actor to 'auto' instead of 'human'",
    file: "src/lib/leafly/order-ack-server.ts",
    from: 'const actor = input.actor ?? "human";',
    to: 'const actor = input.actor ?? "auto";',
    why:
      "The gate is only safe because it is opt-IN. Defaulting to 'auto' would " +
      "sever the confirm push for the BUTTON too — breaking the owner's " +
      "nineteen-slice-old workflow from inside a feature meant to help it.",
  },

  // ── §2 The arrival wiring ───────────────────────────────────────────────
  {
    name: "never acknowledge: force the decision to refuse",
    file: "src/lib/leafly/auto-ack-core.ts",
    from: "if (!isAutoAcknowledgeEnabled(input.autoAckEnvValue)) {",
    to: "if (true) {",
    why:
      "The feature silently does nothing. This is THE failure mode this " +
      "repository keeps meeting — a feature that is installed, green, and " +
      "inert. If the suite cannot see this, it cannot see anything.",
  },
  {
    name: "acknowledge on every event type, not just submissions",
    file: "src/lib/leafly/auto-ack-core.ts",
    from: 'if (event !== "order_submit") {',
    to: "if (false) {",
    why:
      "Acknowledging on a cancellation webhook would fire an irreversible " +
      "action against an order that is already gone.",
  },
  {
    name: "drop the idempotency check (acknowledge twice)",
    file: "src/lib/leafly/auto-ack-core.ts",
    // NOTE: the first version of this mutation anchored on
    // `if (input.acknowledgedAt != null` and reported INERT — that text does
    // not exist. The real guard normalises first (`const acked = (...).trim()`)
    // and then tests the string. The mutation was wrong; the code was not.
    // Kept visible because an inert mutation that had been quietly deleted
    // would have left this behaviour permanently unswept while the summary
    // line still said "0 survived".
    from: 'if (acked !== "") {',
    to: "if (false) {",
    why:
      "Leafly answers a second acknowledgement with a 409. Every retried " +
      "webhook delivery would produce an error in the log and teach whoever " +
      "reads it to ignore this path.",
  },

  // ── §3/§4 The board interaction ─────────────────────────────────────────
  {
    name: "flatten the tri-state: the naive `x !== null` one-liner",
    file: "src/lib/leafly/auto-ack-core.ts",
    from: "if (confirmPushFailedAt === undefined) return undefined;",
    to: "",
    why:
      "THE B1 REGRESSION, delivered by B1's own fix. Every order in a " +
      "pre-0230 shop would be reported as having a failed confirm push, and " +
      "the whole board would show a diagnostic instead of the Confirm button.",
  },
  {
    name: "stop passing confirmPushFailed from the board",
    file: "src/components/admin/orders/LeaflyOrdersPanel.tsx",
    from: "confirmPushFailed: order.confirmPushFailed,",
    to: "",
    why:
      "The re-keyed rule goes inert. L-32's real 400-error repair would never " +
      "be offered again — and, being inert, it would keep passing its own tests.",
  },

  // ── §5 The sweeper ──────────────────────────────────────────────────────
  {
    name: "sweep orders that are too new (race the arrival hook)",
    file: "src/lib/leafly/auto-ack-sweep-core.ts",
    from: "if (ageMs < SWEEP_GRACE_MS) {",
    to: "if (false) {",
    why:
      "The sweeper would race the arrival hook and, far worse, permanently " +
      "paper over a broken arrival path so the real bug is never found.",
  },
  {
    name: "sweep orders past Leafly's deadline",
    file: "src/lib/leafly/auto-ack-sweep-core.ts",
    from: "if (msUntilDeadline !== null && msUntilDeadline <= SWEEP_DEADLINE_MARGIN_MS) {",
    to: "if (false) {",
    why:
      "Acknowledging a cancelled order accomplishes nothing AND hides the " +
      "`expired` count — the single number that tells the owner he is losing " +
      "orders.",
  },
  {
    name: "sort the sweep oldest-first instead of by deadline",
    file: "src/lib/leafly/auto-ack-sweep-core.ts",
    from: "return am - bm;",
    to: "return 0;",
    why:
      "With a per-run cap, the orders left behind would be chosen arbitrarily " +
      "rather than being the ones with time to spare. The cap would start " +
      "dropping the dying orders.",
  },
  {
    name: "remove the per-run cap",
    file: "src/lib/leafly/auto-ack-sweep-core.ts",
    from: "const toSweep = selected.slice(0, cap);",
    to: "const toSweep = selected.slice();",
    why:
      "A backlog turns one tick into an unbounded loop; the serverless " +
      "function is killed mid-flight leaving no record of what it already did.",
  },
  {
    name: "let the sweeper ignore the kill switch",
    file: "src/lib/leafly/auto-ack-server.ts",
    from: "if (!isAutoAcknowledgeEnabled(process.env[LEAFLY_AUTO_ACK_ENV_VAR])) {",
    to: "if (false) {",
    why:
      "An owner who switches auto-acknowledge off and finds the machine still " +
      "pressing the button on a schedule would be right never to trust the " +
      "switch again.",
  },

  // ── §6 Degradation ──────────────────────────────────────────────────────
  {
    name: "remove the middle column tier (back to the cliff)",
    file: "src/lib/leafly/order-board-server.ts",
    from: "  BOARD_COLUMNS_PRE_L33,\n",
    to: "",
    why:
      "A shop missing 0230 would lose 0228's 'nobody was told' pipeline " +
      "warnings as collateral damage — the exact class of bug the fallback " +
      "exists to prevent.",
  },
  {
    name: "retry on ANY error, not just a missing column",
    file: "src/lib/leafly/order-board-server.ts",
    from: "if (!isMissingColumnError(result.error)) return result;",
    to: "if (!result.error) return result;",
    why:
      "A dead connection or a timeout would be retried three times with " +
      "narrower column lists, turning one slow failure into three on the page " +
      "that is the acknowledge button's redirect target.",
  },
  {
    name: "guess 'human' for an unrecorded acknowledger",
    file: "src/lib/leafly/auto-ack-core.ts",
    from: "  return null;\n}",
    to: '  return "Accepted by staff";\n}',
    why:
      "Inventing an audit trail. Every historical row would claim a person " +
      "acknowledged it, which is a statement about who did what that nobody " +
      "actually knows.",
  },

  // ── §7 The kill switch ──────────────────────────────────────────────────
  {
    name: "default the feature OFF",
    file: "src/lib/leafly/auto-ack-core.ts",
    from: "  return !OFF_VALUES.includes(v);",
    to: "  return OFF_VALUES.includes(v);",
    why:
      "The owner tests the feature he asked for, sees nothing happen, and " +
      "reports it broken. A default that quietly does nothing while appearing " +
      "installed is not safe, it is deceptive.",
  },
];

// ──────────────────────────────────────────────────────────────────────────

function runSuite(): boolean {
  try {
    execFileSync(
      "npx",
      [
        "vitest",
        "run",
        "tests/compliance/leafly-l33-auto-acknowledge.test.ts",
        "tests/compliance/pure-selftests.test.ts",
        "tests/compliance/leafly-l32-stale-confirm.test.ts",
        "--silent",
      ],
      {
        cwd: ROOT,
        stdio: "ignore",
        env: { ...process.env, NODE_OPTIONS: "--max-old-space-size=3072" },
      },
    );
    return true; // green
  } catch {
    return false; // red
  }
}

const originals = new Map<string, string>();
for (const m of MUTATIONS) {
  const p = join(ROOT, m.file);
  if (!originals.has(p)) originals.set(p, readFileSync(p, "utf8"));
}

let killed = 0;
let survived = 0;
let inert = 0;

console.log("═".repeat(76));
console.log("SLICE L-33 — MUTATION SWEEP  (testing the tests)");
console.log("═".repeat(76));

// Baseline. If the suite is not green BEFORE any mutation, every subsequent
// "killed" is meaningless — the suite would have been red regardless.
process.stdout.write("\nbaseline (unmutated): ");
if (!runSuite()) {
  console.log("RED — aborting. Fix the suite before sweeping.");
  process.exit(1);
}
console.log("green ✅\n");

try {
  for (const m of MUTATIONS) {
    const p = join(ROOT, m.file);
    const original = originals.get(p)!;

    const occurrences = original.split(m.from).length - 1;
    if (occurrences !== 1) {
      inert += 1;
      console.log(`  ⛔ INERT    ${m.name}`);
      console.log(
        `             anchor matched ${occurrences} times in ${m.file} (need exactly 1)`,
      );
      continue;
    }

    writeFileSync(p, original.replace(m.from, m.to), "utf8");
    const stillGreen = runSuite();
    writeFileSync(p, original, "utf8");

    if (stillGreen) {
      survived += 1;
      console.log(`  ❌ SURVIVED ${m.name}`);
      console.log(`             ${m.why}`);
    } else {
      killed += 1;
      console.log(`  ✅ KILLED   ${m.name}`);
    }
  }
} finally {
  // Belt and braces: restore everything unconditionally, then VERIFY it.
  for (const [p, original] of originals) {
    writeFileSync(p, original, "utf8");
  }
  for (const [p, original] of originals) {
    if (readFileSync(p, "utf8") !== original) {
      console.error(`\n🔥 FILE NOT RESTORED: ${p}`);
      process.exit(2);
    }
  }
}

console.log("\n" + "═".repeat(76));
console.log(`killed: ${killed}   survived: ${survived}   inert: ${inert}`);
console.log("═".repeat(76));

if (survived > 0 || inert > 0) {
  console.log(
    "\nFAILED. A survivor is a behaviour nobody checks; an inert mutation is a\n" +
      "test that was never actually run. Both report as 'passing' in a summary\n" +
      "line, which is exactly why they are failed here.",
  );
  process.exit(1);
}
console.log("\nPASSED — every deliberate break was caught.");
