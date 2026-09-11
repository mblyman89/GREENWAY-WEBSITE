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
    echo "  SKIPPED (pattern not found): $label"
    SURVIVED=$((SURVIVED + 1))
    return
  fi
  if python3 "$target" selftest >/dev/null 2>&1; then
    echo "  SURVIVED: $label"
    SURVIVED=$((SURVIVED + 1))
  else
    echo "  caught:   $label"
    CAUGHT=$((CAUGHT + 1))
  fi
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
mutate "HDMI mistaken for the analog jack again" \
  '"is_headphone": (not is_hdmi) and ("headphone" in blob or "bcm2835" in blob),' \
  '"is_headphone": ("headphone" in blob or "bcm2835" in blob),'
# 11. Stop recognising the analog jack at all -> no buzz advice is ever given.
mutate "analog jack never detected" \
  '"is_headphone": (not is_hdmi) and ("headphone" in blob or "bcm2835" in blob),' \
  '"is_headphone": False,'
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
  'if usb:
            notes.append(
                "Better fix: this Pi already has another audio output. Use it: "' \
  'if False:
            notes.append(
                "Better fix: this Pi already has another audio output. Use it: "'
# 23. Do not name which output to switch to.
mutate "existing USB output not named" \
  "f\"sudo ./install.sh --site <your-site> --audio-device {usb[0]['alsa']}\"" \
  '"sudo ./install.sh --site <your-site>"'
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
  '    if using_analog or (analog and not chosen):' \
  '    if True:'
# 27. Never give the analog advice, even when the analog jack IS in use.
mutate "analog advice never triggered" \
  '    if using_analog or (analog and not chosen):' \
  '    if False:'
# 28. Break the match between the chosen device and the detected analog jack.
mutate "chosen device never matches the analog jack" \
  '        for d in analog:' \
  '        for d in []:'
# 29. Match on the wrong key so a chosen "plughw:0,0" stops being recognised.
mutate "chosen device compared against the wrong field" \
  '            if chosen in (d["alsa"], ' \
  '            if chosen in (d["name"], '

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
