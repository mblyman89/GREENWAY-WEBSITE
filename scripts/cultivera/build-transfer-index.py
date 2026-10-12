#!/usr/bin/env python3
"""
R50 S1b — build normalized_cultivera/TRANSFERS_INDEX.json from a read-only Cultivera POS harvest.

Input  : <harvest>/transfer_details.jsonl  (one GET data-api/transfers/incoming/{id}/detail per line)
Output : a compact, deterministic index of every inbound transfer (the vendor's real manifest) with the
         lines' barcodes and accepted quantities. Deliberately EXCLUDED (public repo): prices, totals,
         addresses, employee names, the WCIA file path, the token. Only what the matcher needs.

Usage  : python3 scripts/cultivera/build-transfer-index.py <harvest_dir> <harvested_at_iso>
"""
import hashlib, json, sys

def main(src: str, harvested_at: str) -> None:
    raw = open(f"{src}/transfer_details.jsonl", "rb").read()
    out = []
    for line in raw.decode("utf-8").splitlines():
        d = json.loads(line)
        lines = []
        for it in d.get("Details") or []:
            bc = (it.get("Barcode") or "").strip()
            if not bc:
                continue
            lines.append([bc, float(it.get("AcceptedQuantity") or 0), float(it.get("Quantity") or 0), bool(it.get("IsSample"))])
        lines.sort()
        out.append({
            "id": d["Id"],
            "number": d.get("TransferNumber") or "",
            "vendor": " ".join((d.get("FromVendor") or "").split()),
            "vendorNo": d.get("VendorNo") or "",
            "transferDate": d.get("TransferDate"),
            "acceptedAt": d.get("DateAccepted"),
            "status": d.get("StatusDisplay") or "",
            "manual": bool(d.get("IsManualCreated")),
            "internal": bool(d.get("IsInternalTransfer")),
            "lines": lines,
        })
    out.sort(key=lambda t: t["id"])
    doc = {
        "source": "Cultivera POS back office, GET data-api/transfers/incoming/{id}/detail (read-only)",
        "harvestedAt": harvested_at,
        "sourceSha256": hashlib.sha256(raw).hexdigest(),
        "lineColumns": ["barcode", "acceptedQuantity", "quantity", "isSample"],
        "timeZoneOfAcceptedAt": "UTC (ISO 'Z')",
        "transfers": out,
    }
    sys.stdout.write(json.dumps(doc, ensure_ascii=False, separators=(",", ":")))

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
