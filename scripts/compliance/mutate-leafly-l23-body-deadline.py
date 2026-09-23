#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
scripts/compliance/mutate-leafly-l23-body-deadline.py

SLICE L-23 -- TESTING THE TESTS.

A passing suite proves nothing on its own, and this slice is the proof of that
claim rather than an example of it. L-17 shipped a deadline, shipped a suite
that asserted the deadline was present and wired into all six Leafly call
sites, and every one of those assertions was TRUE. The owner then tested a
real order and got the identical five-minute hang, because `fetch()` resolves
at the HEADERS and the guard was cleared before the body was ever read.

So the standard this probe has to meet is higher than usual: it is not enough
for the suite to notice that something changed. It has to notice the specific
class of change that L-17's suite could not see -- a safety mechanism that is
present, wired, and useless.

The mutations fall into six families, each a real way this slice could rot:

  1. THE BUFFERING ITSELF -- the body read moving back outside the budget, or
     disappearing. This is the original bug, reintroduced. If any of these
     survive, the suite has learned nothing from L-17.
  2. THE TIMER -- cleared early, never armed, or the abort never wired, so
     the deadline is decorative again.
  3. THE 204 RESCUE -- the highest-stakes branch in the slice. Too narrow and
     every successful acknowledgement is reported as a failure; too wide and a
     stalled 200 is handed back as an empty success. Both are worse than the
     hang: one invites a second press on an IRREVERSIBLE action after the
     shopper's ID images are already destroyed, the other processes an order
     with nothing in it.
  4. THE NULL-BODY RULE -- 204 is the acknowledge endpoint's documented
     success code, and the Response constructor THROWS if a null-body status
     is given any body at all, including the empty string `.text()` returns.
     Dropping this rule throws on every successful acknowledgement.
  5. THE RE-WRAP -- status, statusText, headers or body lost in reconstruction.
     A silently-empty body on the order path is how an order gets processed
     with nothing in it.
  6. THE PHASE -- connect and body timeouts collapsing into one sentence, so
     the operator is told "we cannot tell whether Leafly got it" while we are
     holding Leafly's status line.

RULE 137: every anchor must match EXACTLY ONCE, verified by preflight before a
single mutation runs. An ambiguous anchor is not a probe -- it is a coin toss.

RULE 13c: the CONTROL mutant must SURVIVE. It rewrites a comment, which changes
nothing a user can observe. If the suite "catches" that, the suite is asserting
on prose and its other passes cannot be trusted either.
"""
from __future__ import annotations

import io
import subprocess
import sys
from dataclasses import dataclass

ROOT = "."
TESTS = [
    "tests/compliance/leafly-deadline-body.test.ts",
    # L-17's suite is included on purpose: this slice changes the very helper
    # it asserts about, so a regression there is a regression here.
    "tests/compliance/leafly-deadline.test.ts",
]

FETCH = "src/lib/leafly/deadline-fetch.ts"
CORE = "src/lib/leafly/deadline-core.ts"
HARNESS = "scripts/compliance/run-pure-selftests.ts"


@dataclass
class Mutation:
    name: str
    path: str
    old: str
    new: str
    control: bool = False


M: list[Mutation] = []


def add(name, path, old, new, control=False):
    M.append(Mutation(name, path, old, new, control))


# ---------------------------------------------------------------------------
# 1. THE BUFFERING ITSELF -- the owner's bug, reintroduced
# ---------------------------------------------------------------------------
add(
    "the body read moves back outside the budget -- the exact pre-L-23 bug",
    FETCH,
    """    const text = await response.text();""",
    """    const text = "";""",
)
add(
    "the helper returns the streaming response directly, leaving the body unbounded",
    FETCH,
    """    return {
      ok: true,
      response: new Response(mayCarryBody(response.status) ? text : null, {""",
    """    return {
      ok: true,
      response: response ?? new Response(mayCarryBody(response.status) ? text : null, {""",
)
add(
    "the buffered text is thrown away, so every call site reads an empty body",
    FETCH,
    "response: new Response(mayCarryBody(response.status) ? text : null, {",
    "response: new Response(null, {",
)

# ---------------------------------------------------------------------------
# 2. THE TIMER -- a deadline that is present but decorative
# ---------------------------------------------------------------------------
add(
    "the abort is never wired to fetch, so the timer fires into the void",
    FETCH,
    "const response = await fetchImpl(url, { ...init, signal: controller.signal });",
    "const response = await fetchImpl(url, { ...init });",
)
add(
    "the timer never fires, so nothing is ever bounded",
    FETCH,
    """  const timer = setTimeout(() => {
    weAborted = true;
    controller.abort();
  }, budgetMs);""",
    """  const timer = setTimeout(() => {
    weAborted = true;
  }, budgetMs);""",
)
add(
    "the budget becomes effectively infinite",
    FETCH,
    "const budgetMs = timeoutForOperation(operation);",
    "const budgetMs = 5 * 60 * 1000;",
)
add(
    "weAborted is never set, so our own timeout is misreported as a network fault",
    FETCH,
    """    weAborted = true;
    controller.abort();""",
    """    controller.abort();""",
)

# ---------------------------------------------------------------------------
# 3. THE 204 RESCUE -- the highest-stakes branch in the slice
# ---------------------------------------------------------------------------
add(
    "the rescue is removed, so a successful acknowledge is reported as a failure",
    FETCH,
    "if (phase === \"body\" && outcomeSettledByStatusAlone(receivedStatus)) {",
    "if (false) {",
)
add(
    "the rescue widens to every status, handing back a stalled 200 as an empty success",
    FETCH,
    "if (phase === \"body\" && outcomeSettledByStatusAlone(receivedStatus)) {",
    "if (phase === \"body\") {",
)
add(
    "the rescue fires in the connect phase too, inventing a response we never received",
    FETCH,
    "if (phase === \"body\" && outcomeSettledByStatusAlone(receivedStatus)) {",
    "if (outcomeSettledByStatusAlone(receivedStatus) || receivedStatus === null) {",
)
add(
    "the rescued response reports 200 instead of the status Leafly actually sent",
    FETCH,
    "response: new Response(null, { status: receivedStatus as number }),",
    "response: new Response(null, { status: 200 }),",
)
# ---------------------------------------------------------------------------
# 3b. THE TEST SEAM ITSELF
#
# The seam added in L-23 is the only way the rescue branch can be reached, so
# it is now load-bearing test infrastructure. If it silently stopped being
# honoured -- ignored in favour of the global fetch -- the two rescue tests
# would stop testing the rescue and would go green against anything, which is
# precisely the failure this whole slice exists to punish. So the seam gets
# mutated like any other production decision.
# ---------------------------------------------------------------------------
add(
    "the seam is ignored, so the rescue tests silently stop reaching the rescue",
    FETCH,
    "const fetchImpl: FetchLike = options?.fetchImpl ?? ((u, i) => fetch(u, i));",
    "const fetchImpl: FetchLike = (u, i) => fetch(u, i);",
)

# ---------------------------------------------------------------------------
# 4. THE NULL-BODY RULE -- 204 is the acknowledge success code
# ---------------------------------------------------------------------------
add(
    "204 is dropped from the null-body list, throwing on every successful acknowledge",
    CORE,
    "export const NULL_BODY_STATUSES = [204, 205, 304] as const;",
    "export const NULL_BODY_STATUSES = [205, 304] as const;",
)
add(
    "the null-body list is emptied, so the Response constructor throws",
    CORE,
    "export const NULL_BODY_STATUSES = [204, 205, 304] as const;",
    "export const NULL_BODY_STATUSES = [] as const;",
)
add(
    "mayCarryBody inverts, so bodies are dropped and empty statuses are given one",
    CORE,
    "  return !(NULL_BODY_STATUSES as readonly number[]).includes(status);",
    "  return (NULL_BODY_STATUSES as readonly number[]).includes(status);",
)
add(
    "unknown input defaults to may-NOT-carry-body, silently discarding real payloads",
    CORE,
    """  if (typeof status !== "number" || !Number.isFinite(status)) return true;
  return !(NULL_BODY_STATUSES as readonly number[]).includes(status);""",
    """  if (typeof status !== "number" || !Number.isFinite(status)) return false;
  return !(NULL_BODY_STATUSES as readonly number[]).includes(status);""",
)
add(
    "200 becomes settled-by-status-alone, so a stalled status push looks successful",
    CORE,
    """export function outcomeSettledByStatusAlone(status: number | null | undefined): boolean {
  if (typeof status !== "number" || !Number.isFinite(status)) return false;
  return !mayCarryBody(status);
}""",
    """export function outcomeSettledByStatusAlone(status: number | null | undefined): boolean {
  if (typeof status !== "number" || !Number.isFinite(status)) return false;
  return true;
}""",
)

# ---------------------------------------------------------------------------
# 5. THE RE-WRAP -- what the six call sites actually read
# ---------------------------------------------------------------------------
add(
    "the status is lost in the rebuild, so every response looks like a 200",
    FETCH,
    """        status: response.status,
        statusText: response.statusText,""",
    """        status: 200,
        statusText: response.statusText,""",
)
add(
    "the headers are dropped in the rebuild",
    FETCH,
    "        headers: response.headers,\n      }),",
    "      }),",
)

# ---------------------------------------------------------------------------
# 6. THE PHASE -- telling the operator something we know to be false
# ---------------------------------------------------------------------------
add(
    "every timeout is reported as a connect failure, hiding that Leafly answered",
    FETCH,
    "const phase = receivedStatus === null ? \"connect\" : \"body\";",
    'const phase = "connect" as const;',
)
add(
    "every timeout is reported as a body failure, claiming Leafly answered when it did not",
    FETCH,
    "const phase = receivedStatus === null ? \"connect\" : \"body\";",
    'const phase = "body" as const;',
)
add(
    "the phase is computed and then not passed on, so the sentence never changes",
    FETCH,
    "describeDeadlineFailure({ operation, fault, phase, receivedStatus });",
    "describeDeadlineFailure({ operation, fault });",
)
add(
    "the attempt log stops recording which phase ran out of time",
    FETCH,
    "`timed out after ${budgetMs}ms during ${phase}${",
    "`timed out after ${budgetMs}ms${",
)
add(
    "a body-phase timeout on the irreversible acknowledge is declared safe to retry",
    CORE,
    "    safeToRetry: certainlyNotDelivered || !irreversible,",
    "    safeToRetry: true,",
)
add(
    "the body-phase sentence drops the fact that Leafly did receive the request",
    CORE,
    """        `Leafly DID receive this acknowledgement — the request reached them. ` +
        `Do NOT acknowledge it again. Refresh this page to confirm the order's status.`""",
    """        `We cannot tell whether Leafly received it.`""",
)
add(
    "the body-phase sentence stops naming the status we are holding",
    CORE,
    "? `Leafly answered (HTTP ${input.receivedStatus})`",
    "? `Leafly answered`",
)
add(
    "a body-phase timeout with no status invents one",
    CORE,
    "        : `Leafly began answering`;",
    "        : `Leafly answered (HTTP 200)`;",
)

# ---------------------------------------------------------------------------
# 7. THE HARNESS -- a core that stops running proves nothing
# ---------------------------------------------------------------------------
add(
    "the floor drops to zero, so a gutted suite passes",
    HARNESS,
    'assertRan("leafly-deadline-core", __runLeaflyDeadlineTests(), 640);',
    'assertRan("leafly-deadline-core", __runLeaflyDeadlineTests(), 0);',
)
add(
    "the core is unregistered from CI, so its self-tests stop running",
    HARNESS,
    'assertRan("leafly-deadline-core", __runLeaflyDeadlineTests(), 640);',
    "",
)

# ---------------------------------------------------------------------------
# 8. CONTROL -- must SURVIVE (rule 13c)
# ---------------------------------------------------------------------------
add(
    "CONTROL: a comment is reworded and nothing observable changes",
    FETCH,
    " * SLICE L-23 — THE HALF THE DEADLINE MISSED",
    " * SLICE L-23 — the part of the request that was never bounded",
    control=True,
)


# ---------------------------------------------------------------------------
def read(p):
    with io.open(p, encoding="utf-8") as fh:
        return fh.read()


def write(p, s):
    with io.open(p, "w", encoding="utf-8") as fh:
        fh.write(s)


def run_tests():
    r = subprocess.run(
        ["npx", "vitest", "run", *TESTS],
        capture_output=True,
        text=True,
        cwd=ROOT,
    )
    if r.returncode != 0:
        return False
    # A self-test floor breach shows up in the pure harness, not vitest.
    h = subprocess.run(
        ["npx", "tsx", "scripts/compliance/run-pure-selftests.ts"],
        capture_output=True,
        text=True,
        cwd=ROOT,
    )
    return h.returncode == 0


def preflight():
    """RULE 137: every anchor must match exactly once. No guessing."""
    bad = []
    for m in M:
        src = read(m.path)
        n = src.count(m.old)
        if n != 1:
            bad.append(
                "  [%d matches] %s\n      in %s\n      anchor: %r"
                % (n, m.name, m.path, m.old[:90])
            )
    if bad:
        print("PREFLIGHT FAILED -- ambiguous or missing anchors:\n" + "\n".join(bad))
        return False
    print("preflight OK -- %d mutations, every anchor unique" % len(M))
    return True


def main():
    if not preflight():
        return 2

    print("\nbaseline: the suite must be GREEN before we break anything...")
    if not run_tests():
        print("BASELINE IS RED. Fix the suite before probing it.")
        return 2
    print("baseline GREEN\n")

    caught, survived = [], []
    originals = {p: read(p) for p in {m.path for m in M}}

    try:
        for i, m in enumerate(M, 1):
            src = originals[m.path]
            write(m.path, src.replace(m.old, m.new, 1))
            green = run_tests()
            write(m.path, src)  # restore immediately

            if m.control:
                tag = "SURVIVED (correct)" if green else "CAUGHT (WRONG!)"
            else:
                tag = "survived (HOLE)" if green else "caught"
            (survived if green else caught).append(m.name)
            print("[%2d/%2d] %-18s %s" % (i, len(M), tag, m.name))
    finally:
        for p, s in originals.items():
            write(p, s)

    real = [m for m in M if not m.control]
    ctrl = [m for m in M if m.control]
    ctrl_names = [c.name for c in ctrl]
    real_survivors = [n for n in survived if n not in ctrl_names]
    ctrl_caught = [n for n in caught if n in ctrl_names]

    print("\n" + "=" * 72)
    print(
        "%d real mutations: %d caught, %d survived"
        % (len(real), len(real) - len(real_survivors), len(real_survivors))
    )
    print("%d control mutations: %d wrongly caught" % (len(ctrl), len(ctrl_caught)))
    if real_survivors:
        print("\nHOLES -- behaviour the tests describe but do not pin down:")
        for n in real_survivors:
            print("  - %s" % n)
    if ctrl_caught:
        print("\nCONTROL WAS CAUGHT -- the suite is asserting on prose:")
        for n in ctrl_caught:
            print("  - %s" % n)
    print("=" * 72)

    return 0 if not real_survivors and not ctrl_caught else 1


if __name__ == "__main__":
    sys.exit(main())
