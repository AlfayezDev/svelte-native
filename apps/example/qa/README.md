# native-qa

The Svelte Native QA harness. It builds the QA app, runs the lab (28 functional checks plus the stress scenarios) and the boot runner on a device, merges what it measured into `report.json`, and judges that report against the production bar in `gates.json`. `gates` exits non-zero on any miss.

```
pnpm native-qa build  [--abi x86_64|arm64-v8a] [--prebuild]
pnpm native-qa lab    --device <serial> [--apk <path> | --no-install] [--dexopt profile|none] [--repeat <n>] [--run checks,quick] [--timeout <s>]
pnpm native-qa boot   --device <serial> [--apk <path> | --no-install] [--dexopt profile|none] [--warm <n>] [--cold <n>] [--idle <s>]
pnpm native-qa soak   --device <serial> [--apk <path> | --no-install] [--minutes 10] [--interval <s>] [--parts <names>]
pnpm native-qa crashes --device <serial> [--apk <path> | --no-install] [--starts 1000] [--suites 100] [--idle <s>] [--map <file>] [--symbols <dir>]
pnpm native-qa symbolicate [--input <logcat file>] [--map <file>] [--symbols <dir>] [--abi x86_64] [--all]
pnpm native-qa parity     --device <serial> [--apk <path> | --no-install] [--update | --missing] [--quick] [--filter <screen>]
pnpm native-qa a11y       --device <serial> [--apk <path> | --no-install] [--quick] [--filter <screen>]
pnpm native-qa resilience --device <serial> [--apk <path> | --no-install] [--rotations <n>] [--cycles <n>] [--rounds <n>]
pnpm native-qa report
pnpm native-qa gates  [--platform android|ios] [--all]
pnpm native-qa:emulator     # build, lab x10, boot 30 warm + 30 cold, report, gates (android) on localhost:5555
pnpm native-qa:suites       # parity, a11y and resilience on localhost:5555, then report (see "Parity, accessibility, resilience")
pnpm native-qa:test         # bun test qa
pnpm native-qa:typecheck    # tsc -p qa
```

Node 25 runs the TypeScript directly (`node qa/native-qa.ts`). Bun is only needed for the tests. Prerequisites for `build` are the Android SDK, JDK 17 and the repo's `pnpm install`; `lab` and `boot` need `adb` and `flock`.

## Devices and locks

`--device` is required for `lab` and `boot`; nothing defaults to a phone or a Mac. Serials that reach the shared OVH emulator (`localhost:<port>`, `127.0.0.1:<port>`, `emulator-<n>`) make the command re-run itself under `flock /tmp/svelte-qa-emulator.lock`, so it waits while another agent or job holds the emulator. `build` always runs under `flock /tmp/svelte-qa-gradle.lock`. If the tunnel is down: `ssh -f -N -L 5555:127.0.0.1:5555 ovh-root && adb connect localhost:5555`.

## Dexopt

`adb install` leaves an app at dexopt `verify`: everything runs in ART's interpreter until the JIT warms it up, which is not what a store install ships. After every install the harness does what the store does — installs the APK's baseline profile (`am broadcast -a androidx.profileinstaller.action.INSTALL_PROFILE -n <package>/androidx.profileinstaller.ProfileInstallReceiver`) and compiles against it (`cmd package compile -m speed-profile -f`), printing the broadcast result (1 installed, 2 already there) and the resulting dexopt status. `--dexopt none` skips it to measure the verify-only state; `--no-install` never touches it. The profile itself comes from the svelte-native Expo plugin (`baseline-prof.txt`: the engine and the updates module).

## Commands

**build** runs `svelte-native sync`, runs `expo prebuild --platform android --no-install` when `apps/platform/android` is missing or older than `app.config.ts`, `package.json`, the svelte-native Expo plugin or a module's `expo-module.config.json` (or with `--prebuild`), then `./gradlew :app:assembleRelease -PreactNativeArchitectures=<abi>` with the memory settings from the build recipe. The APK is copied to `qa/out/app-<abi>.apk` and described in `qa/out/build-<abi>.json` (size, sha256, commit, whether the tree was dirty). Gradle output goes to `qa/out/build-<abi>.log`. `EXPO_PUBLIC_API_URL` defaults to `https://dev.qarnos.com`.

**lab** installs the APK (`--apk`, else `qa/out/app-<abi>.apk` for the device's ABI if present, else the app already installed is measured as it is; `--no-install` never installs), then repeats `--repeat` times: force-stop, clear logcat, open `rasheed-svelte:///__dev?run=checks,quick`, follow logcat until the lab logs `[Svelte stress] complete` (or `--timeout` seconds pass), force-stop. The full logcat of each run is kept in `qa/runs/lab-<device>-<stamp>-<n>.log`; the parsed run goes to `qa/runs/lab-<device>-<stamp>.json`. A lab that hangs or crashes is recorded as incomplete, not as an error of the tool. `--run` also takes single scenarios (`list-300-virtual`, `churn-animated`, ...). The lab file records the `--run` it was started with (`run`), and `gates.json` pins the scenarios the full `checks,quick` run produces (`scenarios`, per platform): `report` computes `lab.scenarios.missing`, the pinned scenarios some run of the file lacks, and the gate on it is `<= 0`, so `lab --run checks,list-300-virtual --repeat 10` reads as the partial run it is. The frame gates see every pinned scenario too (a missing one is `not measured`), and `report` lists the missing names under the device's lab line. Two scenarios outside `quick` are for work on the windowed list: `list-mount-loop` mounts the 300-row `List` 40 times in one run (median, minimum and first mounts in its summary; the loop for a CPU profile of the mount) and `list-300-virtual-profile` is the gate's scenario with the host timing every flush (`detail.flushes`: start, duration, nodes created, payload, `createNode`, `appendChild` and `completeRoot` milliseconds).

**boot** installs the same way and then measures `--warm` warm and `--cold` cold launches (30 each by default, the production sample size). Per launch it clears logcat, runs `am start -W -n <package>/.MainActivity`, waits for `Displayed` and the `[Svelte boot]` line, and parses logcat. Results go to `qa/runs/boot-<device>-<stamp>.json` and a filtered log (`Start proc`, `Displayed`, `Running "main"`, `[Svelte boot]`, engine lines, faults) to `qa/runs/boot-<device>-<stamp>.log`.

**report** takes the newest lab run and the newest boot run of each device, computes the flat metrics, evaluates every gate and writes `qa/report.json`. It prints a per-device summary and the gate table. It warns when the runs of a device (lab, boot, soak, crashes, parity, a11y, resilience) measured different builds, or when one cannot say which build it measured, or when the lab and the boot run are of different commits. A build is identified by the sha256 of the installed `base.apk` on Android and by what the app itself reported on iOS (the digests of `main.jsbundle` and of the executable, "iOS" below); a run with no identity is a warning (`build identity not reported`), not a skip. For each device that has an accessibility run it prints one line per screen: the reach percentage (reachable of the interactive elements), `clipped`, the elements modelled from UIKit's state on iOS, and `tree not settled` for an Android dump that was not stable.

**gates** evaluates `gates.json` against the metrics in `report.json` (so editing a bar needs no new measurement), prints the table (wildcard gates collapsed to their worst value; `--all` prints every row) and exits 1 unless every row passed. `--platform android` judges only the Android bars, which is what the emulator lane does. A gate nobody measured is `not measured`, and `not measured` fails. `gates` also fails, with the reason printed first (`FAIL: ...`, before the table), when the report is not the current picture: a run file of a device of the judged platform under `qa/runs` was written after the report's `generatedAt` (run `report` again), or the report carries warnings for the judged platform (runs of different builds or commits, runs that did not identify their build). It prints the report's `generatedAt` and its age. Without `--platform` every device and every warning counts.

## Boot definitions

Both are processes started from nothing: `am force-stop` kills the app first, so `Start proc` is always in the log. The distance of each from a real first launch after install or reboot is stated, not hidden.

- **warm**: `am force-stop`, a 1.5 s pause, `am start`. The previous launch ran seconds earlier, so the page cache and the dex and oat files are hot.
- **cold**: Settings is brought to the front, the app is killed with `am force-stop`, the device idles `--idle` seconds (default 20), then the app is launched. Nothing is cleared (a `pm clear` would also delete the session and make every launch a first-run launch), and a stock emulator or phone cannot drop the page cache, so this is a process-cold, idle-gap launch, not a power-cycle launch. It captures what a user sees after the app has been out of the foreground and swapped out for a while.

The number gated is `Displayed` minus `Start proc`, both timestamps from the activity manager's lines in `logcat -v threadtime`, so it contains the zygote fork, the native host and the JavaScript. `am start -W` `TotalTime`, the system's own `Displayed ... +NNNms`, `Start proc` to `Running "main"` and the `[Svelte boot]` JavaScript total are recorded next to it (`boot.<kind>.totalTime.p90`, `.runningMain.p90`, `.jsTotal.p90`). p90 is nearest rank: with 30 samples it is the 27th smallest.

## Where every number comes from

| Metric              | logcat line                                                                                                                                                                | Parser                 |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| boot display        | `ActivityManager: Start proc <pid>:<package>/...` and `ActivityTaskManager: Displayed <package>/.MainActivity ...: +NNNms`                                                 | `parseLaunchMarkers`   |
| boot JS marks       | `ReactNativeJS: [Svelte boot] init 1 · polyfills 2 · ... · total 321 ms`                                                                                                   | `parseSvelteBoot`      |
| checks              | `'[native lab results]', '{"phase":"checks",...,"checks":[{"name":...,"passed":true},...]}'`, counted entry by entry because logcat cuts a line near 4 KB                  | `parseLabChecks`       |
| frames per scenario | `'[Svelte stress]', '{"name":...,"verdict":...,"frames":{"periodMs":...,"max":...,"droppedPct":...}}'`                                                                     | `parseStressScenarios` |
| list mount          | the `detail.mountMs` of the `list-300-virtual` scenario line                                                                                                               | `parseStressScenarios` |
| lab completion      | `'[Svelte stress] complete', '{"periodMs":...,"results":[{"name":...,"verdict":...}]}'`                                                                                    | `parseStressComplete`  |
| fatals              | `AndroidRuntime: FATAL EXCEPTION` followed by `Process: <package>`, `F libc: Fatal signal` for the package's process, `ANR in <package>`, a JavaScript fatal (`BridgelessReact: ...handleHostException(message = "..."`: a release build then destroys the React host and the process stays alive and blank, with no `FATAL EXCEPTION`), and every `E ReactNativeJS` line | `findFaults`           |
| engine warnings     | `W` and `E` lines with the tag `SvelteEngine`                                                                                                                              | `findEngineWarnings`   |

A scenario line cut by logcat, or a malformed one, throws instead of dropping the scenario (the raw log is already saved). A scenario the lab announced in its completion line but that has no frame data becomes a `null` metric, which is `not measured`.

## Metrics and gates

`report.json` holds one flat map of numbers per device (`devices.<serial>.metrics`). Across repeated lab runs a metric is the worst run (largest drop rate, smallest checks count); a scenario missing from any run is `null`.

| Metric                                                         | Meaning                                                                              |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `boot.{warm,cold}.{samples,attempts,min,p50,p90,max}`          | `Displayed` minus `Start proc`, ms; `samples` counts launches that produced the pair |
| `boot.{warm,cold}.{runningMain,totalTime,jsTotal}.p90`         | the side measurements named above                                                    |
| `boot.{warm,cold}.failed`                                      | launches that produced no display time (`attempts` minus `samples`), gated at 0      |
| `boot.{warm,cold}.jsTotal.samples`                             | launches that logged the `[Svelte boot]` total; the gate `boot.js.samples` (>= 30) reads the warm series, the one `boot.warm.jsTotal.p90` is the p90 of |
| `lab.runs`, `lab.incompleteRuns`                               | complete and incomplete lab runs                                                     |
| `lab.checks.{passed,failed}`                                   | functional checks                                                                    |
| `lab.scenarios.failed`                                         | scenarios the lab itself marks `fail`                                                |
| `lab.scenarios.missing`                                        | scenarios of the pinned list (`scenarios` in `gates.json`) that some run of the file lacks |
| `frames.<scenario>.{droppedPct,maxMs,maxPeriodRatio,periodMs}` | per scenario; ratio is the longest interval over the frame period                    |
| `list.virtual300.mountMs`                                      | 300-row virtual list, mount to layout                                                |
| `log.fatals`, `log.engineWarnings`                             | counted over every lab run and every boot launch. Android: crashes, ANRs and every `E ReactNativeJS` line. iOS: a dead app, the crash reports of the phone's crash log ("Crash reports" below: the ones attributed to a lab run or boot launch, and the ones no run owns) plus the JavaScript errors the app reports (`jsErrors`, its `console.error` count since launch); an app that reports none (an older build) leaves `log.fatals` `not measured`, never 0, unless a dead app or a crash report already makes it positive. `log.engineWarnings` on iOS is 0 by absence: there is no engine to warn |
| `log.crashReports`                                             | iOS only: the reports the phone's crash log gained during the lab, boot, parity and a11y runs of the newest files (attributed or not), gated `<= 0`. A file whose pull failed (`crashReportsError`), or that was recorded before the pull existed, leaves it `not measured`, which fails the gate, never 0, unless another file already counted a report |
| `memory.heapGrowthPct`, `memory.leakedViews`, `memory.deadTagWrites`, `soak.*`, `crashes.*` | written by the soak and crash runners, see "Soak and crashes"        |

`gates.json` is the production bar of `packages/svelte-native/PLAN.md`:

```json
{
	"id": "boot.warm.p90",
	"title": "Warm boot p90, Start proc to Displayed",
	"unit": "ms",
	"metric": "boot.warm.p90",
	"bar": { "android": { "max": 350 }, "ios": { "max": 250 } }
}
```

`bar` maps a platform to `max`, `min` or both, or to `equals` (a text: the gate on `crashes.run` is `== "checks,quick"`, and a metric that is a text only meets an `equals` bar), with an optional `round` (decimals the measured value is rounded to before comparing; `droppedPct` uses 1, so 0.04 % reads as the lab prints it, 0.0 %). A gate is judged for every device of each platform it names. A platform with no device in the report and a metric a device never produced are `not measured`, which fails. `*` in `metric` matches one name segment and yields one row per match (`frames.*.droppedPct` is one row per scenario).

To add a gate:

1. Make the measurement a metric: add it in `lib/metrics.ts` from the run files (or have the new runner write it into a run file in the same schema) and give it a key.
2. Add an entry to `gates.json` with that key and a bar per platform. A bar whose metric no runner writes yet is allowed and shows up as `not measured`.
3. Add a case to `test/metrics.test.ts` or `test/gates.test.ts`, and run `pnpm native-qa:test`.

`gates.json` also holds `scenarios`: the scenarios a full `checks,quick` lab run produces, per platform (17 each; the informational `warm-up` is not one). When the lab gains or loses a scenario, edit that list in the same change.

A new runner for another device (the iPhone) only has to write `qa/runs/<kind>-<device>-<stamp>.json` in the schema of `lib/types.ts` (`LabFile`, `BootFile`, `SoakFile`, `CrashesFile`) with `device.platform` set; `report` picks the newest of each kind (`runKinds` in `lib/runs.ts`) per device.

## Soak and crashes

PLAN.md step 8: the heap, the views and the crash count over time. Three commands, one run-file kind each, merged by `report` like the lab and the boot run (the newest `soak-*.json` and `crashes-*.json` of each device).

```
pnpm native-qa soak    --device localhost:5555 --apk qa/out/app-x86_64.apk [--minutes 10] [--interval 5] [--parts churn,nav]
pnpm native-qa crashes --device localhost:5555 --apk qa/out/app-x86_64.apk [--starts 1000] [--suites 100] [--idle 2] [--chunk 300] [--resume] [--inject-crash --suites 0]
pnpm native-qa symbolicate --input qa/runs/crashes-localhost_5555-<stamp>.log [--all]
```

Both runners take the same lock as `lab` and `boot` for their whole run, install the APK the same way (`--apk`, `--no-install`, `--dexopt`) and accept `--package`.

### soak

`native-qa soak` opens the lab as `rasheed-svelte:///__dev?run=soak-mix-<seconds>s`. Its `soak-mix` scenario (`src/lib/native/dev/Stress.svelte`) repeats one cycle until the requested time is up (the first two cycles are the warm-up and count in it):

1. 6 s of animated churn (32 Reanimated tiles replaced every 250 ms, the cleanup check of `churn-60s`),
2. two push/pop of a 60-row screen,
3. two modal open/close,
4. one sheet open/close,
5. two native-header screens pushed and popped,
6. a 300-row windowed list mounted, scrolled to the end and back, unmounted,
7. three tab switches.

About 28 s per cycle on the emulator. After the second cycle and after the last one everything is unmounted and the app idles for about 8 s: that is the **baseline** and the **final** window, three samples each. Before every sample of a window the lab collects all three heaps that can hold garbage: this runtime (`gc()`; this Hermes build exposes it, and without it the lab records `collected: null` and no JS growth is derived), the Java heap (`SvelteEngine.collectJava()`: a dead view, text layout or render node holds native memory until its Java object is collected, so a window should not depend on when ART last ran; with the 26 October leak present the same build measured +3.1 % and +3.6 % without it and +8.4 %, +8.4 %, +6.1 % with it) and the worklet (UI) runtime's own Hermes heap (`gc()` on the UI thread). In between, every 5 s, a `[Svelte soak]` line carries the same numbers without a collection, and every two minutes of soak time (after a cycle) the lab takes a **checkpoint**: the same idle window as the baseline, three samples. The floors of the windows over time say whether a growth keeps rising (a leak) or levels off (allocator, caches): `memory.native.slopeKbPerMin`.

Three sources are read:

| Source | What | Where it comes from |
| --- | --- | --- |
| lab, JS heap | `allocated`, `heapSize`, `malloc`, `va`, `gcs` of this runtime (`heap`) and of the worklet runtime (`ui`: `allocated` after its collection, `uiBefore`: without) | `HermesInternal.getInstrumentedStats()`, logged by the lab as `[Svelte soak]` |
| lab, engine | `alive` (engine views mounted under a React tag), `pooled`, `held`, `created`, `deleted`, the animated-write classes `lateWrites`, `staleWrites`, `replayedWrites`, `expiredWrites`, `overflowWrites`, `earlyPending`, and the sizes of the C++ delegate's tables `emitters` and `scrollStates` | `SvelteEngine.stats()` (`MountingManager.stats()`, SPEC "Stats for the soak runner") |
| host, process | Native Heap Pss / Heap Alloc / Heap Size, Dalvik Heap Pss / Alloc, total Pss, `Views`, `ViewRootImpl`, `Activities`, `AppContexts` | `adb shell dumpsys meminfo <package>`, every `--interval` seconds and once per window sample the lab announces (`parseMeminfo`) |

`--parts churn,static,nav,modal,sheet,header,list,tabs` runs only the named parts of the cycle (`static` is plain view churn, off by default), to find where a growth comes from; such a run is written as `partsoak-<device>-<stamp>.json`, which `report` never reads, so a bisect cannot stand in for the full soak.

`qa/runs/soak-<device>-<stamp>.json` keeps the raw series (`js`, `memory`), the faults seen, and the `metrics` derived from them (`report` derives them again from the series, so editing the derivation needs no new run); the full logcat is `soak-<device>-<stamp>.log`.

| Metric | Definition |
| --- | --- |
| `memory.heapGrowthPct` | the worst of `memory.js.growthPct` (Hermes `allocated`), `memory.ui.growthPct` (the worklet runtime's, when the build logs it) and `memory.native.growthPct` (`Native Heap` Heap Alloc, the live malloc bytes: a leak raises it, arena slack does not), final window over baseline window, medians of three. Not derived (null, so `not measured`) when either window is missing, a JS sample was not collected, or the build logs the worklet runtime's heap and one of its two windows was not collected (the growth left out would be the worst one) |
| `memory.native.pssGrowthPct`, `memory.java.growthPct` | the same for `Native Heap` Pss and for Dalvik Heap Alloc; reported, not gated |
| `memory.native.slopeKbPerMin` | least-squares slope of `Native Heap` Heap Alloc over the idle floors (baseline, every checkpoint, final; the median of each window at the median of its time); reported, not gated. A leak is a slope that stays positive from the first checkpoint on; a cache or an allocator arena fills and then goes flat |
| `memory.leakedViews` | engine views alive in the last final sample minus the last baseline sample (everything unmounted in both), never below 0 |
| `memory.leakedEmitters` | nodes the C++ delegate holds an event emitter for in the last final sample minus the last baseline sample, never below 0 (a node Fabric deleted must leave the table); null for builds that do not log it |
| `memory.deadTagWrites` | `staleWrites + expiredWrites + overflowWrites` between the start sample and the last final sample: animated writes for a tag deleted more than 1 s ago (an animation that outlives its node), never claimed by a view within 1 s, or dropped because the table of early writes was full |
| `memory.lateTagWrites` | `lateWrites` over the same span: writes for a tag deleted a moment ago. Expected by design (SPEC "View recycling"): Reanimated drops a removed node a frame or two after the batch that deleted it. Reported, not gated |
| `memory.androidViews.growth`, `memory.viewRootImpls`, `memory.activities` | `Views` growth between the windows, and `ViewRootImpl` and `Activities` at the end |
| `soak.minutes` | from the lab's `start` sample to its last `final` sample, warm-up and idle windows included |
| `soak.crashes` | crash, native signal and ANR lines of the package during the run, plus one if the process died without any |
| `soak.complete` | 1 when the lab announced its end and the final window exists |

### Where a native growth comes from

When `memory.native.slopeKbPerMin` stays positive after the first checkpoints, the growth is a leak, and the next question is which allocation site. `heapprofd` cannot unwind this app's JavaScript thread; `malloc_debug` can:

```
flock /tmp/svelte-qa-emulator.lock qa/soak/malloc-debug-soak.sh localhost:5555 qa/out/app-x86_64.apk /tmp/dumps 420
python3 qa/soak/heapdiff.py /tmp/dumps qa/out/app-x86_64.apk qa/out/app-x86_64.symbols --frames 6
```

The script starts the app under `malloc_debug` with 14-frame backtraces (`wrap.<package>` on a userdebug image, `su`), runs the lab's soak and writes `am dumpheap -n` dumps at the baseline window, the first checkpoint and the final window (the process is several times slower, so the soak's cycle count is lower than in a normal run). `heapdiff.py` symbolizes the frames (the app's own libraries from `app-<abi>.symbols`, React Native's and Hermes's by their exported symbols, system libraries when pulled into `<dir>/syslibs`) and prints the call sites by growth, with their live allocation counts: a site whose count rises with the cycles and never falls back is a leak, one that rises once and stays flat is a cache. The 26 October growth was found this way: 1,300 `UpdatesRegistry` entries and the shadow nodes they hold (SPEC "Android wave 4").

### crashes

`native-qa crashes` runs `--starts` cold starts and then `--suites` full lab suites on the same install, and writes `crashes-<device>-<stamp>.json` (rewritten every 25 starts and after every suite, and on Ctrl-C, so a run of hours is never lost) with `crashes-<device>-<stamp>.log` (the tail of the log of every failed start) and `...-suite-<n>.log` (the full logcat of each suite).

A **cold start** is the boot runner's launch loop without its timing: wake, `am force-stop`, `--idle` s (default 2), `logcat -c`, `am start -W`, follow logcat (main, system, crash) until `[Svelte boot]` plus 1.5 s, then `pidof`. It **crashed** when the log has a `FATAL EXCEPTION` or a native `Fatal signal` of the package, or a JavaScript fatal (in this release build React Native logs `handleHostException` with the JS stack, destroys the React host and leaves the process alive and blank: there is no `FATAL EXCEPTION`, and only the log shows it), an **ANR** with `ANR in <package>`, and it **died** when no process is left after the boot line. A start that did none of that but printed no `[Svelte boot]` within 20 s is a start without boot. A **suite** is `lab --run checks,quick` (`labOnce`): it crashed with any crash or ANR line of the package, and is incomplete when the lab never logged its last line or its log could not be parsed (the error is stored in the suite).

| Metric | Definition |
| --- | --- |
| `crashes.run` | the lab `--run` the suites ran (a text; gated `== "checks,quick"`; `not measured` for a file that never recorded it) |
| `crashes.coldStarts`, `crashes.suites` | runs made (the bar is 1000 and 100) |
| `crashes.coldStartCrashes` | starts that crashed or died |
| `crashes.coldStartsNoBoot` | starts that hung without booting and without crashing |
| `crashes.suiteCrashes`, `crashes.suitesIncomplete` | suites with a crash; suites that did not complete and did not crash |
| `crashes.anrs` | ANRs over starts and suites |
| `crashes.signatures` | distinct failures kept (at most 20) |

The file records what it was started with: `run` (the lab `--run` of the suites), `idleSeconds` and `packageName`, next to the installed build. `--resume` continues the device's newest `crashes-*.json` after an emulator outage, a Ctrl-C or between the chunks of `--chunk`: the runs already measured are kept and the counts go on from there. It refuses, naming each difference, when `--run`, `--idle`, `--package` or the installed build differ from the file's, when the file predates these fields, and when the installed build could not be identified on either side (a null on both sides is not a match). `report` computes `crashes.run` from the file and the gate on it is `== "checks,quick"`, so a crashes file whose suites ran a partial lab does not count. A device that goes offline ends the run with an error instead of counting as a crash, and what was measured is written first.

`--inject-crash --suites 0` is a self-test: after every launch the runner sends `am crash <package>` (a real Java crash of the app process) and writes `crashtest-<device>-<stamp>.json`, which `report` never reads. It proves that a crash is seen, classified, deduplicated into one signature with a count and symbolicated.

The file holds the first 20 distinct failures as `signatures`: kind (`java`, `native`, `anr`, `death`, `no-boot`, `suite-incomplete`), title, frames, a count (the same failure again is one signature with a higher count; the key ignores pids, fault addresses, install paths and build ids) and where it was first seen.

### Symbolication

The release bundle is Hermes bytecode and the native libraries are stripped, so `native-qa build` keeps what is needed next to the APK (`qa/out/build-<abi>.json` records them):

- `app-<abi>.bundle.map`: the composed source map React Native's Gradle plugin writes at `android/app/build/generated/sourcemaps/react/release/index.android.bundle.map` (Metro's map composed with Hermes's; one generated line, columns are bytecode offsets). No Gradle change was needed, the plugin already runs `hermesc -output-source-map` for release.
- `app-<abi>.symbols/`: the unstripped `libsvelteengine.so` and `libreanimated.so` (our engine and Reanimated with the engine's sink) from `merged_native_libs`, before Gradle's strip step.

`soak/symbolicate.ts` (also `native-qa symbolicate`) reads a logcat capture on stdin or `--input` and prints each crash of the package with its frames resolved: JavaScript frames (Hermes `at name (address at index.android.bundle:1:OFFSET)` and React Native's fatal-exception `name@1:OFFSET`) through the map with `@jridgewell/trace-mapping`, native frames through `ndk-stack -sym app-<abi>.symbols` (found from `ANDROID_NDK_HOME`, `ANDROID_HOME/ndk/<newest>` or the path). `--all` prints the whole capture with every JavaScript frame rewritten instead. The crash runner symbolicates every signature it stores the same way and warns when `qa/out/build-<abi>.json` describes another APK than the installed one; `--map` and `--symbols` point it at the files of the build that was installed. The offset convention is React Native's own (`parseHermesStack`: line 1, 0-based virtual offset).

### Durations and the full run

On the OVH emulator (60 Hz, software GL) a cold start takes about 5 s with its idle gap and liveness check, a suite 2.4 to 3 minutes, and a soak takes its requested time plus about 40 s (the last cycle finishes, two idle windows) and the install. The full production run is therefore

```
pnpm native-qa build --abi x86_64
pnpm native-qa soak    --device localhost:5555 --minutes 10                  # about 13 min
pnpm native-qa crashes --device localhost:5555 --starts 1000 --suites 100 --chunk 300   # about 1.5 h for the starts, about 4-5 h for the suites
pnpm native-qa report && pnpm native-qa gates --platform android
```

`--chunk 300` runs the series as several commands (cold starts in steps of 300, suites in steps of 10, 20 s apart, each chunk continuing the same file with `--resume`, so the counts add up), each taking and releasing the emulator lock on its own: the OVH emulator's graphics stack (`-gpu swiftshader_indirect`) leaks about 13 MB of host memory per app launch, so a thousand launches must let the host's watchdog restart the emulator between chunks, and the other agents get the device between them. A chunk that fails stops the run with the command to continue it. Without `--chunk` the command holds the lock for the whole series; run that only when nothing else needs the device. `report` takes the newest file of each kind, so a short run made afterwards replaces a full one: the count gates (`crashes.coldStarts` 1000, `crashes.suites` 100, `soak.minutes` 10) fail for what was not run.

### What the medium pass measured (26 October, OVH emulator, release x86_64 build)

One 10-minute soak, 200 cold starts and 5 full suites, all on the same installed build (`s-soak4.apk`, the tree as of 12:13, baseline profile compiled).

| Metric | Measured | Bar |
| --- | --- | --- |
| `soak.minutes` | 10.27 (130 lab samples, 131 process samples, 29 cycles) | >= 10 |
| `memory.js.growthPct` | +0.03 % (Hermes allocated 6.05 MB at both windows) | |
| `memory.native.growthPct` | **+25.59 %** (Native Heap Heap Alloc 63.9 MB at the baseline window, 80.3 MB at the final; Pss +21.05 %) | |
| `memory.heapGrowthPct` | **25.59 %** (worse of the two) | <= 5 |
| `memory.java.growthPct` | -3.98 % (Dalvik Heap Alloc 6.1 MB, 5.9 MB) | |
| `memory.leakedViews` | 0 (95 engine views alive at both windows, 128 pooled, 0 held) | 0 |
| `memory.androidViews.growth` | 0 (`Views` 235 at both windows; `ViewRootImpl` 1, `Activities` 1) | |
| `memory.deadTagWrites` | 0 (`staleWrites`, `expiredWrites`, `overflowWrites` all 0 after 34,144 views were deleted) | 0 |
| `memory.lateTagWrites` | 17,936 (about 0.5 per deleted view, 1 s grace; by design, not gated) | |
| `soak.crashes` | 0 | 0 |
| `crashes.coldStarts` | 200: 0 crashed or died, 0 ANR, 0 without boot | 1000 starts, 0 crashes |
| `crashes.suites` | 5: 28/28 checks each, 141 to 142 s each, 0 crashes, 0 ANR, 0 incomplete | 100 suites, 0 crashes |

The native heap is the one number that misses its bar, and the series shows a leak, not noise: with the JS heap, the Java heap, the engine's views, the pool and the Android view count all flat, the floor of `Native Heap` Heap Alloc rises by about 2 MB per minute (minimum per minute of the series: 68.5, 69.1, 70.1, 74.1, 76.2, 79.3, 81.1, 84.8, 84.7 MB), 16.4 MB over 31,000 views created and destroyed, about 520 bytes per view. It is native (C++) memory that `gc()` does not return: Fabric shadow nodes held past their unmount, the engine's C++ side, or Reanimated's native registries are the candidates. Splitting the soak into its parts (`--parts`, three minutes each) points at the animated tiles: `--parts churn` alone grew `Native Heap` Heap Alloc by 16.7 % (63.5 → 74.1 MB over 11,104 tiles created and destroyed, about 980 bytes per animated tile, with the JS heap -0.8 %, 0 leaked views and 0 dead-tag writes), about the per-tile cost the full soak implies. `--parts static` (19,600 plain views created and destroyed, no animation) stayed flat: +0.3 MB, +0.65 %. The third split (`--parts nav,modal,sheet,header,list,tabs`) was cut short when the emulator went offline during it (about 14:54, `adb logcat exited with 255`, which the runner reports as an error, not as a crash); the full soak's per-view cost (520 bytes over all views, 980 over the animated tiles that make up about two thirds of them) says the other parts add little, but that is not measured. The leak is therefore tied to animated views: roughly 1 KB of native memory per Reanimated tile that `gc()` and the unmount do not return, in Reanimated's native registries (CSS animation and keyframe registrations, shared-value and mapper bookkeeping) or in the engine's animated write path.

**Resolved on 27 October** (SPEC "Android wave 4"): the leak was Reanimated's `UpdatesRegistry` re-adding entries for removed tiles whose update was still pending (found with `malloc_debug` dumps, `qa/soak/heapdiff.py`), and `detachAnimation` now marks a removed node removable a second time 400 ms later. On the fixed build the 10-minute soak measures `memory.heapGrowthPct` 0.08 (native -4.68 %, the floors 59.4, 57.1, 55.7, 56.0, 56.2, 56.6 MB) and the 30-minute soak 0.14 (native -4.08 %, 14 idle windows between 56.1 and 57.1 MB, +18 KB/min), with 0 leaked views and emitters. The numbers above stay as the record of the build before the fix.

The 200 cold starts ran as 100 and 100: the emulator host went down after start 100 (about 13:00), the runner stopped on `adb shell pidof ... device offline` instead of counting a death, and `--resume` continued from the file it had written. The cold-start loop takes about 4.8 s per start (idle gap, `am start -W`, boot line, settle, `pidof`): 1000 starts are about 80 minutes. A suite takes 141 to 142 s: 100 are about 4 hours, so the full run is about 5.5 hours of device time.

Faults found on the way, both visible only through this runner. A JavaScript fatal in this release build is not a crash to Android: React Native logs `handleHostException`, destroys the React host, and the process stays alive with a blank activity (no `FATAL EXCEPTION`, no tombstone, `pidof` still finds it); `findFaults` now counts it, so lab, boot and the runners see it. And the symbolicator was checked on a real stack of such a fatal (the lab's `crash-js` scenario, `anonymous@1:3185559`): it resolves to `apps/platform/src/lib/native/dev/Stress.svelte:375:41`, the `throw` of the scenario. Native symbolication was checked with ndk-stack on a tombstone written around two real addresses of `libsvelteengine.so` (they resolve to `encodeProps` and `encodeState` in `PropsEncoder.cpp`); no native crash of the app has been seen to date.

## Parity, accessibility, resilience

Production step 7. Three suites drive the QA app on a device through adb, each writes one run file, and `report` merges the newest of each per device into the metrics `gates.json` judges.

```
pnpm native-qa parity     --device <serial> [--apk <path> | --no-install] [--update | --missing] [--quick] [--filter <screen>]
pnpm native-qa a11y       --device <serial> [--apk <path> | --no-install] [--quick] [--filter <screen>]
pnpm native-qa resilience --device <serial> [--apk <path> | --no-install] [--rotations 5] [--cycles 100] [--rounds 2]
pnpm native-qa:suites     # all three on localhost:5555 (parity compares, it never updates), then report
```

None of them exits non-zero for a failed check; `gates` judges, as for `lab` and `boot`. They take the device flags and the emulator lock of `lab` and `boot` (`--device`, `--apk`, `--no-install`, `--dexopt`, `--package`; `flock /tmp/svelte-qa-emulator.lock` for the shared emulator, so install the build you mean with `--apk qa/out/<your copy>.apk` when other agents overwrite `qa/out/app-<abi>.apk`). `--quick` runs four variants (parity) or two (a11y), `--filter` selects the screens whose id contains the text, `--rotations`, `--cycles` and `--rounds` shorten the resilience plan; a partial run leaves the rest of the matrix counted as missing, so it cannot pass a gate.

### What the suites drive

`lib/screens.ts` holds the screens: one route in one state each, reachable without a signed-in session.

| id                                                                                       | route                                                                 | state                         |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ----------------------------- |
| `startup-loading`, `startup-error`                                                       | `/` while the platform configuration is pending / unreachable         | loading, error                |
| `login`                                                                                  | `/auth/login`                                                         | ready (needs the dev backend) |
| `dev-checks`, `dev-binding`, `dev-rows`, `dev-async`, `dev-animation`                    | `/__dev` panels                                                       | ready                         |
| `dev-async-loading`, `dev-async-error`                                                   | `/__dev` async panel: `{#await}` pending, tripped `<svelte:boundary>` | loading, error                |
| `lab-screen`                                                                             | `/__dev/screen`                                                       | ready                         |
| `screens-menu`, `screens-header`, `screens-slots`, `screens-translucent`, `screens-tabs` | `/__dev/screens?mode=...`                                             | ready                         |
| `screens-sheet`, `screens-sheet-auto`, `screens-form-sheet`, `screens-modal`             | the menu's buttons, presented as sheets and a modal                   | ready                         |

The loading and error states of the startup screen are made, not waited for: the app's HTTP is routed (`settings put global http_proxy localhost:<port>` and `adb reverse`) to a socket on the machine running the suite that accepts and never answers (the 10 s fetch timeout is the loading state) or one that refuses (the error state). The proxy is removed afterwards. Routes with a `+mobile.svelte` page that no case reaches are listed in `notCovered` with the reason; `test/screens.test.ts` fails when a page is neither covered nor listed, so a new route cannot slip by.

Every screen runs in the **variants** theme (light, dark: `cmd uimode night yes|no`) x direction (LTR, RTL: `cmd locale set-app-locales io.rasheed.svelteqa --locales en-US|ar-SA`, which gives the app Arabic strings and a `ldrtl` configuration for the native chrome) x text size (1.0 and 2.0, `settings put system font_scale`, the largest Android 14+ offers), eight in all (`light-ltr-normal` ... `dark-rtl-large`). Rotation is locked to portrait. Everything the suites change is recorded before the first change in `qa/out/device-state-<serial>.json` and put back in a `finally` (and on SIGINT/SIGTERM); if a run was killed outright, the next run restores from that file first.

### Parity

```
screenshots/<device kind>/<screen>--<variant>.png    one reference per case
screenshots/<device kind>/manifest.json              checksum, size, masks, what it is a reference of
```

The references are about 130 KB each, 18 MB for the 152 of one device kind. The device kind is `<platform>-api<sdk>-<emulator | model>-<width>x<height>-<dpi>dpi` (today `android-api36-emulator-1080x2400-420dpi`): pixels depend on all of them, so a different device kind has its own references (and its first run is `--update`). A reference is a full-display screenshot (status and navigation bar included) written as PNG by the harness's own encoder (`lib/png.ts`, no dependency).

- **Check** (the default): launch the screen from a fresh process, run its steps, take screenshots until one equals the reference, for up to 12 s (25 s for the login screen). The bar is **0 differing pixels outside the masks**: all four channels, no tolerance, no anti-aliasing allowance. If the window closes without a match, one more screenshot decides between `unstable` (two in a row disagree outside the masks) and `fail`; a failure keeps what the device drew and a red-on-grey diff in `qa/runs/parity-<device>-<stamp>/<name>.actual.png` and `.diff.png`, and the run file records the count and the bounding box.
- **Masks** are frozen in the manifest beside the image: the status bar band (its inset frame from the window manager, 0 to 128 px on the emulator: the clock, battery and notification icons vary) and, per case, the bounds of nodes that move on their own (the startup spinner, the Reanimated test square). A mask whose node is not in the tree when the reference is taken is an error, not an unmasked reference, except for nodes the largest text pushes off screen. `parity.maskedPct`, the share of the screen the masks cover in the worst case, is gated at 25 %, and every parity line prints the case's own share (`masked 20.7 %`). `--update` refuses to freeze a reference whose masks cover more than 25 % (`lib/parity.ts`, `maxMaskedPct`, the gate's bar): the case is recorded as an error that names the kinds of mask (status bar and moving nodes on Android; moving, glass and sheet views on iOS) with their counts and shares, so the one to cut is visible.
- **Update** (`--update`): the same launch, but the anchor of the screen must be in the accessibility tree and two screenshots in a row must agree outside the masks before one is frozen, so a reference is never taken mid-animation. Each updated case says `new`, `unchanged` or `changed` against the previous reference. The manifest is rewritten after every case; `--missing` updates only the cases that have no reference yet, which resumes an interrupted update. If the device goes away mid-run (adb offline) the suites stop with that error instead of recording every remaining case as failed. An update run verifies nothing: `report` ignores its metrics, so a gate stays "not measured" until a check run follows. Review the changed PNGs in the diff like any other change.

### Accessibility

`a11y` opens each screen in four layouts (LTR and RTL at text size 1.0 and 2.0; theme changes no node) and checks the accessibility tree. The oracle is `uiautomator dump`: the node info the engine publishes (`A11y.kt`, `EngineText`, `EngineHeader`, `EngineTabs`), which is what any accessibility service receives. The run file says so (`oracle`). TalkBack (`com.google.android.marvin.talkback`) is on the AVD, but its gestures cannot be driven reliably by injected input, so the suite does not run it; a session with TalkBack and a probe service that logs what a service receives (SPEC "Android wave 4") settled the one question the dump could not answer, and the VoiceOver pass of the plan is still manual.

The dump asks the system for the views that are not important for accessibility (`uiautomator` sets `flagIncludeNotImportantViews`), and the engine hides a screen under a sheet or modal from services with `importantForAccessibility=noHideDescendants`: the full dump still lists it, a service walking important nodes does not. The focus-trap check therefore reads a second dump with `--compressed` (important nodes only) when the screen declares a covered screen; the other checks read the full dump. That dump is taken again, up to three times, until it contains the screen's own declared controls (its title when it declares none): a dump taken while the screen is still drawing would be judged half built. Without them after three dumps the screen is recorded as an error (`a11y.incomplete`). Each screen result records `stable`, whether `settledTree` found two dumps in a row identical.

| check       | passes when                                                                                                                                                                                                                                                                    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| reachable   | the element is in the tree with non-zero bounds inside the display, is enabled, and a service can focus it (focusable, actionable or labeled); a control the screen's source declares (`controls` in `lib/screens.ts`, by label) that is not in the tree at all is unreachable; `scrolled` lists controls the largest text pushes below the fold, which are checked when the tree has them and never reported missing |
| labeled     | text, content description or hint on the node or a descendant                                                                                                                                                                                                                  |
| actionable  | clickable, long-clickable, checkable, or a text field: a node exposed as a button (`android.widget.Button`) that advertises no action fails                                                                                                                                    |
| order       | the focus stops, in tree order, run top to bottom and, within a row, start to end (right to left in RTL); stacked stops (a button and the text inside it) are not compared                                                                                                     |
| title first | the screen's title is a focus stop and no content stop comes before it; a header reads its title (or center slot) first and then the controls at its start side by design, which the order check allows                                                                        |
| focus trap  | while a sheet or modal is up, the labels of the screen underneath (`hidden`) are not in the tree a screen reader walks (`uiautomator dump --compressed`); a sheet titled like the button that opened it ("Form sheet") does not count its own title                                |

An interactive element is a node that is clickable, long-clickable, checkable, a text field, or of a control class. Disabled controls are counted (`disabled`) but not checked. An element outside the display, or one uiautomator reports with a negative extent (a row scrolled out of its container), is `clipped` and skipped only when it sits inside a scroll container (a `scrollable` ancestor or a scroll, list or pager class) and the screen declares it below the fold (`scrolled` in `lib/screens.ts`); any other element out of the display is unreachable (`outside the display`, or `negative extent ... not declared below the fold`). The report prints `clipped` and the reach percentage per screen. The heading flag and `accessibilityTraversalBefore/After` are not in the dump: the title is identified by its text, and a header's own traversal chain is not observable here.

### Resilience

`resilience` runs one screen (`screens-menu`: a large header over a scroll view) through the plan, then the low-memory rounds on `screens-header`. After every step it asks, in one adb call, whether the process is alive (`pidof`) and what the filtered log shows (`AndroidRuntime:E ActivityManager:E SvelteEngine:W libc:F DEBUG:F ReactNativeJS:E`, then cleared): a fatal, an ANR, a native signal, a JavaScript error or an engine warning fails the step. Steps with anchors also dump the tree and need the header and a content node on screen. Failures keep their log lines in `qa/runs/resilience-<device>-<stamp>.log`. After a failed step the app is started again on the loop screen (`recovered: true` in the step), so one hang does not fail every step after it; the low-memory rounds are left as they fall, because they depend on the process state.

| group      | steps                                                                                                                                                                                   |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| rotation   | launch, then landscape and portrait x 5 (`user_rotation`, auto-rotate off)                                                                                                              |
| font scale | 2.0, 0.85, 1.0                                                                                                                                                                          |
| locale     | Arabic while running, Arabic after a restart, English while running, English after a restart                                                                                            |
| background | `HOME` then `am start -n .../.MainActivity` x 100 (the process and log every cycle, the tree every tenth and the last)                                                                  |
| low memory | x 2: `am send-trim-memory RUNNING_CRITICAL` in the foreground, `HOME` and `COMPLETE`, `am kill` (the process must be gone), return to the app (the route of the deep link must be back) |

The full plan has 126 steps.

### Run files

| file                                                                  | written by   | holds                                                                                                                                                              |
| --------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `runs/parity-<device>-<stamp>.json`, `runs/parity-<device>-<stamp>/`  | `parity`     | one record per case (verdict, differing pixels, masked pixels, bounding box, attempts) and `notCovered`; failing cases keep `<name>.actual.png` and `.diff.png` in the directory |
| `runs/a11y-<device>-<stamp>.json`                                     | `a11y`       | per screen: the counts (with `clipped`), the focus stops in tree order, every finding with its element and why, `stable` (Android: two dumps in a row agreed) and `chromeModelled` (iOS: bars modelled from UIKit's state); the `oracle`                                                        |
| `runs/resilience-<device>-<stamp>.json`, `.log`                       | `resilience` | per step: group, name, ok, failures, `recovered`, duration; the log keeps the lines of every failed step                                                           |

Each carries the device, the installed build (`app.installedSha256`; on iOS also `app.installed` and `app.build`, "Build identity" below) and the source commit, like the lab and boot files; `aborted` is set when the device went away mid-run. `report` reads the newest of each per device, so after a partial run (`--quick`, `--filter`) run the whole suite again before `gates`.

### Metrics and gates

| metric                                                                                        | meaning                                                                                            | bar                            |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------ |
| `parity.cases`, `parity.casesExpected`                                                        | cases compared against a reference; cases in the whole matrix                                      |                                |
| `parity.diffPixelsOutsideMasks`                                                               | worst case over the compared cases                                                                 | 0                              |
| `parity.casesIncomplete`                                                                      | expected minus compared: missing reference, unstable, errored, skipped or not run                  | 0                              |
| `parity.maskedPct`                                                                            | the share of the screen the masks cover, worst case over the compared cases                       | 25 %                           |
| `parity.casesDiffering`, `parity.casesSkipped`, `parity.routesNotCovered`                     | for reading the run                                                                                |                                |
| `a11y.screens`, `a11y.screensExpected`, `a11y.screensIncomplete`, `a11y.interactive`          | screens dumped, screens in the matrix, screens not dumped, interactive elements seen               | `screensIncomplete` 0          |
| `a11y.unreachable`, `a11y.unlabeled`, `a11y.notActionable`                                    | elements failing each check (100 % means 0)                                                        | 0                              |
| `a11y.orderViolations`, `a11y.titleNotFirst`, `a11y.focusLeaks`                               | consecutive stops out of order, screens whose title is not first, covered labels still in the tree | 0                              |
| `a11y.reachablePct`, `a11y.labeledPct`, `a11y.actionablePct`                                  | the same as shares of `a11y.interactive`                                                           |                                |
| `resilience.steps`, `resilience.failures`, `resilience.stepsMissing`                          | steps run, steps that failed a check, steps of the full plan not run                               | `failures` 0, `stepsMissing` 0 |

A run that is cut short because the device went away (adb offline, which the emulator host does about once an hour when its watchdog restarts it) stops, keeps what it measured and records `aborted` in its run file; the cases it did not reach count as missing, so rerun it.

### Not covered, and why

- `/__dev` async panel, pending and error-boundary states, at 200 % text (`notCoveredStates`, 8 cases of the 160 left out of the matrix, 152 remain): the button that sets the state is below the first screen of a `Page`, and the `Page`'s scroll view reports `scrollable=false` and does not move under a swipe (the same on `/__dev/screen` with its 60 rows), so neither a user nor the harness can reach it.
- Every route behind the login (account, onboarding, workspaces, workspace, settings): no credential. They are listed in the run file's `notCovered` and in `lib/screens.ts`.
- `/__dev/foreign` (WebView, map, video): third-party content that varies between runs.
- Empty states of search results and the keyboard: the soft keyboard is not part of the app and its rendering varies; the one list with an empty state (header search in `screens-slots`) needs typed text.
- VoiceOver and TalkBack themselves: no TalkBack on the AVD, and VoiceOver is not run for the iPhone suites (`--platform ios`, "iOS" below).
- The login screen is skipped, not failed, when the dev backend does not answer from the machine running the suite (`parity.casesSkipped`; the gate on `casesIncomplete` still fails).

## iOS

The same commands run on the iPhone with `--platform ios`: `build`, `lab`, `boot`, `parity`, `a11y`. They write the same run files (`device.platform` is `ios`), so `report` and `gates` read the iPhone like any device and judge the `ios` bars of `gates.json`.

```
pnpm native-qa build  --platform ios --mac <user@host> --mac-checkout <dir on the Mac> [--build-script <path on the Mac>]
pnpm native-qa lab    --platform ios --device <devicectl id> --mac <user@host> [--app <.app on the Mac> | --no-install] [--run checks,quick] [--repeat <n>] [--timeout <s>]
pnpm native-qa boot   --platform ios --device <devicectl id> --mac <user@host> [--warm <n>] [--cold <n>] [--idle <s>]
pnpm native-qa parity --platform ios --device <devicectl id> --mac <user@host> [--update | --missing] [--quick] [--filter <screen>]
pnpm native-qa a11y   --platform ios --device <devicectl id> --mac <user@host> [--quick] [--filter <screen>]
pnpm native-qa probe  --platform ios --device <devicectl id> --mac <user@host> [--probes <names>] [--direction ltr|rtl]
```

`--mac` (or `NATIVE_QA_MAC`) names the Mac the iPhone is paired with; `--device` is the id `xcrun devicectl list devices` prints. Every command also takes `--udid <hardware UDID>` (default `00008110-001E10593410401E`, the lab phone's: what `idevice_id -l` prints on the Mac), by which the phone's crash log is read ("Crash reports" below). Commands run on the Mac over `ssh` (one shared connection, `BatchMode`) and files come back over `scp`; nothing runs on the Mac but `xcrun devicectl`, `rsync`'s target, `pnpm`, `expo prebuild`, `pod install` and the build script. A run takes `flock /tmp/svelte-qa-iphone.lock`, so two runs never fight over the app. The commands never pair, re-pair or change a setting of the phone or the Mac.

**build** copies this checkout to the Mac checkout (`--mac-checkout` or `NATIVE_QA_MAC_CHECKOUT`: the directory the recipe fixes, `rsync` with the Android and iOS project directories left alone), installs the dependencies, runs `expo prebuild --platform ios` and `pod install`, and then opens the build script with `open -a Terminal` and waits for its `.exit` file. Signing needs the login keychain, so the build runs only in the GUI Terminal (default script `/tmp/rasheed-ios-lab-20261025.command`, which writes `.log` and `.exit` next to it). The Mac-side preparation runs under `set -o pipefail`, so a failing `pnpm install` stops the build instead of being hidden by the `tail` it is piped to. The result is `qa/out/ios-build.json`: the signed `.app` on the Mac, the commit and whether the tree was dirty, the SHA-256 of its `main.jsbundle` (`bundleSha256`, also written as `jsbundleSha256`) and of its executable (`cdHash`: `shasum -a 256` of the file `CFBundleExecutable` names in the app's `Info.plist`, read with `PlistBuddy` on the Mac). `lab`, `boot`, `parity` and `a11y` install that app first (`devicectl device install app`) unless `--no-install` is given.

**Build identity.** The app reports `build: { jsbundleSha256, cdHash }` (the SHA-256 of `main.jsbundle` and the executable's code directory hash, read from its signature; `codesign -dvvv` prints the same `CDHash`) at the top level of `Documents/lab-results.json`, `Documents/boot-report.json` and `Documents/capture/index.json` (the parity and a11y captures; the probe index carries none). Every iOS command compares what the app reported with `ios-build.json`, install or `--no-install` alike, and ends the run with the mismatch printed, writing no run file, when they differ (`probe` too; an `--app` other than the recorded one has no record to compare with). The record's executable digest is compared when it has one. Every iOS run file records `app.installed` (what the app reported, or `null` when it reported none: an older app, in which case the command warns `build identity not reported`) and `app.build` (`commit`, `dirty`, `jsbundleSha256`, `cdHash` of the record it was compared with); `app.installedSha256` is the reported executable digest, null with `installed`. `source` stays the checkout's HEAD when the command ran, which says nothing about the build. `report` identifies an iOS run by `installed` and warns for every run that has none, so `gates` fails on it.

**lab** starts the lab by its URL (`rasheed-svelte:///__dev?run=checks,quick&token=<random>`) and reads `Documents/lab-results.json` from the app's data container every 10 s until the file carries the launch's token and says `stressDone` (or `phase: done` for a checks-only run); every 30 s it asks `devicectl` whether the process is still there, and a lab whose app died is recorded as incomplete with that as its fault. The app is ended afterwards; a lab whose app then aborts is found by the crash log ("Crash reports" below), and its run is marked incomplete. The file's scenarios are the `[Svelte stress]` objects Android logs, so `labMetrics` reads them unchanged. iOS has no log stream the harness can follow: the app counts its own `console.error` calls and reports them as `jsErrors` (top level of `lab-results.json` and `boot-report.json`), which the run files keep (`jsErrorCount`, `jsErrors`, null when the app reports none) and `log.fatals` adds to a dead app. The engine's warnings do not exist on iOS (no engine), so `log.engineWarnings` is 0 by absence.

**boot** is measured inside the app by the QA module (`apps/platform/modules/svelte-qa-ios`, a Swift Expo module that refuses to run outside `io.rasheed.svelteqa`). The process start is the kernel's (`sysctl` `p_starttime`); the first frame is the display link tick after React Native mounted the first content (`RCTContentDidAppearNotification`), taken at its `targetTimestamp`, the vsync the frame is shown at (a resolution of one frame, 16.7 ms). `Documents/boot-report.json` carries both, `didFinishLaunching` and the `[Svelte boot]` line. `displayMs` (the number gated) is process start to that first content frame; `runningMainMs` is process start to the content being mounted and `totalTimeMs` process start to `application(_:didFinishLaunchingWithOptions:)`, the nearest iOS counterparts of Android's `Running "main"` and `am start` time. Warm is: end the app, wait 1.5 s, launch; cold is: end the app, idle `--idle` seconds (20), launch. Every launch ends a running instance first (`--terminate-existing`), and a report counts as that launch's only when it names the launched process and its `processStartMs` is later than the moment the harness started the launch command (both are recorded in the sample, `commandStartedAtMs` and `processStartMs`): a report the previous launch left behind is refused and the sample counts as failed. The two times are on the phone's clock and this machine's, which must agree to within the few seconds a launch takes. A copy of the report caught half written is read again on the next poll. iOS cannot be made to drop its page cache, so both are process-cold launches, as on Android, and the first frame is the first content frame: the system's launch screen and Expo's splash overlay are drawn before it.

**parity** and **a11y** cannot be driven from outside, because nothing outside the process can take an iOS app's screenshot or read its accessibility tree and `devicectl` has no input. So the lab drives itself: `run=capture:<ids>&themes=light.dark&token=<random>` (`lib/native/dev/capture.ts`) visits each screen of the matrix in turn (`router.goto`, presenting sheets and modals over the menu), takes screenshots of its own window until two in a row have the same SHA-256, dumps the accessibility tree, and writes `Documents/capture/index.json`, `<screen>--<theme>.png` and `<screen>--<theme>.a11y.json`. The harness polls the index until it says `done` and copies the directory. The theme is `overrideUserInterfaceStyle` on the app's windows (the native bars and sheets follow it); the direction is the launch language: right-to-left runs launch with `-AppleLanguages (ar) -AppleLocale ar_SA`, which gives the process an Arabic locale and UIKit's right-to-left layout, and the window reports the direction it got (a run that asked for one and got the other is an error, not a pass).

- Parity: `screenshots/<ios release>-<model>-<w>x<h>-<scale>x/` (today `ios26-iPhone-SE-3rd-generation-750x1334-2x`), one reference per screen x theme x direction (4 variants, standard text size). The screenshot is the app's own window: no status bar, so no status bar mask; the masks are the frames of the views that move on their own (every `UIActivityIndicatorView` and views with a `qa-mask` test id, which the lab sets on the Reanimated square) and the edges of the system's glass capsules (the bar items and the tab bar of iOS 26: `_UI...Glass`/`...Platter` views, masked at their round ends (half their height and 6 pt more) and along their top and bottom edge, 6 pt; a capsule less than 1.5 times as wide as it is tall is masked whole), because the system draws their rim a level differently on a few pixels from one launch to the next and the rim of a presented sheet's card (its corners, 64 pt squares, and a strip along each side, 6 pt inside the frame of the presented view and 8 pt outside it (32 pt above, where the card of a sheet that fits its content starts): the system's corner mask, border and shadow) for the same reason (before the masks 3 of 72 cases failed by 31 to 73 pixels on the glass edges, and the `auto` sheet by 48 to 235 on its rim, in one launch out of three); what is inside a capsule or a sheet, the app's icons, labels, badges and content, is compared. The bar is the Android one: 0 differing pixels outside the masks, all four channels, no tolerance, and the masks together may cover at most 25 % of the screen (`parity.maskedPct`; the widest today is the `screens-sheet` case at 20.7 %): the parity output prints each case's share, and `--update` refuses a reference over the limit, naming the moving, glass and sheet views with their shares.
- Accessibility: the dump is what the app's accessibility elements report (`SvelteQAAccessibility.swift`: the traversal the system does for VoiceOver, with hidden views, `accessibilityElementsHidden`, explicit `accessibilityElements`, containers and `accessibilityViewIsModal` applied as the system applies them). `lib/iphone/a11y.ts` runs the six checks of the Android suite (reachable, labeled, actionable, order, title first, focus trap) on it, reading traits instead of Android's classes and actions: actionable is the button, link, adjustable or search field trait (or a text input), the title must carry the header trait, and VoiceOver's default order, a sort by position, is applied to the elements no container orders. VoiceOver itself was not run.
  - An element outside the screen is `clipped` (counted, not checked) only when the dump puts it in a scroll view (`RCTScrollView`, `UIScrollView`, table and collection views among its `parents`) and the screen declares it below the fold: `scrolled` in `lib/screens.ts`, plus `iosBelowTheFold` in `lib/iphone/screens.ts` for what the 667 pt iPhone SE leaves below the fold of the Android matrix's screens. Every other element outside the screen is unreachable, with the finding `outside the screen`. The report prints `clipped` and the reach percentage per screen.
  - **iOS chrome order and labels are modelled from UIKit's state, not read from an accessibility client.** UIKit's bars are not accessibility elements until a client runs, so the dump has no navigation bar title, back button, search field or tab bar item. The harness builds them from `uikitState` (the real titles, `hidesBackButton`, tab titles, accessibility labels, badges and enabled flags; guessed frames), marks them `synthesized`, keeps them in the order model (the title first) and leaves them out of `interactive`, `reachable`, `labeled`, `actionable` and the other counts: a label the harness wrote proves nothing. `chromeModelled` counts them per screen. A declared control that only a modelled element carries is present, not counted; one the model lacks is unreachable. Every shown controller stack is modelled, the ones under a presented sheet or modal marked `covered`: they join the focus-trap check only when the dump shows no modal view hiding what lies under the sheet (`ignoredSiblings` 0), the way the covered screen's own content does.

**probe** is the device check of the native screens that no gate can express (SPEC.md, "Native screens, iOS", "Verified on the device"): `run=probe:<names>` (`lib/native/dev/probe.ts`) puts a screen in a state, does through `SvelteQA` what a user would (scroll the first scroll view, type into the search field, move a sheet to a detent, press the system's escape on it, focus a text field) and writes what UIKit reports (`uikitState`: navigation bars and their items, sheet detents, tab items, the keyboard's frame against the field's) and the accessibility tree to `qa/runs/probe-<device>-<stamp>-<direction>/<name>.json` with a screenshot beside it. Probes: `large-title`, `translucent`, `search`, `sheet`, `dismissal`, `reset-form`, `reset-modal`, `reset-sheet`, `back-form`, `back-modal`, `back-sheet`, `tabs`, `keyboard`, `keyboard-sheet`. It cannot press a screen the way a finger does, so the system's own gestures (the sheet's drag, the swipe-down dismissal, the edge swipe) are exercised only through the equivalent API calls and the escape action.

**Crash reports.** An app that aborts after it wrote its results (at the end of the last scenario, or while the harness ends it) leaves nothing in `lab-results.json` or `boot-report.json`: the run read "complete". Only the system's crash report says so (on 27 October the lab phone held 38 of the QA app, all `SIGABRT`s with the same stack: an `NSRangeException` thrown in `-[SvelteTabView unmountChildComponentView:index:]`). Every iOS command (lab, boot, parity, a11y, probe) therefore reads the phone's crash log twice through the Mac (`lib/iphone/crash-reports.ts`): once when it starts, after the install, and once at the end, after the app is ended and 5 s have passed (the system writes the report a moment after the process dies).

- *The pull* is `idevicecrashreport -u <udid> -k <scratch directory>` on the Mac (Homebrew's `/opt/homebrew/bin` and `/usr/local/bin` are added to the PATH). `-k` keeps the reports on the phone: without it the tool deletes them there, so it is never run without. The files of the app (`bundleID` `io.rasheed.svelteqa` in the header, `Retired/` included) and the jetsam events come back over `scp`. It takes about 4 s. A pull counts only when the tool exits 0 and prints `Done.`; a Mac without the tool, or a phone `usbmuxd` does not list (the cable, a locked phone), is an error with the tool's own words, never an empty list.
- *Each report* is `{ file, capturedAt, processStartedAt, pid, exceptionType, signal, reason, framesOf, topFrames }`. `reason` is the exception's message (`exceptionReason`, with its name), else the abort's own words (`asi`), else the termination's, at most 300 characters. `topFrames` are 12 frames (image, offset, symbol): `lastExceptionBacktrace`'s, where an exception was thrown (the faulting thread's first frames of an Objective-C exception are the runtime's abort code, and the app's frame comes after the twelfth), or the faulting thread's when the report has none (`framesOf` says which). A jetsam event counts only when the system killed the app (an entry named `RasheedSvelteQA` with a `reason`; the lab phone has none for the app yet, so that shape is read from the entries of the processes it did kill); a report of the app that cannot be read is a report with `exceptionType: null`, never dropped.
- *New since the run started* is decided by file name: the reports whose files were not on the phone at the first pull. No clock is involved, so the phone's and this machine's may differ by anything. (A moment on the phone's clock would also need the first pull, and would miss a report written late for a crash before it.) A report the system wrote late for a crash of the previous command's app is new to this command and is listed `unattributed`.
- *Attribution* (lab and boot) is by process: the report names a `pid`, each lab run and boot launch records the pid `devicectl` launched, and a report belongs to the run whose pid it names and whose process started before the report was captured (the harness's start of the run for a lab, the kernel's `processStartMs` for a boot launch). That is the one place the two clocks meet; it has 60 s of slack, so a pid the phone reuses long after a run is not that run's. A report no run owns is `unattributed` and counts all the same. A lab run whose app aborted is `complete: false` with `crashes` saying "the app aborted after it wrote its results: <reason> (<signal>, <file>)" (when the harness had already found the app gone it is the same crash, explained, not a second one), so `lab.incompleteRuns`, `lab.runs` and `log.fatals` count it; a boot launch keeps its display time (it was measured before the abort) and its `crashes` becomes 1 (`boot.fatals`). Parity, a11y and the probe launch the app several times for one result and attribute nothing: their reports are listed.
- *The record*: `crashReports` (the new reports, each with `attributedTo`: `lab 3`, `warm 7`, `cold 2` or `unattributed`; empty when there are none) or `crashReportsError` (why they could not be read: before the run, after it) in the run file, printed at the end of the command, and the `.ips` files in `qa/runs/<run file name>-crashes/`. The probe writes `crash-reports.json` in its directory and also lists the reports when it fails because the app died. `report` prints the reports of each run file under the device.
- *The gate* `log.crashReports` (iOS, `<= 0`) counts them over the newest lab, boot, parity and a11y files. A file whose pull failed or that has no record (a run from before the pull) is `not measured`, which fails, never 0.
- *The clock*: the times in a report (`capturedAt`, `processStartedAt`) are the phone's own, as an instant (the report names the phone's UTC offset). They are compared with this machine's clock only in the attribution check above.

Which `ios` bars have a measurement: `lab.*`, `checks.*`, `frames.*`, `list.virtual300.mountMs` (the lab), `boot.*` (boot), `log.fatals` and `log.engineWarnings` (sums over the lab and boot runs: a dead app, the crash reports of the phone and the JavaScript errors the app reports are fatals, an app that reports none leaves `log.fatals` not measured; the Android engine's warnings do not exist on iOS, so that sum is 0 by absence), `log.crashReports` (iOS only: the reports the crash log gained during the runs), `parity.*` and `a11y.*`. The sample-size bars are the production ones (`lab.runs` 10, `boot.*.samples` 30), so a short run reads as a miss until the full series is run: `lab --repeat 10` is about 35 minutes of device time, `boot --warm 30 --cold 30` about 25.

Not covered on iOS, and why (the run files list them): the startup screen's loading and error states, which need the app's HTTP held or refused (a system proxy setting of the phone); every text size but the standard one (Dynamic Type is a setting only the Settings app changes); resilience, soak and crash runs (the Android runners are `adb`/logcat/`dumpsys` based and have no iOS counterpart yet), so `resilience.*`, `soak.*`, `memory.*` and `crashes.*` read "not measured" for the iPhone (the phone's crash log is read by every command, "Crash reports" above).

## Files

```
native-qa.ts          entry point
commands/             build, lab, boot, parity, a11y, resilience, report, gates
lib/                  adb, exec, flock, flags, run files, metrics, gate evaluation, types; png (codec and diff), uia (uiautomator tree), a11y (the checklist), device (screens, settings, the failing proxy), drive (opening a screen), screens (the matrix), parity, resilience, suite-metrics
parse/                logcat, adb and statistics parsers
soak/                 soak and crashes runners, meminfo and soak-log parsers, their metrics, crash signatures, symbolication; heapdiff.py and malloc-debug-soak.sh (native allocation sites of a growth)
gates.json            the production bar
screenshots/          frozen parity references per device kind (committed), with their manifest and masks
test/                 bun tests; test/samples holds captured device output
out/ runs/ report.json    generated, git-ignored (APKs, source maps and unstripped libraries, build logs, run files, merged report)
```

## CI

`.github/workflows/native-qa.yml` runs the emulator lane on a self-hosted runner labelled `svelte-qa-emulator` for every push and on demand: parser tests, typecheck, connect the emulator, build, lab x10, boot 30 + 30, report, `gates --platform android`, then uploads `report.json`, the run files and logs and the build record as an artifact. The runner needs the Android SDK, JDK 17, `adb`, `flock`, and a way to reach the emulator (set the repository variable `QA_TUNNEL_HOST` to the ssh host that forwards port 5555, or leave it empty when `localhost:5555` already works). Runs queue on one concurrency group because the emulator and the Gradle daemon are shared.

Gate note (26 Oct): the cold gate is as strict as the warm one (350 ms Android, 250 iOS). An immediate relaunch after `am force-stop` (the warm series) runs while the previous process is still being torn down and tends to be slower than a launch after a 20 s idle gap (the cold series); both are reported, both must pass.
