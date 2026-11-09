#!/usr/bin/env bash
# emulator-remote.sh <command>: qa/ci/emulator.sh on the OVH host, from another machine (QA_EMULATOR_HOST, default ovh-root).
# For QA_EMULATOR_SH when the lane runs from a terminal; it does not take the emulator lock, `native-qa hold` does.
exec ssh "${QA_EMULATOR_HOST:-ovh-root}" /opt/svelte-qa/bin/emulator.sh "$@"
