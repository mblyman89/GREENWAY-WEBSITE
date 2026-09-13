#!/usr/bin/env bash
#
# Greenway Order Announcer - one-command installer for Raspberry Pi OS.
#
#   curl -fsSL https://YOUR-SITE.com/announcer/install.sh | sudo bash -s -- \
#        --site https://YOUR-SITE.com --code ABCD2345
#
# Everything it does is reversible with --uninstall. It is safe to run twice:
# re-running upgrades the agent in place and keeps the existing pairing.
#
set -euo pipefail

AGENT_URL_DEFAULT=""
SITE=""
CODE=""
AUDIO_DEVICE=""
MIXER_CONTROL=""
DO_UNINSTALL="no"
AGENT_SRC=""

BIN_PATH="/usr/local/bin/greenway-announcer"
CONFIG_DIR="/etc/greenway-announcer"
CONFIG_PATH="$CONFIG_DIR/config.json"
CACHE_DIR="/var/lib/greenway-announcer/sounds"
UNIT_PATH="/etc/systemd/system/greenway-announcer.service"

# ---------------------------------------------------------------------------
# Pretty output. Every message is written for a shop owner, not a developer.
# ---------------------------------------------------------------------------
if [ -t 1 ]; then
  BOLD=$'\033[1m'; GREEN=$'\033[32m'; RED=$'\033[31m'; YELLOW=$'\033[33m'; RESET=$'\033[0m'
else
  BOLD=""; GREEN=""; RED=""; YELLOW=""; RESET=""
fi
step ()  { echo "${BOLD}==> $*${RESET}"; }
ok ()    { echo "  ${GREEN}OK${RESET}  $*"; }
warn ()  { echo "  ${YELLOW}!!${RESET}  $*"; }
die ()   { echo "" >&2; echo "${RED}STOPPED: $*${RESET}" >&2; echo "" >&2; exit 1; }

usage () {
  cat <<'USAGE'
Greenway Order Announcer installer

  sudo ./install.sh --site https://your-site.com --code ABCD2345

Options:
  --site URL          Your website address (required on a first install)
  --code CODE         The 8-character pairing code from the back office
  --audio-device DEV  ALSA device, e.g. "plughw:1,0" (default: system default)
  --mixer-control C   ALSA mixer name, e.g. "PCM" (default: auto)
  --agent-file PATH   Install from a local greenway_announcer.py instead of downloading
  --uninstall         Remove the announcer completely
  --help              Show this message

Where do I get a code?
  Back office -> Orders -> Announcer -> "Add a speaker". The code is good
  for 60 minutes. If it expires, just make another one.
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --site) SITE="${2:-}"; shift 2 ;;
    --code) CODE="${2:-}"; shift 2 ;;
    --audio-device) AUDIO_DEVICE="${2:-}"; shift 2 ;;
    --mixer-control) MIXER_CONTROL="${2:-}"; shift 2 ;;
    --agent-file) AGENT_SRC="${2:-}"; shift 2 ;;
    --uninstall) DO_UNINSTALL="yes"; shift ;;
    --help|-h) usage; exit 0 ;;
    # There are TWO installers in this folder and their flags differ. Sending
    # somebody to --help when they used a real flag from the OTHER one wastes
    # their time, so name the script they actually wanted.
    --token|--device|--columns|--no-cut|--skip-test)
      die "'$1' is a RECEIPT PRINTER option, but this is the ANNOUNCER installer
  (install.sh sets up the speaker that reads orders aloud).

  For the receipt printer, run the other script in this folder:
    sudo ./install-printer.sh --site https://your-site.com --token YOUR-TOKEN

  The printer uses --token (from Admin -> Equipment -> Receipt printer).
  The announcer uses --code (an 8-character pairing code)." ;;
    *) die "I don't understand the option '$1'. Run with --help to see the options." ;;
  esac
done

# ---------------------------------------------------------------------------
# Check the website address IMMEDIATELY, before anything else happens.
#
# "https//site.com" -- with the colon missing -- is easy to type and easy to
# stare straight past, because the eye reads the word "https" and moves on.
# When the installer runs from a git clone it uses the local copy of the agent
# and never downloads anything, so a bad address survives all the way to step 5
# (pairing). That means the package step, the install and the self-test all run
# before anything complains. The address is knowably wrong the moment it is
# typed, so it is checked here, first, and quoted back with the correction.
# ---------------------------------------------------------------------------
if [ -n "$SITE" ]; then
  case "$SITE" in
    https://?*|http://?*)
      : ;;
    https//*|http//*)
      SCHEME="${SITE%%//*}"
      die "The website address is missing the ':' after '$SCHEME'.

  You typed:  $SITE
  You want:   ${SCHEME}://${SITE#*//}

  Nothing has been changed. Fix the address and run the same command again." ;;
    https:/*|http:/*)
      SCHEME="${SITE%%:*}"
      die "The website address has only one '/' after '${SCHEME}:'.

  You typed:  $SITE
  You want:   ${SCHEME}://${SITE#*:/}

  Nothing has been changed. Fix the address and run the same command again." ;;
    *)
      die "'$SITE' does not look like a web address.

  It needs to start with https:// (or http:// for a local test), like:
    https://greenwaywebsite1.vercel.app

  Nothing has been changed. Fix the address and run the same command again." ;;
  esac
fi

[ "$(id -u)" -eq 0 ] || die "This needs to run as root. Put 'sudo' in front of the command and try again."

# ---------------------------------------------------------------------------
# Uninstall
# ---------------------------------------------------------------------------
if [ "$DO_UNINSTALL" = "yes" ]; then
  step "Removing the Greenway announcer"
  systemctl stop greenway-announcer 2>/dev/null || true
  systemctl disable greenway-announcer 2>/dev/null || true
  rm -f "$UNIT_PATH"
  # Everything step 7 installed to keep the Pi awake comes back out too.
  # "Reversible with --uninstall" has to stay true, or the next person finds
  # services they cannot account for and does not know what is safe to remove.
  systemctl stop greenway-keep-awake 2>/dev/null || true
  systemctl disable greenway-keep-awake 2>/dev/null || true
  rm -f /etc/systemd/system/greenway-keep-awake.service
  rm -f /usr/local/bin/greenway-keep-awake
  rm -f /etc/NetworkManager/conf.d/99-greenway-no-wifi-powersave.conf
  systemctl daemon-reload 2>/dev/null || true
  rm -f "$BIN_PATH"
  rm -rf /var/lib/greenway-announcer
  echo ""
  ok "Removed the service, the program and the cached sounds."
  # Sleep stays masked on purpose and is called out rather than silently left:
  # a shop that uninstalls to troubleshoot should not have a Pi start dozing
  # again mid-investigation. Unmasking is one documented command.
  warn "Sleep/suspend were left switched off. To restore them:"
  warn "  sudo systemctl unmask sleep.target suspend.target hibernate.target hybrid-sleep.target"
  warn "Your pairing was left at $CONFIG_PATH in case you reinstall."
  warn "To erase it too:  sudo rm -rf $CONFIG_DIR"
  echo ""
  exit 0
fi

echo ""
echo "${BOLD}Greenway Order Announcer - installer${RESET}"
echo "This takes about two minutes. You can leave it running."
echo ""

# ---------------------------------------------------------------------------
# 1. Sanity checks BEFORE changing anything
# ---------------------------------------------------------------------------
step "Step 1 of 8: checking this Raspberry Pi"

if [ -r /proc/device-tree/model ]; then
  MODEL="$(tr -d '\0' < /proc/device-tree/model)"
  ok "Hardware: $MODEL"
else
  warn "This does not look like a Raspberry Pi. Installing anyway."
fi

command -v systemctl >/dev/null 2>&1 || die "This system does not use systemd, so the announcer cannot install itself as a service. Use a standard Raspberry Pi OS image."

if ! command -v python3 >/dev/null 2>&1; then
  die "Python 3 is missing. Install it with:  sudo apt update && sudo apt install -y python3"
fi
PY_OK="$(python3 -c 'import sys; print(1 if sys.version_info >= (3,9) else 0)')"
[ "$PY_OK" = "1" ] || die "Python 3.9 or newer is required. Update Raspberry Pi OS with: sudo apt update && sudo apt full-upgrade"
ok "Python: $(python3 --version 2>&1)"

if ! ping -c1 -W3 8.8.8.8 >/dev/null 2>&1 && ! ping -c1 -W3 1.1.1.1 >/dev/null 2>&1; then
  die "This Pi cannot reach the internet. Plug in the network cable or connect Wi-Fi, then run this again."
fi
ok "Internet connection is working"

# ---------------------------------------------------------------------------
# 2. Dependencies
# ---------------------------------------------------------------------------
step "Step 2 of 8: installing the pieces it needs"
export DEBIAN_FRONTEND=noninteractive

# Work out what is actually missing FIRST. On a re-run everything is normally
# already installed, in which case there is no reason to touch apt at all --
# and every reason not to, because apt is the one step here that can sit and
# wait on something outside our control.
MISSING=""
for pkg in python3-requests alsa-utils mpg123; do
  dpkg -s "$pkg" >/dev/null 2>&1 || MISSING="$MISSING $pkg"
done

if [ -z "$MISSING" ]; then
  ok "Sound tools and Python libraries are already installed"
else
  echo "  Need to install:$MISSING"

  # Raspberry Pi OS runs apt-daily in the background, and it takes the same
  # lock this needs. When it is mid-run, apt waits. Silently. Forever.
  # A real shop owner sat watching "Step 2 of 8" with no output and no way to
  # tell whether it had died, so: say what is happening, cap how long we are
  # willing to wait, and never hide the reason.
  APT_LOCK_OPTS="-o DPkg::Lock::Timeout=120"
  if apt-get $APT_LOCK_OPTS --version >/dev/null 2>&1; then :; else APT_LOCK_OPTS=""; fi

  if pgrep -x 'apt|apt-get|unattended-upgr' >/dev/null 2>&1; then
    warn "The Pi is already installing its own updates in the background."
    echo "      Waiting for that to finish (up to 3 minutes)..."
  fi

  # Overridable so the test suite can exercise the timeout path in seconds
  # instead of minutes. Defaults are what a real Pi gets.
  APT_UPDATE_TIMEOUT="${GREENWAY_APT_UPDATE_TIMEOUT:-120}"
  APT_INSTALL_TIMEOUT="${GREENWAY_APT_INSTALL_TIMEOUT:-300}"

  echo "  Refreshing the software list (up to 2 minutes)..."
  if timeout "$APT_UPDATE_TIMEOUT" apt-get $APT_LOCK_OPTS update -qq >/dev/null 2>&1; then
    ok "Software list refreshed"
  else
    warn "Could not refresh the software list in time. Carrying on with what is already here."
  fi

  echo "  Installing:$MISSING (up to 5 minutes)..."
  APT_LOG="$(mktemp)"
  if timeout "$APT_INSTALL_TIMEOUT" apt-get $APT_LOCK_OPTS install -y -qq $MISSING >"$APT_LOG" 2>&1; then
    ok "Sound tools and Python libraries are ready"
  else
    APT_STATUS=$?
    echo "" >&2
    if [ "$APT_STATUS" -eq 124 ]; then
      echo "  The install did not finish in time. This is almost always the Pi's own" >&2
      echo "  background updater holding the lock. Wait a few minutes, then run this" >&2
      echo "  installer again -- it is safe to re-run and keeps your pairing." >&2
      echo "" >&2
      echo "  To see what is holding it:  ps aux | grep -E 'apt|unattended'" >&2
    else
      echo "  The last few lines from apt:" >&2
      tail -5 "$APT_LOG" >&2
    fi
    rm -f "$APT_LOG"
    die "Could not install:$MISSING . Try 'sudo apt-get install -y$MISSING' to see the full error."
  fi
  rm -f "$APT_LOG"
fi

# ---------------------------------------------------------------------------
# 3. Install the agent
# ---------------------------------------------------------------------------
step "Step 3 of 8: installing the announcer program"
mkdir -p "$CONFIG_DIR" "$CACHE_DIR"
chmod 700 "$CONFIG_DIR"

TMP_AGENT="$(mktemp)"
if [ -n "$AGENT_SRC" ]; then
  [ -f "$AGENT_SRC" ] || die "I could not find the file '$AGENT_SRC'."
  cp "$AGENT_SRC" "$TMP_AGENT"
elif [ -f "$(dirname "$0")/greenway_announcer.py" ]; then
  cp "$(dirname "$0")/greenway_announcer.py" "$TMP_AGENT"
elif [ -n "$SITE" ]; then
  # 'curl -fsSL' is not enough on its own: a security gateway in front of a
  # domain answers 202 with an HTML CAPTCHA page, curl calls that a success,
  # and we would then install a web page as the program. Capture the real
  # status and check what actually arrived.
  DL_URL="${SITE%/}/announcer/greenway_announcer.py"
  DL_CODE="$(curl -sSL -w '%{http_code}' --max-time 60 -o "$TMP_AGENT" "$DL_URL" 2>/dev/null || echo "000")"
  if [ "$DL_CODE" = "000" ]; then
    die "Could not reach ${SITE%/} to download the announcer program.
  Check this Pi's network and that the website address is spelled correctly."
  fi
  if [ "$DL_CODE" != "200" ]; then
    die "Downloading the announcer program from ${SITE%/} returned HTTP $DL_CODE, not 200.
  A status like 202 or 403 with an HTML body usually means the domain sits
  behind a security gateway / CAPTCHA that blocks automated downloads.
  Use the address that serves the announcer software directly, or run this
  installer from a git clone (it then uses the local copy and downloads nothing)."
  fi
  if head -c 400 "$TMP_AGENT" | grep -qiE '<html|<!doctype html|sgcaptcha|<meta'; then
    die "The address ${DL_URL} returned a web page instead of the announcer program.
  That is what a security gateway / CAPTCHA looks like. Use the address that
  serves the announcer software directly, or run this installer from a git
  clone so it uses the local copy."
  fi
else
  die "I need either --site (to download the program) or --agent-file (to install a local copy)."
fi

python3 -c "import ast,sys; ast.parse(open(sys.argv[1]).read())" "$TMP_AGENT" \
  || die "The downloaded program is damaged. Try the install command again."

install -m 755 "$TMP_AGENT" "$BIN_PATH"
rm -f "$TMP_AGENT"
ok "Installed to $BIN_PATH"

step "Step 4 of 8: checking the program is healthy"
if "$BIN_PATH" selftest >/tmp/greenway-selftest.log 2>&1; then
  ok "Built-in self-test passed ($(grep -oE '[0-9]+ checks passed' /tmp/greenway-selftest.log | head -1))"
else
  cat /tmp/greenway-selftest.log
  die "The announcer's own self-test failed. Nothing was started. Send the text above for help."
fi

# ---------------------------------------------------------------------------
# 5. Pair
# ---------------------------------------------------------------------------
step "Step 5 of 8: connecting this speaker to your website"
PAIR_ARGS=()
[ -n "$AUDIO_DEVICE" ] && PAIR_ARGS+=(--audio-device "$AUDIO_DEVICE")
[ -n "$MIXER_CONTROL" ] && PAIR_ARGS+=(--mixer-control "$MIXER_CONTROL")

if [ -n "$CODE" ]; then
  [ -n "$SITE" ] || die "You gave me a code but not a --site. I need both."
  "$BIN_PATH" pair "$CODE" --site "$SITE" "${PAIR_ARGS[@]}" \
    || die "Pairing did not work. Codes expire after 60 minutes - make a fresh one in the back office and run this installer again."
  ok "This speaker is paired"
elif [ -f "$CONFIG_PATH" ]; then
  ok "Already paired - keeping the existing setup"
else
  warn "No pairing code given, so this speaker is not connected yet."
  warn "When you have a code from the back office, run:"
  warn "  sudo greenway-announcer pair YOURCODE --site https://your-site.com"
fi

# ---------------------------------------------------------------------------
# 6. Service + log limits
# ---------------------------------------------------------------------------
step "Step 6 of 8: setting it to start automatically, forever"

cat > "$UNIT_PATH" <<'UNIT'
[Unit]
Description=Greenway Online Order Announcer
Wants=network-online.target
After=network-online.target sound.target
# Must live in [Unit], not [Service]: systemd ignores it in [Service] and
# would then stop restarting the speaker after 5 quick failures.
StartLimitIntervalSec=0
StartLimitBurst=0

[Service]
Type=simple
ExecStart=/usr/local/bin/greenway-announcer run
Restart=always
RestartSec=5
User=root
WorkingDirectory=/var/lib/greenway-announcer
StandardOutput=journal
StandardError=journal
SyslogIdentifier=greenway-announcer
TimeoutStopSec=20
KillSignal=SIGTERM
NoNewPrivileges=yes
ProtectSystem=full
ProtectHome=yes
PrivateTmp=yes
ReadWritePaths=/var/lib/greenway-announcer /etc/greenway-announcer
MemoryMax=256M

[Install]
WantedBy=multi-user.target
UNIT

# Cap the journal. Unbounded logs are the number one killer of SD cards.
mkdir -p /etc/systemd/journald.conf.d
cat > /etc/systemd/journald.conf.d/greenway-announcer.conf <<'JCONF'
# Keep the Raspberry Pi's SD card alive: cap the journal and never let a
# chatty outage fill the disk.
[Journal]
SystemMaxUse=50M
SystemMaxFileSize=10M
MaxRetentionSec=1month
JCONF
systemctl restart systemd-journald 2>/dev/null || true

systemctl daemon-reload
systemctl enable greenway-announcer >/dev/null 2>&1
systemctl restart greenway-announcer
ok "Service installed, enabled at boot, and started"
ok "Log size capped at 50MB to protect the SD card"

# ---------------------------------------------------------------------------
# 7. Keep the Pi awake
#
# A real shop reported "the pi keeps turning itself off after a little bit of
# time". A Raspberry Pi running the announcer must behave like an appliance:
# always on, always reachable, no exceptions.
#
# There are three different things that all LOOK like "it turned itself off",
# and they have nothing to do with each other. All three are handled here,
# because guessing which one a shop is hitting is how you fix the wrong one and
# declare victory:
#
#   1. Wi-Fi power saving. THE most likely cause by far. The radio dozes
#      between packets, so the Pi stops answering, the website marks the
#      speaker offline, and it "comes back" the moment something wakes it.
#      The Pi never turned off at all. This is the one that matters.
#   2. Suspend / sleep targets. Rare on Pi OS, but a desktop image or a
#      stray package can pull them in, and then the box really does sleep.
#   3. Console blanking. The screen goes black after ~10 minutes. Nothing is
#      off -- but if you are looking at a monitor, "the screen went black" and
#      "it turned itself off" are the same sentence.
#
# Everything below is idempotent and safe to re-run.
# ---------------------------------------------------------------------------
step "Step 7 of 8: keeping this Pi awake and online"

# --- 1. Wi-Fi power saving ------------------------------------------------
# Two belts and braces, because Raspberry Pi OS has changed how it manages
# networking between releases and the shop should not have to care which it is.

# (a) NetworkManager (Bookworm and newer). A drop-in is used rather than
#     editing the shipped file, so an OS update cannot quietly revert it.
if [ -d /etc/NetworkManager ]; then
  mkdir -p /etc/NetworkManager/conf.d
  cat > /etc/NetworkManager/conf.d/99-greenway-no-wifi-powersave.conf <<'NMCONF'
# Installed by the Greenway announcer.
# 2 = disable Wi-Fi power saving. The radio dozing between packets makes the
# speaker look "offline" in the back office while the Pi is perfectly fine.
[connection]
wifi.powersave = 2
NMCONF
  ok "Wi-Fi power saving disabled for NetworkManager"
fi

# (b) A tiny boot service that turns it off directly on every wireless
#     interface. This covers non-NetworkManager setups and any interface
#     NetworkManager is not managing. It is deliberately best-effort: a Pi on
#     ethernet has no wireless interface and must not fail the install.
if command -v iw >/dev/null 2>&1; then
  cat > /usr/local/bin/greenway-keep-awake <<'KEEPAWAKE'
#!/bin/sh
# Installed by the Greenway announcer. Turns Wi-Fi power saving off on every
# wireless interface. Safe to run on a Pi with no Wi-Fi at all.
for dir in /sys/class/net/*/wireless; do
  [ -e "$dir" ] || continue
  iface="$(basename "$(dirname "$dir")")"
  iw dev "$iface" set power_save off 2>/dev/null || true
done
exit 0
KEEPAWAKE
  chmod 755 /usr/local/bin/greenway-keep-awake

  cat > /etc/systemd/system/greenway-keep-awake.service <<'KAUNIT'
[Unit]
Description=Greenway: keep the Wi-Fi radio awake so the speaker stays reachable
After=network.target
# Re-applies after the network comes back, because bringing an interface down
# and up again restores the driver default.
Wants=network.target

[Service]
Type=oneshot
ExecStart=/usr/local/bin/greenway-keep-awake
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
KAUNIT
  systemctl daemon-reload
  systemctl enable greenway-keep-awake >/dev/null 2>&1 || true
  systemctl start greenway-keep-awake >/dev/null 2>&1 || true
  ok "Wi-Fi radio set to stay awake, now and on every boot"
else
  warn "The 'iw' tool is missing, so Wi-Fi power saving could not be turned off directly."
  warn "If this Pi is on Wi-Fi, install it with:  sudo apt install -y iw"
fi

# --- 2. Never sleep, suspend or hibernate ---------------------------------
# Masking is stronger than disabling: a mask cannot be started by anything,
# including another program deciding the box looks idle.
if systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target >/dev/null 2>&1; then
  ok "Sleep, suspend and hibernate are switched off for good"
else
  warn "Could not switch off sleep/suspend. The Pi may still doze."
fi

# --- 3. Stop the screen going black ---------------------------------------
# Cosmetic, and included precisely because it is the thing people SEE. A black
# screen on a Pi that is running perfectly is indistinguishable from a Pi that
# has turned itself off, and that confusion costs a shop an afternoon.
if [ -w /sys/module/kernel/parameters/consoleblank ] 2>/dev/null; then
  echo 0 > /sys/module/kernel/parameters/consoleblank 2>/dev/null || true
fi
setterm --blank 0 --powerdown 0 >/dev/null 2>&1 || true
ok "Screen blanking turned off (a black screen is not a Pi that is off)"

echo ""
echo "  If this Pi has ever seemed to 'turn itself off', run this afterwards:"
echo "    sudo greenway-announcer status"
echo "  It reports how long the Pi has been up. If that number keeps resetting,"
echo "  the Pi is losing POWER - that is the power supply or the cable, not"
echo "  software. If it keeps climbing, the Pi never went off at all."

# ---------------------------------------------------------------------------
# 8. Prove it is actually running
# ---------------------------------------------------------------------------
step "Step 8 of 8: making sure it really is running"
sleep 4
if systemctl is-active --quiet greenway-announcer; then
  ok "The announcer is running right now"
else
  echo ""
  echo "The service did not stay running. Here is the reason:"
  echo "---------------------------------------------------"
  journalctl -u greenway-announcer -n 25 --no-pager || true
  echo "---------------------------------------------------"
  die "Send the text above for help. Nothing is broken - the speaker just is not talking to the site yet."
fi

echo ""
echo "${GREEN}${BOLD}================ DONE ================${RESET}"
echo ""
echo "  Your speaker is installed and running."
echo ""
echo "  ${BOLD}Next: go to the back office -> Orders -> Announcer${RESET}"
echo "  You should see this speaker with a ${GREEN}green dot${RESET} within 30 seconds."
echo "  Press \"Test\" next to it and you should hear a chime."
echo ""
echo "  Handy commands to remember:"
echo "    greenway-announcer status        - is it working? (checks the website too)"
echo "    greenway-announcer test          - play every sound through this speaker"
echo "    greenway-announcer selftest      - check the program itself"
echo "    sudo systemctl restart greenway-announcer   - turn it off and on again"
echo "    journalctl -u greenway-announcer -f         - watch it live"
echo ""
echo "  If a speaker ever goes quiet, the field manual walks you through it:"
echo "    docs/announcer/10-field-manual.md"
echo ""
