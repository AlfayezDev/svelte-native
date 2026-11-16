<script lang="ts">
  import Text from "../../../src/components/Text.svelte";
  import View from "../../../src/components/View.svelte";
  import SafeAreaView from "../../../src/components/SafeAreaView.svelte";

  let { inline = false, unknown = false }: { inline?: boolean; unknown?: boolean } = $props();
  let size = $state(30);
  let tone = $state("plain");
  const spread = { class: "card", testID: "spread" };
  const fontSpread = { class: "leading-none", style: { fontSize: 26 }, testID: "spread-font" };
  export function setTone(next: string) { tone = next; }
  export function setSize(next: number) { size = next; }
</script>

<View testID="card" class={["card", tone === "loud" && "loud"]} style={inline ? { padding: 1 } : undefined}>
  <Text testID="label" class={{ label: true, muted: tone === "plain" }}>Hello</Text>
  <View testID="bare" />
  <View testID="themed" class="themed" />
  <View testID="wide" class="wide" />
  <View testID="moved" class="big tx rot" />
  <View testID="moved-list" class="skew tx" />
  <Text testID="leading" class="small tracking" />
  <Text testID="leading-default" class="snug" />
  <Text testID="leading-absolute" class="snug lh-24" />
  <Text testID="leading-relative" class="lh-8 small" />
  <View testID="inset" class="pad-top" />
  <View testID="inset-over-static" class="pt-4 pad-top" />
  <View testID="static-over-inset" class="pad-top pt-9" />
  <View testID="half" class="half" />
  <View testID="cascade" class="second first" />
  <View testID="system" class="android-only ios-only" />
  <View testID="removed" class="shadow-md shadow-none" />
  <View testID="removed-then-set" class="shadow-md shadow-none shadow-sm" />
  <View testID="removed-in-dark" class="shadow-md dark:shadow-none" />
  <View testID="moved-removed" class="tx rot tx-none" />
  <View testID="inset-removed" class="pad-top pt-none" />
  <Text testID="leading-removed" class="snug small lh-none" />
  <Text testID="leading-own" class="leading-none" style={{ fontSize: size }} />
  <Text testID="leading-own-twin" class="leading-none" style={{ fontSize: 30 }} />
  <Text testID="leading-own-array" class="leading-none" style={[{ fontSize: 10 }, false, { fontSize: 22 }]} />
  <Text testID="leading-own-over-class" class="small leading-none" style={{ fontSize: 30 }} />
  <Text testID="leading-class-size" class="small leading-none" />
  <Text testID="mono" class="font-mono" />
  <Text testID="serif" class="font-serif" />
  {#if unknown}
    <View testID="unknown" class="nothing-here card" />
    <View testID="prototype" class="constructor __proto__" />
    <View testID="unsupported" class="hover:opacity-50 transition card" />
    <View testID="partly" class="truncate" />
    <View testID="markers" class="group peer group/item peer/item card" />
  {/if}
  <Text {...fontSpread} />
  <View {...spread} />
  <SafeAreaView testID="safe" class="p-4" />
</View>
