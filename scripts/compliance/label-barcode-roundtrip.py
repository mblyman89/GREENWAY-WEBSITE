"""D177 S2: decode every Label Studio barcode case with zxing-cpp, rasterised at the PRINTER's dpi.

  npx tsx scripts/compliance/label-barcode-dump.ts /tmp/label-rt
  python3 scripts/compliance/label-barcode-roundtrip.py /tmp/label-rt   (pip install zxing-cpp cairosvg pillow)

Each SVG is sized in real inches, so rendering it at dpi=<printer dpi> gives one PNG pixel per printer dot —
exactly what the thermal head lays down. Writes tests/fixtures/label-studio/roundtrip.json; the vitest suite
checks that fixture against the live encoder (svgSha256). Exit 1 if any case fails to decode to its payload.
"""
import io, json, sys
import cairosvg, zxingcpp
from PIL import Image
from importlib.metadata import version

WANT = {"code128": ["Code128"], "qr": ["QRCode"], "upc_ean": ["UPCA", "EAN13", "EAN8"]}
d = sys.argv[1] if len(sys.argv) > 1 else "/tmp/label-rt"
idx = json.load(open(f"{d}/index.json"))
bad = 0
for it in idx:
    png = cairosvg.svg2png(url=f"{d}/{it['id']}.svg", dpi=it["dpi"], background_color="white")
    img = Image.open(io.BytesIO(png)).convert("L")
    # Add a white border so the symbol's own quiet zone is the only one it relies on being inside the SVG.
    canvas = Image.new("L", (img.width + 40, img.height + 40), 255)
    canvas.paste(img, (20, 20))
    # UPC-A is a subset of EAN-13 (same bars, implied leading 0); zxing reports EAN-13 unless asked for
    # UPC-A specifically, so a 12-digit payload is decoded with the UPC-A format restriction.
    if it["symbology"] == "upc_ean" and len(it["payload"]) == 12:
        got = zxingcpp.read_barcodes(canvas, formats=zxingcpp.BarcodeFormat.UPCA)
    else:
        got = zxingcpp.read_barcodes(canvas)
    it["zxing"] = got[0].text if got else None
    it["format"] = got[0].format.name if got else None
    it["rasterPx"] = [img.width, img.height]
    text = got[0].text if got else None
    # zxing-cpp returns a UPC-A as 13 digits with the implied leading 0 (format UPCA). Only when the
    # decoder itself says UPCA is that 0 dropped for the comparison; the raw text stays in "zxing".
    if got and got[0].format.name == "UPCA" and text and len(text) == 13 and text[0] == "0":
        text = text[1:]
    it["decoded"] = text
    it["ok"] = len(got) == 1 and text == it["payload"] and any(w == got[0].format.name for w in WANT[it["symbology"]])
    bad += not it["ok"]
    print("OK " if it["ok"] else "BAD", it["id"], it["format"], it["zxing"], it["rasterPx"])
out = {
    "_about": f"D177 S2: every Label Studio barcode case (src/lib/printing/label-barcode-cases.ts) was rasterised by cairosvg at the printer's own dpi (one pixel per printer dot) and decoded with zxing-cpp {version('zxing-cpp')}, an independent decoder. svgSha256 pins the exact drawing. If it changes, re-run scripts/compliance/label-barcode-roundtrip.py.",
    "items": idx,
}
json.dump(out, open("tests/fixtures/label-studio/roundtrip.json", "w"), indent=2, ensure_ascii=False)
sys.exit(1 if bad else 0)
