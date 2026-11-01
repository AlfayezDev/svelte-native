<script lang="ts">
  import { onDestroy, onMount, untrack } from "svelte";
  import { requireOptionalNativeModule } from "expo-modules-core";
  import Dimensions from "react-native/Libraries/Utilities/Dimensions";
  import { Screen, Text, View, insets } from "@rasheed/svelte-native";
  import { nativeLabEnabled, theme } from "#lib/native/state.svelte.ts";
  import {
    GESTURE_TAG, Session, expectedTwoFinger, lab, pxPath, scenarioFor,
    type Drive, type Hooks, type Input, type Probe, type Rect, type Rects,
  } from "#lib/native/dev/gestures-lab.ts";
  import Box from "#lib/native/dev/gestures/Box.svelte";
  import Carousel from "#lib/native/dev/gestures/Carousel.svelte";
  import Churn from "#lib/native/dev/gestures/Churn.svelte";
  import Edge from "#lib/native/dev/gestures/Edge.svelte";
  import LongPressTap from "#lib/native/dev/gestures/LongPressTap.svelte";
  import PinchRotate from "#lib/native/dev/gestures/PinchRotate.svelte";
  import Row from "#lib/native/dev/gestures/Row.svelte";
  import ScrollNative from "#lib/native/dev/gestures/ScrollNative.svelte";
  import Sheet from "#lib/native/dev/gestures/Sheet.svelte";

  /**
   * The gesture lab (SPEC.md, "Gestures"): `/__dev/gestures?mode=<box|box-js|pinch-rotate|row|carousel|pushed-edge|sheet|longpress-tap|scroll-native|churn>`.
   * `&js=busy` blocks the JavaScript thread 40 ms of every 50 while the gesture runs, `&round=<n>` picks a round of a scenario that has
   * several (`pushed-edge`), `&drive=<adb|qa|xctest>` says who injects the input (`qa`: this page, through `SvelteQaTouch`, Android's QA
   * variant only; `adb` and `xctest`: the harness, which reads the `[Svelte gesture] ready` lines) and `&managed=1` leaves the start to
   * the stress scenario that opened the page, which also presents `mode=sheet` as a sheet (`goto(..., { presentation: "sheet" })`; opened by
   * link it is a plain screen). Opened by hand (no `managed`), the page starts itself after 1.2 s and logs the same lines.
   * `testID`s are `gesture.<name>` for every view a step aims at, and `gestures.status` holds the last `ready` line for an XCUITest.
   */
  let { url }: { url?: URL } = $props();
  const query = untrack(() => url?.searchParams);
  const mode = query?.get("mode") ?? "box";
  const busy = query?.get("js") === "busy";
  const roundIndex = Number(query?.get("round") ?? "0") || 0;
  const requested = query?.get("drive");
  const drive: Drive = requested === "adb" || requested === "qa" || requested === "xctest" ? requested : "none";
  const managed = query?.get("managed") === "1";
  const spec = scenarioFor(mode, busy);
  const density = Dimensions.get("window").scale;

  type Measurable = { measureInWindow?: (callback: (x: number, y: number, width: number, height: number) => void) => void };
  const handles: Record<string, unknown> = {};
  const probe: Probe = (name) => ({
    ref: (handle) => { if (handle) handles[name] = handle; else delete handles[name]; },
    testID: `gesture.${name}`,
    collapsable: false,
  });

  /** The widest and the lowest detent of the sheet this page draws, and where it rests now: the engine moves the sheet natively, so layout does not know. */
  const detents = [0.4, 0.9] as const;
  let fraction: number = detents[0];
  let detentChanges = 0;
  function sheetShift(): number {
    if (mode !== "sheet") return 0;
    const surface = insets.frame.height > 0 ? insets.frame.height : Dimensions.get("window").height;
    return (detents[1] - fraction) * (surface - insets.top) * density;
  }

  function measureOne(handle: unknown): Promise<Rect | null> {
    return new Promise((resolve) => {
      const target = handle as Measurable;
      if (!target.measureInWindow) { resolve(null); return; }
      const timer = setTimeout(() => { resolve(null); }, 1000);
      target.measureInWindow((x, y, width, height) => { clearTimeout(timer); resolve({ x: x * density, y: y * density, w: width * density, h: height * density }); });
    });
  }
  /** The part of [rect] that is on the screen: a step aims at its centre or a fraction of it, and a view taller than the screen (a sheet's list at its lower detent) must not be aimed below it. */
  function onScreen(rect: Rect, screen: Rect): Rect {
    const left = Math.max(rect.x, screen.x);
    const top = Math.max(rect.y, screen.y);
    const right = Math.min(rect.x + rect.w, screen.x + screen.w);
    const bottom = Math.min(rect.y + rect.h, screen.y + screen.h);
    return right > left && bottom > top ? { x: left, y: top, w: right - left, h: bottom - top } : rect;
  }
  async function measure(): Promise<{ rects: Rects; screen: Rect }> {
    const measured = await Promise.all(Object.entries(handles).map(async ([name, handle]) => [name, await measureOne(handle)] as const));
    const shift = sheetShift();
    const frame = insets.frame;
    const window = Dimensions.get("window");
    const screen = frame.width > 0 ? { x: frame.x * density, y: frame.y * density, w: frame.width * density, h: frame.height * density } : { x: 0, y: 0, w: window.width * density, h: window.height * density };
    const rects: Rects = {};
    for (const [name, rect] of measured) if (rect) rects[name] = onScreen({ ...rect, y: rect.y + shift }, screen);
    return { rects, screen };
  }

  type QaTouch = { run(plan: string): Promise<string> };
  const qaTouch = requireOptionalNativeModule<QaTouch>("SvelteQaTouch");
  type QaResult = { frameTimesMs: number[]; touchSlopPx: number };
  async function inject(input: Input, rects: Rects, density: number): Promise<QaResult> {
    if (!qaTouch) throw new Error("SvelteQaTouch is not in this build: the in-app injector is the Android QA variant's");
    const path = pxPath(input, rects, density);
    const result = JSON.parse(await qaTouch.run(JSON.stringify(path))) as QaResult;
    // What the pinch and the rotation must read follows from what was delivered (`expectedTwoFinger`).
    if (input.kind === "twoFinger") {
      const expected = expectedTwoFinger(path, result.frameTimesMs, result.touchSlopPx);
      session?.mark("expectedScale", expected.scale);
      session?.mark("expectedRotation", expected.rotationDeg);
    }
    return result;
  }

  let status = $state("waiting");
  const hooks: Hooks = {
    measure,
    inject,
    log: (event, payload) => {
      const text = JSON.stringify(payload);
      console.info(`${GESTURE_TAG} ${event}`, text);
      status = event === "ready" ? text : `${event} ${spec?.name ?? mode}`;
    },
  };
  const session: Session | null = spec ? new Session(spec, roundIndex, drive, density, hooks) : null;
  if (session) {
    lab.open(session);
    if (mode === "sheet") { session.mark("detent", 0); session.mark("detentChanges", 0); }
  }

  // The JavaScript thread blocked 40 ms of every 50 from the start of the round to its end.
  let blocker: ReturnType<typeof setInterval> | undefined;
  function stopBlocking() { if (blocker !== undefined) clearInterval(blocker); blocker = undefined; }
  if (session && busy) {
    session.onStart(() => {
      blocker = setInterval(() => { const end = performance.now() + 40; while (performance.now() < end) { /* the JavaScript thread is busy */ } }, 50);
    });
    void session.finished.then(stopBlocking);
  }

  onMount(() => {
    if (!nativeLabEnabled || !session || managed) return;
    const timer = setTimeout(() => { void session.start(); }, 1200);
    return () => { clearTimeout(timer); };
  });
  onDestroy(() => {
    stopBlocking();
    if (!session) return;
    // A screen that is destroyed under a gesture was popped (the edge swipe, Back): the round that waits for it is told.
    session.mark("popped", 1);
    lab.close(session);
  });

  function detentChanged(event: { index: number; fraction: number }) {
    fraction = event.fraction;
    detentChanges++;
    session?.mark("detent", event.index);
    session?.mark("detentChanges", detentChanges);
  }
</script>

{#snippet content()}
  <Text testID="gestures.status" accessibilityLabel={status} numberOfLines={1} style={{ color: theme.muted, fontSize: 9, paddingHorizontal: 16 }}>{status}</Text>
  {#if !session}
    <Text style={{ color: theme.danger, fontSize: 15, padding: 16 }}>Unknown mode {mode}{busy ? " (busy)" : ""}</Text>
  {:else if mode === "box" || mode === "box-js"}
    <Box {session} {probe} js={mode === "box-js"} />
  {:else if mode === "pinch-rotate"}
    <PinchRotate {session} {probe} />
  {:else if mode === "row"}
    <Row {session} {probe} />
  {:else if mode === "carousel"}
    <Carousel {session} {probe} />
  {:else if mode === "pushed-edge"}
    <Edge {session} {probe} />
  {:else if mode === "sheet"}
    <Sheet {session} {probe} />
  {:else if mode === "longpress-tap"}
    <LongPressTap {session} {probe} />
  {:else if mode === "scroll-native"}
    <ScrollNative {session} {probe} />
  {:else if mode === "churn"}
    <Churn {session} />
  {/if}
{/snippet}

{#if nativeLabEnabled}
  {#if mode === "sheet"}
    <Screen sheet={{ detents: [...detents], grabber: true }} onDetentChange={detentChanged} style={{ backgroundColor: theme.surface }}>
      <View style={{ flex: 1, paddingTop: 4 }}>{@render content()}</View>
    </Screen>
  {:else}
    <Screen title="Gestures lab" subtitle={spec?.name ?? mode} style={{ backgroundColor: theme.background }}>
      <View style={{ flex: 1 }}>{@render content()}</View>
    </Screen>
  {/if}
{/if}
