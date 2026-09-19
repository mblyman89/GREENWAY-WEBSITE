#!/usr/bin/env python3
"""
The sabotage catalogue for 0229, kept in its OWN FILE on purpose.

The first version of this lived inside the bash harness as heredoc'd snippets
that bash indented with `sed` before handing to python. That corrupted every
multi-line triple-quoted string (the indent became part of the literal), so
three anchors matched zero times and were reported as misses. A second, smaller
bug: one consequence string contained backticks, which bash happily ran as a
command substitution.

Both faults were in the harness, not in the migration -- but both LOOKED like
findings, which is exactly the confusion this whole exercise exists to remove.
So the edits now live in plain Python where a string literal is a string
literal, and bash only ever passes a name.

Every entry carries:
  name  -- what we break
  why   -- the real-world consequence on the floor, which is the only reason
           the constraint exists and the only useful thing to print
  edit  -- a function (str) -> str that MUST assert its anchor count and MUST
           change the text

ANCHOR DISCIPLINE. 0229 is heavily commented and its prose quotes the very SQL
it explains: the phrases "on delete cascade", "resolved_at is null" and
"if not exists" all appear in comments as well as in statements. An anchor that
matched prose would rewrite a comment, leave the SQL intact, and be reported as
a SURVIVOR -- sending me hunting a hole in the proof that does not exist. That
trap already cost three runs of the L-14 mutation harness. Hence: exact
whole-statement anchors, each asserting it appears EXACTLY once.

Usage (called by sabotage-0229-proof.sh):
    python3 sabotage_0229_edits.py names
    python3 sabotage_0229_edits.py why  <name>
    python3 sabotage_0229_edits.py apply <name> <path-to-0229.sql>
    python3 sabotage_0229_edits.py selftest <path-to-0229.sql>
"""
from __future__ import annotations

import os
import sys


def _one(s: str, old: str, new: str, label: str) -> str:
    n = s.count(old)
    assert n == 1, f"{label}: anchor appears {n}x, expected exactly 1"
    out = s.replace(old, new)
    assert out != s, f"{label}: replacement was a no-op"
    return out


# -- The exact statements, copied verbatim out of 0229 -----------------------

UNIQUE_IDX = """create unique index if not exists leafly_register_interrupts_one_open_per_order
  on public.leafly_register_interrupts (local_order_id)
  where resolved_at is null;"""

DISPOSITION = """  disposition             text
                            check (disposition is null
                                   or disposition in ('void', 'walk_in')),"""

HOT_IDX = """create index if not exists leafly_register_interrupts_open_idx
  on public.leafly_register_interrupts (register_device_id, raised_at desc)
  where resolved_at is null;"""

KIND = """  kind                    text not null default 'leafly_cancel'
                            check (kind in ('leafly_cancel')),"""


def _not_partial(s: str) -> str:
    return _one(
        s,
        UNIQUE_IDX,
        """create unique index if not exists leafly_register_interrupts_one_open_per_order
  on public.leafly_register_interrupts (local_order_id);""",
        "unique_index_not_partial",
    )


def _drop_unique(s: str) -> str:
    return _one(s, UNIQUE_IDX, "", "drop_unique_index_entirely")


def _resolved_at_default(s: str) -> str:
    return _one(
        s,
        "  resolved_at             timestamptz,",
        "  resolved_at             timestamptz not null default now(),",
        "resolved_at_defaults_to_now",
    )


def _disposition_open(s: str) -> str:
    return _one(s, DISPOSITION, "  disposition             text,", "disposition_allowlist_removed")


def _reason_constrained(s: str) -> str:
    return _one(
        s,
        "  cancel_reason_code      text,",
        "  cancel_reason_code      text\n"
        "                            check (cancel_reason_code is null\n"
        "                                   or cancel_reason_code in ('customer_canceled')),",
        "cancel_reason_code_constrained",
    )


def _rls_off(s: str) -> str:
    return _one(
        s,
        "alter table public.leafly_register_interrupts enable row level security;",
        "",
        "rls_disabled",
    )


def _no_cascade(s: str) -> str:
    return _one(
        s,
        "  local_order_id          uuid references public.orders(id) on delete cascade,",
        "  local_order_id          uuid references public.orders(id),",
        "no_cascade_on_order_delete",
    )


def _claimed_at_default(s: str) -> str:
    return _one(
        s,
        "  add column if not exists register_claimed_at timestamptz;",
        "  add column if not exists register_claimed_at timestamptz not null default now();",
        "register_claimed_at_not_null_default",
    )


def _table_not_idempotent(s: str) -> str:
    return _one(
        s,
        "create table if not exists public.leafly_register_interrupts (",
        "create table public.leafly_register_interrupts (",
        "table_not_idempotent",
    )


def _alter_not_idempotent(s: str) -> str:
    return _one(
        s,
        "  add column if not exists register_device_name text;",
        "  add column register_device_name text;",
        "alter_not_idempotent",
    )


def _hot_index_not_partial(s: str) -> str:
    return _one(
        s,
        HOT_IDX,
        """create index if not exists leafly_register_interrupts_open_idx
  on public.leafly_register_interrupts (register_device_id, raised_at desc);""",
        "hot_index_not_partial",
    )


def _kind_allowlist_removed(s: str) -> str:
    return _one(
        s,
        KIND,
        "  kind                    text not null default 'leafly_cancel',",
        "kind_allowlist_removed",
    )


def _title_nullable(s: str) -> str:
    return _one(
        s,
        "  title                   text not null,",
        "  title                   text,",
        "title_nullable",
    )


SABOTAGES = [
    (
        "unique_index_not_partial",
        "Leafly RETRIES cancellation webhooks. Without the partial predicate, once any "
        "interrupt exists for an order a later genuine cancellation is blocked forever and "
        "never reaches the floor.",
        _not_partial,
    ),
    (
        "drop_unique_index_entirely",
        "a retried webhook stacks duplicate modals on the till; staff clear one and another "
        "appears, which is how people learn to dismiss modals without reading them.",
        _drop_unique,
    ),
    (
        "resolved_at_defaults_to_now",
        "every interrupt is born already resolved, so the blocking modal never blocks. A "
        "cancelled order gets bagged and handed to the customer.",
        _resolved_at_default,
    ),
    (
        "disposition_allowlist_removed",
        "any string becomes a legal disposition, so 'complete' can be recorded against a "
        "cancelled order and the reconciliation report mis-states what happened to the product.",
        _disposition_open,
    ),
    (
        "cancel_reason_code_constrained",
        "Leafly adds a reason code we have never seen and our own database REJECTS the inbound "
        "truth. We lose the webhook rather than store an unfamiliar word.",
        _reason_constrained,
    ),
    (
        "rls_disabled",
        "the interrupt table becomes readable with the public anon key, exposing customer order "
        "numbers and staff names to any browser.",
        _rls_off,
    ),
    (
        "no_cascade_on_order_delete",
        "deleting an order leaves an interrupt pointing at nothing: a modal no employee can "
        "clear, and the register is stuck until someone edits the database by hand.",
        _no_cascade,
    ),
    (
        "register_claimed_at_not_null_default",
        "every Leafly order arrives already claimed, so claim-as-lease can never tell claimed "
        "from unclaimed and two tills serve the same customer.",
        _claimed_at_default,
    ),
    (
        "table_not_idempotent",
        "the owner applies migrations BY HAND (AGENTS rule 6). Without the existence guard the "
        "second paste errors and leaves the schema half-built.",
        _table_not_idempotent,
    ),
    (
        "alter_not_idempotent",
        "same as above for the claim columns: re-running errors with 42701 instead of quietly "
        "doing nothing.",
        _alter_not_idempotent,
    ),
    (
        "hot_index_not_partial",
        "the per-device poll index stops being partial. Not a correctness bug, which is the "
        "point: this one tells us whether the proof checks index PREDICATES or merely that some "
        "index exists.",
        _hot_index_not_partial,
    ),
    (
        "kind_allowlist_removed",
        "an interrupt kind we never designed can be written by our own code, and the register "
        "renders a modal it has no branch for.",
        _kind_allowlist_removed,
    ),
    (
        "title_nullable",
        "an interrupt with no title is a modal with no text: the budtender is blocked by a blank "
        "box and cannot tell which order it concerns.",
        _title_nullable,
    ),
]

BY_NAME = {name: (why, fn) for name, why, fn in SABOTAGES}


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 2
    cmd = argv[1]

    if cmd == "names":
        for name, _, _ in SABOTAGES:
            print(name)
        return 0

    if cmd == "why":
        entry = BY_NAME.get(argv[2])
        if entry is None:
            print(f"unknown sabotage: {argv[2]}", file=sys.stderr)
            return 2
        print(entry[0])
        return 0

    if cmd == "apply":
        name, path = argv[2], argv[3]
        entry = BY_NAME.get(name)
        if entry is None:
            print(f"unknown sabotage: {name}", file=sys.stderr)
            return 2
        with open(path, encoding="utf-8") as fh:
            s = fh.read()
        try:
            out = entry[1](s)
        except AssertionError as exc:
            print(f"ANCHOR: {exc}", file=sys.stderr)
            return 3
        tmp = path + ".tmp"
        with open(tmp, "wb") as fh:
            fh.write(out.encode("utf-8"))
        os.replace(tmp, path)
        return 0

    if cmd == "selftest":
        # Every anchor must apply cleanly to the REAL 0229, and each must
        # produce a DISTINCT result. Two sabotages that yield identical text
        # are one sabotage wearing two names, and would overstate coverage.
        path = argv[2]
        with open(path, encoding="utf-8") as fh:
            s = fh.read()
        seen = {}
        bad = 0
        for name, why, fn in SABOTAGES:
            if not why.strip():
                print(f"  FAIL {name}: no consequence recorded")
                bad += 1
                continue
            try:
                out = fn(s)
            except AssertionError as exc:
                print(f"  FAIL {name}: {exc}")
                bad += 1
                continue
            if out == s:
                print(f"  FAIL {name}: no-op")
                bad += 1
                continue
            dup = [k for k, v in seen.items() if v == out]
            if dup:
                print(f"  FAIL {name}: produces identical text to {dup[0]}")
                bad += 1
                continue
            seen[name] = out
            print(f"  ok   {name}")
        print(f"  {len(seen)} distinct sabotages, {bad} broken")
        return 1 if bad else 0

    print(f"unknown command: {cmd}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
