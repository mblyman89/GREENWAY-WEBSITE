/**
 * scripts/recon/l28-mutation-test.mjs
 *
 * SLICE L-28 — TESTING THE TESTS.
 *
 * The owner's standing rule is "test it, test the tests". A green suite proves
 * the code passes the tests; it does not prove the tests would notice if the
 * code broke. This script breaks the fix, on purpose, one realistic way at a
 * time, and demands that the suite go red for each.
 *
 * A mutation that SURVIVES is a hole in the suite, not a curiosity.
 *
 * Every mutation below is a plausible future edit — a "simplification", a
 * revert, a tidy-up — not a nonsense character swap.
 *
 * Run:  node scripts/recon/l28-mutation-test.mjs
 */

import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const SUITE = "tests/compliance/leafly-l28-board-overflow.test.ts";

const BOARD = "src/lib/leafly/order-board-server.ts";
const CORE = "src/lib/leafly/board-view-core.ts";
const PANEL = "src/components/admin/orders/LeaflyOrdersPanel.tsx";
const PAGE = "src/app/admin/orders/page.tsx";

const mutations = [
  {
    name: "1. Revert the cap to 8 (the original bug)",
    file: BOARD,
    from: "export const LEAFLY_BOARD_LIMIT = 200;",
    to: "export const LEAFLY_BOARD_LIMIT = 8;",
  },
  {
    name: "2. Drop the canceled_at filter from the pending query",
    file: BOARD,
    from: `        .is("canceled_at", null)
        .or(
          \`leafly_status.is.null,leafly_status.not.in.(\${TERMINAL_STATUSES.join(",")})\`,
        )
        .order("acknowledge_by"`,
    to: `        .order("acknowledge_by"`,
  },
  {
    name: "3. Drop the terminal-status filter from the COUNT (badge lies again)",
    file: BOARD,
    from: `      .is("canceled_at", null)
      .or(
        \`leafly_status.is.null,leafly_status.not.in.(\${TERMINAL_STATUSES.join(",")})\`,
      )`,
    to: "",
  },
  {
    name: "4. Forget 'expired' in the terminal vocabulary",
    file: BOARD,
    from: 'const TERMINAL_STATUSES = ["picked_up", "canceled", "expired"] as const;',
    to: 'const TERMINAL_STATUSES = ["picked_up", "canceled"] as const;',
  },
  {
    name: "5. Stop fetching closed orders (the 'Finished' tab goes empty)",
    file: BOARD,
    from: "orders: [...pendingRows, ...ackedRows, ...closedRows],",
    to: "orders: [...pendingRows, ...ackedRows],",
  },
  {
    name: "6. Default the board to 'all' instead of 'open'",
    file: CORE,
    from: 'export const DEFAULT_BOARD_FILTER: BoardFilter = "open";',
    to: 'export const DEFAULT_BOARD_FILTER: BoardFilter = "all";',
  },
  {
    name: "7. Stop counting live orders hidden by the view",
    file: CORE,
    from: "    if (isLiveBucket(r.bucket) && !visible.has(r)) hiddenLiveCount += 1;",
    to: "    if (false) hiddenLiveCount += 1;",
  },
  {
    name: "8. Only count orders hidden by the FILTER, ignoring the search",
    file: CORE,
    from: "  const visible = new Set(searched);",
    to: "  const visible = new Set(byBucket);",
  },
  {
    name: "9. Sort rows with no deadline FIRST under urgency",
    file: CORE,
    from: `    } else if (ad !== null) {
      return -1;
    } else if (bd !== null) {
      return 1;
    }`,
    to: `    } else if (ad !== null) {
      return 1;
    } else if (bd !== null) {
      return -1;
    }`,
  },
  {
    name: "10. Drop 'closed' from the 'all' filter",
    file: CORE,
    from: '  all: ["accept_now", "needs_attention", "to_build", "awaiting_pickup", "closed"],',
    to: '  all: ["accept_now", "needs_attention", "to_build", "awaiting_pickup"],',
  },
  {
    name: "11. Render the raw board again instead of the filtered view",
    file: PANEL,
    from: "{groupLeaflyWorkflow(view.rows)",
    to: "{groupLeaflyWorkflow(board.orders.map(toWorkflowRow))",
  },
  {
    name: "12. Stop rendering the hidden-work warning",
    file: PANEL,
    from: "            {hiddenWarning ? (",
    to: "            {false ? (",
  },
  {
    name: "13. Search stops matching the local order id",
    file: CORE,
    from: "  const haystacks = [row.leaflyOrderId, row.localOrderId];",
    to: "  const haystacks = [row.leaflyOrderId];",
  },
  {
    name: "14. A bad URL param throws instead of falling back",
    file: CORE,
    from: `  return (BOARD_FILTERS as readonly string[]).includes(trimmed)
    ? (trimmed as BoardFilter)
    : DEFAULT_BOARD_FILTER;`,
    to: "  return trimmed as BoardFilter;",
  },
  {
    name: "15. Page stops validating params (raw URL text reaches the panel)",
    file: PAGE,
    from: "      filter={parseBoardFilter(sp.lfilter)}",
    to: "      filter={sp.lfilter as never}",
  },
  {
    name: "16. Empty states collapse into one vague sentence",
    file: CORE,
    from: '    return `No orders match “${view.search}”. Clear the search to see the rest.`;',
    to: '    return "No orders.";',
  },
];

function run() {
  try {
    execSync(`npx vitest run ${SUITE} --reporter=dot`, {
      stdio: "pipe",
      encoding: "utf8",
      timeout: 180000,
    });
    return true; // green
  } catch {
    return false; // red
  }
}

console.log("─".repeat(74));
console.log("L-28 MUTATION SWEEP — does the suite actually defend the fix?");
console.log("─".repeat(74));

// Sanity: the suite must be green before we start breaking things.
const originals = new Map();
for (const f of [BOARD, CORE, PANEL, PAGE]) originals.set(f, readFileSync(f, "utf8"));

if (!run()) {
  console.error("BASELINE IS RED. Fix the suite before mutation testing.");
  process.exit(2);
}
console.log("baseline: GREEN\n");

let caught = 0;
let survived = 0;
const survivors = [];

for (const m of mutations) {
  const original = originals.get(m.file);
  if (!original.includes(m.from)) {
    console.log(`SKIP  ${m.name}`);
    console.log(`      anchor not found in ${m.file} — mutation is stale`);
    survived++;
    survivors.push(`${m.name} (STALE ANCHOR)`);
    continue;
  }
  writeFileSync(m.file, original.replace(m.from, m.to));
  const green = run();
  writeFileSync(m.file, original); // always restore

  if (green) {
    console.log(`SURVIVED  ${m.name}`);
    survived++;
    survivors.push(m.name);
  } else {
    console.log(`caught    ${m.name}`);
    caught++;
  }
}

// Restore everything, belt and braces.
for (const [f, src] of originals) writeFileSync(f, src);

console.log(`\n${"─".repeat(74)}`);
console.log(`RESULT: ${caught} caught, ${survived} survived, of ${mutations.length}`);
if (survived > 0) {
  console.log("\nHOLES IN THE SUITE:");
  for (const s of survivors) console.log(`  - ${s}`);
  console.log("\nEach survivor is a change that would break the owner's board");
  console.log("while the tests stayed green. Close them before shipping.");
  process.exit(1);
}
console.log("Every mutation was caught. The suite defends the fix.");
process.exit(0);
