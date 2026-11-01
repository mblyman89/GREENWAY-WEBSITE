"""CVB-2 - the Cultivera ARCHIVE harvester (READ-ONLY): every dataset the back office will give us.

Owner request (2026-11-01, verbatim in docs/roadmap/CVB-CULTIVERA-BENCHMARK.md): "scrape all sales, cogs,
returns, voids, employee samples, employee purchases, discounts by employee, all reports, taxes, cycle
counts, vendor records like purchase history and purchase stats, any and all data ... This will also allow me
to retain Cultivera historical data safely in our system."

This module REUSES the Phase A client (cultivera_pos.PosClient): the same read-only guard (only POST
api/auth/login, then GET/POST under data-api/), the same redaction, pacing, 401 re-login and 429/5xx
back-off. It adds nothing that can write to Cultivera.

Every endpoint, body shape, page size and count below was MEASURED LIVE on 2026-11-01 against the owner's
account (docs/roadmap/CVB-CULTIVERA-BENCHMARK.md section 4 has the table). Three things were measured
the hard way and are encoded here on purpose:
  * `orders` and `customers` return HTTP 504 (the gateway's ~60 s limit) for large pages, so orders are
    read in MONTHLY windows of 1,000 and customers in pages of 1,000;
  * `shifts/list` returns ZERO rows (with the right Count) for a 5,000 page, so it pages at 1,000;
  * the keyless roll-up reports (daily-sales, sales-by-sku, ...) have no Id; they are read in ONE page and
    refused if the page is short of Count, so a silent truncation is impossible.

Outputs (one run directory, the same RunDir as Phase A):
  <dataset>.pNNNN.jsonl.gz   paged datasets, <= PART_ROWS rows per part, gzip (mtime 0 = byte-stable)
  orders.YYYY-MM.jsonl.gz    orders, one part per Pacific month window
  valuation_snapshot_rows.sNNNNN.jsonl.gz / cycle_count_details.ccNNNNN.jsonl.gz   one part per parent id
  summaries.json             every summary object (sales, tax, valuation, ...)
  lookups.json               every lookup list (statuses, payment methods, reasons, ...)
  state.json / manifest.json progress, and every file with bytes + sha256 + rows (provenance)

Every paged dataset is verified: unique keys == the server's Count, or the dataset fails loudly.
"""
from __future__ import annotations

import gzip
import json
import re
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable

from .cultivera_pos import (
    PACIFIC,
    Q,
    CultiveraPosError,
    CultiveraPosRefused,
    PosClient,
    RunDir,
    parse_page,
    pacific_wall,
    remaining_budget_ok,
    sha256_bytes,
)

KIND = "cultivera_archive"
# Before the store's first Cultivera sale (order 1: 2024-08-30, measured). Cultivera filters by day, so an
# early floor costs nothing and can never cut history off.
ARCHIVE_FROM = "2015-01-01"
PART_ROWS = 20_000
KEYLESS_MAX = 25_000
MAX_PAGES = 2_000

_DAY = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")
PART_NAME = re.compile(r"^[a-z0-9_]+\.(p\d{4}|\d{4}-\d{2}|s\d{5}|cc\d{5})\.jsonl\.gz$")
SINGLE_FILES = frozenset({"summaries.json", "lookups.json", "manifest.json", "state.json", "errors.jsonl"})


class BudgetReached(RuntimeError):
    """The run's time budget is spent; the run pauses and a Resume continues where it stopped."""


class ArchiveCancelled(RuntimeError):
    pass


# --------------------------------------------------------------------------- pure helpers


def mdy(day: str) -> str:
    """YYYY-MM-DD -> MM/DD/YYYY (the back office date-picker format every report filter takes)."""
    m = _DAY.match(day or "")
    if not m:
        raise CultiveraPosError(f"date must be YYYY-MM-DD, got {day!r}")
    return f"{m.group(2)}/{m.group(3)}/{m.group(1)}"


def pacific_today(epoch: float) -> str:
    return datetime.fromtimestamp(epoch, PACIFIC).strftime("%Y-%m-%d")


def month_windows(first_day: str, last_day: str) -> list[tuple[str, str, str]]:
    """Inclusive Pacific month windows [(label YYYY-MM, from, to)] covering first_day..last_day."""
    a, b = _DAY.match(first_day), _DAY.match(last_day)
    if not a or not b or first_day > last_day:
        raise CultiveraPosError(f"bad window {first_day}..{last_day}")
    y, m = int(a.group(1)), int(a.group(2))
    out = []
    while (y, m) <= (int(b.group(1)), int(b.group(2))):
        ny, nm = (y + 1, 1) if m == 12 else (y, m + 1)
        last = (datetime(ny, nm, 1) - datetime(y, m, 1)).days
        out.append((f"{y:04d}-{m:02d}", f"{y:04d}-{m:02d}-01", f"{y:04d}-{m:02d}-{last:02d}"))
        y, m = ny, nm
    return out


def first_day_from_str(created_at_str: str) -> str:
    """Cultivera's CreatedAtStr is the Pacific wall clock "MM/DD/YYYY hh:mm AM" -> YYYY-MM-DD."""
    m = re.match(r"^(\d{2})/(\d{2})/(\d{4})", created_at_str or "")
    if not m:
        raise CultiveraPosError(f"unreadable CreatedAtStr {created_at_str!r}")
    return f"{m.group(3)}-{m.group(1)}-{m.group(2)}"


def sales_filter(date_from: str, date_to: str) -> dict[str, Any]:
    """The report filter every sales / tax / promotion report takes (BrandIds included: tax-setting-report
    answers HTTP 500 without it, measured 2026-11-01)."""
    return {"CategoryIds": [], "InventoryTypeIds": [], "ProductIds": [], "VendorIds": [], "EmployeeIds": [],
            "OriginIds": [], "PaymentMethodIds": [], "DateFrom": mdy(date_from), "DateTo": mdy(date_to),
            "ShiftId": None, "WeekDays": [], "Barcode": "", "SalesWithoutCategory": False,
            "SalesWithoutInventoryType": False, "HourFrom": "", "HourTo": "", "SalesType": None, "BrandIds": []}


def tax_filter(date_from: str, date_to: str) -> dict[str, Any]:
    return {**sales_filter(date_from, date_to), "TaxSettingId": None, "TaxSettingDetailIds": [], "OrderNo": ""}


def inv_filter() -> dict[str, Any]:
    return {"CategoryIds": [], "InventoryTypeIds": [], "ProductIds": [], "VendorIds": []}


def _sort(key: str | None) -> list[dict[str, str]]:
    return [{"field": key, "dir": "asc"}] if key else []


def page_style(filters: dict[str, Any], key: str | None = "Id") -> Callable[[int, int], dict[str, Any]]:
    """{Page:{Skip,Take,Sort,HasSortInfo}, ...filters} - the report grids."""
    return lambda skip, take: {"Page": {"Skip": skip, "Take": take, "Sort": _sort(key), "HasSortInfo": bool(key)},
                               **filters}


def flat_style(filters: dict[str, Any], key: str | None = "Id") -> Callable[[int, int], dict[str, Any]]:
    """{...filters, Skip, Take, Sort, HasSortInfo} - transfers, shrink, users, roles."""
    return lambda skip, take: {**filters, "Skip": skip, "Take": take, "Sort": _sort(key), "HasSortInfo": bool(key)}


def kendo_style(filters: dict[str, Any], key: str = "Id") -> Callable[[int, int], dict[str, Any]]:
    """{...filters, skip, take, page, pageSize, sort} - orders, inventories, vendors (Kendo grid)."""
    return lambda skip, take: {**filters, "skip": skip, "take": take, "page": skip // take + 1, "pageSize": take,
                               "sort": _sort(key)}


def gz_jsonl(rows: list[dict[str, Any]]) -> bytes:
    """Byte-stable gzip JSONL (mtime 0), so a re-harvest of the same rows has the same sha256."""
    raw = "".join(json.dumps(r, ensure_ascii=False, sort_keys=True) + "\n" for r in rows).encode("utf-8")
    return gzip.compress(raw, compresslevel=6, mtime=0)


def read_gz_jsonl(b: bytes) -> list[dict[str, Any]]:
    return [json.loads(line) for line in gzip.decompress(b).decode("utf-8").splitlines() if line.strip()]


def part_name(dataset: str, n: int) -> str:
    return f"{dataset}.p{n:04d}.jsonl.gz"


def is_archive_file(name: str) -> bool:
    return name in SINGLE_FILES or bool(PART_NAME.match(name or ""))


# --------------------------------------------------------------------------- the dataset catalogue


@dataclass(frozen=True)
class Paged:
    """A list with an Id-like key: paged, Count-verified, written in parts."""
    name: str
    endpoint: str
    body: Callable[[str, str], Callable[[int, int], dict[str, Any]]]  # (from, to) -> body_for(skip, take)
    take: int = 5000
    key: str = "Id"
    pii: bool = False
    note: str = ""


@dataclass(frozen=True)
class Keyless:
    """A roll-up report with no row key: ONE page, refused unless the page holds all Count rows."""
    name: str
    endpoint: str
    body: Callable[[str, str], dict[str, Any]]
    note: str = ""


@dataclass(frozen=True)
class Summary:
    name: str
    endpoint: str
    body: Callable[[str, str], dict[str, Any]]


def _p(filters: Callable[[str, str], dict[str, Any]], key: str | None = "Id"):
    return lambda f, t: page_style(filters(f, t), key)


def _const(d: dict[str, Any]) -> Callable[[str, str], dict[str, Any]]:
    return lambda f, t: dict(d)


# Order matters only for the UI: small reference lists first (the importer needs employees and lookups
# before it can label the big ones), then the big transaction datasets.
PAGED: tuple[Paged, ...] = (
    Paged("employees", "employees", _p(_const({"Name": "", "OnlyManager": False, "HideNotActive": False,
                                                  "HideManager": False})), take=1000, pii=True),
    Paged("users", "users", lambda f, t: flat_style({"Name": "", "Email": ""}), take=1000, pii=True),
    Paged("roles", "roles", lambda f, t: flat_style({"Name": ""}), take=1000),
    Paged("clocks", "clocks", _p(_const({"DeviceIds": [], "EmployeeIds": [], "CheckInDateFrom": None,
                                           "CheckInDateTo": None, "HideCheckOut": False})), take=1000),
    Paged("shifts", "shifts/list", _p(_const({"ShiftNumber": None, "DeviceIds": [], "ShiftDateFrom": None,
                                                "ShiftDateTo": None, "HideClosed": False})), take=1000,
          note="5,000 per page returns zero rows (measured); 1,000 works"),
    Paged("discounts", "discounts", _p(_const({"DiscountName": "", "HideNotActive": False})), take=1000),
    Paged("promotions", "promotions", _p(_const({"PromotionName": "", "HideNotActive": False, "DateFrom": None,
                                                   "DateTo": None})), take=1000),
    Paged("loyalty_rules", "loyalty-program-rules", _p(_const({"LoyaltyProgramRuleName": "",
                                                                "HideNotActive": False})), take=1000),
    Paged("price_models", "products/price-models", _p(_const({"Name": "", "IsActive": False})), take=1000),
    Paged("categories", "products/categories", _p(_const({"CategoryName": "", "IsActive": False})), take=1000),
    Paged("strains", "products/strains", _p(_const({"StrainName": "", "IsActive": False})), take=5000),
    Paged("brands", "brands", _p(_const({"Name": "", "VendorIds": [], "HideNotActive": False})), take=5000),
    Paged("products", "products", _p(_const({"StrainId": None, "Product": "", "BrandIds": [], "TagIds": [],
                                               "HideMasterProduct": False, "HideNotAvailable": False,
                                               "HideOutOfStock": False, "HideDiscontinued": False,
                                               "InventoryTypeIds": [], "VendorIds": [], "CategoryIds": [],
                                               "ShowNonCannabis": False})), take=2000,
          note="ShowNonCannabis=false is ALL products (17,605); true is non-cannabis only (189)"),
    Paged("storage_locations", "storage-locations", _p(_const({"Name": "", "StorageLocationTypeIds": [],
                                                                "ShowOnlySaleFloor": False})), take=1000),
    Paged("tax_settings", "tax-settings", _p(_const({"Name": ""})), take=1000),
    Paged("vendors", "/vendors", lambda f, t: kendo_style({"Name": "", "LicenseNo": "", "VendorNo": "",
                                                           "Address": "", "HideNotActive": False}), take=1000),
    Paged("vendor_transfers", "transfers/incoming", lambda f, t: flat_style({"Number": None, "VendorIds": [],
                                                                             "StatusIds": [], "DateFrom": None,
                                                                             "DateTo": None}), take=2000,
          note="purchase history: every inbound manifest with vendor, status and Total"),
    Paged("outbound_transfers", "transfers/outbound", lambda f, t: flat_style({"Number": None, "VendorIds": [],
                                                                               "StatusIds": [], "DateFrom": None,
                                                                               "DateTo": None}), take=1000),
    Paged("inbound_transfer_report", "reports/inbound-transfers",
          _p(lambda f, t: {"TransferNumber": "", "InventoryTypeIds": [], "VendorIds": [], "CategoryIds": [],
                           "DateFrom": mdy(f), "DateTo": mdy(t)}), take=5000),
    Paged("vendor_returns", "inventory-returns", _p(_const({"Tsid": "", "VendorIds": [], "ReasonIds": [],
                                                              "HideManifested": False, "FromDate": None,
                                                              "ToDate": None})), take=1000),
    Paged("samples", "samples", _p(_const({"ProductIds": [], "StatusIds": [], "HideCanceled": False})), take=1000,
          note="employee samples (budtender samples) with employee, status and quantity"),
    Paged("cycle_counts", "inventories/cycle-counts",
          lambda f, t: kendo_style({"ccNumber": "", "DateRequested": None, "InventoryIds": [], "ShowPending": False,
                                    "ShowComplete": False, "ShowApproved": False, "ShowPendingCounts": False,
                                    "ShowPassCounts": False, "ShowFailCounts": False, "ShowOverageCounts": False,
                                    "ShowUnderageCounts": False}), take=1000),
    Paged("inventory_discrepancies", "inventories/inventory-discrepancies",
          _p(_const({"Barcode": "", "ProductIds": [], "RegisterIds": [], "HideProcessed": False})), take=1000),
    Paged("loyalty_adjustments", "customers/customer-loyalty-point-adjustment", lambda f, t: kendo_style({}),
          take=1000),
    Paged("inventories", "inventories", lambda f, t: kendo_style({}), take=5000),
    Paged("aging_inventory", "reports/aging-inventory",
          _p(lambda f, t: {"Barcode": "", "ProductIds": [], "VendorIds": [], "BrandIds": [], "CategoryIds": [],
                           "DateFrom": mdy(f), "DateTo": mdy(t)}), take=5000),
    Paged("depleted_inventories", "inventories/depleted-inventories",
          lambda f, t: kendo_style({"Barcode": "", "ProductIds": [], "StorageIds": [], "DisplayIds": []},
                                   key="Barcode"), take=5000, key="Barcode",
          note="no Id; Barcode is unique (26,899 of 26,899, measured)"),
    Paged("shrink", "reports/shrink-report",
          lambda f, t: flat_style({"ReasonIds": [], "StorageIds": [], "EmployeeIds": [], "Barcode": "", "Memo": "",
                                   "DateFrom": mdy(f), "DateTo": mdy(t)}), take=5000,
          note="every inventory adjustment with reason, employee and cost valuation"),
    Paged("customers", "customers", _p(_const({"Name": "", "MmjidNumber": "", "PhoneNumber": "",
                                                 "IsActive": False})), take=1000, pii=True,
          note="5,000 per page times out (HTTP 504, measured); 1,000 works"),
    Paged("loyalty_accrual", "reports/loyalty-point-accrual",
          _p(lambda f, t: {"CustomerIds": [], "EmployeeIds": [], "TypeIds": [], "OrderNo": None,
                           "DateFrom": mdy(f), "DateTo": mdy(t)}), take=5000, pii=True),
    Paged("activity", "activity", _p(_const({"ActivityNumber": None, "ShiftNumber": None, "ActivityTypesIds": [],
                                               "DateFrom": None, "DateTo": None})), take=5000,
          note="register activity: opens, drops, payouts, pay-ins, closes, sales, returns"),
    Paged("sales_lines", "reports/daily-sales-detail", _p(sales_filter), take=5000,
          note="every sold line: employee, payment, discount, tax, cost, returns"),
    Paged("discount_lines", "reports/promotion-details-report",
          _p(lambda f, t: {**sales_filter(f, t), "PromotionIds": [], "DiscountIds": []}), take=5000,
          note="every line's discount: employee, discount type, manager-approved discount"),
    Paged("tax_lines", "reports/tax-report", _p(tax_filter), take=5000),
)

KEYLESS: tuple[Keyless, ...] = (
    Keyless("daily_sales", "reports/daily-sales", lambda f, t: page_style(sales_filter(f, t), None)(0, KEYLESS_MAX)),
    Keyless("weekly_sales", "reports/weekly-sales", lambda f, t: page_style(sales_filter(f, t), None)(0, KEYLESS_MAX)),
    Keyless("monthly_sales", "reports/monthly-sales",
            lambda f, t: page_style(sales_filter(f, t), None)(0, KEYLESS_MAX)),
    Keyless("hourly_sales", "reports/hourly-sales", lambda f, t: page_style(sales_filter(f, t), None)(0, KEYLESS_MAX)),
    Keyless("sales_by_sku", "reports/sales-by-sku", lambda f, t: page_style(sales_filter(f, t), None)(0, KEYLESS_MAX)),
    Keyless("sales_by_category", "reports/sales-by-categories",
            lambda f, t: page_style(sales_filter(f, t), None)(0, KEYLESS_MAX)),
    Keyless("sales_by_inventory_type", "reports/sales-by-inventory-types",
            lambda f, t: page_style(sales_filter(f, t), None)(0, KEYLESS_MAX)),
    Keyless("budtender_performance", "reports/budtender-performance",
            lambda f, t: page_style({"EmployeeIds": [], "DateFrom": mdy(f), "DateTo": mdy(t)}, None)(0, KEYLESS_MAX)),
    Keyless("promotion_report", "reports/promotion-report",
            lambda f, t: page_style({**sales_filter(f, t), "PromotionIds": [], "DiscountIds": []}, None)(0, KEYLESS_MAX)),
    Keyless("tax_setting_report", "reports/tax-setting-report",
            lambda f, t: page_style(tax_filter(f, t), None)(0, KEYLESS_MAX)),
    Keyless("inventory_valuation_by_sku", "reports/inventory-valuation-by-sku",
            lambda f, t: page_style({**inv_filter(), "DateFrom": mdy(f), "DateTo": mdy(t)}, None)(0, KEYLESS_MAX)),
)

SUMMARIES: tuple[Summary, ...] = (
    Summary("sales_details_summary", "reports/sales-details-summary", sales_filter),
    Summary("tax_report_summary", "reports/tax-report-summary", tax_filter),
    Summary("tax_setting_summary", "reports/tax-setting-summary", tax_filter),
    Summary("sales_cannabis_non_cannabis", "reports/sales-cannabis-non-cannabis", sales_filter),
    Summary("sales_medical_non_medical", "reports/sales-medical-non-medical", sales_filter),
    Summary("sales_pre_packaged_vs_bulk", "reports/sales-pre-packaged-vs-bulk", sales_filter),
    Summary("sales_by_sku_summary", "reports/sales-by-sku-summary", sales_filter),
    Summary("sales_by_categories_summary", "reports/sales-by-categories-summary", sales_filter),
    Summary("sales_by_inventory_types_summary", "reports/sales-by-inventory-types-summary", sales_filter),
    Summary("aging_inventory_summary", "reports/aging-inventory-summary",
            lambda f, t: {"Barcode": "", "ProductIds": [], "VendorIds": [], "BrandIds": [], "CategoryIds": [],
                          "DateFrom": mdy(f), "DateTo": mdy(t)}),
    Summary("inbound_transfers_summary", "reports/inbound-transfers-summary",
            lambda f, t: {"TransferNumber": "", "InventoryTypeIds": [], "VendorIds": [], "CategoryIds": [],
                          "DateFrom": mdy(f), "DateTo": mdy(t)}),
    Summary("inventory_valuation_by_sku_summary", "reports/inventory-valuation-by-sku-summary",
            lambda f, t: {**inv_filter(), "DateFrom": mdy(f), "DateTo": mdy(t)}),
    Summary("inventory_valuation_cannabis_non_cannabis", "reports/inventory-valuation-cannabis-non-cannabis",
            lambda f, t: {**inv_filter(), "DateFrom": mdy(f), "DateTo": mdy(t)}),
    Summary("inventory_valuation_medical_non_medical", "reports/inventory-valuation-medical-non-medical",
            lambda f, t: {**inv_filter(), "DateFrom": mdy(f), "DateTo": mdy(t)}),
    Summary("inventory_valuation_pre_packaged_bulk", "reports/inventory-valuation-pre-packaged-bulk",
            lambda f, t: {**inv_filter(), "DateFrom": mdy(f), "DateTo": mdy(t)}),
)

LOOKUPS: tuple[str, ...] = (
    "transaction-status", "activity-operation-types", "payment-methods", "order-origins",
    "inventory-return-reasons", "adjustment-reasons", "employee-sample-status", "loyalty-point-accrual-types",
    "discount-types", "employees", "valuation-snapshot",
)

# The orders grid (voids = IsCanceled, refunds = IsRefunded / IsPartialRefunded, ManagerPinUsed).
ORDERS_ENDPOINT = "orders"
ORDERS_TAKE = 1000


def orders_body(date_from: str | None, date_to: str | None) -> Callable[[int, int], dict[str, Any]]:
    return kendo_style({"FromDate": mdy(date_from) if date_from else None,
                        "ToDate": mdy(date_to) if date_to else None, "HideCanceled": False, "Receipt": None,
                        "TransactionStatusIds": [], "OrderOriginIds": []})


STAGES = ("login", "lookups", "summaries", "keyless", "paged", "orders", "cycle_count_details",
          "valuation_snapshots")


# --------------------------------------------------------------------------- the harvester


class Archive:
    """One archive run. Every write goes to the RunDir; every stage records itself in state.json."""

    def __init__(self, client: PosClient, *, cancelled: Callable[[], bool], clock: Callable[[], float],
                 budget_seconds: float, date_to: str):
        self.c = client
        self.run: RunDir = client.run
        self.cancelled = cancelled
        self.clock = clock
        self.budget = budget_seconds
        self.t0 = clock()
        self.date_from = ARCHIVE_FROM
        self.date_to = date_to
        self.state: dict[str, Any] = self.run.read_json("state.json", {}) or {}
        self.state.setdefault("stages", {})
        self.state.setdefault("datasets", {})

    # -- bookkeeping
    def save(self) -> None:
        self.run.write_json("state.json", self.state)

    def tick(self) -> None:
        """Called before every request: honours cancel and the time budget."""
        if self.cancelled():
            raise ArchiveCancelled("cancelled")
        if not remaining_budget_ok(self.t0, self.clock(), self.budget):
            raise BudgetReached("time budget reached")

    def post(self, endpoint: str, body: Any) -> Any:
        """POST exactly the URL that was measured live: Q + endpoint, verbatim. The back office's own route
        table spells the vendor list "/vendors" (data-api//vendors, measured 2026-11-01: 1,788 of 1,788), so
        the catalogue keeps that spelling rather than guessing that a normalised path behaves the same."""
        self.tick()
        return self.c.json("POST", Q + endpoint, body)

    def ds(self, name: str) -> dict[str, Any]:
        return self.state["datasets"].setdefault(name, {"status": "pending", "parts": [], "rows": 0})

    def write_part(self, name: str, file_name: str, rows: list[dict[str, Any]]) -> None:
        self.run.write_atomic(file_name, gz_jsonl(rows))
        d = self.ds(name)
        d["parts"] = [p for p in d["parts"] if p["name"] != file_name] + [{"name": file_name, "rows": len(rows)}]
        d["rows"] = sum(p["rows"] for p in d["parts"])
        self.save()

    def saved_keys(self, name: str, key: str) -> set[str]:
        keys: set[str] = set()
        for p in self.ds(name)["parts"]:
            for r in read_gz_jsonl(self.run.p(p["name"]).read_bytes()):
                keys.add(str(r.get(key)))
        return keys

    # -- stages
    def stage_lookups(self) -> dict[str, Any]:
        out: dict[str, Any] = {}
        for name in LOOKUPS:
            body = {"Name": None} if name == "valuation-snapshot" else {}
            out[name] = self.post(f"lookup/inventory/{name}", body)
        self.run.write_json("lookups.json", out)
        return {"lookups": len(out)}

    def stage_summaries(self) -> dict[str, Any]:
        out: dict[str, Any] = {}
        for s in SUMMARIES:
            out[s.name] = self.post(s.endpoint, s.body(self.date_from, self.date_to))
        snap = self.latest_snapshot_id()
        if snap is not None:
            out["inventory_valuation_snapshot_summary"] = self.post(
                "reports/inventory-valuation-snapshot-summary", {"InventoryValuationSnapshotId": snap, **inv_filter()})
        out["_window"] = {"from": self.date_from, "to": self.date_to}
        self.run.write_json("summaries.json", out)
        return {"summaries": len(out) - 1}

    def latest_snapshot_id(self) -> int | None:
        snaps = (self.run.read_json("lookups.json", {}) or {}).get("valuation-snapshot") or []
        ids = [int(s["Id"]) for s in snaps if isinstance(s, dict) and isinstance(s.get("Id"), int)]
        return max(ids) if ids else None

    def stage_keyless(self) -> dict[str, Any]:
        done = 0
        reports = list(KEYLESS)
        snap = self.latest_snapshot_id()
        if snap is not None:
            reports.append(Keyless("sales_velocity", "reports/sales-velocity",
                                   lambda f, t: page_style({"InventoryValuationSnapshotId": snap, **inv_filter()},
                                                           None)(0, KEYLESS_MAX)))
        for k in reports:
            d = self.ds(k.name)
            if d["status"] == "done":
                continue
            rows, count = parse_page(self.post(k.endpoint, k.body(self.date_from, self.date_to)))
            if count > KEYLESS_MAX or len(rows) != count:
                raise CultiveraPosError(f"{k.endpoint}: Count {count} but one page held {len(rows)} rows")
            self.write_part(k.name, part_name(k.name, 1), rows)
            d.update(status="done", count=count, endpoint=k.endpoint, kind="keyless")
            self.save()
            done += 1
        return {"reports": done}

    def page_into_parts(self, name: str, endpoint: str, body_for: Callable[[int, int], dict[str, Any]], take: int,
                        key: str, file_for: Callable[[int], str]) -> int:
        """Page a keyed list into parts, resuming after the rows already saved. Returns the server Count."""
        d = self.ds(name)
        seen = self.saved_keys(name, key)
        skip = d["rows"]
        n_part = len(d["parts"])
        buf: list[dict[str, Any]] = []
        count: int | None = d.get("count")
        for _ in range(MAX_PAGES):
            got, count = parse_page(self.post(endpoint, body_for(skip, take)))
            d["count"] = count
            for r in got:
                k = str(r.get(key))
                if k not in seen:
                    seen.add(k)
                    buf.append(r)
            skip += len(got)
            while len(buf) >= PART_ROWS:
                n_part += 1
                self.write_part(name, file_for(n_part), buf[:PART_ROWS])
                buf = buf[PART_ROWS:]
            if not got or skip >= count:
                break
        else:
            raise CultiveraPosError(f"{endpoint}: more than {MAX_PAGES} pages - refusing to loop")
        if buf:
            n_part += 1
            self.write_part(name, file_for(n_part), buf)
        if count is None or len(seen) != count:
            raise CultiveraPosError(f"{endpoint}: Count {count} but {len(seen)} unique rows")
        return count

    def stage_paged(self) -> dict[str, Any]:
        done = 0
        for p in PAGED:
            d = self.ds(p.name)
            if d["status"] == "done":
                continue
            d.update(endpoint=p.endpoint, kind="paged", pii=p.pii, key=p.key, status="running")
            self.save()
            count = self.page_into_parts(p.name, p.endpoint, p.body(self.date_from, self.date_to), p.take, p.key,
                                         lambda n, nm=p.name: part_name(nm, n))
            d.update(status="done", count=count)
            self.save()
            done += 1
        return {"datasets": done}

    def stage_orders(self) -> dict[str, Any]:
        """Monthly windows (a full-history page times out). Each window is Count-verified; the windows'
        total must equal the all-time Count read at the end."""
        d = self.ds("orders")
        d.update(endpoint=ORDERS_ENDPOINT, kind="windowed", pii=True, key="Id")
        first = d.get("firstDay")
        if not first:
            got, total = parse_page(self.post(ORDERS_ENDPOINT, orders_body(None, None)(0, 1)))
            if total == 0:
                d.update(status="done", count=0, windows={})
                self.save()
                return {"orders": 0}
            first = first_day_from_str(str(got[0].get("CreatedAtStr")))
            d["firstDay"] = first
        windows = d.setdefault("windows", {})
        for label, f, t in month_windows(first, self.date_to):
            if windows.get(label, {}).get("status") == "done":
                continue
            rows: list[dict[str, Any]] = []
            seen: set[str] = set()
            skip, count = 0, None
            for _ in range(MAX_PAGES):
                got, count = parse_page(self.post(ORDERS_ENDPOINT, orders_body(f, t)(skip, ORDERS_TAKE)))
                for r in got:
                    k = str(r.get("Id"))
                    if k not in seen:
                        seen.add(k)
                        rows.append(r)
                skip += len(got)
                if not got or skip >= count:
                    break
            if count is None or len(seen) != count:
                raise CultiveraPosError(f"orders {label}: Count {count} but {len(seen)} unique rows")
            fname = f"orders.{label}.jsonl.gz"
            if rows:
                self.write_part("orders", fname, rows)
            windows[label] = {"status": "done", "count": count}
            self.save()
        _, total = parse_page(self.post(ORDERS_ENDPOINT, orders_body(None, None)(0, 1)))
        windowed = sum(w["count"] for w in windows.values())
        if windowed != total:
            raise CultiveraPosError(f"orders: windows hold {windowed} but the all-time Count is {total}")
        d.update(status="done", count=total)
        self.save()
        return {"orders": total, "windows": len(windows)}

    def stage_cycle_count_details(self) -> dict[str, Any]:
        d = self.ds("cycle_count_details")
        d.update(endpoint="inventories/cycle-count-details/{id}", kind="per_parent", key="Id")
        headers = [r for p in self.ds("cycle_counts")["parts"] for r in read_gz_jsonl(self.run.p(p["name"]).read_bytes())]
        done_ids = set(d.setdefault("doneIds", []))
        for h in sorted(headers, key=lambda r: int(r["Id"])):
            hid = int(h["Id"])
            if hid in done_ids:
                continue
            rows = self.post(f"inventories/cycle-count-details/{hid}", {"HeaderId": hid, "DetailIds": []})
            if not isinstance(rows, list):
                raise CultiveraPosError(f"cycle-count-details/{hid}: not a list")
            if int(h.get("ItemCounts") or 0) != len(rows):
                raise CultiveraPosError(f"cycle count {hid}: header says {h.get('ItemCounts')} items, got {len(rows)}")
            if rows:
                self.write_part("cycle_count_details", f"cycle_count_details.cc{hid:05d}.jsonl.gz", rows)
            d["doneIds"] = sorted(done_ids | {hid})
            done_ids.add(hid)
            self.save()
        d.update(status="done", count=d["rows"])
        self.save()
        return {"cycleCounts": len(done_ids)}

    def stage_valuation_snapshots(self) -> dict[str, Any]:
        """Every daily inventory valuation snapshot Cultivera kept (one part per snapshot)."""
        d = self.ds("valuation_snapshot_rows")
        d.update(endpoint="reports/inventory-valuation-snapshot", kind="per_parent", key="Id")
        snaps = (self.run.read_json("lookups.json", {}) or {}).get("valuation-snapshot") or []
        done_ids = set(d.setdefault("doneIds", []))
        for s in sorted(snaps, key=lambda s: int(s["Id"])):
            sid = int(s["Id"])
            if sid in done_ids:
                continue
            body = page_style({"InventoryValuationSnapshotId": sid, **inv_filter()})
            rows: list[dict[str, Any]] = []
            seen: set[str] = set()
            skip, count = 0, None
            for _ in range(MAX_PAGES):
                got, count = parse_page(self.post("reports/inventory-valuation-snapshot", body(skip, 5000)))
                for r in got:
                    k = str(r.get("Id"))
                    if k not in seen:
                        seen.add(k)
                        rows.append(r)
                skip += len(got)
                if not got or skip >= count:
                    break
            if count is None or len(seen) != count:
                raise CultiveraPosError(f"snapshot {sid}: Count {count} but {len(seen)} unique rows")
            if rows:
                for r in rows:
                    r.setdefault("_snapshotLabel", s.get("Value"))
                self.write_part("valuation_snapshot_rows", f"valuation_snapshot_rows.s{sid:05d}.jsonl.gz", rows)
            done_ids.add(sid)
            d["doneIds"] = sorted(done_ids)
            self.save()
        d.update(status="done", count=d["rows"], snapshots=len(done_ids))
        self.save()
        return {"snapshots": len(done_ids)}


def build_manifest(run: RunDir, state: dict[str, Any]) -> dict[str, Any]:
    rows_by_file = {p["name"]: p["rows"] for d in state.get("datasets", {}).values() for p in d.get("parts", [])}
    dataset_of = {p["name"]: name for name, d in state.get("datasets", {}).items() for p in d.get("parts", [])}
    files = []
    for f in sorted(run.root.iterdir()):
        if f.is_file() and f.name not in ("manifest.json", "state.json", "actions.jsonl") and not f.name.endswith(".part"):
            b = f.read_bytes()
            files.append({"name": f.name, "bytes": len(b), "sha256": sha256_bytes(b),
                          "rows": rows_by_file.get(f.name), "dataset": dataset_of.get(f.name)})
    datasets = {name: {k: d.get(k) for k in ("status", "count", "rows", "endpoint", "kind", "pii", "key")}
                for name, d in state.get("datasets", {}).items()}
    return {"kind": KIND, "files": files, "datasets": datasets, "stages": state.get("stages", {}),
            "window": state.get("window"), "startedAt": state.get("startedAt"),
            "finishedAt": state.get("finishedAt"), "status": state.get("status")}


def run_archive(client: PosClient, *, cancelled: Callable[[], bool] = lambda: False,
                clock: Callable[[], float] = time.time, budget_seconds: float = 10_800.0,
                date_to: str | None = None) -> dict[str, Any]:
    """Run (or resume) the archive. Never raises for a Cultivera problem: it is recorded in state.json
    (status failed / paused / cancelled) and a rerun resumes every finished stage, dataset, part and window."""
    a = Archive(client, cancelled=cancelled, clock=clock, budget_seconds=budget_seconds,
                date_to=date_to or pacific_today(clock()))
    st = a.state
    # The window is fixed by the FIRST attempt so a resume next day never mixes two windows.
    st.setdefault("window", {"from": a.date_from, "to": a.date_to})
    a.date_from, a.date_to = st["window"]["from"], st["window"]["to"]
    st.setdefault("startedAt", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(clock())))
    st["status"] = "running"
    st.pop("error", None)
    a.save()
    try:
        for stage in STAGES:
            if st["stages"].get(stage, {}).get("status") == "done" and stage != "login":
                continue
            s0 = clock()
            if stage == "login":
                a.tick()
                client.login()
                result: dict[str, Any] = {}
            else:
                result = getattr(a, f"stage_{stage}")()
            st["stages"][stage] = {"status": "done", "seconds": round(clock() - s0, 1), **result,
                                   "endedPacific": pacific_wall(clock())}
            a.save()
        st["status"] = "done"
    except ArchiveCancelled:
        st["status"] = "cancelled"
        st["error"] = "cancelled - press Resume to continue where it stopped"
    except BudgetReached:
        st["status"] = "paused"
        st["error"] = "the time budget was reached - press Resume to continue where it stopped"
    except (CultiveraPosError, CultiveraPosRefused) as e:
        st["status"] = "failed"
        st["error"] = str(e)[:500]
    except Exception as e:  # noqa: BLE001 - recorded, never a half-written state
        st["status"] = "failed"
        st["error"] = f"unexpected {type(e).__name__}: {str(e)[:400]}"
    st["finishedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(clock()))
    st["calls"] = client.calls
    a.save()
    manifest = build_manifest(a.run, st)
    a.run.write_json("manifest.json", manifest)
    client.log(action="archive_end", status=st["status"], calls=client.calls)
    return manifest


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
