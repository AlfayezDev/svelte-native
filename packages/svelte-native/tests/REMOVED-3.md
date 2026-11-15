# Removed, merged and moved: group 3

Format: `- <old file> "<old test name>": <merged into | duplicate of | removed because> <where>`. Files are in `packages/svelte-native/tests/`.

## Removed and merged

- updates-module.test.ts "the TypeScript declaration is not empty": merged into native-host/contracts/updates-module.test.ts "Android and iOS expose the constants and functions the client declares" (its first two assertions guard the lists that test compares).
- fetch/body.test.ts "a Blob is not read into JavaScript: its type is the Content-Type and the upload is the native Blob": duplicate of web-apis/fetch/fetch.test.ts "a large Blob joined from parts is uploaded from native segments, without being read in JavaScript" (no `blob.` call, the bytes arrive) and "a Blob, a File's type and URLSearchParams set their Content-Type; a given one wins" (the type is the Content-Type).
- fetch/body.test.ts "a ReadableStream body is drained to bytes before it is sent": duplicate of web-apis/fetch/fetch.test.ts "a ReadableStream body is drained to bytes and then sent".
- fetch/fetch.test.ts "UTF-8 with a byte order mark and an invalid sequence reads the same by every route": merged into web-apis/fetch/body.test.ts "text decodes UTF-8: a byte order mark is dropped, invalid bytes are U+FFFD, in every kind of body and by every route of a network body" (same bytes, same expected string, the network routes are its last assertions).
- fetch/fetch.test.ts "a signal that carries no reason (React Native's AbortController drops it) gives the default AbortError": merged into web-apis/fetch/fetch.test.ts "the default reason is an AbortError DOMException, also for a signal that carries no reason (React Native's AbortController drops it)".
- fetch/polyfills.test.ts "polyfills.ts does not import anything of src/fetch at load: it is required inside the getters": removed because it is two regexes on the text of polyfills.ts and "they are getters at boot and nothing of src/fetch is evaluated: boot reads neither the layer nor the native module registry" proves the same by running the file (`loadedAtBoot` is empty).
- updates-client.test.ts "an update that is not newer than the embedded bundle is rejected": merged into updates/client.test.ts "an update that %s is rejected by the selection policy" (rows "is not newer than the embedded bundle" and "is as old as the embedded bundle").
- updates-client.test.ts "an update that is not newer than the running update is rejected, even when the embedded bundle is older": merged into the same test.each (row "is not newer than the running update, even when the embedded bundle is older").
- updates-client.test.ts "an update for another runtime version is rejected": merged into the same test.each (row "is for another runtime version").
- updates-client.test.ts "the server's filters reject an update whose metadata disagrees": merged into the same test.each (row "has metadata the server's filters disagree with").
- animation/animation.test.ts "the CSS `transition` shorthand reaches a CSSManager like the longhand keys, and never the native payload": merged into "Reanimated CSS keys, the longhand ones and the `transition` shorthand, go to a CSSManager built from the node, and never reach the native payload" (its last assertions).
- fork.test.ts "(d) fork(() => router.goto('/b')) with the route's modules loaded renders the page off screen, and the commit puts it on": merged into navigation/prepare.test.ts "router.prepare loads the modules, renders the screen off screen, and commit() puts it on with its effects run once" (prepare is built on fork; the page texts before the commit and the screens after it are now asserted there).
- css-build.test.ts (the assertion, not a test) `expect(TAILWIND_VERSION).toBe("4.3.3")`: removed because it pins a literal that every Tailwind bump edits and checks no behaviour; compiler/css-build.test.ts compares TAILWIND_VERSION with the version of the Tailwind the tests link instead.

## Moved out of the package's suite

- updates-module.test.ts "app.config points at the project's EAS Update URL with an app-version runtime policy", "a build without a channel (a local build, or `eas update` reading the config) sends no channel and does not check", "each store-bound profile has a channel, and the config reads the same one": moved to apps/qa/qa/test/updates-config.test.ts (they test the QA app's configuration; `bun test qa` in apps/qa runs them, as in CI).

## Moved to another file of the group, names unchanged

- init-app.test.ts "examples/minimal's overrides are the ones init writes, and the React Native it pins is the one the override is", "the dependencies are examples/minimal's and inside the package's peer ranges, and the patched ones are the patches' versions", "the configuration page's snippets carry the versions, the patches and the Svelte build init writes": package/docs-examples.test.ts.
- fork.test.ts: the (a), (b), (c), fork_timing, experimental_async_required and (e) tests are renderer/fork.test.ts; the router.prepare and "(d) when the route's modules are still loading" tests are navigation/prepare.test.ts; "for components that do not await, async mode changes the compiled output by one import line ...", "components compiled with experimental.async fork as the ones that only import the flag do" and "async mode is one switch for the bundle ..." are compiler/async-mode-fork.test.ts.

## Cross-group

For the final pass: a duplicate whose counterpart is in a file of another group, left in both places.

- navigation/prepare.test.ts "router.prepare gives the same tree and the same effects as goto" and prepare-tree.test.ts "prepare + commit gives what goto gives: <case>" (the prepare-tree cases carry the one-page case).
- compiler/async-mode-fork.test.ts "for components that do not await, async mode changes the compiled output by one import line, and the library's components are such", async-option.test.ts "every Svelte file the transformer sees ..." and svelte-async-mode.test.ts "the Metro transformer compiles components and modules without Svelte's async mode, unless the app asks for it": three checks that async mode adds the flag import and nothing else.
- renderer/support/fork.ts `shape()` and async-mode-parity.test.ts `shape()`: one copy each.
- native-host/contracts/updates-module.test.ts "the bundle handler only works if the generated MainApplication builds its host through ExpoReactHostFactory" and expo-headless.test.ts "MainApplication is idempotent" (the test builds a string that contains what it asserts; expo-headless checks the structure of the same output).
- compiler/worklet-state.test.ts "with the app's `runes: false` Svelte infers each file's mode again ..." and "a Svelte library below node_modules keeps Svelte's own default ...", and runes-default.test.ts "which files are compiled in runes mode" (the same file x mode matrix through the transformer).
- compiler/worklet-state.test.ts "a worklet that reads $state in a runes component is refused too ..." and "a gesture callback is workletized without the directive ...", and gestures/toolchain.test.ts "a UI-thread callback that reads $state is refused in development" and "with .runOnJS(true) the same read is fine" (the build side and the run-time side of the same two ideas).
- compiler/cache-key.test.ts, async-option.test.ts "the transformer's cache key follows it" and runes-default.test.ts "the transformer's cache key follows the setting": the files and the options of one cache key.
- compiler/lower.test.ts "the files that are lowered" and runes-default.test.ts "which files are compiled in runes mode": both classify library paths through `isLibrarySource`; one table of path -> (lowers HTML, runes) would carry both.
- package/types.test.ts and dist.test.ts: the same five checks (same files, same bytes, deterministic, package.json points at it, not git-ignored) for dist/types and dist/node; type-budget.test.ts "every typed entry of the exports map resolves to its declaration" and package/types.test.ts "`types` is the declaration of `svelte-native-source` in dist/types, and both are files".
- package/internals-types.test.ts and node-modules.test.ts "svelte-check passes on an app that declares nothing of the library's ...": the static twin and the behavioural proof.
- web-apis/geolocation.test.ts "a build without the module answers denied" and navigator.test.ts "in a build without it: navigator.geolocation is undefined with one warning ..., and the permission reads denied".
- kit/remote-files.test.ts and remote-form.test.ts "SvelteKit's binary serialization of files ..." / "file fields take Files, keep them as given, reset" (the same form-file path with the platform's Blob; remote-files adds the native Blob and the failure message).

## Left for the final pass

- Shared helpers that files of other groups import stay where they are: fork-harness.ts and async-run.ts (prepare-tree, async-mode-parity), css-project.ts (metro-classes), updates-fixtures/eas.ts (kit-device), native/host-tools.ts and the other Kotlin and C++ hosts in native/ (the CI comment and apps/qa/qa/README.md still say `tests/native/*Host.kt`, true for the others; this group's two hosts are native-host/fixtures/).
- Comments in files of other groups that name a file of this group by its old name: async-mode-parity.test.ts and async-option.test.ts and fork-harness.ts ("fork.test.ts" is renderer/fork.test.ts and compiler/async-mode-fork.test.ts), svg-configs.test.ts ("view-configs.test.ts" is renderer/view-configs.test.ts).
- kit/remote-files.test.ts builds the remote client twice (about 1.3 s each): `loadClient` in remote-harness.ts builds on every call and is another group's.
- The four `mock.module` stand-ins of web-apis/fetch/support/setup.ts are process-wide, because Bun cannot take a mock back; a package-level slow suite in a process of its own would end that.
- web-apis/fetch/body.test.ts is a third `Request` tests: a request.test.ts split was not made.
- The mulberry32 `random()` is still copied in compiler/lower-html-compile.test.ts, renderer/view-configs.test.ts and html-differential.own-process.ts.
- Kept as they are, on purpose: the abort tests of fetch.test.ts that depend on the garbage collector, the Bun watcher test of compiler/watch-tree.test.ts (it cannot fail on the Node bug, which compiler/watch-tree-node.test.ts covers, but it checks watchTree itself), the geolocation timeout tests (different scenarios, not variants of one table), and the two other "no reason" tests of web-apis/fetch/fetch.test.ts (the reason is there before the listeners run; the reason of an abort wins over the native error: different facts from the default error).
