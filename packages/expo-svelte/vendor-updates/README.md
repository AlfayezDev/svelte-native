# Updating the vendored packages

The library carries its third-party native packages as copies of their npm tarballs (`vendor/<name>/`, VENDORING.md). An app installs none of them, so the copy is the only code of that package an app runs: an update is a change to code the library ships, and is reviewed as one. This directory says how an agent (or a person) updates a copy: this file is the procedure every update follows, and `<name>.md` beside it is the strategy of one package (what it is coupled to, which version to move to, what to look for in its source, what proves the update). An update whose package has no strategy file stops here: write the file first.

The files here are for the repository; they are not in the published package (`files` in `package.json` does not list this directory).

## Rules

- **One package per pull request**, or one coupled group that must move together (each strategy file names its group: Reanimated with Worklets, the Nitro runtime with MMKV and quick-crypto, the Expo modules with an Expo SDK). A version bump never rides along with other work.
- **Never install the package to try it.** `npm pack <name>@<version>` into a scratch directory downloads the tarball and runs nothing; `npm install` would run its lifecycle scripts and its dependencies'. The scratch directory is new and empty, and nothing in it is run.
- **Builds, tests and device runs happen on the QA hosts** (OVH for Linux and Android, the Mac for iOS), never on a workstation (`AGENTS.md`, "Heavy runs").
- **The copy is never edited by hand.** `node scripts/vendor.ts` writes it from the tarball; a local change is a patch in `vendor-patches/<name>/` that the script applies.
- **A finding the agent cannot explain stops the update.** The report says what was found and the update waits for the owner (see "Red flags").
- Pushing, opening the pull request and merging follow the owner's instructions for the session; dispatching workflows and pushing tags are the owner's (`AGENTS.md`).

## 1. What is out of date

From `packages/expo-svelte`, list each copy's version against the registry's latest:

```sh
node --input-type=module -e '
import { vendoredPackages } from "./src/vendored.ts";
import { execFileSync } from "node:child_process";
for (const { name, version } of vendoredPackages) {
  const latest = execFileSync("npm", ["view", name, "version"], { encoding: "utf8" }).trim();
  if (latest !== version) console.log(`${name} ${version} -> ${latest}`);
}'
```

The registry's latest is not the target: the package's strategy file says which version to move to (an Expo module follows the SDK in the library's `expo` peer; Reanimated moves only with a Worklets version its compatibility table names). Also look for advisories and deprecations, which make an update urgent whatever the policy says:

```sh
gh api "/advisories?ecosystem=npm&affects=<name>" --jq '.[] | [.ghsa_id, .severity, .summary, .vulnerabilities[0].vulnerable_version_range] | @tsv'
npm view <name>@<version> deprecated
```

Native dependencies that a copy's podspec or `build.gradle` downloads (each strategy file lists them) have their own releases and advisories: check them too.

## 2. Pick the target

Read `<name>.md`: its "Version policy" and "Coupled with". Then read the package's changelog or release notes from the current version to the target (the repository's `CHANGELOG.md` or its GitHub releases), and write down every entry that touches what the strategy file lists under "What the library relies on": a renamed prop or event, a changed native class, a new minimum React Native, Expo SDK, iOS or Android version, a new native dependency.

## 3. Check the source before it is copied

This is the step that makes vendoring safe: the copy runs in every app, and no package manager will warn anyone later. Work in a scratch directory.

1. **The tarball is the registry's.** `npm view <name>@<target> dist.integrity dist.tarball gitHead repository.url --json`, then `npm pack <name>@<target>`: the integrity npm prints must equal `dist.integrity` (the vendor script checks this again before it replaces the copy).
2. **What changed since the copy.** Pack the current version too (`npm pack <name>@<current>`), unpack both (`tar -xzf`, each into its own directory) and diff them (`diff -ru old/package new/package`). Do not diff against `vendor/<name>/`: it carries the patches. Summarize the diff: files added, removed and changed per directory (`android/`, `ios/` or `apple/`, `cpp/`, `src/`, the built JavaScript, the config plugin), and the size of each.
3. **The tarball is the upstream source.** The registry records the commit it was published from (`gitHead`; Expo's packages are published from the `expo/expo` monorepo, so the package is a directory of that commit). Fetch that commit (`git clone --filter=blob:none <repository>` and `git checkout <gitHead>`) and diff every hand-written file of the tarball against it: the native sources, `src/`, the podspec, `build.gradle`, `CMakeLists.txt`, the config plugin's sources. They must be identical. Files that are built at publish time (`lib/`, `build/`, `plugin/build/`, `dist/`) have no counterpart in the repository: check that the built JavaScript exports what `src/` does and contains nothing `src/` lacks (search both for URLs, `eval`, `Function(`, `child_process`, `fetch`, `XMLHttpRequest`, base64 blobs). A package without `gitHead` (some publish from a dirty tree) is compared with the tag of the version instead, and the report says so.
4. **Red flags.** Each of these stops the update until the report explains it and the owner agrees:
   - a lifecycle script (`preinstall`, `install`, `postinstall`, `prepare`) that the current version did not have;
   - a new prebuilt binary (`.so`, `.a`, `.aar`, `.jar`, `.xcframework`, `.framework`, `.dylib`, `.wasm`, `.node`) or a changed one, without a way to tie it to the upstream build (release assets with checksums, a reproducible build);
   - new network access in native code or in the config plugin (URLs, HTTP clients, sockets), or a build step that downloads something (a Gradle task, a podspec `prepare_command` or a `curl` in the podspec, a script phase);
   - a new privacy-relevant API (location, camera, microphone, photos, contacts, calendars, motion, Bluetooth, tracking, health): App Store Connect asks every app whose binary references one for a usage text, so it decides whether the package can stay always linked;
   - a new native dependency (a pod, a Maven artifact, a Maven repository), or a changed version of one: it is code the app downloads at build time, with its own source to check;
   - a new JavaScript dependency (it becomes a dependency of the library);
   - a changed license, or code that is minified or obfuscated where the current version's was not;
   - a file in the tarball that is neither in the upstream commit nor built from it.

## 4. Write the copy

```sh
node scripts/vendor.ts <name>@<target> [--exclude <path>]...
```

Use the excludes the copy's `VENDOR.md` lists under "Left out" (and a new one when the new version adds something an app never needs: examples, tests, docs, prebuilt artifacts the build does not read). The script replaces `vendor/<name>/` as a whole, applies `vendor-patches/<name>/*.patch` in file-name order and writes `VENDOR.md` (integrity, sha256, what was left out, each patch with its sha256).

When a patch does not apply:

- **Upstream fixed it.** Find the upstream change (changelog, commit, the code at the target), then delete the patch file, its shape check in `src/doctor/shapes.ts`, its `patchSpecs` entry in `src/doctor/patches.ts` (or the part of it), and the tests that pin it; say so in the report.
- **Upstream did not.** Re-derive the patch on the new source: unpack the target into `a/` and `b/`, change `b/`, `diff -ru` them into the patch file (the header names the file as `a/<path>` and `b/<path>`, `patch -p1` format), run the script again, and update the doctor's shape check if the patched code changed shape.

## 5. Update the library

- The version in `src/vendored.ts` or `src/optional-libraries.ts` (a test keeps it equal to `vendor/<name>/package.json`), and "Current" in the package's strategy file (`tests/package/vendor-updates.test.ts` keeps it equal too).
- The autolinking entry, when the package's `ReactPackage` class, podspec, codegen library name, component descriptors or CMake paths changed: capture Expo's `react-native-config` for the installed package in a scratch app on the build host, and replace its fixture in `tests/cli/fixtures/vendored-autolinking/`.
- The package's JavaScript `dependencies`: the copy's must be in the library's `dependencies` at compatible ranges (the packaging test compares them).
- What the strategy file lists under "What the library relies on" (view configs, deep imports, class names, plugin behavior the library re-implements): each has a test that fails when the copy stops matching it; fix the library, not the test, unless the package's behavior changed on purpose.
- The strategy file itself: anything the update taught (a new coupling, a new download, a new check).
- `CHANGELOG.md` under `## Unreleased`: the package, old and new version, and anything an app sees (a fixed bug, a new minimum OS version, a removed prop).
- `pnpm --dir packages/expo-svelte build` on the build host, and commit `dist/` (`AGENTS.md`).

## 6. Prove it

On the QA hosts:

- `pnpm lint`, `pnpm typecheck`, the package's tests, the QA harness's tests, the example's tests, `scripts/consumer-check.sh all`.
- Android: a release build of the example app (every library turned on), the package's screens and then every screen from a cold start, with no crash and no error from the app's process in the log; the doctor on the example app.
- iOS: a Release build of the example app for the simulator, the same screens, the same log.
- An optional library: the example app with `libraries: {}` too, on both platforms: the package's classes, symbols and pods are not in the build, and the app runs.
- The checks the strategy file lists under "Proof".
- The emulator lane (`native-qa`) on the pull request.

## 7. Report

The pull request's description is the report, in this order:

1. **Package**: name, current → target, and why now (the policy, an advisory, a needed fix).
2. **Source check**: the tarball's integrity; the upstream commit it was compared with and the result ("identical except the built files", or each difference and its explanation); the red flags found, each with its explanation, or "none".
3. **Upstream changes that matter here**: the changelog entries from step 2, and what each means for the library.
4. **Patches**: each kept, re-derived (what changed) or dropped (the upstream change that made it unnecessary).
5. **Library changes**: what had to change and why.
6. **Proof**: each check of step 6 with its result; a check that could not run is listed with the reason, never left out.
7. **Left open**: anything not verified.
