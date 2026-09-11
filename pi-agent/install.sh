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

[ "$(id -u)" -eq 0 ] || die "This needs to run as root. Put 'sudo' in front of the command and try again."

# ---------------------------------------------------------------------------
# Uninstall
# ---------------------------------------------------------------------------
if [ "$DO_UNINSTALL" = "yes" ]; then
  step "Removing the Greenway announcer"
  systemctl stop greenway-announcer 2>/dev/null || true
  systemctl disable greenway-announcer 2>/dev/null || true
  rm -f "$UNIT_PATH"; systemctl daemon-reload 2>/dev/null || true
  rm -f "$BIN_PATH"
  rm -rf /var/lib/greenway-announcer
  echo ""
  ok "Removed the service, the program and the cached sounds."
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
step "Step 1 of 7: checking this Raspberry Pi"

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
step "Step 2 of 7: installing the pieces it needs"
export DEBIAN_FRONTEND=noninteractive
if ! apt-get update -qq >/dev/null 2>&1; then
  warn "Could not refresh the software list. Carrying on with what is already here."
fi
MISSING=""
for pkg in python3-requests alsa-utils mpg123; do
  dpkg -s "$pkg" >/dev/null 2>&1 || MISSING="$MISSING $pkg"
done
if [ -n "$MISSING" ]; then
  echo "  Installing:$MISSING"
  apt-get install -y -qq $MISSING >/dev/null 2>&1 \
    || die "Could not install:$MISSING . Run 'sudo apt update' and try again."
fi
ok "Sound tools and Python libraries are ready"

# ---------------------------------------------------------------------------
# 3. Install the agent
# ---------------------------------------------------------------------------
step "Step 3 of 7: installing the announcer program"
mkdir -p "$CONFIG_DIR" "$CACHE_DIR"
chmod 700 "$CONFIG_DIR"

TMP_AGENT="$(mktemp)"
if [ -n "$AGENT_SRC" ]; then
  [ -f "$AGENT_SRC" ] || die "I could not find the file '$AGENT_SRC'."
  cp "$AGENT_SRC" "$TMP_AGENT"
elif [ -f "$(dirname "$0")/greenway_announcer.py" ]; then
  cp "$(dirname "$0")/greenway_announcer.py" "$TMP_AGENT"
elif [ -n "$SITE" ]; then
  curl -fsSL "${SITE%/}/announcer/greenway_announcer.py" -o "$TMP_AGENT" \
    || die "Could not download the announcer program from ${SITE%/}. Check the website address."
else
  die "I need either --site (to download the program) or --agent-file (to install a local copy)."
fi

python3 -c "import ast,sys; ast.parse(open(sys.argv[1]).read())" "$TMP_AGENT" \
  || die "The downloaded program is damaged. Try the install command again."

install -m 755 "$TMP_AGENT" "$BIN_PATH"
rm -f "$TMP_AGENT"
ok "Installed to $BIN_PATH"

step "Step 4 of 7: checking the program is healthy"
if "$BIN_PATH" selftest >/tmp/greenway-selftest.log 2>&1; then
  ok "Built-in self-test passed ($(grep -oE '[0-9]+ checks passed' /tmp/greenway-selftest.log | head -1))"
else
  cat /tmp/greenway-selftest.log
  die "The announcer's own self-test failed. Nothing was started. Send the text above for help."
fi

# ---------------------------------------------------------------------------
# 5. Pair
# ---------------------------------------------------------------------------
step "Step 5 of 7: connecting this speaker to your website"
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
step "Step 6 of 7: setting it to start automatically, forever"

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
# 7. Prove it is actually running
# ---------------------------------------------------------------------------
step "Step 7 of 7: making sure it really is running"
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
