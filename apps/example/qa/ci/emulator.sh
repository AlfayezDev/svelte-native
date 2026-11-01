#!/usr/bin/env bash
# emulator.sh start|stop|restart|status|rss|guard|wait|watchdog
#
# Controls the Svelte QA emulator (AVD svelte-qa, headless, software GL) on the OVH host. It runs ON the host, as the
# svelte-qa user (the CI runner and the watchdog) or as root; from another machine: ssh ovh-root /opt/svelte-qa/bin/emulator.sh <command>.
#
# The emulator is the systemd service svelte-qa-emulator.service (qa/ci/setup-runner.sh installs it), not a child of a job: the
# runner kills what a job started when the job ends, and the next job wants the emulator up. A user other than root restarts it
# through `sudo -n systemctl`, which the setup allows for this unit and nothing else.
#
# Why restarts exist: with -gpu swiftshader_indirect gfxstream leaks one host RenderThread (and about 13 MB) per app launch of
# the guest, so qemu's resident set reaches the host's 22 GB after about 50 minutes of lab and soak runs and QEMU dies with
# "hanging threads". A restart returns the memory. `start`, `stop`, `restart` and `guard` do not take the emulator lock: the
# caller does (a CI job holds it for its whole lane; hold it yourself with `native-qa hold`). Only `watchdog` takes it, to
# restart between other people's runs.
#
#   rss        qemu's resident set in whole GB (0 when the emulator is not running)
#   status     unit state, boot flag, adb state and rss, one line
#   wait       block until the guest has booted and adb answers on localhost:5555
#   start      start the service and wait
#   stop       stop the service
#   restart    restart the service and wait: a fresh instance
#   guard      restart when adb is not answering or rss is at or above SOFT_GB (default 11); for the CI lane between stages, which holds the lock
#   watchdog   forever: restart when adb has been offline for two checks (at once), when rss >= HARD_GB (18, at once), or when
#              rss >= SOFT_GB (11) as soon as the emulator lock is free (waits up to LOCK_WAIT, default 1500 s, and tries again
#              at the next check)
#
# Environment: ANDROID_HOME (/opt/android-sdk), QA_EMULATOR_UNIT, QA_DEVICE (localhost:5555), QA_EMULATOR_SERIAL (emulator-5554),
# NATIVE_QA_LOCK_FILE (/run/svelte-qa/emulator.lock), SOFT_GB, HARD_GB, BOOT_WAIT (300 s), INTERVAL (120 s).
set -u

UNIT=${QA_EMULATOR_UNIT:-svelte-qa-emulator.service}
SDK=${ANDROID_HOME:-/opt/android-sdk}
ADB=${ADB:-$SDK/platform-tools/adb}
DEVICE=${QA_DEVICE:-localhost:5555}
SERIAL=${QA_EMULATOR_SERIAL:-emulator-5554}
LOCK=${NATIVE_QA_LOCK_FILE:-/run/svelte-qa/emulator.lock}
SOFT_GB=${SOFT_GB:-11}
HARD_GB=${HARD_GB:-18}
LOCK_WAIT=${LOCK_WAIT:-1500}
BOOT_WAIT=${BOOT_WAIT:-300}
INTERVAL=${INTERVAL:-120}
POLL=${POLL:-3}
PROC=${PROC:-/proc}
SELF=$(readlink -f "$0")

log() { printf '%s %s\n' "$(date +%T)" "$*"; }

svc() {
  if [ "$(id -u)" = 0 ]; then systemctl "$@"; else sudo -n systemctl "$@"; fi
}

qemu_pid() {
  local pid
  pid=$(systemctl show -p MainPID --value "$UNIT" 2>/dev/null)
  if [ -z "$pid" ] || [ "$pid" = 0 ]; then
    pid=$(pgrep -f 'qemu-system-x86_64.* -avd svelte-qa' 2>/dev/null | head -1)
  fi
  printf '%s' "${pid:-}"
}

rss_gb() {
  local pid kb
  pid=$(qemu_pid)
  [ -n "$pid" ] || { echo 0; return; }
  kb=$(awk '/^VmRSS:/ {print $2}' "$PROC/$pid/status" 2>/dev/null)
  echo $(( ${kb:-0} / 1048576 ))
}

boot_flag() { timeout 20 "$ADB" -s "$SERIAL" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r'; }
adb_state() { timeout 20 "$ADB" -s "$DEVICE" get-state 2>/dev/null | tr -d '\r'; }

# The guest booted, and adb answers under the name the harness uses.
wait_boot() {
  local start=$SECONDS
  "$ADB" start-server >/dev/null 2>&1
  while [ "$(boot_flag)" != 1 ]; do
    [ $((SECONDS - start)) -ge "$BOOT_WAIT" ] && { log "no boot within ${BOOT_WAIT} s"; return 1; }
    sleep "$POLL"
  done
  "$ADB" connect "$DEVICE" >/dev/null 2>&1
  while [ "$(adb_state)" != device ]; do
    [ $((SECONDS - start)) -ge "$BOOT_WAIT" ] && { log "adb never answered on $DEVICE"; return 1; }
    sleep "$POLL"
    "$ADB" connect "$DEVICE" >/dev/null 2>&1
  done
  log "up after $((SECONDS - start)) s: $(timeout 20 "$ADB" -s "$DEVICE" shell getprop ro.product.cpu.abi | tr -d '\r'), rss $(rss_gb) GB"
}

restart() {
  log "restarting $UNIT ($1)"
  "$ADB" disconnect "$DEVICE" >/dev/null 2>&1
  svc restart "$UNIT" || { log "systemctl restart failed"; return 1; }
  wait_boot
}

watchdog() {
  local bad=0 state gb i=0
  log "watchdog: soft ${SOFT_GB} GB under the lock, hard ${HARD_GB} GB, every ${INTERVAL} s"
  while [ -z "${ITERATIONS:-}" ] || [ "$i" -lt "$ITERATIONS" ]; do
    i=$((i + 1))
    state=$(adb_state)
    if [ "$state" = device ]; then
      bad=0
      gb=$(rss_gb)
      if [ "$gb" -ge "$HARD_GB" ]; then
        restart "qemu rss ${gb} GB >= ${HARD_GB} GB"
      elif [ "$gb" -ge "$SOFT_GB" ]; then
        log "qemu rss ${gb} GB >= ${SOFT_GB} GB: waiting for $LOCK (<= ${LOCK_WAIT} s)"
        [ -e "$LOCK" ] || : > "$LOCK" 2>/dev/null
        flock -w "$LOCK_WAIT" -E 75 "$LOCK" "$SELF" _restart "qemu rss ${gb} GB, lock held"
        [ $? = 75 ] && log "lock wait timed out, deferring"
      fi
    else
      bad=$((bad + 1))
      log "adb offline ($bad): '$state'"
      if [ "$bad" -ge 2 ]; then restart "adb offline"; bad=0; fi
    fi
    [ -n "${ITERATIONS:-}" ] && [ "$i" -ge "$ITERATIONS" ] && break
    sleep "$INTERVAL"
  done
}

case "${1:-status}" in
  rss) rss_gb ;;
  status)
    printf 'unit=%s boot=%s adb=%s rss=%s GB\n' "$(systemctl is-active "$UNIT" 2>/dev/null)" "$(boot_flag)" "$(adb_state)" "$(rss_gb)" ;;
  wait) wait_boot ;;
  start) svc start "$UNIT" && wait_boot ;;
  stop) "$ADB" disconnect "$DEVICE" >/dev/null 2>&1; svc stop "$UNIT" ;;
  restart) restart "${2:-requested}" ;;
  _restart) restart "${2:-requested}" ;;
  guard)
    gb=$(rss_gb); state=$(adb_state)
    if [ "$state" != device ]; then restart "guard: adb is '$state'"
    elif [ "$gb" -ge "$SOFT_GB" ]; then restart "guard: qemu rss ${gb} GB >= ${SOFT_GB} GB"
    else log "guard: qemu rss ${gb} GB < ${SOFT_GB} GB, adb $state, no restart"; fi ;;
  watchdog) watchdog ;;
  *) echo "usage: emulator.sh start|stop|restart|status|rss|wait|guard|watchdog" >&2; exit 2 ;;
esac
