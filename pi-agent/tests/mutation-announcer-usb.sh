#!/usr/bin/env bash
#
# Testing the tests: mutate the USB-vs-aux output selection.
#
#   bash pi-agent/tests/mutation-announcer-usb.sh
#
# Every mutation below is a plausible wrong version of the audio-output logic
# that makes the shop play through the wrong socket -- or through nothing at
# all. Each one MUST be caught by the agent's own selftest. A mutation that
# survives means the selftest is decoration and would not have stopped the
# original fault (a working USB dongle ignored in favour of the noisy jack, or
# HDMI on a headless Pi) from shipping again.
#
# Nothing here touches the real agent: every mutation is applied to a COPY in a
# temp directory, which is deleted on exit.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
AGENT="$HERE/../greenway_announcer.py"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
CAUGHT=0
SURVIVED=0

if [ ! -f "$AGENT" ]; then
  echo "Cannot find the agent at $AGENT"
  exit 1
fi

# Baseline: the real file must pass, otherwise every result below is noise.
if ! python3 "$AGENT" selftest >/dev/null 2>&1; then
  echo "BASELINE FAILED: the real agent does not pass its own selftest."
  exit 1
fi
echo "baseline OK - the unmutated agent passes"
echo ""

mutate () {
  local label="$1" from="$2" to="$3"
  local target="$WORK/mutant.py"
  cp "$AGENT" "$target"
  if ! python3 - "$target" "$from" "$to" <<'PY'
import sys
path, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
text = open(path, encoding="utf-8").read()
if old not in text:
    sys.exit(3)
open(path, "w", encoding="utf-8").write(text.replace(old, new, 1))
PY
  then
    echo "  SKIPPED (pattern not found -> COUNTS AS SURVIVED, re-anchor it): $label"
    SURVIVED=$((SURVIVED + 1))
    return
  fi
  # The selftest is the first net. Some rules live in cmd_test(), which the
  # selftest never executes, so the end-to-end shell test is the second net.
  # A mutant is only "caught" if SOMETHING goes red; it survives only when
  # every net lets it through.
  if ! python3 "$target" selftest >/dev/null 2>&1; then
    echo "  caught:   $label"
    CAUGHT=$((CAUGHT + 1))
    return
  fi
  if ! AGENT_UNDER_TEST="$target" bash "$HERE/test_audio_output_saved.sh" >/dev/null 2>&1; then
    echo "  caught:   $label  (by the end-to-end save test)"
    CAUGHT=$((CAUGHT + 1))
    return
  fi
  echo "  SURVIVED: $label"
  SURVIVED=$((SURVIVED + 1))
}

echo "Mutating how a USB dongle is recognised:"
# 1. The original bug, restored: USB is not a category, only "not the others".
mutate "USB never identified (back to guessing by elimination)" \
  '        is_usb = ("usb" in blob) or ("uac" in blob)' \
  '        is_usb = False'
# 2. Claim everything is USB -> the jack and HDMI both masquerade as the dongle.
mutate "every output claimed to be USB" \
  '        is_usb = ("usb" in blob) or ("uac" in blob)' \
  '        is_usb = True'
# 3. Drop the UAC spelling that some branded adapters report.
mutate "UAC-style adapters no longer recognised" \
  '        is_usb = ("usb" in blob) or ("uac" in blob)' \
  '        is_usb = ("uac" in blob)'

echo ""
echo "Mutating the stable (reboot-proof) address:"
# 4. Go back to position-based addressing, which breaks on renumbering.
mutate "stable name downgraded to a card NUMBER (breaks after reboot)" \
  '                "stable": f"plughw:CARD={card_id},DEV={match.group(4)}",' \
  '                "stable": f"plughw:{match.group(1)},{match.group(4)}",'
# 5. Point the stable name at the wrong card entirely.
mutate "stable name points at the wrong device index" \
  '                "stable": f"plughw:CARD={card_id},DEV={match.group(4)}",' \
  '                "stable": f"plughw:CARD={card_id},DEV=9",'

echo ""
echo "Mutating the preference order (USB > jack > other > HDMI):"
# 6. HDMI first: the exact configuration that plays silence on a headless Pi.
mutate "HDMI promoted to first choice" \
  '    order = {"usb": 0, "headphone": 1, "other": 2, "hdmi": 3}' \
  '    order = {"hdmi": 0, "usb": 1, "headphone": 2, "other": 3}'
# 7. The jack beats the dongle: the reported fault, reintroduced.
mutate "the noisy 3.5mm jack preferred over the USB dongle" \
  '    order = {"usb": 0, "headphone": 1, "other": 2, "hdmi": 3}' \
  '    order = {"headphone": 0, "usb": 1, "other": 2, "hdmi": 3}'
# 8. Flatten the order so ranking is meaningless.
mutate "all outputs ranked equal (order becomes arbitrary)" \
  '    order = {"usb": 0, "headphone": 1, "other": 2, "hdmi": 3}' \
  '    order = {"usb": 0, "headphone": 0, "other": 0, "hdmi": 0}'
# 9. Misclassify the dongle so it sorts as an unknown add-on card.
mutate "USB bucket never returned by output_kind" \
  '    if device.get("is_usb"):
        return "usb"' \
  '    if False:
        return "usb"'

echo ""
echo "Mutating the explicit-choice rules:"
# 10. Ignore what the owner configured -> the tool argues with the human.
mutate "a configured device is ignored" \
  '    if configured:
        wanted = configured.strip()' \
  '    if False:
        wanted = (configured or "").strip()'
# 11. Honour a configured device even when it is NOT plugged in -> silence.
mutate "a configured device that is gone is used anyway" \
  '        for d in devices:
            if wanted in _address_forms(d):
                return d' \
  '        for d in devices:
            if wanted:
                return d'
# 12. Only accept one spelling, so an upgraded config stops matching.
mutate "stable CARD= spellings no longer match an old config" \
  '        f"plughw:CARD={cid},DEV={dev}",' \
  '        f"plughw:CARD={cid},DEV=ignored",'

echo ""
echo "Mutating the play-time fallback (the 'both usb and aux' promise):"
# 13. Only ever try the first output -> pulling the dongle kills the shop.
mutate "fallback gives up after the first output" \
  '    for address in addresses:
        played, detail = player(path, address)
        if played:
            return True, detail, address' \
  '    for address in addresses[:1]:
        played, detail = player(path, address)
        if played:
            return True, detail, address'
# 14. Keep playing through every output even after one worked -> double chime.
mutate "fallback keeps going after it already made a noise" \
  '        if played:
            return True, detail, address' \
  '        if False:
            return True, detail, address'
# 15. Claim success when nothing played -> the silent-but-green failure.
mutate "total failure reported as success" \
  '    return False, "Every audio output failed. " + "; ".join(failures), None' \
  '    return True, "Every audio output failed. " + "; ".join(failures), None'
# 16. Refuse to fall back to the system default when nothing is enumerated.
mutate "no enumerated outputs -> refuses instead of trying the default" \
  '        played, detail = player(path, None)
        return played, detail, None' \
  '        return False, "no outputs", None'
# 17. Lose the fallback list entirely at the chain level.
mutate "playback chain only ever offers one output" \
  '    for d in rank_outputs(devices):
        if first is not None and d is first:
            continue' \
  '    for d in []:
        if first is not None and d is first:
            continue'
# 18. Let duplicates through so the same socket is tried twice.
mutate "duplicate outputs no longer removed from the chain" \
  '        if addr not in seen:
            seen.add(addr)
            unique.append(addr)' \
  '        if True:
            seen.add(addr)
            unique.append(addr)'

echo ""
echo "Mutating 'save only the address you actually proved':"
# 19. Probe the card number but save the stable name -- writing an address into
#     the config that was never played through. This is the defect that a
#     spelling-blind test cannot see: both names usually work, so the config
#     looks right, and the one time they differ the shop goes silent.
mutate "saves a spelling it never tested" \
  '                _persist_working_output(args, worked)' \
  '                _persist_working_output(args, candidate["stable"])'
# 20. Save the positional card number instead of the reboot-proof name, so the
#     speaker works until the next power cut renumbers the cards.
mutate "saves a positional name that breaks on reboot" \
  '    forms = [device.get("stable"), device.get("alsa")]' \
  '    forms = [device.get("alsa"), device.get("stable")]'
# 21. Only ever try one spelling, so a card whose CARD= form cannot be opened
#     is written off as broken even though it works.
mutate "a working output is rejected over its preferred spelling" \
  '    forms = [device.get("stable"), device.get("alsa")]' \
  '    forms = [device.get("stable")]'
# 22. Stop deduping the spellings, so identical names get probed twice and the
#     owner watches the same output fail twice over.
mutate "the same spelling is probed twice" \
  '        if f and f not in out:' \
  '        if f:'

echo ""
echo "Mutating 'use-output accepts the name the tool recommends':"
# 23. Narrow use-output back to card numbers only, so the reboot-proof name
#     printed by `greenway-announcer audio` is rejected by the very command
#     that is supposed to apply it. A dead end with no way out but editing
#     root-owned JSON by hand.
mutate "use-output rejects the name the report recommends" \
  '    if known and not any(device in _address_forms(d) for d in known):' \
  '    if known and not any(d["alsa"] == device for d in known):'
# 24. Accept anything at all. "Accept every spelling" must not decay into "skip
#     validation", or a typo gets saved and the shop goes quiet.
mutate "use-output validates nothing at all" \
  '    if known and not any(device in _address_forms(d) for d in known):' \
  '    if False:'

echo ""
echo "============================================================"
echo "caught: $CAUGHT    survived: $SURVIVED"
if [ "$SURVIVED" -eq 0 ]; then
  echo "MUTATION TESTING PASSED - every broken version was caught."
  exit 0
fi
echo "MUTATION TESTING FAILED - $SURVIVED mutant(s) slipped through."
echo "Those selftests are decoration. Strengthen them."
exit 1
