#!/usr/bin/env bash
# All the Android host checks of the native code, one after the other: the engine (engine.sh: g++, kotlinc, java), fetch and Blob (fetch.sh: kotlinc, java,
# bun and node, the OkHttp and Okio jars), the blur view (blur.sh: kotlinc, java) and push (push.sh: kotlinc, java). No device, no Android SDK. From any directory. Usage: src/test/run.sh
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
for check in engine fetch blur push; do
  echo "== $check"
  bash "$here/$check.sh"
done
