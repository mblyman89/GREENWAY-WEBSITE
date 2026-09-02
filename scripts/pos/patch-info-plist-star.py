#!/usr/bin/env python3
"""
SLICE 10 - add the two Info.plist keys the Star TSP143IIIBi requires.

WHY A SCRIPT AND NOT A HAND EDIT
--------------------------------
Info.plist is XML that Xcode also rewrites. A hand edit is a one-time act with
no record of intent; this script is idempotent, so it can be re-run after any
Capacitor sync or Xcode change and will either apply the keys or say "no
change". It refuses to run twice-over, and it re-parses the file with plistlib
afterwards so a malformed plist can never be committed.

THE TWO KEYS, AND WHY EACH ONE IS NOT OPTIONAL
----------------------------------------------
1. UISupportedExternalAccessoryProtocols = ["jp.star-m.starpro"]
   VERIFIED: StarXpand-SDK-iOS README section 2.1, "Set Supported external
   accessory protocols", Item 0 = jp.star-m.starpro.
   The TSP143IIIBi is Bluetooth CLASSIC (MFi/iAP2), not Bluetooth LE. iOS will
   not open an External Accessory session to an MFi accessory unless the app
   declares the accessory's protocol here. Without it the printer is not
   "broken" - it is INVISIBLE, with no error naming the cause. That silent,
   device-only failure is exactly what the preflight is for.

2. NSBluetoothAlwaysUsageDescription
   VERIFIED: StarXpand-SDK-iOS README section 2.2. Since iOS 13 an app that
   touches Bluetooth without this key is TERMINATED by the OS on first use.
   The string is shown verbatim to the budtender in the permission alert, so
   it is written for them and names the thing on the counter.

The indentation is a single TAB, matching the surrounding file byte-for-byte
(confirmed with `cat -A` before writing this). Do not "tidy" it to spaces.
"""

import io
import plistlib
import sys

PLIST = "ios/App/App/Info.plist"

EA_PROTOCOL = "jp.star-m.starpro"
BT_USAGE = (
    "Greenway uses Bluetooth to print receipts and open the cash drawer "
    "on the counter receipt printer."
)

# Anchors are exact byte sequences from the real file (single-tab indented).
BT_ANCHOR = "\t<key>LSRequiresIPhoneOS</key>\n\t<true/>\n"
BT_BLOCK = (
    "\t<key>NSBluetoothAlwaysUsageDescription</key>\n"
    "\t<string>" + BT_USAGE + "</string>\n"
)

EA_ANCHOR = (
    "\t<key>UIRequiredDeviceCapabilities</key>\n"
    "\t<array>\n"
    "\t\t<string>arm64</string>\n"
    "\t</array>\n"
)
EA_BLOCK = (
    "\t<key>UISupportedExternalAccessoryProtocols</key>\n"
    "\t<array>\n"
    "\t\t<string>" + EA_PROTOCOL + "</string>\n"
    "\t</array>\n"
)


def main() -> int:
    original = io.open(PLIST, encoding="utf-8").read()
    text = original
    changes = []

    if "NSBluetoothAlwaysUsageDescription" not in text:
        if BT_ANCHOR not in text:
            print("FAIL: could not find the LSRequiresIPhoneOS anchor", file=sys.stderr)
            return 1
        text = text.replace(BT_ANCHOR, BT_ANCHOR + BT_BLOCK, 1)
        changes.append("NSBluetoothAlwaysUsageDescription")

    if "UISupportedExternalAccessoryProtocols" not in text:
        if EA_ANCHOR not in text:
            print("FAIL: could not find the UIRequiredDeviceCapabilities anchor", file=sys.stderr)
            return 1
        text = text.replace(EA_ANCHOR, EA_ANCHOR + EA_BLOCK, 1)
        changes.append("UISupportedExternalAccessoryProtocols")

    if not changes:
        print("no-op: both Star keys are already present, nothing written")
        return 0

    io.open(PLIST, "w", encoding="utf-8").write(text)

    # Prove the file is still a valid plist and that the values are what we meant.
    d = plistlib.load(open(PLIST, "rb"))
    assert d["UISupportedExternalAccessoryProtocols"] == [EA_PROTOCOL], d.get(
        "UISupportedExternalAccessoryProtocols"
    )
    assert d["NSBluetoothAlwaysUsageDescription"] == BT_USAGE
    assert d["UIRequiredDeviceCapabilities"] == ["arm64"], "SLICE 9 arm64 fix must survive"
    assert d["ITSAppUsesNonExemptEncryption"] is False, "SLICE 9 encryption key must survive"

    print("added: " + ", ".join(changes))
    print("plist re-parsed OK, " + str(len(d)) + " keys")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
