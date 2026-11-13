<script lang="ts">
  import { Screen, ScrollView, Tabs, Text, View, type TabItem } from "@alfayez/svelte-native";
  import { nativeLabEnabled, theme } from "#lib/native/state.svelte.ts";
  import { attachHandler, gestureProbe } from "#lib/native/dev/gesture-probe.ts";

  /**
   * The page of the `gestures-*` probes (`lib/native/dev/probe.ts`): one box that carries (or is about to carry) a gesture handler, and a scroll view
   * with a box of its own. `?mode=` picks how it is shown (`plain`: a screen of the stack, `sheet`: a sheet with two detents, `tabs` and `tabs-eager`: two
   * tabs with a box in the second one, whose pane mounts at its first selection or, eager, at launch; `gestureProbe.select("b")` selects it), `?attach=early` attaches a
   * pan handler to the box as the page mounts, the way a Svelte detector does after its commit; the probe attaches later itself otherwise.
   */
  let { url }: { url?: URL } = $props();
  const mode = $derived(url?.searchParams.get("mode") ?? "plain");
  const early = $derived(url?.searchParams.get("attach") === "early");
  const rows = Array.from({ length: 12 }, (_, index) => index + 1);
  const tabItems: TabItem[] = [{ key: "a", title: "A" }, { key: "b", title: "B" }];
  let selected = $state("a");
  gestureProbe.select = (key) => { selected = key; };

  function report(name: string, handle: unknown) {
    const tag = (handle as { tag?: number } | null)?.tag;
    if (tag === undefined) return;
    gestureProbe.tags[name] = tag;
    if (early && (name === "box" || name === "pane")) setTimeout(() => { gestureProbe.tags.handler = attachHandler(tag); }, 0);
  }
</script>

{#snippet content()}
  <View collapsable={false} testID="gesture-box" ref={(handle: unknown) => report("box", handle)} style={{ height: 120, borderRadius: 12, backgroundColor: "#3685ff", margin: 16 }} />
  <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 8 }}>
    <View collapsable={false} testID="gesture-in-scroll" ref={(handle: unknown) => report("inScroll", handle)} style={{ height: 80, borderRadius: 12, backgroundColor: "#ff8a36" }} />
    {#each rows as row (row)}
      <View style={{ padding: 12, borderRadius: 10, backgroundColor: theme.surface }}><Text style={{ color: theme.foreground, fontSize: 15 }}>Row {row}</Text></View>
    {/each}
  </ScrollView>
{/snippet}

{#snippet pane(tab: { readonly key: string })}
  <View style={{ flex: 1, paddingTop: 80 }}>
    {#if tab.key === "b"}
      <View collapsable={false} testID="gesture-in-pane" ref={(handle: unknown) => report("pane", handle)} style={{ height: 120, borderRadius: 12, backgroundColor: "#36c27a", margin: 16 }} />
    {/if}
    <Text style={{ color: theme.foreground, fontSize: 15, padding: 16 }}>Pane {tab.key}</Text>
  </View>
{/snippet}

{#if nativeLabEnabled}
  {#if mode === "tabs" || mode === "tabs-eager"}
    <Tabs items={tabItems} {selected} onSelect={(key) => { selected = key; }} content={pane} lazy={mode === "tabs"} tint={theme.foreground} />
  {:else if mode === "sheet"}
    <Screen sheet={{ detents: [0.4, 0.9], grabber: true }} style={{ backgroundColor: theme.surface }}>
      <View style={{ flex: 1, paddingTop: 24 }}>{@render content()}</View>
    </Screen>
  {:else}
    <Screen title="Gesture probe" style={{ backgroundColor: theme.background }}>
      <View style={{ flex: 1 }}>{@render content()}</View>
    </Screen>
  {/if}
{/if}
