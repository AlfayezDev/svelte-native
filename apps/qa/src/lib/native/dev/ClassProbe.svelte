<script lang="ts">
  import { Text, View } from "@alfayez/svelte-native";
  import { theme } from "../state.svelte.ts";

  /**
   * The views the class checks of the native checks lab read (`class-checks.ts`, `class-lab.ts`): each has `class`, and each is imported from the package, so the page lowers it to a host tag
   * (`<native-view nativeClass={...}>`) whose node `{@attach}` hands out (`bind:this` is not available with the custom renderer). The node is the renderer's own (`NativeNode`): its props are what
   * the host sends to the native view, the resolved style of its classes under its own `style`. Mounted for the length of the run (the lab's page shows it while it works) and not on the page otherwise.
   * Every class is written in full here, which is how Tailwind finds it (the build reads the files under `src/`).
   */
  type Measure = (callback: (x: number, y: number, width: number, height: number) => void) => void;
  type Handle = { measureInWindow: Measure };
  let paddingRef: Handle | null = null;
  let paddedChildRef: Handle | null = null;
  let wide = $state(false);
  const nodes: Record<string, unknown> = {};
  /** `{@attach hold("name")}` keeps the element it is given, the renderer's node, while it is mounted. */
  const hold = (name: string) => (element: unknown) => {
    nodes[name] = element;
    return () => { if (nodes[name] === element) delete nodes[name]; };
  };

  /** The renderer's node of a probe view, by name (the lab reads `getProp` of it). */
  export function node(name: string): unknown {
    return nodes[name];
  }
  /** The host handles of the padded view and of the child inside it, to measure what the layout made of `p-4`. */
  export function handles(): { parent: Handle | null; child: Handle | null } {
    return { parent: paddingRef, child: paddedChildRef };
  }
  export function setWide(next: boolean): void {
    wide = next;
  }
</script>

<View testID="class-probe" style={{ gap: 6, padding: 8, borderRadius: 8, borderWidth: 1, borderColor: theme.border }}>
  <Text style={{ color: theme.muted, fontSize: 12 }}>Classes (the class checks read these views)</Text>
  <View {@attach hold("padding")} ref={(handle) => { paddingRef = handle; }} class="self-start p-4">
    <View ref={(handle) => { paddedChildRef = handle; }} style={{ width: 40, height: 20, backgroundColor: "#0091ff" }} />
  </View>
  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
    <View {@attach hold("tint")} class="size-8 bg-sky-500/50" />
    <View {@attach hold("responsive")} class="p-2 md:p-10" />
    <View {@attach hold("capped")} class="p-2 max-md:p-10" />
    <View {@attach hold("scheme")} class="size-8 bg-white dark:bg-zinc-900" />
    <View {@attach hold("custom")} class="qa-card" />
    <View {@attach hold("beaten")} class="qa-card p-6" />
    <View {@attach hold("inline")} class="size-8 bg-zinc-400" style={{ backgroundColor: "#f97316" }} />
    <View {@attach hold("list")} class={["p-4", wide && "p-8"]} />
    <View {@attach hold("object")} class={{ "p-4": true, "p-8": wide }} />
    <Text {@attach hold("label")} class="text-lg font-semibold" style={{ color: theme.foreground }}>Aa</Text>
  </View>
</View>
