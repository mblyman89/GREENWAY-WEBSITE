"""R50 S11b: decode every scanner setup barcode the count page draws, with zxing-cpp.

  npx tsx scripts/compliance/scanner-barcode-dump.ts /tmp/scanner-rt
  python3 scripts/compliance/scanner-barcode-roundtrip.py /tmp/scanner-rt   (pip install zxing-cpp cairosvg pillow)

Writes tests/fixtures/scanner/roundtrip.json. The vitest suite checks that fixture against the live encoder.
Exit 1 if any barcode does not decode to exactly its payload as Code 128.
"""
import io, json, sys
import cairosvg, zxingcpp
from PIL import Image
from importlib.metadata import version

d = sys.argv[1] if len(sys.argv) > 1 else "/tmp/scanner-rt"
idx = json.load(open(f"{d}/index.json"))
bad = 0
for it in idx:
    png = cairosvg.svg2png(url=f"{d}/{it['id']}.svg", scale=2, background_color="white")
    got = zxingcpp.read_barcodes(Image.open(io.BytesIO(png)).convert("L"))
    it["zxing"] = got[0].text if got else None
    it["format"] = got[0].format.name if got else None
    want = "QRCode" if it.get("symbology") == "qr" else "Code128"  # R74 S12: Alacrity draws QR
    it["ok"] = len(got) == 1 and got[0].text == it["payload"] and want in got[0].format.name
    bad += not it["ok"]
    print("OK " if it["ok"] else "BAD", it["id"], it["zxing"])
out = {
    "_about": f"R50 S11b: each scanner setup barcode the count page draws (Code 128; QR for the Alacrity, R74 S12) was rasterised (cairosvg, scale 2) and decoded with zxing-cpp {version('zxing-cpp')}, an independent decoder. svgSha256 pins the exact drawing. If it changes, re-run scripts/compliance/scanner-barcode-roundtrip.py.",
    "items": idx,
}
json.dump(out, open("tests/fixtures/scanner/roundtrip.json", "w"), indent=2, ensure_ascii=False)
sys.exit(1 if bad else 0)
