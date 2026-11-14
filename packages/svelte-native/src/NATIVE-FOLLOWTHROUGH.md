# Native follow-through audit

This audit separates missing work from behavior already implemented. It is not
an implementation or a device-test report.

## Back navigation already present

- Android `native/svelte-engine/android/src/main/java/expo/modules/svelteengine/views/EngineStack.kt`
  registers `OnBackPressedCallback`, handles start/progress/cancel/press, applies
  native translation/scale, and reports dismissal after exit. The previous
  mounted screen is exposed during the gesture. Progress does not run through JS.
- iOS `native/svelte-screens-ios/native/Views/SvelteStackView.mm` uses native
  interactive pop, handles canceled transition bar restoration, and gives edge
  pop precedence over RNGH pans only in its activation zone.
- `router.prepare()` is forward speculation. It is not needed merely to reveal
  an already mounted previous screen and should not perform commands or writes
  during canceled back gestures.

A new Svelte-visible back-progress contract is optional additional functionality,
not a prerequisite for the native back behavior above. Before adding one, its
start/target token, progress, cancel, commit and dismissal ordering must be pinned
across nested stacks, redirects, screen removal and activity detachment. In
particular, Android progress/cancel currently re-read `top()` rather than using
the held `gestureScreen`: concurrent navigation during a gesture needs a native
regression test before changing that ownership behavior.

This checkout can run JS contract tests but has no Kotlin compiler, Android SDK
build tools/emulator or Apple build tools. Therefore no new native callback ABI
or ownership patch is claimed compiled or verified. The next implementation gate
is an Android native build/test environment, an iOS build environment, and named
emulator/device targets for concurrent navigation/cancel/commit QA. The earlier local
transition-fixture errors were resolved by applying the repository's existing
Svelte source patch; no new compiler change was needed.

## Streaming and background uploads

The current path is `NativeFile` bytes -> SvelteKit `serialize_binary_form` ->
`BinaryFormBlob.bytes()` -> configured `fetch`. By the time custom fetch runs,
the complete request has been allocated. Swapping fetch alone cannot make this
path streaming or restart-safe.

The installed Kit server can consume the binary form body incrementally and use
lazy file values. Main now supplies a SvelteFetch native transport with native
Blob/File handles, native segment-based request bodies and streaming response
reads. Those capabilities do not automatically change remote form encoding:
remote forms still call the scoped binary serializer and send a complete byte
array. `NativeFile.from(file)` deliberately reads and snapshots a native File's
contents before that encoding. It is compatible, but not a memory optimization.

A binary-form encoder that preserves native file handles alongside metadata
could use the new transport, but it must retain Kit's exact ordering/offsets and
validate on both native platforms. Passing a ReadableStream is not a shortcut:
`src/fetch/body.ts` StreamSource.upload drains it with readAll before sending.
Generic native Blob upload and buffered remote binary-form upload are separate
paths; do not claim their allocation behavior is the same.

Background delivery still requires durable private payload staging, native task
identity/progress/cancellation, process-restart recovery, credential expiry
handling, result reconciliation and server idempotency. Current iOS FetchClient
uses URLSessionConfiguration.default, not a persistent background-session
contract. The in-memory remote form result/refresh/redirect lifecycle cannot
supply restart handling. The next gate is a tested native-handle binary encoder
and authenticated, idempotent test upload endpoint, followed by Android/iOS
background/relaunch/cancel tests. Do not silently persist credentials or payloads
while trying to emulate this with JavaScript retries.

Current buffered uploads remain usable with explicit byte limits and server
validation. They now reject timestamp metadata the Kit parser cannot represent.

## Android parity investigation (2026-11-14)

PR head `3772a6d` ran the Android emulator lane (run `43544491618`): release
builds succeeded, 26 blocking gates passed, and `parity.diffPixels` failed at
2,385,720 pixels. Gesture functional checks passed 12/12; this is not a complete
platform-parity pass. The 106 selected pixel cases were 74 pass, 28 fail and
4 error. The 106 incomplete-case informational count also includes unselected
cases from the 208-case full matrix; it does not mean all selected cases failed.

Downloaded artifacts from main `b4d470f` (run `43473258700`) have identical
verdict, differing-pixel count, masked-pixel count and bounds for every selected
case. The earlier main `e24da9a` has the same failure pattern; main `ed5db02`
(run `43420539380`) passed all 106 cases on the same SDK 36 emulator. Exact base
`3ba874b` was canceled before producing artifacts, so there is no executed
current-base comparison. These failures predate this PR's changes.

The source investigation found two interacting issues exposed by same-page query
navigation: explicit sheet/modal presentation was swallowed by the in-place URL
update, and cleanup from an old conditional nested Screen cleared a newer
Screen's registered options. A host reproduction confirmed the latter removes
the native header configuration. Goldens and native Kotlin were not changed to
hide the failure. Any repair still needs a new emulator parity report before
claiming the visual failures are resolved on device.
