#!/bin/bash
# Native heap dumps of a soak at its baseline window, its first checkpoint and its final window, for heapdiff.py.
#
#   flock /tmp/svelte-qa-emulator.lock qa/soak/malloc-debug-soak.sh <serial> <apk> <out-dir> [soak-seconds]
#
# The app runs under malloc_debug with 14-frame backtraces (`wrap.<package>`, needs a userdebug image and `su`), which
# slows it down several times but allocates what it allocates; `am dumpheap -n` writes the live allocations with their
# backtraces. The property is cleared and the app stopped on exit. Hold the emulator lock for the whole run.
set -u
SERIAL=$1; APK=$2; OUT=$3; SECONDS_TO_RUN=${4:-420}
PKG=dev.alfayez.exposvelte.qa
A="adb -s $SERIAL"
mkdir -p "$OUT"
cleanup() { $A shell "su 0 setprop wrap.$PKG ''"; $A shell am force-stop $PKG; }
trap cleanup EXIT
$A install -r "$APK" > /dev/null
$A shell "am force-stop $PKG"; sleep 1
$A shell "su 0 setprop wrap.$PKG 'LIBC_DEBUG_MALLOC_OPTIONS=backtrace=14 logwrapper'"
$A shell "logcat -c"
$A shell "am start -n $PKG/.MainActivity -a android.intent.action.VIEW -d 'expo-svelte-qa:///__dev?run=soak-mix-${SECONDS_TO_RUN}s'" > /dev/null
dump() {
  local tag=$1 pid
  pid=$($A shell pidof $PKG | tr -d '\r')
  echo "dump $tag pid=$pid at $(date +%T)"
  $A shell "am dumpheap -n $pid /data/local/tmp/$tag.heap"
  sleep 6
  $A shell "su 0 cat /data/local/tmp/$tag.heap" > "$OUT/$tag.heap"
  $A shell "dumpsys meminfo $PKG" > "$OUT/$tag.meminfo"
  $A shell "su 0 rm -f /data/local/tmp/$tag.heap"
}
# The lab logs a [Svelte soak] line per sample; dump once per window, 9 s in (after its three samples).
$A logcat -v brief ReactNativeJS:I '*:S' > "$OUT/soak.log" 2>/dev/null &
LOGCAT=$!
done_base=0; done_mid=0
deadline=$((SECONDS + SECONDS_TO_RUN + 150))
while [ $SECONDS -lt $deadline ]; do
  if [ $done_base = 0 ] && grep -q '"phase":"baseline"' "$OUT/soak.log"; then done_base=1; sleep 9; dump base; fi
  if [ $done_mid = 0 ] && grep -q '"phase":"checkpoint"' "$OUT/soak.log"; then done_mid=1; sleep 9; dump mid; fi
  if grep -q '"phase":"final"' "$OUT/soak.log"; then sleep 9; dump final; break; fi
  sleep 2
done
kill $LOGCAT 2>/dev/null
echo "dumps in $OUT: heapdiff.py $OUT $APK qa/out/app-<abi>.symbols"
