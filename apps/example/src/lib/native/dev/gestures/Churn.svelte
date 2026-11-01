<script lang="ts">
  import { tick } from "svelte";
  import { requireOptionalNativeModule } from "expo-modules-core";
  import { Text, View } from "@rasheed/svelte-native";
  import { createSharedValue } from "@rasheed/svelte-native/animation";
  import { theme } from "../../state.svelte.ts";
  import ChurnItem from "./ChurnItem.svelte";
  import { CHURN_ROUNDS, type Session } from "../gestures-lab.ts";

  /**
   * `gestures-churn`: `CHURN_ROUNDS` mounts and unmounts of a view with three gestures, half on the UI thread and half on the JavaScript
   * thread, some unmounted in the commit that mounted them and some a frame later. Nothing may be left in the gesture host
   * (`fabricStats().gestures`: records, native handlers, UI-thread registrations) and the engine's live views must be back to what they were.
   */
  let { session }: { session: Session } = $props();
  createSharedValue(0); // loads Reanimated before the first gesture is made

  /** The gesture host's counts (`fabricStats().gestures` of `@rasheed/svelte-native/fabric`, which the host publishes on `globalThis.__svelteFabric`; importing the module would pull the renderer into the app's type check). */
  const hostStats = () => (globalThis as { __svelteFabric?: { stats(): { gestures: { records: number; handlers: number; eventHandlers: number } | null } } }).__svelteFabric?.stats().gestures ?? null;
  const engine = requireOptionalNativeModule<{ stats?: () => Record<string, number> | null }>("SvelteEngine");
  let round = $state(0);
  let shown = $state(false);
  let status = $state("waiting");
  let mounted = 0;
  let unmounted = 0;

  const frame = () => new Promise<void>((resolve) => { requestAnimationFrame(() => { resolve(); }); });
  const pause = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });
  /** The engine's live views, read for the baseline and for the end. No count is no mark: the lab's check (`viewsLeft`) fails that on Android, where the engine counts, and accepts it on iOS, which has no engine. */
  async function alive(): Promise<number | undefined> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const stats = engine?.stats?.() ?? null;
      if (stats && typeof stats.alive === "number") return stats.alive;
      await pause(150);
    }
    return undefined;
  }

  async function run() {
    const baseline = await alive();
    if (baseline !== undefined) session.mark("aliveBaseline", baseline);
    for (let index = 0; index < CHURN_ROUNDS; index++) {
      round = index;
      shown = true;
      await tick();
      // Rounds 0 and 1 of every four unmount in the turn that mounted them (before the host's deferred attach), rounds 2 and 3 a frame later.
      if (index % 4 >= 2) await frame();
      shown = false;
      await tick();
      status = `${index + 1} / ${CHURN_ROUNDS}`;
    }
    await frame();
    await pause(500);
    const host = hostStats();
    session.mark("mounted", mounted);
    session.mark("unmounted", unmounted);
    session.mark("records", host?.records ?? -1);
    session.mark("handlers", host?.handlers ?? -1);
    session.mark("eventHandlers", host?.eventHandlers ?? -1);
    const after = await alive();
    if (after !== undefined) session.mark("alive", after);
    session.finish();
  }
  // svelte-ignore state_referenced_locally
  session.onStart(run);
</script>

<View style={{ gap: 12, padding: 16 }}>
  <Text style={{ color: theme.foreground, fontSize: 15 }}>Mount and unmount a view with three gestures · {status}</Text>
  <View style={{ height: 80, alignItems: "flex-start" }}>
    {#if shown}<ChurnItem js={round % 2 === 1} mounted={() => { mounted++; }} unmounted={() => { unmounted++; }} />{/if}
  </View>
</View>
