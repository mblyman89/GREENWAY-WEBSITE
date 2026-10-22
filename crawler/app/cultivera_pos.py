"""R50 S9 — the "Fetch It All, Fuck Cultivera" harvester (Cultivera POS, READ-ONLY).

This is the crawler half of the cutover button (bible §3b.5, Phase A). It logs in
to the owner's Cultivera POS account ONCE, then only ever READS:

  1. inventory export   POST data-api/inventories/export-inventories-to-excel -> {Name, Url} -> CDN xlsx
  2. product export     POST data-api/products/export-products              -> {Name, Url} -> CDN xlsx
  3. inventory list     POST data-api/inventories   (Kendo paging; the inventory OF RECORD, §3b.2)
  4. transfers list     POST data-api/transfers/incoming (flat body)
  5. transfer details   GET  data-api/transfers/incoming/{id}/detail  — only transfers a live lot references
  6. batches            GET  data-api/inventories/inventory-batch/{BatchId} — only for list-only lots (the
                        ones the export drops), so their received time can be restored (UTC Z)

Every endpoint, header and export body above was measured live in rehearsal #1 (2026-10-12).
TWO details are NOT yet verified live and are pinned as "verify at rehearsal #2" in the bible: the Kendo
sort field used for data-api/inventories ("Id") and the Sort value in the transfers/incoming flat body.
Both only affect ORDER; _page_all refuses any run whose unique-row total differs from the server Count,
so a wrong sort can fail loudly but never silently drop a lot.

Hard rules enforced in code (each has a test in crawler/tests/test_cultivera_pos.py):
  * READ-ONLY GUARD — the only non-data-api call allowed is POST api/auth/login. Any other URL on the
    write API, any method other than GET/POST, and any CDN URL that is not https on a cultivera.com
    CDN host raises CultiveraPosRefused before a byte leaves the box.
  * NO SECRETS AT REST — the password is read from the environment and never logged; the token lives
    only in memory; the action log redacts Authorization and any password/token keys.
  * RESUMABLE — every stage writes its output file atomically and records itself in state.json; a rerun
    skips finished stages and, inside transfer_details / batches, skips ids already saved.
  * PACED — a fixed delay after every request (default 0.6 s, the rehearsal pace) plus bounded retries
    on 429/5xx and one re-login on 401.
  * PROVENANCE — manifest.json lists every output file with byte count and sha256, plus stage timings,
    so the go/no-go (src/lib/pos/cultivera-fetch-core.ts) and the time budget (§3b.7) are checkable.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Iterable
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

import httpx

API_HOST = "api-wa.cultiverapos.com"
API = f"https://{API_HOST}/api/"
Q = f"https://{API_HOST}/data-api/"
LOGIN_URL = API + "auth/login"
ORIGIN = "https://wa.cultiverapos.com"

# Headers the Cultivera back-office app sends on every data-api call (read from cbo-app.bundle.js and
# confirmed live: without x-aloc the inventory endpoints return the wrong location).
DATA_HEADERS = {
    "x-aloc": "1",
    "x-tmz": "Pacific Standard Time",
    "x-def-aloc": "1",
    "x-def-tmz": "Pacific Standard Time",
}
BASE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) Chrome/124 Safari/537.36",
    "Origin": ORIGIN,
    "Referer": ORIGIN + "/",
    "Accept": "application/json, text/plain, */*",
}

# The two export bodies — MUST equal INVENTORY_EXPORT_FILTER / PRODUCT_EXPORT_FILTER in
# src/lib/pos/cultivera-fetch-core.ts (a parity test reads the TS file and compares).
INVENTORY_EXPORT_FILTER: dict[str, Any] = {
    "Barcode": "", "ProductIds": [], "HideUnavailable": False, "HideInactive": False,
    "HideNonCannabis": False, "ShowOnlySamples": False, "CategoryIds": [], "ShowMetrcId": False,
    "VendorIds": [], "DisplayIds": [], "StorageIds": [], "BrandIds": [],
}
PRODUCT_EXPORT_FILTER: dict[str, Any] = {
    "Product": "", "BrandIds": [], "TagIds": [], "CategoryIds": [], "InventoryTypeIds": [],
    "VendorIds": [], "HideMasterProduct": False, "HideNotAvailable": False, "HideOutOfStock": False,
    "HideDiscontinued": False, "ShowNonCannabis": False,
}

STAGES_PHASE_A = (
    "login",
    "export_inventories",
    "export_products",
    "inventory_list",
    "transfers_list",
    "transfer_details",
    "batches",
    "sales",
    "wcia_json",
)

# Enrichment stages (R50 S3b): the cutover import never waits on them. They run last, stop before the
# time budget is spent, and a miss or an error is recorded as "partial" - never a failed run.
# R74 S2: a wcia_json miss is still "partial" (the files it did get stage), but it now carries a
# "coverage" block and a top-level state["warnings"] line, so the app fails it LOUD, never silent.
ENRICHMENT_STAGES = frozenset({"sales", "wcia_json"})
# Seconds of the budget an enrichment stage leaves unused (the import's go/no-go has a time check).
ENRICHMENT_MARGIN_SECONDS = 120.0

_SECRET_KEYS = re.compile(r"(pass(word)?|token|authorization|secret|cookie)", re.I)
_CDN_HOST = re.compile(r"^cdn(-[a-z0-9]+)?\.cultivera\.com$")


class CultiveraPosRefused(RuntimeError):
    """A call the read-only guard will not make."""


class CultiveraPosError(RuntimeError):
    """A call that was made but did not succeed (after retries)."""


# --------------------------------------------------------------------------- pure helpers


def guard_request(method: str, url: str) -> str:
    """Return the call kind ("login" | "data") or raise CultiveraPosRefused. Pure."""
    m = method.upper()
    if m not in ("GET", "POST"):
        raise CultiveraPosRefused(f"method {m} refused (read-only)")
    if url == LOGIN_URL:
        if m != "POST":
            raise CultiveraPosRefused("login must be POST")
        return "login"
    if url.startswith(Q) and ".." not in url[len(Q):]:
        return "data"
    raise CultiveraPosRefused(f"refused (not data-api): {url}")


def guard_cdn_url(url: str) -> str:
    """An export / file URL must be https on a cultivera.com CDN host. Pure."""
    p = urlparse(url)
    if p.scheme != "https" or not _CDN_HOST.match(p.hostname or "") or p.username or p.password:
        raise CultiveraPosRefused(f"refused CDN url: {url}")
    return url


def redact(obj: Any) -> Any:
    """Deep copy with any password/token/authorization value replaced. Pure."""
    if isinstance(obj, dict):
        return {k: ("[redacted]" if _SECRET_KEYS.search(str(k)) else redact(v)) for k, v in obj.items()}
    if isinstance(obj, list):
        return [redact(v) for v in obj]
    return obj


def kendo_body(skip: int, take: int, sort_field: str) -> dict[str, Any]:
    """Kendo grid paging body used by data-api/inventories (rehearsal #1: 3,858 rows, Count verified)."""
    return {"take": take, "skip": skip, "page": skip // take + 1, "pageSize": take,
            "sort": [{"field": sort_field, "dir": "asc"}]}


def transfers_body(skip: int, take: int) -> dict[str, Any]:
    """Flat body data-api/transfers/incoming takes (cbo-app.bundle.js; Kendo shape returns HTTP 500)."""
    return {"Number": None, "VendorIds": [], "StatusIds": [], "DateFrom": None, "DateTo": None,
            "Skip": skip, "Take": take, "Sort": [{"field": "Id", "dir": "asc"}], "HasSortInfo": True}


PACIFIC = ZoneInfo("America/Los_Angeles")

# R50 S11 (the Oct 30 count): the Sales Details grid of the Cultivera back office (Reports -> Sales
# Details), read from cbo-app.bundle.js and measured live (10/12 and 9/28-10/11/2026): Kendo-style Page
# + flat filters, DateFrom/DateTo as MM/DD/YYYY (the back office date picker format), {Count, Data}.
SALES_ENDPOINT = "reports/daily-sales-detail"
SALES_SUMMARY_ENDPOINT = "reports/sales-details-summary"
# Only what the count roll-forward and the COGS check need. No employee, customer or payment fields
# ever reach disk (SalesPersonName / SalesPersonId / PaymentMethod are dropped here).
SALES_SAFE_FIELDS = ("Id", "OrderId", "OrderNo", "ProductId", "ProductName", "CreatedAt", "Tsid", "Units",
                     "ReturnUnits", "FinalUnits", "UnitPrice", "DiscountAmount", "TotalReturn", "OrderStatus",
                     "Category", "InventoryType", "GrossSales", "NetSales", "TotalTax", "Cost", "IsCannabis")
_DAY = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")


def sales_filter(date_from: str, date_to: str) -> dict[str, Any]:
    """Flat filter body of the Sales Details grid. Dates are YYYY-MM-DD in, MM/DD/YYYY out."""
    def mdy(d: str) -> str:
        m = _DAY.match(d or "")
        if not m:
            raise CultiveraPosError(f"sales date must be YYYY-MM-DD, got {d!r}")
        return f"{m.group(2)}/{m.group(3)}/{m.group(1)}"
    return {"CategoryIds": [], "InventoryTypeIds": [], "ProductIds": [], "VendorIds": [], "EmployeeIds": [],
            "OriginIds": [], "PaymentMethodIds": [], "DateFrom": mdy(date_from), "DateTo": mdy(date_to),
            "ShiftId": None, "WeekDays": [], "Barcode": "", "SalesWithoutCategory": False,
            "SalesWithoutInventoryType": False, "HourFrom": "", "HourTo": "", "SalesType": None}


def sales_body(date_from: str, date_to: str) -> Callable[[int, int], dict[str, Any]]:
    flt = sales_filter(date_from, date_to)
    return lambda skip, take: {"Page": {"Skip": skip, "Take": take, "Sort": [{"field": "Id", "dir": "asc"}],
                                        "HasSortInfo": True}, **flt}


def safe_sale(row: dict[str, Any]) -> dict[str, Any]:
    return {k: row.get(k) for k in SALES_SAFE_FIELDS}


def pacific_wall(epoch: float) -> str:
    """Epoch -> Pacific wall time "YYYY-MM-DDTHH:MM:SS" (the clock Cultivera stamps sales with)."""
    return datetime.fromtimestamp(epoch, PACIFIC).strftime("%Y-%m-%dT%H:%M:%S")


def valid_sales_from(v: Any) -> bool:
    return isinstance(v, str) and bool(_DAY.match(v))


def parse_export_response(payload: Any) -> tuple[str, str]:
    """{Name, Url} -> (name, guarded url). Anything else is an error, never a guess."""
    if not isinstance(payload, dict) or not payload.get("Url"):
        raise CultiveraPosError(f"export response has no Url: {str(payload)[:200]}")
    return str(payload.get("Name") or ""), guard_cdn_url(str(payload["Url"]))


def parse_page(payload: Any) -> tuple[list[dict[str, Any]], int]:
    """A list page -> (rows, Count). Rejects pages without an integer Count."""
    if not isinstance(payload, dict) or not isinstance(payload.get("Count"), int):
        raise CultiveraPosError(f"list page without Count: {str(payload)[:200]}")
    rows = payload.get("Data") or []
    if not isinstance(rows, list):
        raise CultiveraPosError("list page Data is not a list")
    return rows, payload["Count"]


def dedupe_by_id(rows: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for r in rows:
        k = str(r.get("Id"))
        if k not in seen:
            seen.add(k)
            out.append(r)
    return out


def referenced_transfer_ids(lots: Iterable[dict[str, Any]]) -> list[int]:
    """Transfers a live lot points at (§3b.4 signal 1). Rehearsal #1: 654 of 1,164."""
    ids = {int(l["IncomingTransferId"]) for l in lots if l.get("IncomingTransferId") not in (None, "", 0)}
    return sorted(ids)


def list_only_batch_ids(lots: Iterable[dict[str, Any]], exported_barcodes: set[str]) -> list[int]:
    """BatchIds of lots the export dropped (§3b.2) — their received time comes from the batch."""
    ids = {int(l["BatchId"]) for l in lots
           if str(l.get("Barcode") or "") not in exported_barcodes and l.get("BatchId") not in (None, "", 0)}
    return sorted(ids)


_WCIA_URL = re.compile(r"^wa_pos/[A-Za-z0-9_./-]+\.json$")


def wcia_url_ok(url: Any) -> bool:
    """The vendor WCIA file path Cultivera stores on a transfer detail (§1.5c). Relative, under
    wa_pos/, a .json file, no traversal. Anything else is never sent. Pure."""
    return isinstance(url, str) and len(url) <= 400 and bool(_WCIA_URL.match(url)) and ".." not in url and "//" not in url


def wcia_targets(details: Iterable[dict[str, Any]]) -> tuple[list[tuple[int, str]], list[dict[str, Any]]]:
    """(transferId, JsonFile) pairs to fetch, and the details skipped with why. Pure."""
    out: dict[int, str] = {}
    skipped: list[dict[str, Any]] = []
    for d in details:
        tid, url = d.get("Id"), d.get("JsonFile")
        if tid in (None, "", 0):
            continue
        if url in (None, ""):
            continue  # transfer has no vendor file (HasJsonFile false) — nothing to get
        if not wcia_url_ok(url):
            skipped.append({"id": tid, "error": "JsonFile path refused"})
            continue
        out[int(tid)] = url
    return sorted(out.items()), skipped


def wcia_text_ok(text: Any) -> bool:
    """The load-wcia-json reply's JsonFile must be a WCIA transfer document. Pure."""
    if not isinstance(text, str):
        return False
    try:  # blank text is a ValueError here too
        doc = json.loads(text)
    except ValueError:
        return False
    return isinstance(doc, dict) and isinstance(doc.get("inventory_transfer_items"), list)


def wcia_coverage(wanted: int, saved: int, refused: int, errors: int, stopped_for_time: bool) -> dict[str, Any]:
    """R74 S2 - the vendor-file coverage the app shows loud. `expected` = every transfer that has a
    vendor file (fetchable + refused); complete only when every one of them is saved. Pure."""
    expected = wanted + refused
    missing = expected - saved
    return {"expected": expected, "saved": saved, "missing": missing, "refused": refused,
            "errors": errors, "stoppedForTime": stopped_for_time, "complete": missing == 0}


def wcia_warning(result: dict[str, Any]) -> str | None:
    """R74 S2 - one plain sentence for state.json "warnings" when vendor files are missing. Pure."""
    if result.get("error"):
        return f"Vendor transfer files: the stage failed ({result['error']}). No new lab files were fetched."
    cov = result.get("coverage") or {}
    if not cov or cov.get("complete"):
        return None
    why = []
    if cov.get("stoppedForTime"):
        why.append("the time budget ran out")
    if cov.get("errors"):
        why.append(f"{cov['errors']} errors")
    if cov.get("refused"):
        why.append(f"{cov['refused']} refused paths")
    tail = f" ({', '.join(why)})" if why else ""
    return f"Vendor transfer files: {cov['missing']} of {cov['expected']} MISSING{tail}. The {cov['saved']} saved still stage."


def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def remaining_budget_ok(started_at: float, now: float, budget_seconds: float) -> bool:
    return (now - started_at) <= budget_seconds


# --------------------------------------------------------------------------- run directory


@dataclass
class RunDir:
    root: Path

    def __post_init__(self) -> None:
        self.root.mkdir(parents=True, exist_ok=True)

    def p(self, name: str) -> Path:
        if "/" in name or "\\" in name or name.startswith("."):
            raise ValueError(f"bad output name {name!r}")
        return self.root / name

    def write_atomic(self, name: str, data: bytes) -> None:
        tmp = self.p(name + ".part")
        tmp.write_bytes(data)
        os.replace(tmp, self.p(name))

    def write_json(self, name: str, obj: Any) -> None:
        self.write_atomic(name, json.dumps(obj, ensure_ascii=False, sort_keys=True).encode("utf-8"))

    def read_json(self, name: str, default: Any = None) -> Any:
        try:
            return json.loads(self.p(name).read_text("utf-8"))
        except FileNotFoundError:
            return default

    def append_jsonl(self, name: str, obj: Any) -> None:
        p = self.p(name)
        torn = False
        if p.exists() and p.stat().st_size > 0:
            with open(p, "rb") as r:
                r.seek(-1, os.SEEK_END)
                torn = r.read(1) != b"\n"  # a crash mid-write left a partial last line
        with open(p, "a", encoding="utf-8") as f:
            f.write(("\n" if torn else "") + json.dumps(obj, ensure_ascii=False) + "\n")
            f.flush()
            os.fsync(f.fileno())

    def read_jsonl(self, name: str) -> list[Any]:
        out = []
        try:
            for line in self.p(name).read_text("utf-8").splitlines():
                if line.strip():
                    try:
                        out.append(json.loads(line))
                    except json.JSONDecodeError:
                        pass  # a torn last line from a crash: the id is simply refetched
        except FileNotFoundError:
            pass
        return out


# --------------------------------------------------------------------------- client


@dataclass
class PosClient:
    username: str
    password: str
    run: RunDir
    transport: httpx.BaseTransport | None = None
    pace_seconds: float = 0.6
    retries: int = 4
    sleep: Callable[[float], None] = time.sleep
    _token: str | None = field(default=None, repr=False)
    calls: int = 0

    def __post_init__(self) -> None:
        self._http = httpx.Client(transport=self.transport, headers=BASE_HEADERS, timeout=60.0,
                                  follow_redirects=False)
        # Every hop of a CDN redirect chain is guarded BEFORE it is requested (event hook), so a
        # redirect can never send us to a non-Cultivera host — not even for one request.
        self._cdn = httpx.Client(transport=self.transport, timeout=120.0, follow_redirects=True,
                                 max_redirects=5, headers={"User-Agent": BASE_HEADERS["User-Agent"]},
                                 event_hooks={"request": [lambda req: guard_cdn_url(str(req.url)) and None]})

    def close(self) -> None:
        self._http.close()
        self._cdn.close()

    def log(self, **rec: Any) -> None:
        rec["at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        self.run.append_jsonl("actions.jsonl", redact(rec))

    def login(self) -> None:
        guard_request("POST", LOGIN_URL)
        if not self.username or not self.password:
            raise CultiveraPosError("Cultivera POS credentials are not configured")
        r = self._http.post(LOGIN_URL, json={"username": self.username, "password": self.password})
        self.calls += 1
        self.log(action="login", status=r.status_code)
        if r.status_code != 200:
            raise CultiveraPosError(f"login failed: HTTP {r.status_code}")
        tok = (r.json() or {}).get("Token") if r.headers.get("content-type", "").startswith("application/json") else None
        if not tok:
            raise CultiveraPosError("login response had no Token")
        self._token = str(tok)

    def call(self, method: str, url: str, body: Any = None) -> httpx.Response:
        guard_request(method, url)
        if self._token is None:
            self.login()
        relogged = False
        last: httpx.Response | None = None
        for attempt in range(self.retries):
            headers = {**DATA_HEADERS, "Authorization": f"Bearer {self._token}"}
            try:
                r = self._http.request(method, url, json=body, headers=headers)
            except httpx.TransportError as e:
                self.calls += 1
                self.log(action="http", method=method, url=url, body=body, error=type(e).__name__)
                self.sleep(5.0 * (attempt + 1))
                continue
            self.calls += 1
            self.log(action="http", method=method, url=url, body=body, status=r.status_code, bytes=len(r.content))
            self.sleep(self.pace_seconds)
            last = r
            if r.status_code == 401 and not relogged:
                relogged = True
                self.login()
                continue
            if r.status_code in (429, 500, 502, 503, 504):
                self.sleep(5.0 * (attempt + 1))
                continue
            return r
        raise CultiveraPosError(f"{method} {url} failed after {self.retries} tries "
                                f"(last HTTP {getattr(last, 'status_code', 'none')})")

    def json(self, method: str, url: str, body: Any = None) -> Any:
        r = self.call(method, url, body)
        if r.status_code != 200:
            raise CultiveraPosError(f"{method} {url}: HTTP {r.status_code} {r.text[:200]}")
        return r.json()

    def cdn_get(self, url: str) -> bytes:
        guard_cdn_url(url)
        for attempt in range(self.retries):
            try:
                r = self._cdn.get(url)
            except httpx.TransportError as e:
                self.log(action="cdn", url=url, error=type(e).__name__)
                self.sleep(5.0 * (attempt + 1))
                continue
            self.calls += 1
            self.log(action="cdn", url=url, status=r.status_code, bytes=len(r.content))
            if r.status_code == 200:
                # After redirects the final host must still be a Cultivera CDN host.
                guard_cdn_url(str(r.url))
                return r.content
            if r.status_code in (429, 500, 502, 503, 504):
                self.sleep(5.0 * (attempt + 1))
                continue
            raise CultiveraPosError(f"CDN GET {url}: HTTP {r.status_code}")
        raise CultiveraPosError(f"CDN GET {url} failed after {self.retries} tries")


# --------------------------------------------------------------------------- stages


XLSX_MAGIC = b"PK\x03\x04"


def _export(client: PosClient, endpoint: str, body: dict[str, Any], out_name: str) -> dict[str, Any]:
    name, url = parse_export_response(client.json("POST", Q + endpoint, body))
    data = client.cdn_get(url)
    if not data.startswith(XLSX_MAGIC):
        raise CultiveraPosError(f"{endpoint}: CDN file is not an xlsx (first bytes {data[:8]!r})")
    client.run.write_atomic(out_name, data)
    return {"file": out_name, "cultiveraName": name, "bytes": len(data)}


def stage_export_inventories(client: PosClient) -> dict[str, Any]:
    return _export(client, "inventories/export-inventories-to-excel", INVENTORY_EXPORT_FILTER,
                   "export_inventories.xlsx")


def stage_export_products(client: PosClient) -> dict[str, Any]:
    return _export(client, "products/export-products", PRODUCT_EXPORT_FILTER, "export_products.xlsx")


def _page_all(client: PosClient, endpoint: str, body_for: Callable[[int, int], dict[str, Any]],
              take: int = 500, max_pages: int = 400) -> tuple[list[dict[str, Any]], int]:
    rows: list[dict[str, Any]] = []
    skip, count = 0, None
    for _ in range(max_pages):
        got, count = parse_page(client.json("POST", Q + endpoint, body_for(skip, take)))
        rows += got
        skip += len(got)  # advance by what the server returned (some endpoints cap a page)
        if not got or skip >= count:
            break
    else:
        raise CultiveraPosError(f"{endpoint}: more than {max_pages} pages — refusing to loop")
    uniq = dedupe_by_id(rows)
    if count is None or len(uniq) != count:
        raise CultiveraPosError(f"{endpoint}: Count {count} but {len(uniq)} unique rows")
    return uniq, count


def stage_inventory_list(client: PosClient) -> dict[str, Any]:
    rows, count = _page_all(client, "inventories", lambda s, t: kendo_body(s, t, "Id"))
    client.run.write_json("inventories.json", {"meta": {"endpoint": "inventories", "count": count}, "data": rows})
    return {"file": "inventories.json", "rows": len(rows)}


def stage_transfers_list(client: PosClient) -> dict[str, Any]:
    rows, count = _page_all(client, "transfers/incoming", transfers_body)
    client.run.write_json("transfers.json", {"meta": {"endpoint": "transfers/incoming", "count": count}, "data": rows})
    return {"file": "transfers.json", "rows": len(rows)}


def _fetch_each(client: PosClient, ids: list[int], url_for: Callable[[int], str], out_name: str,
                stage: str, cancelled: Callable[[], bool]) -> dict[str, Any]:
    have = {str(r.get("Id")) for r in client.run.read_jsonl(out_name)}
    fetched = errors = 0
    for i in ids:
        if str(i) in have:
            continue
        if cancelled():
            raise StageCancelled(stage)
        r = client.call("GET", url_for(i))
        if r.status_code != 200:
            errors += 1
            client.run.append_jsonl("errors.jsonl", {"stage": stage, "id": i, "status": r.status_code})
            continue
        try:
            rec = r.json()
        except ValueError:
            rec = {}
        if not isinstance(rec, dict) or str(rec.get("Id")) != str(i):
            errors += 1
            client.run.append_jsonl("errors.jsonl", {"stage": stage, "id": i, "error": "Id mismatch"})
            continue
        client.run.append_jsonl(out_name, rec)
        fetched += 1
    saved = {str(r.get("Id")) for r in client.run.read_jsonl(out_name)}
    missing = [i for i in ids if str(i) not in saved]
    return {"file": out_name, "wanted": len(ids), "fetched_now": fetched, "errors": errors, "missing": missing}


def stage_transfer_details(client: PosClient, cancelled: Callable[[], bool]) -> dict[str, Any]:
    lots = (client.run.read_json("inventories.json") or {}).get("data") or []
    ids = referenced_transfer_ids(lots)
    return _fetch_each(client, ids, lambda i: Q + f"transfers/incoming/{i}/detail",
                       "transfer_details.jsonl", "transfer_details", cancelled)


def stage_wcia_json(client: PosClient, cancelled: Callable[[], bool],
                    out_of_time: Callable[[], bool] = lambda: False) -> dict[str, Any]:
    """The vendor's WCIA transfer file per transfer (§1.5c): lab ids, potency, COA links per line.
    Read-only POST (Cultivera's own viewer call). Resumable per transfer id. Stops (leaving the rest
    missing, fetched on the next run) once `out_of_time()` says the run's budget is nearly spent."""
    details = client.run.read_jsonl("transfer_details.jsonl")
    targets, skipped = wcia_targets(details)
    for sk in skipped:
        client.run.append_jsonl("errors.jsonl", {"stage": "wcia_json", **sk})
    out_name = "wcia_json.jsonl"
    have = {str(r.get("Id")) for r in client.run.read_jsonl(out_name)}
    fetched = errors = 0
    stopped_for_time = False
    for tid, url in targets:
        if str(tid) in have:
            continue
        if cancelled():
            raise StageCancelled("wcia_json")
        if out_of_time():
            stopped_for_time = True
            break
        r = client.call("POST", Q + "transfers/incoming-load-wcia-json", {"Url": url})
        if r.status_code != 200:
            errors += 1
            client.run.append_jsonl("errors.jsonl", {"stage": "wcia_json", "id": tid, "status": r.status_code})
            continue
        try:
            rec = r.json()
        except ValueError:
            rec = None
        text = rec.get("JsonFile") if isinstance(rec, dict) else None
        if not wcia_text_ok(text):
            errors += 1
            client.run.append_jsonl("errors.jsonl", {"stage": "wcia_json", "id": tid, "error": "not a WCIA document"})
            continue
        client.run.append_jsonl(out_name, {"Id": tid, "Url": url, "JsonFile": text})
        fetched += 1
    saved = {str(r.get("Id")) for r in client.run.read_jsonl(out_name)}
    missing = [t for t, _ in targets if str(t) not in saved]
    # R74 S2: say plainly how many vendor files the run has, and why the rest are missing. A refused
    # path is a vendor file we never got, so it counts against coverage too (never silently "fine").
    return {"file": out_name, "wanted": len(targets), "fetched_now": fetched, "errors": errors,
            "refused": len(skipped), "missing": missing,
            "coverage": wcia_coverage(len(targets), len(targets) - len(missing), len(skipped), errors,
                                      stopped_for_time)}


def stage_sales(client: PosClient, sales_from: str | None, now_epoch: float) -> dict[str, Any]:
    """R50 S11 - the Oct 30 count roll-forward. The owner's page #/rpt/sales-details (bible §0.6
    clarification #4). Every Sales Details line from the sales day (10/31, the day after the count)
    through today (Pacific), read-only, Count-verified, safe fields only -> sales.jsonl, plus
    Cultivera's own totals for the same dates -> sales_summary.json. Row sums must equal the summary
    (measured equal on 10/12 and on 9/28-10/11); a difference is recorded as "partial" and the count
    page refuses it. No sales day on the run -> nothing is fetched (the cutover import never needs it)."""
    if not valid_sales_from(sales_from):
        return {"skipped": "no count date on this run"}
    date_to = pacific_wall(now_epoch)[:10]
    if str(sales_from) > date_to:
        raise CultiveraPosError(f"sales: sales day {sales_from} is after today ({date_to})")
    rows, count = _page_all(client, SALES_ENDPOINT, sales_body(str(sales_from), date_to))
    safe = [safe_sale(r) for r in rows]
    client.run.write_atomic("sales.jsonl", "".join(json.dumps(r, separators=(",", ":")) + "\n" for r in safe).encode())
    summary = client.json("POST", Q + SALES_SUMMARY_ENDPOINT, sales_filter(str(sales_from), date_to))
    if not isinstance(summary, dict):
        raise CultiveraPosError(f"sales summary is not an object: {str(summary)[:200]}")

    def total(field_name: str) -> float:
        return round(sum(float(r.get(field_name) or 0) for r in safe), 2)

    checks = {f: {"rows": total(f), "cultivera": round(float(summary.get(f) or 0), 2)} for f in ("GrossSales", "NetSales")}
    reconciled = all(abs(v["rows"] - v["cultivera"]) < 0.005 for v in checks.values())
    client.run.write_json("sales_summary.json", {
        "dateFrom": sales_from, "dateTo": date_to, "count": count, "rows": len(safe),
        "units": sum(int(r.get("Units") or 0) for r in safe),
        "returnUnits": sum(int(r.get("ReturnUnits") or 0) for r in safe),
        "cogs": total("Cost"), "checks": checks, "reconciled": reconciled,
        "cultivera": {k: summary.get(k) for k in ("GrossSales", "Discounts", "Taxes", "Returns", "NetSales")},
        "fetchedAtPacific": pacific_wall(now_epoch),
    })
    out: dict[str, Any] = {"file": "sales.jsonl", "rows": len(safe), "dateFrom": sales_from, "dateTo": date_to,
                           "reconciled": reconciled}
    if not reconciled:
        out["missing"] = ["totals differ from Cultivera's Sales Details summary"]
    return out


def exported_barcodes_from_xlsx(path: Path) -> set[str]:
    """Barcodes in the inventory export (column 'Barcode'). openpyxl, read-only streaming."""
    from openpyxl import load_workbook  # local import: only this stage needs it

    wb = load_workbook(path, read_only=True, data_only=True)
    try:
        ws = wb.worksheets[0]
        it = ws.iter_rows(values_only=True)
        header = [str(h or "").strip() for h in next(it)]
        if "Barcode" not in header:
            raise CultiveraPosError("inventory export has no Barcode column")
        col = header.index("Barcode")
        return {str(r[col]).strip() for r in it if r and r[col] not in (None, "")}
    finally:
        wb.close()


def stage_batches(client: PosClient, cancelled: Callable[[], bool]) -> dict[str, Any]:
    lots = (client.run.read_json("inventories.json") or {}).get("data") or []
    exported = exported_barcodes_from_xlsx(client.run.p("export_inventories.xlsx"))
    ids = list_only_batch_ids(lots, exported)
    res = _fetch_each(client, ids, lambda i: Q + f"inventories/inventory-batch/{i}",
                      "batches.jsonl", "batches", cancelled)
    res["list_only_lots"] = sum(1 for l in lots if str(l.get("Barcode") or "") not in exported)
    return res


class StageCancelled(RuntimeError):
    pass


# --------------------------------------------------------------------------- orchestration


def build_manifest(run: RunDir, state: dict[str, Any]) -> dict[str, Any]:
    files = []
    for f in sorted(run.root.iterdir()):
        if f.is_file() and f.name not in ("manifest.json", "state.json", "actions.jsonl") and not f.name.endswith(".part"):
            b = f.read_bytes()
            files.append({"name": f.name, "bytes": len(b), "sha256": sha256_bytes(b)})
    return {"kind": "cultivera_pos_phase_a", "files": files, "stages": state.get("stages", {}),
            "startedAt": state.get("startedAt"), "finishedAt": state.get("finishedAt"),
            "status": state.get("status")}


def run_phase_a(client: PosClient, *, cancelled: Callable[[], bool] = lambda: False,
                clock: Callable[[], float] = time.time, budget_seconds: float = 1800.0,
                sales_from: str | None = None) -> dict[str, Any]:
    """Run (or resume) Phase A. Returns the manifest. Never raises for a stage error — it is recorded
    in state.json with status "failed" so the button can show it and a rerun resumes.

    `sales_from` (YYYY-MM-DD, R50 S11): the sales day of the count (10/31 for the 10/30 count). When set,
    the sales stage scrapes Cultivera's Sales Details from that day through today; a different date on a
    resume refetches the sales."""
    if sales_from is not None and not valid_sales_from(sales_from):
        raise ValueError("sales_from must be YYYY-MM-DD")
    run = client.run
    state = run.read_json("state.json", {}) or {}
    state.setdefault("stages", {})
    if sales_from is not None:
        if state.get("salesFrom") != sales_from:
            state["stages"].pop("sales", None)
        state["salesFrom"] = sales_from
    state.setdefault("startedAt", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(clock())))
    state["status"] = "running"
    run.write_json("state.json", state)
    t0 = clock()
    try:
        for stage in STAGES_PHASE_A:
            st = state["stages"].get(stage) or {}
            if st.get("status") == "done" and stage != "login":
                continue
            if cancelled():
                raise StageCancelled(stage)
            s0 = clock()
            if stage == "login":
                client.login()
                result: dict[str, Any] = {}
            elif stage == "export_inventories":
                result = stage_export_inventories(client)
            elif stage == "export_products":
                result = stage_export_products(client)
            elif stage == "inventory_list":
                result = stage_inventory_list(client)
            elif stage == "transfers_list":
                result = stage_transfers_list(client)
            elif stage == "transfer_details":
                result = stage_transfer_details(client, cancelled)
            elif stage == "sales":
                try:
                    result = stage_sales(client, state.get("salesFrom"), clock())
                except (CultiveraPosError, CultiveraPosRefused) as e:  # enrichment never fails the run
                    result = {"error": str(e)[:300], "missing": ["?"]}
            elif stage == "wcia_json":
                try:
                    result = stage_wcia_json(client, cancelled, lambda: not remaining_budget_ok(
                        t0, clock() + ENRICHMENT_MARGIN_SECONDS, budget_seconds))
                except (CultiveraPosError, CultiveraPosRefused) as e:  # enrichment never fails the run
                    result = {"error": str(e)[:300], "missing": ["?"]}
            else:
                result = stage_batches(client, cancelled)
            # R74 S2: a refused vendor-file path is a file we do not have - partial, not done.
            incomplete = bool(result.get("missing")) or (result.get("coverage") or {}).get("complete") is False
            enrichment = stage in ENRICHMENT_STAGES
            state["stages"][stage] = {"status": ("partial" if enrichment else "incomplete") if incomplete else "done",
                                      "seconds": round(clock() - s0, 1), **result,
                                      # R50 S11: Pacific wall clock of each stage, so the count can tell
                                      # which Cultivera sales the inventory snapshot already includes.
                                      "startedPacific": pacific_wall(s0), "endedPacific": pacific_wall(clock())}
            if stage == "wcia_json":  # R74 S2: never a silent partial - a top-level warning the app shows
                warn = wcia_warning(result)
                state["warnings"] = [w for w in (state.get("warnings") or []) if not str(w).startswith("Vendor transfer files")]
                if warn:
                    state["warnings"].append(warn)
            run.write_json("state.json", state)
            if incomplete and not enrichment:
                raise CultiveraPosError(f"{stage}: {len(result['missing'])} ids not fetched")
        state["status"] = "done"
    except StageCancelled as e:
        state["status"] = "cancelled"
        state["error"] = f"cancelled before {e}"
    except (CultiveraPosError, CultiveraPosRefused) as e:
        state["status"] = "failed"
        state["error"] = str(e)[:500]
    except Exception as e:  # noqa: BLE001 — anything unexpected (bad JSON, disk) is a recorded failure,
        state["status"] = "failed"  # never a half-written state the button cannot read or resume.
        state["error"] = f"unexpected {type(e).__name__}: {str(e)[:400]}"
    state["finishedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(clock()))
    state["seconds"] = round(clock() - t0, 1)
    state["withinBudget"] = remaining_budget_ok(t0, clock(), budget_seconds)
    run.write_json("state.json", state)
    manifest = build_manifest(run, state)
    run.write_json("manifest.json", manifest)
    client.log(action="phase_a_end", status=state["status"], seconds=state["seconds"], calls=client.calls)
    return manifest
