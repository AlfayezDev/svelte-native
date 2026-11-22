<script lang="ts">
  import { onMount, tick, untrack } from "svelte";
  import { requireOptionalNativeModule } from "expo-modules-core";
  import { Pressable, Text, View } from "expo-svelte";
  import { nativeLabEnabled, theme } from "#lib/native/state.svelte.ts";
  import Page from "#lib/native/components/Page.svelte";

  /**
   * The accessibility lab (SPEC.md, "Accessibility props"; qa/README "Accessibility"): one control of each kind the Android engine publishes to
   * a screen reader, with a `testID` the QA suite finds it by (`a11y.<name>`). The props are the ones React Native documents, some written as
   * `aria-*` and `role` and some as `accessibilityState` and `accessibilityRole`, so both spellings are covered. `?mode=states` (the default) has
   * the checkbox, the radio group, the tabs, the disabled, busy and expanded buttons and the hidden element; `?mode=actions` has the slider, the
   * button with a hint, the swipe row with custom actions and the live-region counter. Each fits one screen at the normal text size.
   *
   * `?probe=nodes` logs, once the screen is up, what each `testID` node publishes to a service (`SvelteEngine.accessibilityNodes()`: the node
   * info its delegate fills, as one `[Svelte a11y] node {...}` line each, then `[Svelte a11y] done N`); the suite reads those lines for what the
   * uiautomator dump does not carry (tooltip, range, actions, live region). `?probe=actions` first performs an action on the swipe row and on the
   * slider the way a service does (`SvelteEngine.performAccessibilityAction`), so that what JavaScript received shows on the screen ("Last action:
   * archive", the slider's value). Without `probe` the page does nothing of its own.
   */
  let { url }: { url?: URL } = $props();
  const query = untrack(() => url?.searchParams);
  const probe = query?.get("probe") ?? "";
  const mode = query?.get("mode") === "actions" ? "actions" : "states";
  const engine = requireOptionalNativeModule<{
    accessibilityNodes?: () => string | null;
    performAccessibilityAction?: (testID: string, name: string) => boolean;
  }>("SvelteEngine");

  let terms = $state(true);
  let everything = $state<boolean | "mixed">("mixed");
  const plans = ["Free", "Pro", "Team"] as const;
  let plan = $state<(typeof plans)[number]>("Pro");
  let tab = $state<"inbox" | "archive">("inbox");
  let open = $state(false);
  let level = $state(4);
  let count = $state(0);
  let last = $state("none");

  const text = $derived({ color: theme.foreground, fontSize: 16 });
  const card = $derived({ gap: 6, padding: 12, borderRadius: 12, backgroundColor: theme.surface });
  const row = $derived({ flexDirection: "row" as const, alignItems: "center" as const, gap: 10, minHeight: 48 });
  const mark = (on: boolean | "mixed", round = false) => ({ width: 22, height: 22, borderRadius: round ? 11 : 5, borderWidth: 2, borderColor: theme.foreground, backgroundColor: on === true ? theme.accent : on === "mixed" ? theme.muted : "transparent" });
  const button = $derived({ minHeight: 48, paddingHorizontal: 16, borderRadius: 12, justifyContent: "center" as const, backgroundColor: theme.background, borderWidth: 1, borderColor: theme.border });

  function log(line: string): void { console.info(`[Svelte a11y] ${line}`); }

  onMount(() => {
    if (!nativeLabEnabled || (probe !== "nodes" && probe !== "actions")) return;
    const timer = setTimeout(() => { void (async () => {
      if (probe === "actions") {
        log(`archive ${engine?.performAccessibilityAction?.("a11y.row", "archive")}`);
        log(`increment ${engine?.performAccessibilityAction?.("a11y.slider", "increment")}`);
        await tick();
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
      const nodes = engine?.accessibilityNodes?.();
      if (!nodes) { log("done 0 (the engine has no accessibilityNodes)"); return; }
      const list = JSON.parse(nodes) as unknown[];
      for (const node of list) log(`node ${JSON.stringify(node)}`);
      log(`done ${list.length}`);
    })(); }, 1200);
    return () => clearTimeout(timer);
  });
</script>

{#if nativeLabEnabled}
  <Page title="Accessibility lab">
    {#if mode === "states"}
      <View style={card}>
        <Pressable testID="a11y.terms" role="checkbox" aria-checked={terms} aria-label="Accept terms" onPress={() => { terms = !terms; }} style={row}>
          <View style={mark(terms)} /><Text style={text}>Accept terms</Text>
        </Pressable>
        <Pressable testID="a11y.all" role="checkbox" aria-checked={everything} aria-label="Select all" onPress={() => { everything = everything === true ? false : true; }} style={row}>
          <View style={mark(everything)} /><Text style={text}>Select all</Text>
        </Pressable>
        <View testID="a11y.plans" role="radiogroup" accessibilityLabel="Plan">
          {#each plans as name (name)}
            <Pressable testID={`a11y.plan.${name.toLowerCase()}`} role="radio" accessibilityState={{ checked: plan === name }} accessibilityLabel={name} onPress={() => { plan = name; }} style={row}>
              <View style={mark(plan === name, true)} /><Text style={text}>{name}</Text>
            </Pressable>
          {/each}
        </View>
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Pressable testID="a11y.tab.inbox" role="tab" aria-selected={tab === "inbox"} accessibilityLabel="Inbox" onPress={() => { tab = "inbox"; }} style={button}><Text style={text}>Inbox</Text></Pressable>
          <Pressable testID="a11y.tab.archive" role="tab" aria-selected={tab === "archive"} accessibilityLabel="Archive" onPress={() => { tab = "archive"; }} style={button}><Text style={text}>Archive</Text></Pressable>
        </View>
        <Pressable testID="a11y.disabled" accessibilityRole="button" aria-label="Pay now" aria-disabled={true} disabled onPress={() => {}} style={[button, { opacity: 0.5 }]}><Text style={text}>Pay now</Text></Pressable>
        <Pressable testID="a11y.busy" accessibilityRole="button" accessibilityLabel="Saving" accessibilityState={{ busy: true }} onPress={() => {}} style={button}><Text style={text}>Saving</Text></Pressable>
        <Pressable testID="a11y.details" accessibilityRole="button" accessibilityLabel="Details" aria-expanded={open} onPress={() => { open = !open; }} style={button}><Text style={text}>Details</Text></Pressable>
        <View testID="a11y.hidden" aria-hidden={true}><Text style={text}>Hidden note</Text></View>
        <Text style={text}>Visible note</Text>
      </View>
    {:else}
      <View style={card}>
        <View testID="a11y.slider" accessible accessibilityRole="adjustable" accessibilityLabel="Volume"
          accessibilityValue={{ min: 0, max: 10, now: level, text: `${level} of 10` }}
          accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
          onAccessibilityAction={(event) => { level = Math.min(10, Math.max(0, level + (event.nativeEvent.actionName === "increment" ? 1 : -1))); }}
          style={{ height: 48, justifyContent: "center" }}>
          <View style={{ height: 8, borderRadius: 4, backgroundColor: theme.border }}><View style={{ width: `${level * 10}%`, height: 8, borderRadius: 4, backgroundColor: theme.accent }} /></View>
        </View>
        <Pressable testID="a11y.hint" accessibilityRole="button" accessibilityLabel="Archive thread" accessibilityHint="Moves the thread out of the inbox" onPress={() => { last = "tap"; }} style={button}>
          <Text style={text}>Archive thread</Text>
        </Pressable>
        <View testID="a11y.row" accessible accessibilityLabel="Invoice 1042"
          accessibilityActions={[{ name: "archive", label: "Archive" }, { name: "delete", label: "Delete" }]}
          onAccessibilityAction={(event) => { last = event.nativeEvent.actionName; }}
          style={{ ...row, backgroundColor: theme.background, paddingHorizontal: 12, borderRadius: 10 }}>
          <Text style={text}>Invoice 1042 (swipe row)</Text>
        </View>
        <Text testID="a11y.last" style={text}>Last action: {last}</Text>
        <View testID="a11y.counter" accessibilityLiveRegion="polite" style={row}><Text style={text}>Count: {count}</Text></View>
        <Pressable testID="a11y.add" accessibilityRole="button" accessibilityLabel="Add one" onPress={() => { count += 1; }} style={button}><Text style={text}>Add one</Text></Pressable>
      </View>
    {/if}
  </Page>
{/if}
