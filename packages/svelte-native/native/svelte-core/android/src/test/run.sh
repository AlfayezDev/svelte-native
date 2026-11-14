#!/usr/bin/env bash
# Host checks of the logic behind the SvelteFetch module: the HTTP client wiring, redirects, the body buffer and its backpressure, aborts, Blob segments, object
# URLs, file fetches, UTF-8, against the repository's test server (tests/fetch/server.ts, started here on a free port) and the Encoding standard's own results
# (vectors.ts, which the runtime's TextDecoder and TextEncoder make). No device, no Android SDK. Needs kotlinc, java, bun and node, and the OkHttp and Okio jars
# React Native 0.86 builds against: found in the Gradle cache, or named by OKHTTP_JAR and OKIO_JAR. Usage: src/test/run.sh
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
package="$(cd "$here/../../../../.." && pwd)"
work="$(mktemp -d)"
server=""
cleanup() {
  [ -n "$server" ] && kill "$server" 2>/dev/null || true
  rm -rf "$work"
}
trap cleanup EXIT
main="$here/../main/java/expo/modules/sveltecore"

cache="${GRADLE_USER_HOME:-$HOME/.gradle}/caches/modules-2/files-2.1"
okhttp="${OKHTTP_JAR:-$(find "$cache/com.squareup.okhttp3/okhttp/4.9.2" -name 'okhttp-4.9.2.jar' 2>/dev/null | head -n 1)}"
okio="${OKIO_JAR:-$(find "$cache/com.squareup.okio/okio/2.9.0" -name 'okio-jvm-2.9.0.jar' 2>/dev/null | head -n 1)}"
if [ -z "$okhttp" ] || [ -z "$okio" ]; then
  echo "run.sh: okhttp 4.9.2 and okio 2.9.0 jars not found in $cache (build any React Native app once, or set OKHTTP_JAR and OKIO_JAR)" >&2
  exit 1
fi

# The plain classes only: the Expo module and the Android file access are compiled by Gradle, not here.
kotlinc -nowarn -cp "$okhttp:$okio" \
  "$main/FetchTypes.kt" "$main/Utf8.kt" "$main/LocalFiles.kt" "$main/BlobData.kt" "$main/BodyBuffer.kt" "$main/BlobRequestBody.kt" "$main/ObjectUrls.kt" "$main/TempFiles.kt" "$main/Fetch.kt" \
  "$here/kotlin/expo/modules/sveltecore/FetchCheck.kt" -include-runtime -d "$work/fetch-check.jar"

bun "$here/vectors.ts" > "$work/vectors.txt"

port="$(node -e 'const s=require("net").createServer().listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')"
node "$package/tests/fetch/server.ts" --port "$port" > "$work/server.log" 2>&1 &
server=$!

run() { java "$@" -cp "$work/fetch-check.jar:$okhttp:$okio" expo.modules.sveltecore.FetchCheckKt "http://127.0.0.1:$port" "$work/vectors.txt" "$work/scratch"; }
run -Xmx1g
# The same classes with a heap of 64 MiB, on bodies of 200 MiB: they must fail the one fetch or go to a file, and the process must carry on.
rm -rf "$work/scratch"
java -Xmx64m -cp "$work/fetch-check.jar:$okhttp:$okio" expo.modules.sveltecore.FetchCheckKt "http://127.0.0.1:$port" "$work/vectors.txt" "$work/scratch" lowmem
