/**
 * R41 S7: tests written before the first-file gate release payroll, vendor
 * and test-credit files against a FakePostgrest with no prenote history. The
 * gate (readFirstFileGate in ach-file-ledger-store) would correctly refuse
 * them all. This wrapper answers ONLY the gate's two reads, so those suites
 * keep testing what they test (letters, limits, deadlines, bank steps) with
 * the first-file test already passed, and every other request (including
 * their own ach_files reads and row counts) goes to the fake unchanged.
 *
 * The gate itself is tested for real in r41-s7-prenote-wait.test.ts, where
 * this wrapper is NOT used.
 */

/** A prenote file approved at Timberland long ago, and a prenote from it marked passed. */
export const OPEN_GATE_HISTORY = {
  files: [{ id: "00000000-0000-4000-8000-0000000f1257", status: "bank_approved", effective_date: "2026-01-06", filename: "prenote_2026-01-06.ach" }],
  passed: [{ settlement_date: "2026-01-06" }],
};

function isGateFilesRead(url: URL): boolean {
  return url.pathname.endsWith("/ach_files") && url.searchParams.get("kind") === "eq.prenote" && url.searchParams.get("select") === "id,status,effective_date,filename";
}

function isGatePassedRead(url: URL): boolean {
  return (
    url.pathname.endsWith("/ach_verifications") &&
    url.searchParams.get("method") === "eq.prenote" &&
    url.searchParams.get("status") === "eq.passed" &&
    url.searchParams.get("select") === "settlement_date"
  );
}

export function withOpenFirstFileGate(
  inner: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
  return async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "GET" && isGateFilesRead(url)) return new Response(JSON.stringify(OPEN_GATE_HISTORY.files), { status: 200, headers: { "Content-Type": "application/json" } });
    if (method === "GET" && isGatePassedRead(url)) return new Response(JSON.stringify(OPEN_GATE_HISTORY.passed), { status: 200, headers: { "Content-Type": "application/json" } });
    return inner(input, init);
  };
}
