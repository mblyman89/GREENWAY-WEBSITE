#!/usr/bin/env bash
#
# mutation-announcer-setup-guide.sh
#
# Tests the tests.
#
# src/lib/announcer/announcer-setup-core.ts holds the setup walkthrough that
# the owner reads in the back office while standing in front of a Raspberry Pi.
# It ships with 53 self-checks. A passing self-check proves nothing on its own:
# a test suite that asserts things which are true no matter what you do is a
# green light wired to nothing.
#
# So we break the file on purpose, one fault at a time, and demand that the
# suite notice. A mutant that survives is a hole in the net, and the script
# fails loudly so it gets fixed rather than discovered by the owner.
#
# The faults chosen are not random. Each one is a real way this guide could
# hurt someone:
#
#   1-2. A placeholder leaks into a copyable command. The owner pastes
#        "YOUR-SITE" into a terminal, the installer runs for a minute, then
#        fails with something that reads like broken hardware.
#   3.   The pairing code is printed even when there isn't one, so the command
#        carries the word "null" into the installer.
#   4.   The guide tells an already-paired owner to pass --code, which is the
#        exact "should I delete the speaker and start over?" confusion we are
#        trying to end.
#   5.   A step loses its commands, so the walkthrough has a dead rung.
#   6.   Steps stop being numbered in order, so "step 7" on screen is not the
#        seventh thing you do.
#   7.   The critical flag comes off the power supply -- the single most common
#        cause of a Pi that "turns itself off".
#   8.   A section loses its steps entirely.
#
# Usage: bash scripts/compliance/mutation-announcer-setup-guide.sh
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TARGET="$ROOT/src/lib/announcer/announcer-setup-core.ts"
BACKUP="$(mktemp)"
RUNNER="$(mktemp /tmp/setup-mutant-XXXXXX.ts)"

cleanup() {
  # Always put the real file back, even if we are killed part-way through.
  if [ -f "$BACKUP" ]; then cp "$BACKUP" "$TARGET"; fi
  rm -f "$BACKUP" "$RUNNER"
}
trap cleanup EXIT INT TERM

cp "$TARGET" "$BACKUP"

cat > "$RUNNER" <<EOF
import { __runAnnouncerSetupTests } from "$TARGET";
const r = __runAnnouncerSetupTests();
console.log(JSON.stringify(r));
process.exit(r.failed > 0 ? 1 : 0);
EOF

KILLED=0
SURVIVED=0

# Run the suite against whatever is currently on disk.
# Returns 0 if the suite PASSED (mutant survived), 1 if it FAILED (killed).
run_suite() {
  npx tsx "$RUNNER" > /tmp/setup-mutant-out.txt 2>&1
  return $?
}

# apply_mutant <name> <perl-expression>
apply_mutant() {
  local name="$1"
  local expr="$2"

  cp "$BACKUP" "$TARGET"

  # Prove the edit actually landed. A mutation script whose sed silently
  # matched nothing reports a perfect score while testing absolutely nothing,
  # which is a worse outcome than having no mutation script at all.
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

echo "Mutation testing the back-office setup guide..."
echo

# Sanity: the unmutated file must PASS, or every mutant below is meaningless.
cp "$BACKUP" "$TARGET"
if ! run_suite; then
  echo "HARNESS BROKEN: the unmutated file already fails its own self-tests."
  cat /tmp/setup-mutant-out.txt
  cleanup
  exit 2
fi
echo "  baseline: the real file passes its own self-tests"
echo

apply_mutant "placeholder site address leaks into the install command" \
  's{--site \$\{site\}}{--site https://YOUR-SITE.example.com}g'

apply_mutant "placeholder code leaks into the install command" \
  's{--code \$\{code\}}{--code XXXX-XXXX}g'

apply_mutant "the code is printed even when there is no code" \
  's{: `sudo \./install\.sh --site \$\{site\}`;}{: `sudo ./install.sh --site \$\{site\} --code \$\{code\}`;}'

apply_mutant "an already-paired owner is told to pass --code anyway" \
  's{\? `sudo \./install\.sh --site \$\{site\}`\n}{? `sudo ./install.sh --site \$\{site\} --code \$\{code ?? ""\}`\n}'

apply_mutant "step numbers are no longer sequential" \
  's{number: 7,}{number: 70,}'

apply_mutant "a step loses the explanation of why you are doing it" \
  's{"The full list is below this guide\.[^"]*"}{"too short"}'

apply_mutant "the power supply stops being flagged critical" \
  's{(power supply[\s\S]{0,600}?critical: )true}{$1false}'

# NOTE: this mutant edits ONLY the part of the file above the self-tests.
# A naive global replace would rewrite the assertion along with the data, and
# a mutant that also mutates its own test proves nothing -- it "survives" for
# a reason that has nothing to do with test coverage. Mutate the subject,
# never the judge.
apply_mutant "the always-on section stops telling him how to tell the two faults apart" \
  'my $m = "export function __runAnnouncerSetupTests"; my ($a, $b) = split /\Q$m\E/, $_, 2; $a =~ s/Up for:/Uptime:/g; $_ = defined $b ? $a . $m . $b : $a;'

echo
echo "Mutants killed:   $KILLED"
echo "Mutants survived: $SURVIVED"
echo

if [ "$SURVIVED" -ne 0 ]; then
  echo "FAILED: $SURVIVED mutant(s) survived. The self-tests do not actually cover those faults."
  exit 1
fi

echo "PASSED: every mutant was caught."
