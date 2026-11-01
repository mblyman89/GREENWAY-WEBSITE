"""CVL - the Cultivera customer LOYALTY crawl (READ-ONLY, slow, resumable).

Owner (2026-11-01, verbatim): "cultivera, naturally, does not provide the total loyalty earned, spent, or
current amount in the downloadable spreadsheet. which means I need you to add to this fetcher the ability to
slowly crawl through each customer record and pull out this info and automatically apply the data to the
customers in our back office."

Every endpoint and field below was measured live on 2026-11-01 (probes p16-p21):

  1. ids       POST data-api/customers  {Page:{Skip,Take,Sort,HasSortInfo}, Name:"", MmjidNumber:"",
               PhoneNumber:"", IsActive:false}  -> Count 16,588 (IsActive:true gives 16,586). Pages of 1,000
               (5,000 times out with HTTP 504). The list row has NO current balance - only LoyaltyPointsApplied.
  2. accrual   POST data-api/reports/loyalty-point-accrual {Page, CustomerIds:[], EmployeeIds:[], TypeIds:[],
               OrderNo:null, DateFrom, DateTo} -> 100,833 rows with CustomerId, Type, Points. Types (lookup
               loyalty-point-accrual-types): 1 Create Order, 2 Return Order Item, 3 Apply Loyalty Points
               (positive = points redeemed), 4 Cancel Order, 5 Initial Loyalty Points, 7 Adjusted Loyalty Points
               (signed). Only per-customer SUMS per type are kept on disk (no names, no order numbers).
  3. details   GET  data-api/customers/detail/{Id} (~1.6-2 s each) -> LoyaltyPoints (the CURRENT balance, a
               float, e.g. 509.13), LoyaltyPointsApplied (points redeemed; the UI calls it "Total Discount
               Applied (pts)"), LoyaltyAmountApplied (dollars), Total, NumberOfOrders, TotalUnits, IsDeleted,
               plus PII. A missing id is HTTP 400 {"ExceptionMessage":"Customer not found"} - a recorded skip.

Cultivera's balance does NOT reconcile with its own accrual history (customer 2322: initial 783 + earned
694.23 - applied 900 = 577.23, but the record says 509.13). So the current balance is ALWAYS read from the
customer record, never derived; the accrual sums are history for staff to see.

Hard rules (tests in crawler/tests/test_cultivera_loyalty.py):
  * READ-ONLY - every call goes through PosClient, whose guard refuses anything but data-api GET/POST.
  * NO PII AT REST - a detail record is reduced to LOYALTY_FIELDS before it is written. Names, phone,
    address, DOB, email, ID-card paths never touch disk.
  * SLOW + RESUMABLE - PosClient's pace after every call; ids already saved are never refetched; a time
    budget stops the run as "paused" (resumable), a cancel stops it as "cancelled" (resumable).
  * ORDER - customers with loyalty activity are fetched first, so a partial run already holds the records
    that matter; every id is still fetched (a balance is never assumed to be zero).
"""
from __future__ import annotations

import time
from datetime import datetime
from typing import Any, Callable

from .cultivera_pos import (
    PACIFIC,
    Q,
    CultiveraPosError,
    CultiveraPosRefused,
    PosClient,
    RunDir,
    parse_page,
    sha256_bytes,
)

IDS_ENDPOINT = "customers"
ACCRUAL_ENDPOINT = "reports/loyalty-point-accrual"
DETAIL_PATH = "customers/detail/{id}"
IDS_TAKE = 1000
ACCRUAL_TAKE = 5000
MAX_PAGES = 400
ACCRUAL_FROM = "01/01/2015"  # before Greenway's first Cultivera record (earliest accrual row is 2024-08-30)

# Accrual type -> the per-customer total it adds to (lookup loyalty-point-accrual-types, measured).
ACCRUAL_TYPES: dict[int, str] = {
    1: "earnedOrders",     # Create Order
    2: "returned",         # Return Order Item
    3: "applied",          # Apply Loyalty Points (positive values = redeemed)
    4: "cancelled",        # Cancel Order
    5: "initial",          # Initial Loyalty Points
    7: "adjusted",         # Adjusted Loyalty Points (signed)
}

# The ONLY detail fields written to disk (no PII).
LOYALTY_FIELDS = ("Id", "CustomerNo", "LoyaltyPoints", "LoyaltyPointsApplied", "LoyaltyAmountApplied", "Total",
                  "NumberOfOrders", "TotalUnits", "IsDeleted")

STAGES = ("login", "ids", "accrual", "details")
OUT_IDS = "customer_ids.json"
OUT_ACCRUAL = "accrual_totals.json"
OUT_LOYALTY = "customer_loyalty.jsonl"
OUT_SKIPPED = "skipped.jsonl"
OUT_ERRORS = "errors.jsonl"


class LoyaltyStop(RuntimeError):
    """Raised between requests: args[0] is "cancelled" or "paused"."""


# --------------------------------------------------------------------------- pure helpers


def ids_body(skip: int, take: int) -> dict[str, Any]:
    return {"Page": {"Skip": skip, "Take": take, "Sort": [{"field": "Id", "dir": "asc"}], "HasSortInfo": True},
            "Name": "", "MmjidNumber": "", "PhoneNumber": "", "IsActive": False}


def mdy_today(epoch: float) -> str:
    """Today's date (Pacific) as MM/DD/YYYY - the accrual report's DateTo."""
    return datetime.fromtimestamp(epoch, PACIFIC).strftime("%m/%d/%Y")


def accrual_body(date_to: str) -> Callable[[int, int], dict[str, Any]]:
    def body(skip: int, take: int) -> dict[str, Any]:
        return {"Page": {"Skip": skip, "Take": take, "Sort": [{"field": "Id", "dir": "asc"}], "HasSortInfo": True},
                "CustomerIds": [], "EmployeeIds": [], "TypeIds": [], "OrderNo": None,
                "DateFrom": ACCRUAL_FROM, "DateTo": date_to}
    return body


def safe_loyalty(rec: dict[str, Any]) -> dict[str, Any]:
    """Reduce a customer detail record to the loyalty fields (drops every PII key)."""
    return {k: rec.get(k) for k in LOYALTY_FIELDS}


def is_not_found(status: int, text: str) -> bool:
    return status == 400 and "customer not found" in (text or "").lower()


def add_accrual(totals: dict[str, dict[str, Any]], row: dict[str, Any], unknown: dict[str, int]) -> None:
    """Fold one accrual row into per-customer sums. An unknown Type is counted, never guessed."""
    cid = row.get("CustomerId")
    t = row.get("Type")
    pts = row.get("Points")
    if cid is None or not isinstance(pts, (int, float)):
        unknown["badRow"] = unknown.get("badRow", 0) + 1
        return
    key = ACCRUAL_TYPES.get(t) if isinstance(t, int) else None
    if key is None:
        unknown[str(t)] = unknown.get(str(t), 0) + 1
        return
    c = totals.setdefault(str(cid), {"rows": 0, **{k: 0.0 for k in ACCRUAL_TYPES.values()}})
    c[key] = round(c[key] + float(pts), 4)
    c["rows"] += 1


def fetch_order(ids: list[int], accrual: dict[str, Any], list_applied: dict[str, float]) -> list[int]:
    """Customers with any loyalty activity first (accrual rows or points applied), then the rest; each
    group ascending. Every id is still in the list."""
    active = [i for i in ids if str(i) in accrual or (list_applied.get(str(i)) or 0) != 0]
    seen = set(active)
    return sorted(active) + sorted(i for i in ids if i not in seen)


# --------------------------------------------------------------------------- stages


def _page(client: PosClient, endpoint: str, body_for: Callable[[int, int], dict[str, Any]], take: int,
          on_rows: Callable[[list[dict[str, Any]]], None], should_stop: Callable[[], str | None]) -> int:
    skip, count = 0, None
    for _ in range(MAX_PAGES):
        why = should_stop()
        if why:
            raise LoyaltyStop(why)
        got, count = parse_page(client.json("POST", Q + endpoint, body_for(skip, take)))
        on_rows(got)
        skip += len(got)
        if not got or skip >= count:
            return count
    raise CultiveraPosError(f"{endpoint}: more than {MAX_PAGES} pages - refusing to loop")


def stage_ids(client: PosClient, should_stop: Callable[[], str | None]) -> dict[str, Any]:
    ids: dict[int, float] = {}

    def keep(rows: list[dict[str, Any]]) -> None:
        for r in rows:
            if isinstance(r.get("Id"), int):
                ids[r["Id"]] = float(r.get("LoyaltyPointsApplied") or 0)

    count = _page(client, IDS_ENDPOINT, ids_body, IDS_TAKE, keep, should_stop)
    if len(ids) != count:
        raise CultiveraPosError(f"customers: Count {count} but {len(ids)} unique ids")
    client.run.write_json(OUT_IDS, {"count": count, "ids": sorted(ids),
                                    "listApplied": {str(k): v for k, v in ids.items() if v}})
    return {"file": OUT_IDS, "count": count}


def stage_accrual(client: PosClient, should_stop: Callable[[], str | None], now: float) -> dict[str, Any]:
    totals: dict[str, dict[str, Any]] = {}
    unknown: dict[str, int] = {}
    seen: set[str] = set()
    dupes = 0

    def fold(rows: list[dict[str, Any]]) -> None:
        nonlocal dupes
        for r in rows:
            k = str(r.get("Id"))
            if k in seen:
                dupes += 1
                continue
            seen.add(k)
            add_accrual(totals, r, unknown)

    date_to = mdy_today(now)
    count = _page(client, ACCRUAL_ENDPOINT, accrual_body(date_to), ACCRUAL_TAKE, fold, should_stop)
    if len(seen) != count:
        raise CultiveraPosError(f"{ACCRUAL_ENDPOINT}: Count {count} but {len(seen)} unique rows")
    client.run.write_json(OUT_ACCRUAL, {"count": count, "dateFrom": ACCRUAL_FROM, "dateTo": date_to,
                                        "unknownTypes": unknown, "customers": totals})
    return {"file": OUT_ACCRUAL, "rows": count, "customers": len(totals), "unknownTypes": unknown}


def stage_details(client: PosClient, should_stop: Callable[[], str | None]) -> dict[str, Any]:
    run = client.run
    idx = run.read_json(OUT_IDS) or {}
    accrual = (run.read_json(OUT_ACCRUAL) or {}).get("customers") or {}
    ids = fetch_order(list(idx.get("ids") or []), accrual, idx.get("listApplied") or {})
    have = {str(r.get("Id")) for r in run.read_jsonl(OUT_LOYALTY)}
    have |= {str(r.get("id")) for r in run.read_jsonl(OUT_SKIPPED)}
    fetched = errors = 0
    for i in ids:
        if str(i) in have:
            continue
        why = should_stop()
        if why:
            raise LoyaltyStop(why)
        r = client.call("GET", Q + DETAIL_PATH.format(id=i))
        if is_not_found(r.status_code, r.text):
            run.append_jsonl(OUT_SKIPPED, {"id": i, "reason": "Customer not found"})
            have.add(str(i))
            continue
        rec: Any = None
        if r.status_code == 200:
            try:
                rec = r.json()
            except ValueError:
                rec = None
        if not isinstance(rec, dict) or str(rec.get("Id")) != str(i) or not isinstance(rec.get("LoyaltyPoints"), (int, float)):
            errors += 1
            run.append_jsonl(OUT_ERRORS, {"stage": "details", "id": i, "status": r.status_code,
                                          "error": "unexpected response"})
            continue
        run.append_jsonl(OUT_LOYALTY, safe_loyalty(rec))
        have.add(str(i))
        fetched += 1
    missing = [i for i in ids if str(i) not in have]
    return {"file": OUT_LOYALTY, "wanted": len(ids), "fetchedNow": fetched, "errors": errors,
            "saved": len(run.read_jsonl(OUT_LOYALTY)), "skipped": len(run.read_jsonl(OUT_SKIPPED)),
            "missing": missing[:200], "missingCount": len(missing)}


# --------------------------------------------------------------------------- orchestration


def build_manifest(run: RunDir, state: dict[str, Any]) -> dict[str, Any]:
    files = []
    for f in sorted(run.root.iterdir()):
        if f.is_file() and f.name not in ("manifest.json", "state.json", "actions.jsonl") and not f.name.endswith(".part"):
            b = f.read_bytes()
            files.append({"name": f.name, "bytes": len(b), "sha256": sha256_bytes(b)})
    return {"kind": "cultivera_loyalty", "files": files, "stages": state.get("stages", {}),
            "startedAt": state.get("startedAt"), "finishedAt": state.get("finishedAt"), "status": state.get("status")}


def progress(run: RunDir) -> dict[str, Any]:
    idx = run.read_json(OUT_IDS) or {}
    return {"total": idx.get("count"), "saved": len(run.read_jsonl(OUT_LOYALTY)),
            "skipped": len(run.read_jsonl(OUT_SKIPPED))}


def run_loyalty(client: PosClient, *, cancelled: Callable[[], bool] = lambda: False,
                clock: Callable[[], float] = time.time, budget_seconds: float = 14 * 3600.0) -> dict[str, Any]:
    """Run (or resume) the crawl. Never raises for a Cultivera error - it is recorded in state.json.
    Status: done | paused (time budget; resumable) | cancelled (resumable) | failed (resumable)."""
    run = client.run
    state = run.read_json("state.json", {}) or {}
    state.setdefault("stages", {})
    state.setdefault("startedAt", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(clock())))
    state["status"] = "running"
    state.pop("error", None)
    run.write_json("state.json", state)
    t0 = clock()
    last_save = [t0]

    def should_stop() -> str | None:
        if cancelled():
            return "cancelled"
        if clock() - t0 >= budget_seconds:
            return "paused"
        if clock() - last_save[0] >= 60:  # the progress page polls state.json
            last_save[0] = clock()
            state["progress"] = progress(run)
            run.write_json("state.json", state)
        return None

    try:
        for stage in STAGES:
            st = state["stages"].get(stage) or {}
            if st.get("status") == "done" and stage != "login":
                continue
            s0 = clock()
            if stage == "login":
                client.login()
                result: dict[str, Any] = {}
            elif stage == "ids":
                result = stage_ids(client, should_stop)
            elif stage == "accrual":
                result = stage_accrual(client, should_stop, clock())
            else:
                result = stage_details(client, should_stop)
            incomplete = bool(result.get("missingCount"))
            state["stages"][stage] = {"status": "incomplete" if incomplete else "done",
                                      "seconds": round(clock() - s0, 1), **result}
            run.write_json("state.json", state)
            if incomplete:
                raise CultiveraPosError(f"{stage}: {result['missingCount']} customers not fetched (see errors.jsonl)")
        state["status"] = "done"
    except LoyaltyStop as e:
        state["status"] = str(e)
    except (CultiveraPosError, CultiveraPosRefused) as e:
        state["status"] = "failed"
        state["error"] = str(e)[:500]
    except Exception as e:  # noqa: BLE001 - recorded, never a half-written state
        state["status"] = "failed"
        state["error"] = f"unexpected {type(e).__name__}: {str(e)[:400]}"
    state["progress"] = progress(run)
    state["finishedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(clock()))
    state["seconds"] = round(clock() - t0, 1)
    run.write_json("state.json", state)
    manifest = build_manifest(run, state)
    run.write_json("manifest.json", manifest)
    client.log(action="loyalty_end", status=state["status"], seconds=state["seconds"], calls=client.calls)
    return manifest
