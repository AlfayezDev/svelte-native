#!/usr/bin/env bash
# lane.sh reset|build|emulator|crashes|summary — the stages of .github/workflows/native-qa.yml, kept in a script so they run the
# same way from a terminal: QA_DEVICE=localhost:5555 bash qa/ci/lane.sh emulator
#
#   reset      forget the previous lane's run files, logs and report (the workspace of the runner is kept between runs)
#   build      the release APK of the QA app for x86_64 (and the smoke app when QA_SMOKE=1)
#   emulator   a fresh emulator, then the stages below, then report and gates. Run it under the emulator lock:
#                node qa/native-qa.ts hold --device "$QA_DEVICE" -- bash qa/ci/lane.sh emulator
#   crashes    the 1,000 cold starts and 100 suites in chunks, resumed after an outage; each chunk holds the lock on its own so
#              the host's watchdog can restart the emulator between them
#   summary    the stage table, the gate tables and the tail of every failed stage, to $GITHUB_STEP_SUMMARY (or stdout)
#
# Every stage runs even when an earlier one failed, because the report should say everything that is wrong; the script exits 1
# if any stage failed, the gates included. Output of stage <name> is qa/out/lane-<name>.log; qa/out/lane-stages.tsv has one
# line per stage: name, result, seconds, qemu GB at its end.
#
# Environment (the workflow sets them):
#   QA_MODE      push (default): lab, quick parity and a11y, gestures.  full: also boot, resilience, the full parity and a11y
#                matrices, and the smoke app when QA_SMOKE=1
#   QA_REPEAT    lab repeats (3). Under QA_MODE=push the lab.runs gate (the production 10) is not judged
#   QA_WARM, QA_COLD   boot launches in full mode (30, 30)
#   QA_DEVICE    the serial (localhost:5555)
#   QA_SMOKE     1: build and run the smoke app in full mode; needs apps/platform/libs/samsungpay.jar or $QA_SAMSUNGPAY_JAR
#   QA_STARTS, QA_SUITES, QA_CHUNK   the crash volume (1000, 100, 100)
#   QA_CLI       the harness command (node qa/native-qa.ts); QA_EMULATOR_SH the emulator script (qa/ci/emulator.sh; from another
#                machine qa/ci/emulator-remote.sh, which runs it on the host over ssh)
set -u

CI_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$CI_DIR/../.." || exit 2   # apps/platform
OUT=qa/out
STAGES=$OUT/lane-stages.tsv
MODE=${QA_MODE:-push}
REPEAT=${QA_REPEAT:-3}
WARM=${QA_WARM:-30}
COLD=${QA_COLD:-30}
DEVICE=${QA_DEVICE:-localhost:5555}
EMULATOR=${QA_EMULATOR_SH:-$CI_DIR/emulator.sh}
# shellcheck disable=SC2206  # a command line, split on purpose
QA=(${QA_CLI:-node qa/native-qa.ts})
FAILED=0

emulator_rss() { bash "$EMULATOR" rss 2>/dev/null || echo "?"; }

# stage <name> <command...>: runs it with its output in qa/out/lane-<name>.log and on the console, records the result, goes on.
stage() {
  local name=$1 start=$SECONDS rc
  shift
  mkdir -p "$OUT"
  echo "::group::$name"
  "$@" 2>&1 | tee "$OUT/lane-$name.log"
  rc=${PIPESTATUS[0]}
  echo "::endgroup::"
  local seconds=$((SECONDS - start))
  printf '%s\t%s\t%s\t%s\n' "$name" "$([ "$rc" = 0 ] && echo pass || echo "fail($rc)")" "$seconds" "$(emulator_rss)" >> "$STAGES"
  if [ "$rc" != 0 ]; then
    FAILED=$((FAILED + 1))
    echo "::error title=$name failed::exit $rc after ${seconds}s; log: $OUT/lane-$name.log"
  fi
  return 0
}

# A lane that was told to stop says so in the table instead of vanishing from it.
cancelled() {
  printf '%s\t%s\t%s\t%s\n' "(stopped)" "cancelled" "$SECONDS" "$(emulator_rss)" >> "$STAGES"
  exit 143
}

# Between stages: restart the emulator if it leaked past SOFT_GB or went offline (the lane holds the lock, so nobody is hurt).
fresh_enough() { stage "guard-$1" bash "$EMULATOR" guard; }

reset() {
  rm -rf qa/runs qa/report.json "$OUT"/lane-* "$OUT"/gates* "$OUT"/*.log "$OUT"/build-*.json
  mkdir -p "$OUT"
}

build() {
  mkdir -p "$OUT"
  trap cancelled TERM INT
  stage build-qa "${QA[@]}" build --abi x86_64
  if [ "$MODE" = full ] && [ "${QA_SMOKE:-0}" = 1 ]; then
    local jar=${QA_SAMSUNGPAY_JAR:-/var/lib/svelte-qa/secrets/samsungpay.jar}
    if [ ! -f libs/samsungpay.jar ] && [ -f "$jar" ]; then mkdir -p libs && cp "$jar" libs/samsungpay.jar; fi
    stage build-smoke "${QA[@]}" build --abi x86_64 --variant smoke
  fi
  [ "$FAILED" = 0 ]
}

emulator() {
  mkdir -p "$OUT"
  trap cancelled TERM INT
  local quick=--quick kinds=lab,parity,a11y,gestures except=()
  if [ "$MODE" = full ]; then
    quick=""
    kinds=lab,boot,parity,a11y,resilience,gestures
  else
    except=(--except lab.runs)
  fi

  # A fresh instance before anything is measured: the host leaks memory with every app launch, and frame timings and the
  # watchdog's restarts should not land in the middle of the first stage.
  stage emulator-restart bash "$EMULATOR" restart "fresh instance for the lane"
  if ! tail -n 1 "$STAGES" | grep -q 'pass'; then
    echo "::error title=no emulator::the emulator did not come back; nothing was measured"
    return 1
  fi

  stage lab "${QA[@]}" lab --device "$DEVICE" --repeat "$REPEAT"
  if [ "$MODE" = full ]; then
    fresh_enough boot
    stage boot "${QA[@]}" boot --device "$DEVICE" --warm "$WARM" --cold "$COLD"
  fi
  fresh_enough parity
  # shellcheck disable=SC2086  # $quick is one flag or nothing
  stage parity "${QA[@]}" parity --device "$DEVICE" $quick
  fresh_enough a11y
  # shellcheck disable=SC2086
  stage a11y "${QA[@]}" a11y --device "$DEVICE" --no-install $quick
  if [ "$MODE" = full ]; then
    fresh_enough resilience
    stage resilience "${QA[@]}" resilience --device "$DEVICE" --no-install
  fi
  fresh_enough gestures
  stage gestures "${QA[@]}" gestures --device "$DEVICE" --no-install --input both
  if [ "$MODE" = full ] && [ "${QA_SMOKE:-0}" = 1 ]; then
    fresh_enough smoke
    stage smoke "${QA[@]}" smoke --device "$DEVICE"
  fi

  stage report "${QA[@]}" report
  stage gates "${QA[@]}" gates --platform android --runs "$kinds" "${except[@]}" --markdown "$OUT/gates.md"
  if [ "$MODE" = full ] && [ "${QA_SMOKE:-0}" = 1 ]; then
    stage gates-smoke "${QA[@]}" gates --smoke --platform android --runs smoke --markdown "$OUT/gates-smoke.md"
  fi
  [ "$FAILED" = 0 ]
}

# The crash volume. `crashes --chunk` ends non-zero when a chunk did (an emulator that went away); the same command plus
# --resume continues the file, so it is tried again, with a restart before each attempt.
crashes() {
  mkdir -p "$OUT"
  trap cancelled TERM INT
  local attempt resume="" lost=0 finished=0
  for attempt in 1 2 3 4 5 6; do
    "${QA[@]}" hold --device "$DEVICE" --wait 21600 -- bash "$EMULATOR" guard
    stage "crashes-$attempt" "${QA[@]}" crashes --device "$DEVICE" --starts "${QA_STARTS:-1000}" --suites "${QA_SUITES:-100}" --chunk "${QA_CHUNK:-100}" $resume
    if tail -n 1 "$STAGES" | grep -q 'pass'; then finished=1; break; fi
    lost=$((lost + 1))
    resume=--resume
  done
  # An attempt that a later one made up for is not a failure of the volume; the gates decide whether the numbers are there.
  [ "$finished" = 1 ] && FAILED=$((FAILED - lost))
  stage report "${QA[@]}" report
  stage gates "${QA[@]}" gates --platform android --runs crashes --except lab.runs --markdown "$OUT/gates.md"
  [ "$FAILED" = 0 ]
}

summary() {
  local target=${GITHUB_STEP_SUMMARY:-/dev/stdout}
  {
    local sha=${GITHUB_SHA:-local}
    echo "## Android emulator lane (${QA_MODE:-push}, ${sha:0:9})"
    echo
    if [ -s "$STAGES" ]; then
      echo "| stage | result | time | qemu RSS |"
      echo "| --- | --- | --- | --- |"
      awk -F'\t' '{ r = ($2 == "pass") ? "pass" : "**" $2 "**"; printf "| %s | %s | %dm%02ds | %s GB |\n", $1, r, $3 / 60, $3 % 60, $4 }' "$STAGES"
    else
      echo "No stage ran: the job stopped before the lane started (see the steps above)."
    fi
    echo
    for table in "$OUT/gates.md" "$OUT/gates-smoke.md"; do
      [ -s "$table" ] && { cat "$table"; echo; }
    done
    if [ -s "$STAGES" ]; then
      awk -F'\t' '$2 != "pass" { print $1 }' "$STAGES" | while read -r name; do
        [ -s "$OUT/lane-$name.log" ] || continue
        echo "<details><summary>Last lines of stage <code>$name</code></summary>"
        echo
        echo '```'
        tail -n 30 "$OUT/lane-$name.log" | cut -c1-240
        echo '```'
        echo
        echo "</details>"
        echo
      done
    fi
  } >> "$target"
}

case "${1:-}" in
  reset) reset ;;
  build) build ;;
  emulator) emulator ;;
  crashes) crashes ;;
  summary) summary ;;
  *) echo "usage: lane.sh reset|build|emulator|crashes|summary" >&2; exit 2 ;;
esac
