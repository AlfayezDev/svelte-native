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
emulator/device targets for concurrent navigation/cancel/commit QA. Existing
compiler transition-fixture errors are a separate owner-controlled blocker.

## Streaming and background uploads

The current path is `NativeFile` bytes -> SvelteKit `serialize_binary_form` ->
`BinaryFormBlob.bytes()` -> configured `fetch`. By the time custom fetch runs,
the complete request has been allocated. Swapping fetch alone cannot make this
path streaming or restart-safe.

The installed Kit server can consume the binary form body incrementally and use
lazy file values. A streaming client can preserve that protocol, but requires a
file-backed encoder preserving exact offsets/order and a native upload transport
that actually consumes files/streams without rebuilding the body in JS memory.
No such client transport is currently wired into this repository. A generic
ReadableStream helper that still calls `.bytes()` would only disguise buffering.

Background delivery additionally requires durable private payload staging,
native task identity/progress/cancellation, process-restart recovery, credential
expiry handling, result reconciliation and server idempotency. The current
in-memory remote form result/refresh/redirect lifecycle cannot stand in for those
contracts. The next implementation gate is a chosen native transfer backend and
an authenticated, idempotent test upload endpoint, followed by Android/iOS
background/relaunch/cancel tests. Do not silently persist credentials or payloads
while trying to emulate this with JavaScript retries.

Current buffered uploads remain usable with explicit byte limits and server
validation. They now reject timestamp metadata the Kit parser cannot represent.
