#!/usr/bin/env bash
#
# Greenway Receipt Printer - one-command installer for Raspberry Pi OS.
#
#   curl -fsSL https://YOUR-SITE.com/printer/install-printer.sh | sudo bash -s -- \
#        --site https://YOUR-SITE.com --token YOUR-PRINTER-TOKEN
#
# Everything it does is reversible with --uninstall. It is safe to run twice:
# re-running upgrades the agent in place and keeps the existing pairing.
#
set -euo pipefail

SITE=""
TOKEN=""
DEVICE=""
COLUMNS_ARG=""
NO_CUT="no"
DO_UNINSTALL="no"
AGENT_SRC=""
SKIP_TEST="no"

BIN_PATH="/usr/local/bin/greenway-printer"
CONFIG_DIR="/etc/greenway-printer"
CONFIG_PATH="$CONFIG_DIR/config.json"
STATE_DIR="/var/lib/greenway-printer"
UNIT_PATH="/etc/systemd/system/greenway-printer.service"
SERVICE="greenway-printer"

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
Greenway Receipt Printer installer

  sudo ./install-printer.sh --site https://your-site.com --token YOUR-TOKEN

Options:
  --site URL        Your website address (required on a first install)
  --token TOKEN     The printer poll token from the back office
  --device PATH     Printer device, e.g. /dev/usb/lp0 (default: auto-detect)
  --columns N       Paper width in characters (default 48 for 80mm paper)
  --no-cut          Do not send the paper-cut command (for printers with no cutter)
  --agent-file PATH Install from a local greenway_printer.py instead of downloading
  --skip-test       Do not print a test page at the end
  --uninstall       Remove the printer agent completely
  --help            Show this message

Where do I get the token?
  Back office -> Admin -> Equipment -> Receipt printer. Copy the poll token.
  If there isn't one yet, generate it there first.
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --site) SITE="${2:-}"; shift 2 ;;
    --token) TOKEN="${2:-}"; shift 2 ;;
    --device) DEVICE="${2:-}"; shift 2 ;;
    --columns) COLUMNS_ARG="${2:-}"; shift 2 ;;
    --no-cut) NO_CUT="yes"; shift ;;
    --agent-file) AGENT_SRC="${2:-}"; shift 2 ;;
    --skip-test) SKIP_TEST="yes"; shift ;;
    --uninstall) DO_UNINSTALL="yes"; shift ;;
    --help|-h) usage; exit 0 ;;
    *) die "I don't understand the option '$1'. Run with --help to see the list." ;;
  esac
done

[ "$(id -u)" -eq 0 ] || die "This needs to run with sudo. Try again with: sudo $0 ..."

# ---------------------------------------------------------------------------
# Uninstall
# ---------------------------------------------------------------------------
if [ "$DO_UNINSTALL" = "yes" ]; then
  step "Removing the Greenway receipt printer agent"
  # Disable FIRST, then stop. The other order leaves a window in which
  # Restart=always can bring the agent back between the stop and the disable:
  # the unit is still enabled, systemd still owns it, and RestartSec=5 fires.
  # Removing the restart policy before asking it to stop closes that window.
  systemctl disable "$SERVICE" 2>/dev/null || true
  systemctl stop "$SERVICE" 2>/dev/null || true

  # Verify it really stopped rather than trusting the exit code. A unit with a
  # long TimeoutStopSec, or one caught mid-restart, can still be settling here.
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    systemctl is-active --quiet "$SERVICE" 2>/dev/null || break
    sleep 1
  done
  if systemctl is-active --quiet "$SERVICE" 2>/dev/null; then
    warn "The service did not stop on request; forcing it."
    systemctl kill --signal=SIGKILL "$SERVICE" 2>/dev/null || true
    sleep 2
  fi
  ok "Service stopped and disabled."
  rm -f "$UNIT_PATH"
  rm -f "$BIN_PATH"
  # Unconditionally, and AFTER the unit file is gone, so systemd forgets the
  # unit entirely instead of keeping a loaded copy of a deleted file.
  systemctl daemon-reload 2>/dev/null || true
  systemctl reset-failed "$SERVICE" 2>/dev/null || true
  ok "Program and service file removed."
  echo ""
  echo "The configuration in $CONFIG_DIR was LEFT IN PLACE so you can reinstall"
  echo "without re-entering the token. To remove it too:"
  echo "  sudo rm -rf $CONFIG_DIR $STATE_DIR"
  echo ""
  exit 0
fi

echo ""
echo "${BOLD}Greenway Receipt Printer - installer${RESET}"
echo ""

# ---------------------------------------------------------------------------
# 1. Requirements
# ---------------------------------------------------------------------------
step "Checking this Pi"

command -v systemctl >/dev/null 2>&1 || die \
  "This Pi does not appear to use systemd, so the printer cannot be set up to
  start automatically. Raspberry Pi OS (Bookworm or Bullseye) is expected."

if ! command -v python3 >/dev/null 2>&1; then
  die "Python 3 is missing. Install it with:  sudo apt install -y python3"
fi
PYVER="$(python3 -c 'import sys; print("%d.%d" % sys.version_info[:2])')"
ok "Python $PYVER found."

if ! python3 -c 'import requests' >/dev/null 2>&1; then
  step "Installing the one missing Python package (requests)"
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update -qq || warn "Could not refresh the package list; trying anyway."
    apt-get install -y -qq python3-requests || die \
      "Could not install python3-requests. Connect this Pi to the internet and try again."
  else
    die "Cannot install python3-requests automatically on this system."
  fi
  ok "Installed python3-requests."
else
  ok "The 'requests' package is already present."
fi

# The usblp kernel module is what exposes a USB receipt printer as
# /dev/usb/lp0. It is built in and auto-loads on Raspberry Pi OS, but a few
# images blacklist it (it conflicts with some CUPS setups), which produces the
# baffling symptom of a printer that is listed by lsusb but has no device file.
if [ -d /sys/module/usblp ] || modinfo usblp >/dev/null 2>&1; then
  ok "The usblp printer driver is available."
  if [ ! -d /sys/module/usblp ]; then
    modprobe usblp 2>/dev/null || true
  fi
  if grep -rqs "blacklist usblp" /etc/modprobe.d/ 2>/dev/null; then
    warn "usblp is blacklisted in /etc/modprobe.d/. The printer device may never appear."
    warn "If printing fails, remove that blacklist line and reboot."
  fi
else
  warn "Could not confirm the usblp driver. If the printer is not detected, run:"
  warn "  sudo modprobe usblp"
fi

# ---------------------------------------------------------------------------
# 2. Install the program
# ---------------------------------------------------------------------------
step "Installing the printer program"

TMP_AGENT="$(mktemp)"
cleanup () { rm -f "$TMP_AGENT"; }
trap cleanup EXIT

if [ -n "$AGENT_SRC" ]; then
  [ -f "$AGENT_SRC" ] || die "No such file: $AGENT_SRC"
  cp "$AGENT_SRC" "$TMP_AGENT"
  ok "Using the local copy at $AGENT_SRC."
else
  # Look next to this script first: that is the case when someone downloaded
  # the repo or copied the folder onto a USB stick.
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || echo "")"
  if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/greenway_printer.py" ]; then
    cp "$SCRIPT_DIR/greenway_printer.py" "$TMP_AGENT"
    ok "Using the copy next to this installer."
  else
    [ -n "$SITE" ] || die \
      "I need to download the printer program, so I need your website address.
  Re-run with:  --site https://your-site.com"
    DL_URL="${SITE%/}/printer/greenway_printer.py"
    step "Downloading the printer program from $DL_URL"
    curl -fsSL "$DL_URL" -o "$TMP_AGENT" || die \
      "Could not download $DL_URL
  Check this Pi's internet connection and that the website address is correct."
    ok "Downloaded."
  fi
fi

# Never install a file we cannot vouch for. The agent's own selftest is the
# cheapest possible integrity check: a truncated or corrupted download fails
# it, and a half-written printer agent is worse than no printer agent.
if ! python3 "$TMP_AGENT" selftest >/dev/null 2>&1; then
  die "The printer program failed its own self-check, so it was NOT installed.
  The download may be incomplete. Try running this installer again."
fi
ok "The program passed its own self-check."

install -m 755 "$TMP_AGENT" "$BIN_PATH"
ok "Installed to $BIN_PATH"

install -d -m 700 "$CONFIG_DIR"
install -d -m 755 "$STATE_DIR"
ok "Created $CONFIG_DIR and $STATE_DIR"

# ---------------------------------------------------------------------------
# 3. Pair
# ---------------------------------------------------------------------------
if [ -n "$TOKEN" ] || [ -n "$SITE" ]; then
  step "Saving the settings"
  PAIR_ARGS=()
  [ -n "$SITE" ] && PAIR_ARGS+=(--site "$SITE")
  [ -n "$DEVICE" ] && PAIR_ARGS+=(--device "$DEVICE")
  [ -n "$COLUMNS_ARG" ] && PAIR_ARGS+=(--columns "$COLUMNS_ARG")
  [ "$NO_CUT" = "yes" ] && PAIR_ARGS+=(--no-cut)

  if [ -z "$TOKEN" ]; then
    if [ -f "$CONFIG_PATH" ]; then
      warn "No --token given; keeping the token already on this Pi."
      TOKEN="$(python3 -c "
import json,sys
try:
    print(json.load(open('$CONFIG_PATH')).get('pollToken',''))
except Exception:
    print('')
")"
    fi
  fi
  [ -n "$TOKEN" ] || die \
    "I need the printer token. Get it from:
  Back office -> Admin -> Equipment -> Receipt printer
Then re-run with:  --token YOUR-TOKEN"

  # `pair` verifies against the live site, so a wrong token or a typo'd
  # address fails HERE, with a clear message, instead of silently at 9am.
  if ! "$BIN_PATH" pair "$TOKEN" "${PAIR_ARGS[@]}"; then
    warn "The settings were saved but the check did not pass (see the message above)."
    warn "The service will still be installed and will keep retrying."
  else
    ok "Paired with the website."
  fi
elif [ ! -f "$CONFIG_PATH" ]; then
  die "This is a first install, so I need the website address and the token:
  sudo $0 --site https://your-site.com --token YOUR-TOKEN"
else
  ok "Keeping the existing settings in $CONFIG_PATH"
fi

# ---------------------------------------------------------------------------
# 4. Service
# ---------------------------------------------------------------------------
step "Setting up automatic start"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || echo "")"
if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/systemd/greenway-printer.service" ]; then
  install -m 644 "$SCRIPT_DIR/systemd/greenway-printer.service" "$UNIT_PATH"
  ok "Installed the service file from the local copy."
else
  cat > "$UNIT_PATH" <<'UNIT'
[Unit]
Description=Greenway Receipt Printer Agent
Wants=network-online.target
After=network-online.target
# Switch off systemd's start rate limit: the default gives up forever after 5
# restarts in 10s, which is exactly the silent-dead-printer failure we must
# prevent. This key MUST be in [Unit], not [Service].
StartLimitIntervalSec=0
StartLimitBurst=0

[Service]
Type=simple
ExecStart=/usr/local/bin/greenway-printer run
Restart=always
RestartSec=5
User=root
WorkingDirectory=/var/lib/greenway-printer
StandardOutput=journal
StandardError=journal
SyslogIdentifier=greenway-printer
TimeoutStopSec=20
KillSignal=SIGTERM
NoNewPrivileges=yes
ProtectSystem=full
ProtectHome=yes
PrivateTmp=yes
# PrivateDevices is deliberately NOT set: it would hide /dev/usb/lp0.
ReadWritePaths=/var/lib/greenway-printer /etc/greenway-printer
MemoryMax=256M

[Install]
WantedBy=multi-user.target
UNIT
  ok "Wrote $UNIT_PATH"
fi

systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null 2>&1
ok "The printer agent will now start automatically on boot."

systemctl restart "$SERVICE"
sleep 3

if systemctl is-active --quiet "$SERVICE"; then
  ok "The printer agent is running."
else
  warn "The service did not stay running. Recent log:"
  journalctl -u "$SERVICE" -n 15 --no-pager 2>/dev/null | sed 's/^/      /' || true
  die "The printer agent is not running. The log above says why."
fi

# ---------------------------------------------------------------------------
# 5. Prove it
# ---------------------------------------------------------------------------
if [ "$SKIP_TEST" != "yes" ]; then
  step "Printing a test page"
  # Stop the service first: two processes writing to one printer device would
  # interleave bytes and produce garbage on the paper.
  systemctl stop "$SERVICE"
  if "$BIN_PATH" test; then
    ok "Test page sent."
  else
    warn "The test page did not print. The message above says why."
    warn "The service is still installed; fix the printer and run: sudo greenway-printer test"
  fi
  systemctl start "$SERVICE"
fi

echo ""
echo "${BOLD}${GREEN}Done.${RESET}"
echo ""
echo "The printer is set up and will start automatically whenever this Pi boots."
echo ""
echo "Useful commands:"
echo "  sudo greenway-printer status              What is my setup, and can I reach the site?"
echo "  sudo greenway-printer test                Print a test page"
echo "  sudo greenway-printer selftest            Check the program itself"
echo "  sudo systemctl status greenway-printer    Is the service running?"
echo "  sudo journalctl -u greenway-printer -f    Watch it work, live"
echo "  sudo $0 --uninstall                       Remove it"
echo ""
