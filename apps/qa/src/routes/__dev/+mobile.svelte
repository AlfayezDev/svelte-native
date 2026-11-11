<script lang="ts">
  import { onMount, setContext, tick, untrack } from "svelte";
  import Platform from "react-native/Libraries/Utilities/Platform";
  import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
  import { File, Paths } from "expo-file-system";
  import { nativeApplicationVersion } from "expo-application";
  import { randomUUID } from "expo-crypto";
  import { SvelteMap, SvelteSet, SvelteDate, SvelteURL } from "svelte/reactivity";
  import { writable, derived } from "svelte/store";
  import { Text, View, Pressable, useRouter } from "@example/svelte-native";
  import { AnimatedView, createSharedValue, withTiming, withSpring, withRepeat, withSequence, cancelAnimation, ReduceMotion, runOnUISync } from "@example/svelte-native/animation";
  import { nativeLabEnabled, theme } from "#lib/native/state.svelte.ts";
  import { labContext, RuneCounter, runeCounter, screenLab, type RowHandle } from "#lib/native/dev/model.svelte.ts";
  import Binding from "#lib/native/dev/Binding.svelte";
  import Row from "#lib/native/dev/Row.svelte";
  import Observed from "#lib/native/dev/Observed.svelte";
  import Stress from "#lib/native/dev/Stress.svelte";
  import ClassProbe from "#lib/native/dev/ClassProbe.svelte";
  import { runClassChecks } from "#lib/native/dev/class-lab.ts";
  import HtmlScreen from "#lib/native/dev/HtmlScreen.svelte";
  import { runHtmlChecks } from "#lib/native/dev/html-lab.ts";
  import TransitionsScreen from "#lib/native/dev/TransitionsScreen.svelte";
  import { runTransitionChecks } from "#lib/native/dev/transition-lab.ts";
  import Page from "#lib/native/components/Page.svelte";
  import Button from "#lib/native/components/Button.svelte";
  import { runCapture } from "#lib/native/dev/capture.ts";
  import { runProbes } from "#lib/native/dev/probe.ts";
  import { writeResilienceIdentity } from "#lib/native/dev/resilience.ts";
  import { jsErrorCount } from "#lib/native/dev/errors.ts";
  import { qaModule, type BuildIdentity } from "#lib/native/dev/qa.ts";
  import { smokeLaunch } from "#lib/native/dev/smoke-log.ts";
  import { updateReport } from "#lib/native/dev/update-probe.ts";

  /**
   * `?run=checks,quick` (or scenario names) drives the lab without touching the screen; results land in Documents/lab-results.json.
   * `?run=probe:<names>` (iOS) runs device probes of the native screens (`lib/native/dev/probe.ts`) into Documents/probe.
   * `?run=capture:<ids>&themes=light.dark` (iOS) screenshots and dumps the accessibility tree of the named screens into Documents/capture,
   * `?run=resilience&token=<text>` (iOS) writes the build identity to Documents/resilience.json and runs nothing (`native-qa resilience --platform ios`, `lib/native/dev/resilience.ts`),
   * `?panel=<name>` opens a panel of this page and `&state=pending|error` puts the async panel in that state (the parity and accessibility suites).
   */
  let { url: pageUrl }: { url?: URL } = $props();
  const autorun = untrack(() => pageUrl?.searchParams.get("run") ?? "");
  const capture = autorun.startsWith("capture:") ? autorun.slice("capture:".length).split(".").filter(Boolean) : null;
  const probes = autorun.startsWith("probe:") ? autorun.slice("probe:".length).split(".").filter(Boolean) : null;
  const captureThemes = untrack(() => (pageUrl?.searchParams.get("themes") ?? "light").split(".").filter((theme): theme is "light" | "dark" => theme === "light" || theme === "dark"));
  /** `&token=<text>` is echoed into every file the run writes, so the harness knows a file belongs to the launch it made. */
  const token = untrack(() => pageUrl?.searchParams.get("token") ?? null);
  smokeLaunch.token = token;
  const initialPanel = untrack(() => pageUrl?.searchParams.get("panel"));
  const headerVariant = untrack(() => pageUrl?.searchParams.get("hv"));
  if (headerVariant === "title" || headerVariant === "plain") screenLab.header = headerVariant;
  const rowVariant = untrack(() => pageUrl?.searchParams.get("rv"));
  if (rowVariant === "plain" || rowVariant === "image") screenLab.rows = rowVariant;
  const initialState = untrack(() => pageUrl?.searchParams.get("state"));
  const resilience = autorun === "resilience";
  const stressAutorun = $derived(capture || probes || resilience ? "" : autorun.split(",").filter((part) => part && part !== "checks").join(","));
  let stressResults: unknown[] = [];
  let stressDone = false;
  /** What is installed, from the QA module (iOS); Android's harness knows its APK by its own hash. */
  let build: BuildIdentity | null = null;
  if (qaModule?.enabled) void qaModule.buildIdentity().then((identity) => { build = identity; });
  function saveResults(phase: string) {
    const report = { phase, token, finishedAt: new Date().toISOString(), platform: Platform.OS, osVersion: String(Platform.Version), appVersion: nativeApplicationVersion, build, jsErrors: jsErrorCount(), checks: $state.snapshot(checks), stress: stressResults, stressDone, updates: updateReport() };
    console.info("[native lab results]", JSON.stringify(report));
    try { new File(Paths.document, "lab-results.json").write(JSON.stringify(report)); }
    catch (error) { console.error("[native lab results]", error); }
  }
  const router = useRouter();
  onMount(() => {
    if (!nativeLabEnabled || !capture) return;
    const timer = setTimeout(() => { void runCapture(router, capture, captureThemes, token).catch((error: unknown) => console.error("[native lab capture]", error)); }, 1500);
    return () => clearTimeout(timer);
  });
  onMount(() => {
    if (!nativeLabEnabled || !probes) return;
    const timer = setTimeout(() => { void runProbes(router, probes, token).catch((error: unknown) => console.error("[native lab probe]", error)); }, 1500);
    return () => clearTimeout(timer);
  });
  onMount(() => {
    if (!nativeLabEnabled || !resilience) return;
    void writeResilienceIdentity(token, jsErrorCount()).catch((error: unknown) => console.error("[native lab resilience]", error));
  });
  onMount(() => {
    if (!nativeLabEnabled || !autorun || capture || probes || resilience) return;
    const timer = setTimeout(() => { void (async () => {
      if (autorun.includes("checks")) { await runChecks(); saveResults("checks"); }
      if (stressAutorun) panel = "stress";
      else saveResults("done");
    })(); }, 1500);
    return () => clearTimeout(timer);
  });
  onMount(() => {
    if (!nativeLabEnabled) return;
    const tag = `svelte-native-lab:${randomUUID()}`;
    let active = true;
    const release = () => { void deactivateKeepAwake(tag).catch((error: unknown) => console.error("[native lab keep awake cleanup]", error)); };
    void activateKeepAwakeAsync(tag).then(() => { if (!active) release(); }).catch((error: unknown) => console.error("[native lab keep awake]", error));
    return () => { active = false; release(); };
  });
  type Check = { name: string; passed: boolean; detail: string };
  type Panel = "checks" | "binding" | "rows" | "async" | "animation" | "stress";
  const panels: readonly Panel[] = ["checks", "binding", "rows", "async", "animation", "stress"];
  let panel = $state<Panel>(panels.find((name) => name === initialPanel) ?? "checks");
  let running = $state(false);
  let checks = $state<Check[]>([]);
  /** The views of the class checks (`class-lab.ts`): on the page while the run reads them, not otherwise (the page's screens are frozen without them). */
  let classProbe: ReturnType<typeof ClassProbe> | undefined = $state();
  let classProbeOn = $state(false);
  /** The same for the HTML checks (`html-lab.ts`): the lab's screen of HTML elements, whose tree they read. */
  let htmlProbe: ReturnType<typeof HtmlScreen> | undefined = $state();
  let htmlProbeOn = $state(false);
  /** And for the transition checks (`transition-lab.ts`): the lab's screen of transitions, which the run shows, hides, shuffles and opens. */
  let transitionProbe: ReturnType<typeof TransitionsScreen> | undefined = $state();
  let transitionProbeOn = $state(false);
  const passed = $derived(checks.filter((check) => check.passed).length);
  const failed = $derived(checks.length - passed);
  const titleStyle = $derived({ color: theme.foreground, fontSize: 19, fontWeight: "600" as const });
  const textStyle = $derived({ color: theme.foreground, fontSize: 15 });

  let count = $state(1);
  const doubled = $derived(count * 2);
  let nested = $state({ person: { name: "before" }, numbers: [1, 2] });
  const total = $derived.by(() => nested.numbers.reduce((sum, value) => sum + value, 0));
  let raw = $state.raw({ value: 1 });
  let observed = $state(0);
  // eslint-disable-next-line svelte/prefer-writable-derived -- This lab deliberately tests pre-effects.
  let preObserved = $state(0);
  let effects = 0;
  let cleanups = 0;
  $effect.pre(() => { preObserved = count; });
  $effect(() => { observed = count; effects++; return () => { cleanups++; }; });
  let trigger = $state(0);
  let ignored = $state(0);
  let untrackedRuns = 0;
  $effect(() => { void trigger; untrack(() => ignored); untrackedRuns++; });
  const classCounter = new RuneCounter();
  const factoryCounter = runeCounter();
  const store = writable(1);
  const storeTriple = derived(store, (value) => value * 3);
  const map = new SvelteMap<string, number>();
  const set = new SvelteSet<string>();
  const date = new SvelteDate(0);
  const url = new SvelteURL("https://native.invalid/?value=before");
  const collectionSummary = $derived(`${map.size}:${map.get("answer") ?? 0}:${set.size}:${date.getTime()}:${url.searchParams.get("value")}`);

  const context = $state({ message: "context before" });
  setContext(labContext, context);
  let bound = $state("parent before");
  let childLabel = $state("prop before");
  let binding: ReturnType<typeof Binding> | undefined = $state();
  let bindingObservation = $state({ value: "", label: "", context: "" });
  const instances = new SvelteMap<string, RowHandle>();
  let removed = 0;
  let rows = $state([{ id: "a", name: "Row A" }, { id: "b", name: "Row B" }]);
  let visible = $state(true);
  let keyVersion = $state(0);
  const register = (id: string, handle: RowHandle) => { instances.set(id, handle); };
  const remove = (id: string) => { instances.delete(id); removed++; };

  let pending = $state<Promise<string> | null>(null);
  let asyncPhase = $state("idle");
  let resolvePending: ((value: string) => void) | undefined;
  let rejectPending: ((reason: Error) => void) | undefined;
  function startAsync() {
    pending = new Promise<string>((resolve, reject) => { resolvePending = resolve; rejectPending = reject; });
  }
  let trip = $state(false);
  let boundaryError = $state<string | null>(null);
  let recover: (() => void) | undefined;
  function boundaryValue() {
    if (trip) throw new Error("Deliberate boundary test");
    return "Boundary healthy";
  }
  function resetBoundary() { trip = false; const reset = recover; recover = undefined; boundaryError = null; reset?.(); }
  onMount(() => {
    if (!nativeLabEnabled || panel !== "async") return;
    if (initialState === "pending") startAsync();
    else if (initialState === "error") trip = true;
  });

  const position = createSharedValue(0);
  const finishedAt = createSharedValue(0);
  let animationTarget = $state(false);
  let animationLoop = $state(false);
  let animationKind = $state<"timing" | "spring">("timing");
  let animationReport = $state("Not measured");
  let animatedTaps = $state(0);
  let animationMounted = false;
  let animationReady: (() => void) | undefined;
  $effect(() => { if (panel !== "animation") animationMounted = false; });
  const animatedStyle = () => {
    "worklet";
    return { transform: [{ translateX: position.value * 180 }, { rotate: `${position.value * 180}deg` }], opacity: 0.45 + position.value * 0.55 };
  };
  $effect(() => {
    const target = animationTarget ? 1 : 0;
    position.value = animationLoop
      ? withRepeat(withSequence(withTiming(1, { duration: 700 }), withTiming(0, { duration: 700 })), -1)
      : animationKind === "spring" ? withSpring(target) : withTiming(target, { duration: 700 });
    return () => cancelAnimation(position);
  });
  function finished(finished?: boolean) { "worklet"; if (finished) finishedAt.value = Date.now(); }
  function startProbe() {
    "worklet";
    cancelAnimation(position);
    position.value = 0;
    finishedAt.value = 0;
    position.value = withTiming(1, { duration: 400, reduceMotion: ReduceMotion.Never }, finished);
    return Date.now();
  }
  function check(name: string, condition: boolean, detail = "") { checks.push({ name, passed: condition, detail }); }
  async function settle() { await tick(); await Promise.resolve(); await tick(); }
  async function verifyAnimation() {
    animationLoop = false;
    await settle();
    if (!animationMounted) await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => { animationReady = undefined; reject(new Error("Animated view did not lay out")); }, 5000);
      animationReady = () => { clearTimeout(timeout); animationReady = undefined; resolve(); };
    });
    const start = runOnUISync(startProbe);
    let checksum = 0;
    while (Date.now() - start < 1000) checksum = Math.imul(checksum + 1, 1664525);
    const end = Date.now();
    const completion = finishedAt.value;
    const detail = `UI completion ${completion ? completion - start : "missing"} ms; JS busy ${end - start} ms; checksum ${checksum}`;
    animationReport = detail;
    check("Reanimated UI runtime continues while JS is busy", completion > start && completion < end - 100, detail);
  }

  async function runChecks() {
    if (running) return;
    running = true;
    checks = [];
    const previousPanel = panel;
    panel = "checks";
    try {
      await settle();
      count++;
      await settle();
      check("$state + $derived", doubled === count * 2 && observed === count);
      nested.person.name = "after";
      nested.numbers.push(3);
      await settle();
      check("Deep object and array proxies + $derived.by", nested.person.name === "after" && total === nested.numbers.reduce((a, b) => a + b, 0));
      const snapshot = $state.snapshot(nested);
      nested.person.name = "later";
      check("$state.snapshot is detached", snapshot.person.name === "after");
      raw = { value: raw.value + 1 };
      await settle();
      check("$state.raw replacement", raw.value > 1);
      const beforeEffects = effects;
      const beforeCleanups = cleanups;
      count++; count++; count++;
      await settle();
      check("Synchronous updates batch into one effect", effects === beforeEffects + 1);
      check("$effect.pre + $effect + tick", preObserved === count && observed === count);
      check("Effect cleanup precedes rerun", cleanups === beforeCleanups + 1);
      const beforeUntracked = untrackedRuns;
      ignored++;
      await settle();
      check("untrack excludes dependencies", untrackedRuns === beforeUntracked);
      trigger++;
      await settle();
      check("Tracked dependencies still rerun", untrackedRuns === beforeUntracked + 1);
      let rootRuns = 0;
      let rootCleanups = 0;
      const dispose = $effect.root(() => { $effect(() => { void count; rootRuns++; return () => { rootCleanups++; }; }); });
      await settle();
      dispose(); count++;
      await settle();
      check("$effect.root disposal", rootRuns === 1 && rootCleanups === 1);
      classCounter.increment(); factoryCounter.increment();
      await settle();
      check("Runes in .svelte.ts classes and factories", classCounter.doubled === classCounter.value * 2 && factoryCounter.value > 1);
      store.set(7);
      await settle();
      check("Store subscriptions and derived stores", $storeTriple === 21);
      map.set("answer", 42); set.add("present"); date.setTime(1234); url.searchParams.set("value", "after");
      await settle();
      check("SvelteMap / SvelteSet / SvelteDate / SvelteURL", collectionSummary === "1:42:1:1234:after");

      panel = "binding";
      await settle();
      childLabel = "prop after"; context.message = "context after"; bound = "parent after";
      await settle();
      check("Reactive $props", bindingObservation.label === "prop after");
      check("Context retains reactive state", bindingObservation.context === "context after");
      check("Parent → $bindable child", binding?.readValue() === "parent after");
      binding?.setValue("child after");
      await settle();
      check("$bindable child → parent", bound === "child after" && bindingObservation.value === "child after");

      panel = "rows"; visible = true;
      rows = [{ id: "a", name: "Row A" }, { id: "b", name: "Row B" }];
      await settle();
      const a = instances.get("a");
      a?.setDraft("unsaved A");
      rows.reverse();
      await settle();
      check("Keyed reorder retains component and draft", !!a && instances.get("a") === a && a.draft() === "unsaved A");
      const beforeRemove = removed;
      rows = rows.filter((row) => row.id !== "a");
      await settle();
      check("Keyed removal destroys component", !instances.has("a") && removed === beforeRemove + 1);
      const keyed = instances.get("keyed");
      keyVersion++;
      await settle();
      check("{#key} recreates component", !!keyed && !!instances.get("keyed") && instances.get("keyed") !== keyed);
      visible = false;
      await settle();
      check("{#if} removes and cleans up children", !instances.has("b") && !instances.has("keyed"));
      visible = true;
      await settle();
      check("Conditional remount runs lifecycle", instances.has("b") && instances.has("keyed"));

      panel = "async"; startAsync();
      await settle();
      check("{#await} pending branch", asyncPhase === "pending");
      resolvePending?.("done");
      await settle();
      check("{#await} resolved branch", asyncPhase === "resolved: done");
      startAsync(); await settle(); rejectPending?.(new Error("expected"));
      await settle();
      check("{#await} rejected branch", asyncPhase === "rejected: expected");
      resetBoundary(); await settle(); trip = true;
      await settle();
      check("<svelte:boundary> catches render errors", boundaryError === "Deliberate boundary test");
      resetBoundary(); await settle();
      check("Boundary reset restores rendering", boundaryError === null && !trip);

      panel = "animation";
      await settle();
      await verifyAnimation();

      // `class` (the css option: src/global.css): ten checks of what the classes of a mounted view became, after the others because one of them switches the app's appearance for a moment.
      panel = "checks";
      classProbeOn = true;
      await settle();
      try { await runClassChecks(classProbe, check); }
      catch (error) { check("Class checks completed", false, error instanceof Error ? error.message : String(error)); console.error("[native lab classes]", error); }

      classProbeOn = false;
      // HTML elements (`HtmlScreen.svelte`, written with HTML and classes): six checks of what the host drew from the mounted elements, after the class checks, whose scheme override is over by now.
      htmlProbeOn = true;
      await settle();
      try { await runHtmlChecks(htmlProbe, check); }
      catch (error) { check("HTML checks completed", false, error instanceof Error ? error.message : String(error)); console.error("[native lab html]", error); }

      htmlProbeOn = false;
      // Transitions (`TransitionsScreen.svelte`: `in:`, `out:`, `transition:` and `animate:flip` on HTML elements): five checks of what the host and Reanimated did to the elements, last because they take a few seconds of real time.
      transitionProbeOn = true;
      await settle();
      try { await runTransitionChecks(transitionProbe, check); }
      catch (error) { check("Transition checks completed", false, error instanceof Error ? error.message : String(error)); console.error("[native lab transitions]", error); }
    } catch (error) {
      check("Runner completed", false, error instanceof Error ? error.message : String(error));
      console.error("[native lab]", error);
    } finally { running = false; classProbeOn = false; htmlProbeOn = false; transitionProbeOn = false; panel = previousPanel; }
  }
</script>

{#if nativeLabEnabled}
<Page title="Mobile development lab" description="Svelte on Hermes · real native views · Reanimated UI runtime">
  <Text style={titleStyle} accessibilityLiveRegion="polite">{checks.length ? `${passed} functional checks passed · ${failed} failed` : "Ready to test"}</Text>
  {#each checks.filter((check) => !check.passed) as failure, index (`${index}:${failure.name}`)}
    <Text style={{ color: theme.danger, fontSize: 15 }}>FAIL · {failure.name}{failure.detail ? ` · ${failure.detail}` : ""}</Text>
  {/each}
  <Button label={running ? "Running checks…" : "Run all checks"} onPress={runChecks} disabled={running} />
  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
    {#each (["checks", "binding", "rows", "async", "animation", "stress"] as const) as item (item)}
      <Button label={item} variant={panel === item ? "primary" : "secondary"} onPress={() => { panel = item; }} disabled={running} />
    {/each}
  </View>
  {#if panel === "checks"}
    <Text style={textStyle}>State {count} · derived {doubled} · array total {total} · raw {raw.value}</Text>
    <Text style={textStyle}>Effect observed {observed} · pre-effect {preObserved} · store {$storeTriple}</Text>
    <Text style={textStyle}>Collections {collectionSummary}</Text>
    <Button label="Increment state" variant="secondary" onPress={() => { count++; }} disabled={running} />
    {#if classProbeOn}<ClassProbe bind:this={classProbe} />{/if}
    {#if htmlProbeOn}<HtmlScreen bind:this={htmlProbe} />{/if}
    {#if transitionProbeOn}<TransitionsScreen bind:this={transitionProbe} />{/if}
    {#each checks as result, index (`${index}:${result.name}`)}
      <View style={{ gap: 5, borderLeftWidth: 3, borderLeftColor: result.passed ? "#22a06b" : theme.danger, paddingLeft: 12 }}>
        <Text style={textStyle}>{result.passed ? "PASS" : "FAIL"} · {result.name}</Text>
        {#if result.detail}<Text style={{ color: theme.muted, fontSize: 13 }}>{result.detail}</Text>{/if}
      </View>
    {/each}
  {:else if panel === "binding"}
    <Text style={textStyle}>Parent value: {bound}</Text>
    <Binding bind:this={binding} bind:value={bound} label={childLabel} observe={(value) => { bindingObservation = value; }} />
    <Button label="Change parent and context" variant="secondary" onPress={() => { bound = "parent changed"; childLabel = "prop changed"; context.message = "context changed"; }} />
  {:else if panel === "rows"}
    <Text style={textStyle}>Edit a draft or tap a row, then reverse. Its local state should follow its key.</Text>
    <Button label="Reverse rows" onPress={() => { rows.reverse(); }} />
    <Button label="Restore sample rows" variant="secondary" onPress={() => { rows = [{ id: "a", name: "Row A" }, { id: "b", name: "Row B" }]; visible = true; }} />
    <Button label={visible ? "Unmount rows" : "Mount rows"} variant="secondary" onPress={() => { visible = !visible; }} />
    <Button label="Change key" variant="secondary" onPress={() => { keyVersion++; }} />
    {#if visible}
      {#each rows as row (row.id)}<Row {row} {register} {remove} />{/each}
      {#key keyVersion}<Row row={{ id: "keyed", name: "Key block" }} {register} {remove} />{/key}
    {/if}
  {:else if panel === "async"}
    <Button label="Start async" onPress={startAsync} />
    <Button label="Resolve async" variant="secondary" onPress={() => resolvePending?.("done")} />
    <Button label="Reject async" variant="secondary" onPress={() => rejectPending?.(new Error("expected"))} />
    {#if pending}
      {#await pending}<Observed value="pending" observe={(value) => { asyncPhase = value; }} />
      {:then value}<Observed value={`resolved: ${value}`} observe={(value) => { asyncPhase = value; }} />
      {:catch error}<Observed value={`rejected: ${error instanceof Error ? error.message : String(error)}`} observe={(value) => { asyncPhase = value; }} />{/await}
    {/if}
    <Button label="Trip error boundary" variant="secondary" onPress={() => { trip = true; }} />
    <svelte:boundary failed={boundaryFailed} onerror={(error, reset) => { boundaryError = error instanceof Error ? error.message : String(error); recover = reset; }}>
      <Text style={textStyle}>{boundaryValue()}</Text>
    </svelte:boundary>
  {:else if panel === "stress"}
    <Stress autorun={stressAutorun} onResult={(results, done) => { stressResults = results; stressDone = done; saveResults(done ? "done" : "stress"); }} />
  {:else}
    <Text style={textStyle}>Transforms and opacity run through Reanimated. Normal controls respect the system’s reduced-motion setting.</Text>
    <View style={{ height: 100, padding: 16, borderRadius: 16, backgroundColor: theme.surface }}>
      <AnimatedView {animatedStyle} testID="qa-mask-square" onLayout={() => { animationMounted = true; animationReady?.(); }} accessibilityLabel="Reanimated test square" style={{ width: 52, height: 52, borderRadius: 12, backgroundColor: "#3685ff" }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Animated touch target" onPress={() => { animatedTaps++; }} style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><Text style={{ color: "white" }}>Tap</Text></Pressable>
      </AnimatedView>
    </View>
    <Text style={textStyle}>Animated taps: {animatedTaps}</Text>
    <Button label="Animate timing" onPress={() => { animationLoop = false; animationKind = "timing"; animationTarget = !animationTarget; }} disabled={running} />
    <Button label="Animate spring" variant="secondary" onPress={() => { animationLoop = false; animationKind = "spring"; animationTarget = !animationTarget; }} disabled={running} />
    <Button label={animationLoop ? "Stop animation loop" : "Start animation loop"} variant="secondary" onPress={() => { animationLoop = !animationLoop; }} disabled={running} />
    <Button label="Verify UI thread · block JS for 1 second" variant="secondary" onPress={async () => { if (running) return; running = true; try { await verifyAnimation(); } finally { running = false; } }} disabled={running} />
    <Text style={textStyle}>{animationReport}</Text>
  {/if}
</Page>
{/if}

{#snippet boundaryFailed(error: unknown)}
  <Text style={{ color: theme.danger }}>{error instanceof Error ? error.message : String(error)}</Text>
  <Button label="Reset boundary" onPress={resetBoundary} />
{/snippet}
