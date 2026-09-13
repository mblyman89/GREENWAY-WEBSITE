#!/usr/bin/env bash
#
# mutation-vretti-setup.sh
#
# Tests the tests.
#
# src/lib/printing/vretti-setup-core.ts is the hand-holding walkthrough the
# owner reads in the back office while standing in front of the vretti printer
# and a Raspberry Pi. It ships with 61 self-checks. Green self-checks are not
# evidence on their own: a suite that asserts things which remain true no
# matter how the guide is broken is a reassurance with nothing behind it.
#
# So we break the guide on purpose, one fault at a time, and require the suite
# to notice. A surviving mutant is a hole in the net, and the script fails
# loudly so it is fixed here rather than at 9pm with a printer that will not
# print and instructions that lie.
#
# The faults chosen are the ways this guide could actually waste his evening:
#
#   1.  A placeholder site address leaks into a copyable command, so the
#       install runs for a minute and then fails in a way that reads like
#       broken hardware.
#   2.  The literal word YOUR-TOKEN ships even though a real token exists --
#       the installer authenticates as nobody and the printer never prints.
#   3.  Worse than a placeholder: "null" is carried into --token, which looks
#       like a real value and fails silently.
#   4.  The wrong installer flag (--code belongs to the ANNOUNCER) is used, so
#       the printer installer rejects the command outright.
#   5.  The install command is fetched from the announcer's path, installing
#       entirely the wrong software on the Pi.
#   6.  A subcommand the agent does not implement is handed out, so a
#       troubleshooting step he trusts errors out when he needs it most.
#   7.  The systemd service name drifts from what the installer registers, so
#       every "is it running?" command reports nothing at all.
#   8.  The device path drifts from what the agent opens, so the single most
#       important diagnostic check is checking the wrong thing.
#   9.  Step numbers stop being sequential, so "Step 6" on screen is not the
#       sixth thing he does.
#   10. A step loses its "if it goes wrong" text -- the rung of the ladder
#       that matters most is the one that catches you when you slip.
#   11. The thermal paper stops being flagged critical, so the one consumable
#       that stops the shop printing is listed as optional.
#
# Usage: bash scripts/compliance/mutation-vretti-setup.sh
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TARGET="$ROOT/src/lib/printing/vretti-setup-core.ts"
BACKUP="$(mktemp)"
RUNNER="$(mktemp /tmp/vretti-mutant-XXXXXX.ts)"
OUTFILE="$(mktemp /tmp/vretti-mutant-out-XXXXXX.txt)"

cleanup() {
  # Always put the real file back, even if we are killed part-way through.
  if [ -f "$BACKUP" ]; then cp "$BACKUP" "$TARGET"; fi
  rm -f "$BACKUP" "$RUNNER" "$OUTFILE"
}
trap cleanup EXIT INT TERM

cp "$TARGET" "$BACKUP"

cat > "$RUNNER" <<EOF
import { __runVrettiSetupTests } from "$TARGET";
__runVrettiSetupTests();
EOF

KILLED=0
SURVIVED=0

# Returns 0 if the suite PASSED (mutant survived), non-zero if it FAILED.
# __runVrettiSetupTests throws on failure, so tsx exits non-zero for us.
run_suite() {
  npx tsx "$RUNNER" > "$OUTFILE" 2>&1
  return $?
}

# apply_mutant <name> <perl-expression>
apply_mutant() {
  local name="$1"
  local expr="$2"

  cp "$BACKUP" "$TARGET"

  # Prove the edit landed. A mutation script whose pattern silently matched
  # nothing reports a perfect score while testing nothing at all, which is
  # worse than having no mutation script.
  perl -0pi -e "$expr" "$TARGET"
  if cmp -s "$BACKUP" "$TARGET"; then
    echo "HARNESS BROKEN: mutant '$name' changed nothing - the pattern no longer matches the source."
    cleanup
    exit 2
  fi

  if run_suite; then
    echo "  SURVIVED: $name"
    SURVIVED=$((SURVIVED + 1))
  else
    echo "  killed:   $name"
    KILLED=$((KILLED + 1))
  fi
}

# Mutate ONLY the half of the file above the self-tests, so a mutant can never
# rewrite the assertion that judges it. Mutate the subject, never the judge.
subject_only() {
  local body="$1"
  echo 'my $m = "export function __runVrettiSetupTests"; my ($a, $b) = split /\Q$m\E/, $_, 2; '"$body"' $_ = defined $b ? $a . $m . $b : $a;'
}

echo "Mutation testing the vretti setup guide..."
echo

# Sanity: the unmutated file must PASS, or every mutant below is meaningless.
cp "$BACKUP" "$TARGET"
if ! run_suite; then
  echo "HARNESS BROKEN: the unmutated file already fails its own self-tests."
  cat "$OUTFILE"
  cleanup
  exit 2
fi
echo "  baseline: the real file passes its own self-tests"
echo

apply_mutant "a placeholder site address leaks into the install command" \
  "$(subject_only '$a =~ s{--site \$\{siteForCommands\}}{--site https://your-site.com}g;')"

apply_mutant "YOUR-TOKEN ships even though a real token exists" \
  "$(subject_only '$a =~ s{const tokenForCommands = hasToken \? token : "YOUR-TOKEN";}{const tokenForCommands = "YOUR-TOKEN";};')"

apply_mutant "the word null is carried into the install command" \
  "$(subject_only '$a =~ s{const tokenForCommands = hasToken \? token : "YOUR-TOKEN";}{const tokenForCommands = String(opts.pollToken);};')"

apply_mutant "the announcer flag --code is used on the printer installer" \
  "$(subject_only '$a =~ s{--token \$\{tokenForCommands\}}{--code \$\{tokenForCommands\}};')"

apply_mutant "the printer step runs the announcer installer instead" \
  "$(subject_only '$a =~ s{sudo \./install-printer\.sh --site}{sudo ./install.sh --site};')"

# The guide deliberately runs the installer from the clone already on the Pi,
# because install-printer.sh then uses the copy sitting next to it and
# downloads nothing -- sidestepping the CAPTCHA/HTML-gateway failure both
# installers guard against. Reverting to curl-pipe-bash must not go unnoticed.
apply_mutant "the install reverts to piping a download straight into a shell" \
  "$(subject_only '$a =~ s{sudo \./install-printer\.sh --site \$\{siteForCommands\}}{curl -fsSL \$\{siteForCommands\}/printer/install-printer.sh | sudo bash -s -- --site \$\{siteForCommands\}};')"

# `./install-printer.sh` only resolves from the folder that holds it.
apply_mutant "the guide stops saying which folder to stand in" \
  "$(subject_only '$a =~ s{command: \`cd \$\{agentDir\}\`,}{command: \"pwd\",};')"

# `~` belongs to root under sudo, not to the Pi user.
apply_mutant "a tilde path is used where sudo would resolve it to /root" \
  "$(subject_only '$a =~ s{const agentDir = \`\$\{repoDir\}/pi-agent\`;}{const agentDir = \"~/GREENWAY-WEBSITE/pi-agent\";};')"

# The shop Pi is not a factory-default Pi.
apply_mutant "the SSH step goes back to the factory-default pi@raspberrypi" \
  "$(subject_only '$a =~ s{export const DEFAULT_PI_USER = \"greenway-office\";}{export const DEFAULT_PI_USER = \"pi\";}; $a =~ s{export const DEFAULT_PI_HOST = \"greenway-office\.local\";}{export const DEFAULT_PI_HOST = \"raspberrypi.local\";};')"

# Keep-awake lives inside install.sh, so a git pull alone applies nothing.
apply_mutant "the update section stops re-running the installer that applies keep-awake" \
  "$(subject_only '$a =~ s{command: \`sudo \./install\.sh --site \$\{siteForCommands\}\`,}{command: \"git pull\",};')"

apply_mutant "the update section stops verifying that keep-awake took" \
  "$(subject_only '$a =~ s{command: \"systemctl is-enabled greenway-keep-awake\",}{command: \"systemctl is-enabled greenway-printer\",};')"

apply_mutant "a subcommand the agent does not implement is handed out" \
  "$(subject_only '$a =~ s{sudo greenway-printer status}{sudo greenway-printer diagnose};')"

apply_mutant "the service name drifts from what the installer registers" \
  "$(subject_only '$a =~ s{systemctl restart greenway-printer}{systemctl restart greenway-print};')"

apply_mutant "the device path drifts from what the agent opens" \
  "$(subject_only '$a =~ s{/dev/usb/lp0}{/dev/usb/lp1}g;')"

apply_mutant "step numbers stop being sequential" \
  "$(subject_only '$a =~ s{number: 6,}{number: 60,};')"

apply_mutant "a step loses its if-it-goes-wrong safety net" \
  "$(subject_only '$a =~ s{ifItGoesWrong:\s*\n?\s*"[^"]{20,}?"}{ifItGoesWrong: undefined}s;')"

apply_mutant "thermal paper stops being flagged critical" \
  "$(subject_only '$a =~ s{(thermal paper rolls[\s\S]{0,800}?critical: )true}{\${1}false}i;')"

echo
echo "Mutants killed:   $KILLED"
echo "Mutants survived: $SURVIVED"
echo

if [ "$SURVIVED" -ne 0 ]; then
  echo "FAILED: $SURVIVED mutant(s) survived. The self-tests do not actually cover those faults."
  exit 1
fi

echo "PASSED: every mutant was caught."
