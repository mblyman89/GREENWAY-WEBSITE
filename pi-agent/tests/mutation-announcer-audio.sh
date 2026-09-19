#!/usr/bin/env bash
#
# Mutation harness for the audio diagnosis and the sudo/permission fix.
#
# Two real field failures are covered here:
#
#   1. `greenway-announcer test` crashed with
#         PermissionError: [Errno 13] Permission denied:
#         '/etc/greenway-announcer/config.json'
#      because Path.exists() RAISES when a parent directory is not searchable
#      (the config dir is mode 700) instead of returning False. Every non-sudo
#      run died with a traceback instead of saying "use sudo".
#
#   2. The first speaker in the field buzzed. The cause was the Pi's PWM analog
#      jack driven too hard, not a fault -- but nothing in the software said so.
#
# A test that cannot fail is not a test. This deliberately breaks each of those
# behaviours and demands that the agent's own selftest notices. A surviving
# mutant means the selftest is decoration.
#
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
AGENT="$HERE/../greenway_announcer.py"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

CAUGHT=0
SURVIVED=0

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
    # A mutation whose anchor no longer exists is NOT a pass. It tests
    # nothing. This is counted as a survivor on purpose, because the code it
    # used to guard has been edited and nobody re-pointed the mutation -- the
    # exact way a suite rots into decoration while still printing green.
    echo "  SKIPPED (pattern not found -> COUNTS AS SURVIVED, re-anchor it): $label"
    SURVIVED=$((SURVIVED + 1))
    return
  fi
  # Two nets. The Python selftest covers the pure logic; the end-to-end shell
  # test covers rules that live inside commands (cmd_test, cmd_use_output)
  # which the selftest never executes. A mutant survives only if BOTH stay
  # green -- otherwise a whole command could be gutted while the suite cheered.
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

echo "Mutating the permission handling (the crash Michael hit):"
# 1. Revert to the exact bug that was shipped: let PermissionError escape.
mutate "PermissionError no longer caught -> the original field crash returns" \
  '    except PermissionError:
        return "denied"' \
  '    except _NeverRaised:
        return "denied"'
# 2. Report a locked-out config as simply absent. This is the subtle one: the
#    user would be told to pair a speaker that is already paired.
mutate "denied collapsed into missing" \
  '        return "denied"' \
  '        return "missing"'
# 3. Report a locked-out config as readable -> callers then crash on read.
mutate "denied reported as readable" \
  '    except PermissionError:
        return "denied"' \
  '    except PermissionError:
        return "readable"'
# 4. A real file must be seen as readable, not guessed at.
mutate "an existing readable file reported as missing" \
  '        return "readable" if path.exists() else "missing"' \
  '        return "missing"'
# 5. Broad OSError must not be mistaken for a permission problem.
mutate "generic OSError mislabelled as denied" \
  '    except OSError:
        return "missing"' \
  '    except OSError:
        return "denied"'

echo ""
echo "Mutating the 'you forgot sudo' message:"
# 6. Stop naming the file that could not be read.
mutate "message no longer names the config file" \
  'settings at {path} (permission denied)' \
  'settings (permission denied)'
# 7. Stop giving the actual fix. "Permission denied" alone helps nobody.
mutate "message no longer gives the sudo command" \
  'f"  sudo greenway-announcer {command}"' \
  '"  (see the documentation)"'
# 8. Give a fixed command instead of the one that failed, so `test` would be
#    told to run `status`.
mutate "message hard-codes the wrong subcommand" \
  'f"  sudo greenway-announcer {command}"' \
  '"  sudo greenway-announcer status"'
# 9. Drop the phrase that explains WHY it is locked.
mutate "message no longer says permission denied" \
  '(permission denied).' \
  '(unavailable).'

echo ""
echo "Mutating the ALSA error diagnosis (the 'Unknown error 524' from the shop):"
# A. Stop recognising 524 at all -> back to printing raw driver noise.
mutate "error 524 no longer recognised" \
  'if "524" in text or "not supported" in text or "no such device" in text:' \
  'if "nothing-matches-this" in text:'
# B. Drop the HDMI explanation, which is the actual cause on a headless Pi.
mutate "HDMI no longer named as the cause" \
  '"This Pi has an HDMI audio output, and HDMI is usually the default. "' \
  '"Something went wrong. "'
# C. Blame HDMI even when the Pi has none.
mutate "HDMI blamed even when there is no HDMI output" \
  '        if hdmi:' \
  '        if True:'
# D. Stop suggesting a working output -> diagnosis with no fix.
mutate "no working output suggested after 524" \
  '        if target:' \
  '        if False:'
# D2. Drop the "no monitor" explanation, which is the reason it fails.
mutate "no longer explains that HDMI needs a monitor attached" \
  '"With no monitor plugged in, HDMI audio cannot open -- which is "' \
  '"HDMI audio cannot open -- which is "'
# E. Recommend the HDMI output that just failed.
mutate "suggests the HDMI output that just failed" \
  '        target = (other or analog or [None])[0]' \
  '        target = (hdmi or other or analog or [None])[0]'
# F. Drop the reassurance.
mutate "no longer says nothing is broken" \
  '"exactly this error. Nothing is broken."' \
  '"exactly this error."'
# G. Lose the busy-device branch (the service holding the sound card).
mutate "busy device no longer recognised" \
  'if "busy" in text or "resource busy" in text:' \
  'if "nothing-matches-busy" in text:'
# H. Busy advice without the commands that fix it.
mutate "busy advice no longer gives the stop command" \
  'sudo systemctl stop greenway-announcer' \
  'stop the service'
# I. Lose the permission branch.
mutate "permission error no longer recognised" \
  'if "permission denied" in text:' \
  'if "nothing-matches-perm" in text:'
# J. Lose the missing-device branch.
mutate "missing device no longer recognised" \
  'if "no such file or directory" in text:' \
  'if "nothing-matches-missing" in text:'
# K. Guess at errors it does not understand. Confident wrong advice is worse
#    than none: it sends somebody chasing a fault that is not there.
mutate "unknown errors are guessed at instead of admitted" \
  '    return None


def diagnose_buzz' \
  '    return "Try a different output."


def diagnose_buzz'

echo ""
echo "Mutating the stale-install warning (why 'audio' said invalid choice):"
# L. Stop noticing that the installed program is older than the source.
mutate "stale install no longer detected" \
  '        if repo_copy.read_bytes() == running.read_bytes():
            return None' \
  '        return None'
# M. Claim everything is stale, including an up-to-date install.
mutate "up-to-date install wrongly reported as stale" \
  '        if repo_copy.read_bytes() == running.read_bytes():' \
  '        if False:'
# N. Drop the key sentence: git pull is not enough.
mutate "no longer explains that git pull is not enough" \
  "  'git pull' updates the folder; it does NOT update the installed program.\\n" \
  "  The program is out of date.\\n"
# O. Drop the command that fixes it.
mutate "stale warning no longer gives the install command" \
  '    sudo ./install.sh --site https://greenwaywebsite1.vercel.app' \
  '    (reinstall it)'

echo ""
echo "Mutating the tone-cache fallback (the second crash of the same family):"
# 30. Let the unwritable-cache crash escape again.
mutate "cache failure no longer caught -> test crashes without sudo" \
  '    except OSError:
        fallback = Path(tempfile.gettempdir()) / "greenway-announcer-sounds"' \
  '    except _NeverRaised:
        fallback = Path(tempfile.gettempdir()) / "greenway-announcer-sounds"'
# 31. Return the unusable directory anyway.
mutate "fallback returns the unwritable directory anyway" \
  '        return fallback' \
  '        return preferred'
# 32. Leave the write-probe file lying in the sounds directory.
mutate "write probe left behind in the cache directory" \
  '        probe.unlink()' \
  '        pass'
# 33. Never verify writability, only existence -> the crash comes back later.
mutate "writability never actually probed" \
  '        probe.write_bytes(b"")' \
  '        pass'
# 34. A raising exists() in ensure_builtin stops regenerating the tone.
mutate "ensure_builtin no longer survives a raising exists()" \
  '    try:
        fresh = path.exists() and path.stat().st_size > 0
    except OSError:' \
  '    try:
        fresh = path.exists() and path.stat().st_size > 0
    except _NeverRaised:'
# 35. Treat an unreadable tone as present -> silence instead of sound.
mutate "unreadable tone treated as already cached" \
  '        fresh = False' \
  '        fresh = True'

echo ""
echo "Mutating the sound-hardware parser:"
# 10. The regression that would mislabel HDMI as the headphone jack on the
#     common layout where both live on the bcm2835 card.
# NOTE: these two anchor on the `is_headphone = ...` ASSIGNMENT, not on the
# dict entry. The classification was lifted out of the dict literal into a
# named local when USB became a first-class category. When that happened these
# two mutations silently reported "SKIPPED (pattern not found)" and stopped
# testing anything at all -- a mutation that cannot find its target is not a
# passing test, it is an absent one. Re-anchored deliberately.
mutate "HDMI mistaken for the analog jack again" \
  'is_headphone = (not is_hdmi) and ("headphone" in blob or "bcm2835" in blob)' \
  'is_headphone = ("headphone" in blob or "bcm2835" in blob)'
# 11. Stop recognising the analog jack at all -> no buzz advice is ever given.
mutate "analog jack never detected" \
  'is_headphone = (not is_hdmi) and ("headphone" in blob or "bcm2835" in blob)' \
  'is_headphone = False'
# 12. Stop recognising HDMI.
mutate "HDMI never detected" \
  'is_hdmi = "hdmi" in blob or "iec958" in blob' \
  'is_hdmi = False'
# 13. Everything becomes HDMI -> a USB dongle would never be recommended.
mutate "every output claimed to be HDMI" \
  'is_hdmi = "hdmi" in blob or "iec958" in blob' \
  'is_hdmi = True'
# 14. Off-by-one in the ALSA address: plughw:0,1 vs plughw:0,0 is the
#     difference between sound and silence.
mutate "card and device numbers swapped in the ALSA name" \
  '"alsa": f"plughw:{match.group(1)},{match.group(4)}",' \
  '"alsa": f"plughw:{match.group(4)},{match.group(1)}",'
# 15. Use hw: instead of plughw: -- hw: fails when the rate needs converting.
mutate "plughw downgraded to hw" \
  '"alsa": f"plughw:{match.group(1)},{match.group(4)}",' \
  '"alsa": f"hw:{match.group(1)},{match.group(4)}",'
# 16. Only ever return the first output found.
mutate "parser returns only one output" \
  '    return devices' \
  '    return devices[:1]'

echo ""
echo "Mutating the buzzing advice:"
# 17. The core reassurance: the PWM jack is noisy by design.
mutate "no longer explains the PWM jack is noisy by design" \
  'PWM-driven and is genuinely noisy' \
  'usually fine'
# 18. Removing this sends somebody out to buy a replacement speaker.
mutate "no longer says the speaker is not broken" \
  'normal for the hardware, not a broken speaker.' \
  'unusual.'
# 19. The single most effective fix, inverted. This would make it worse.
mutate "advice inverted: turn the Pi UP instead of DOWN" \
  "turn the Pi's own volume DOWN to about 80% and turn " \
  "turn the Pi's own volume UP to 100% and turn "
# 20. Drop the speaker-knob half of the fix.
mutate "no longer says to turn the speaker knob up" \
  "the speaker's knob UP. Driving the Pi's jack at 100% is the single most " \
  "the speaker alone. "
# 21. Never suggest the USB dongle that actually cures it.
mutate "USB audio adapter never recommended" \
  'Permanent fix: a $10 USB audio adapter is a real DAC and removes the ' \
  'Permanent fix: contact support. '
# 22. Ignore an output the Pi already has and tell him to buy one.
mutate "existing USB output ignored" \
  '        if usb:' \
  '        if False:'
# 23. Do not name which output to switch to.
mutate "existing USB output not named" \
  "f\"sudo greenway-announcer use-output {usb[0]['stable']}\"" \
  '"sudo greenway-announcer use-output"'
# 23b. Name it with the card number instead of the reboot-proof name. This is
#      the subtle one: the advice still "works" when pasted today and silently
#      points at the wrong card after the next power cut.
mutate "suggested command reverts to an unstable card number" \
  "use-output {usb[0]['stable']}\"" \
  "use-output {usb[0]['alsa']}\""
# 23c. Send him back to the installer for a one-setting change. The old text
#      also carried a "<your-site>" placeholder, so it could not even be
#      pasted without stopping to look something up.
mutate "buzz advice sends him to the installer instead of use-output" \
  "f\"sudo greenway-announcer use-output {usb[0]['stable']}\"" \
  "f\"sudo ./install.sh --site <your-site> --audio-device {usb[0]['stable']}\""

echo ""
echo "Mutating the stale-pin diagnosis (Michael's Sound Blaster fault):"
# 23d. Never mention that a saved card number is overriding a better output.
#      The two lines above it are each individually correct; the fault lives
#      only in the gap between them, so staying quiet hides it completely.
mutate "stale pin never reported" \
  '    stale = stale_pin_advice(devices, chosen)' \
  '    stale = None'
# 23e. Report it but omit the command that fixes it -- diagnosing without
#      offering the fix is the same defect as finding a working output and
#      throwing it away.
mutate "stale pin reported without the fix command" \
  "        f\"        sudo greenway-announcer use-output {best['stable']}\"" \
  '        f"        (ask somebody)"'
# 23f. Recommend the unstable card number, walking him straight back into the
#      same trap he is currently in.
mutate "stale pin fix recommends an unstable card number" \
  "        f\"        sudo greenway-announcer use-output {best['stable']}\"" \
  "        f\"        sudo greenway-announcer use-output {best['alsa']}\""
# 23g. Fire the warning unconditionally, including when the dongle is already
#      pinned. Advice that always fires is nagging, not diagnosis, and trains
#      him to ignore the one time it matters.
mutate "stale pin warns even when the pin is already correct" \
  '    if order.get(output_kind(best), 2) >= order.get(output_kind(pinned), 2):
        return None' \
  '    if False:
        return None'
# 23h. Compare the wrong way round, so it stays silent on a genuinely stale
#      pin and complains about correct ones.
mutate "stale pin comparison inverted" \
  '    if order.get(output_kind(best), 2) >= order.get(output_kind(pinned), 2):' \
  '    if order.get(output_kind(best), 2) <= order.get(output_kind(pinned), 2):'
# 23i. Match the pin with one spelling only, so a config holding the stable
#      name is treated as "not plugged in" and never checked.
mutate "stale pin matches only one spelling" \
  '        if configured.strip() in _address_forms(d):' \
  '        if configured.strip() == d["alsa"]:'
# 24. Lose the idle-buzz (electrical) branch entirely.
mutate "electrical/idle buzz advice dropped" \
  'A buzz that is present even when nothing is playing is electrical, not audio: ' \
  'Buzzing can happen. '
# 25. Lose the too-loud branch.
mutate "too-loud buzz advice dropped" \
  'A buzz ONLY while a sound plays usually means the level is too high. Lower the ' \
  'Sound may vary. '
# 26. Give the PWM excuse even when a real DAC is in use -> wrong diagnosis.
mutate "PWM excuse given even when not using the analog jack" \
  '    if using_analog:' \
  '    if True:'
# 27. Never give the analog advice, even when the analog jack IS in use.
mutate "analog advice never triggered" \
  '    if using_analog:' \
  '    if False:'
# 28. Diagnose the CONFIGURED device rather than the one really in use, so an
#     unplugged dongle suppresses the advice for the jack actually carrying the
#     sound. This is the bug the rewrite removed; prove it stays removed.
mutate "diagnoses the configured device instead of the real one" \
  '    in_use = choose_output(devices, chosen)' \
  '    in_use = choose_output(devices, chosen) if chosen else None'
# 29. Go back to defining USB as "whatever is not headphone and not HDMI", so an
#     I2S HAT gets recommended as though it were the owner's USB dongle.
mutate "USB defined by elimination again instead of positively" \
  '    usb = [d for d in devices if output_kind(d) == "usb"]' \
  '    usb = [d for d in devices if not d["is_headphone"] and not d["is_hdmi"]]'
# 29b. Treat every output as the analog jack, so USB gets the PWM excuse.
mutate "analog detection widened to every output" \
  '    using_analog = in_use is not None and output_kind(in_use) == "headphone"' \
  '    using_analog = in_use is not None'

# --- The audio report screen itself --------------------------------------
# Until these existed, cmd_audio() was never executed by any test, so every
# rule it enforces could be deleted without turning anything red.
# 30. Print outputs in raw probe order, so HDMI or the jack can appear above
#     the dongle and the owner picks the wrong one.
mutate "audio report no longer ranks outputs best-first" \
  '    ranked = rank_outputs(devices)' \
  '    ranked = list(devices)'
# 31. Print card numbers instead of reboot-proof names in the listing.
#     NOTE the anchor: cmd_audio's loop is at 8-space indent, cmd_use_output's
#     near-identical line is at 12. Anchoring on the bare print() hit the wrong
#     function and silently stopped testing this rule -- the reason the harness
#     treats a not-found pattern as SURVIVED rather than skipping it.
mutate "audio report prints unstable card numbers" \
  "    for d in ranked:
        print(f\"  {d['stable']:<28} {describe_choice(d)}\")" \
  "    for d in ranked:
        print(f\"  {d['alsa']:<28} {describe_choice(d)}\")"
# 31b. The same defect in use-output's \"this Pi has:\" listing. It is the
#      error message that tells a stuck owner what to type next, so handing him
#      a card number there sends him straight back into the reboot trap.
mutate "use-output's listing prints unstable card numbers" \
  "        for d in rank_outputs(known):
            print(f\"  {d['stable']:<28} {describe_choice(d)}\")" \
  "        for d in rank_outputs(known):
            print(f\"  {d['alsa']:<28} {describe_choice(d)}\")"
# 32. Drop the fallback chain, hiding the 'both usb and aux' behaviour.
#     ANCHORED ON THE PRINT, NOT JUST THE `if`. A bare `if len(chain) > 1:`
#     anchor silently began matching a DIFFERENT function once auto-pick added
#     a second chain listing earlier in the file -- so this mutation was
#     mutating code no test covered and coming back "survived" for a reason
#     that had nothing to do with the rule it was written to check.
mutate "audio report hides the fallback chain" \
  '    if len(chain) > 1:
        print("\nIf the first output fails, these are tried in order:")' \
  '    if False:
        print("\nIf the first output fails, these are tried in order:")'
# 32b. The same omission on the auto-pick screen. "It is cleared" is a claim;
#      the ordered list is the proof, and it is the only way the owner can
#      confirm auto did what he wanted without walking to the speaker.
mutate "the auto-pick screen hides which outputs it will fall back to" \
  '        if len(chain) > 1:
            print("\nIf that output fails or is unplugged, these are tried in order:")' \
  '        if False:
            print("\nIf that output fails or is unplugged, these are tried in order:")'
# 33. Never warn that the configured output is missing -> the report claims a
#     device that is not plugged in is the one in use.
mutate "audio report never warns about an absent output" \
  '        if not present:' \
  '        if False:'
# 34. Warn on every output, including present ones -> false alarms teach the
#     owner to ignore the warning that matters.
mutate "audio report warns even when the output is present" \
  '        present = any(chosen.strip() in _address_forms(d) for d in devices)' \
  '        present = False'
# 35. Go back to matching only two of the six legitimate spellings, so a
#     correctly configured stable name is reported as unplugged.
mutate "audio report matches only the numbered spelling again" \
  '        present = any(chosen.strip() in _address_forms(d) for d in devices)' \
  '        present = any(chosen.strip() in (d["alsa"], f"hw:{d[\x27card\x27]},{d[\x27device\x27]}") for d in devices)'
# 36. Report the configured device as the one in use, rather than the device
#     that will really play. Silently wrong exactly when it matters most.
mutate "audio report shows the configured device as in use" \
  '    actual = choose_output(devices, chosen)' \
  '    actual = None'

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
