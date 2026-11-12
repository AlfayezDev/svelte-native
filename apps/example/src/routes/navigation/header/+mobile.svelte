<script lang="ts">
  import { SafeAreaView, Screen, ScrollView, Text, View, useToolbar, type ToolbarItem } from "@example/svelte-native";
  import { useDemo } from "#lib/demo.ts";
  import { text, theme } from "#lib/theme.svelte.ts";

  // More of what `<Screen>` configures. `search` puts a native search field in the header (it asks for a place to show results: the
  // `headerSearch` snippet), and `toolbar` adds a native bar at the bottom with actions, flexible space, a badge and an `onPress` that gets the
  // key of the item. An item's icon is an image or a snippet drawn as a template. `useToolbar()` says how tall the bar is, for content that
  // runs under a translucent one (this one does not).
  const people = ["Amal", "Bilal", "Carla", "Dev", "Esra", "Farid", "Gina", "Hamza"];
  let query = $state("");
  let pressed = $state("nothing yet");
  const matches = $derived(people.filter((name) => name.toLowerCase().includes(query.trim().toLowerCase())));
  const items: ToolbarItem[] = [
    { key: "reply", title: "Reply", icon: circle, accessibilityLabel: "Reply" },
    { key: "gap", spacer: true },
    { key: "flag", title: "Flag", icon: circle, badge: 2, accessibilityLabel: "Flag, 2 new" },
  ];
  const toolbar = useToolbar();

  // `?demo`: press the two toolbar actions, one after the other, twice. The search field in the header is the platform's and opens only on a
  // touch: the hold at the end leaves room for one (see features/demos.ts).
  let { url }: { url: URL } = $props();
  useDemo(() => url, [
    [() => (pressed = "reply"), 1400],
    [() => (pressed = "flag"), 1400],
    [() => (pressed = "reply"), 1400],
    [() => (pressed = "flag"), 1000],
    [() => (pressed = "nothing yet"), 0],
  ], { hold: 3500 });
</script>

{#snippet circle()}
  <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: "#000000" }} />
{/snippet}

{#snippet results()}
  <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, gap: 8 }}>
    {#each matches as name (name)}
      <Text style={text.body}>{name}</Text>
    {:else}
      <Text style={text.caption}>Nobody is called that.</Text>
    {/each}
  </ScrollView>
{/snippet}

<Screen
  title="Header and toolbar"
  search={{ placeholder: "Search people", onChangeText: (value) => (query = value), onCancel: () => (query = "") }}
  headerSearch={results}
  toolbar={{ items, onPress: (key) => (pressed = key), tint: theme.colors.accent }}
>
  <SafeAreaView edges={["left", "right"]} style={{ flex: 1 }}>
    <View style={{ padding: 20, gap: 12 }}>
      <Text style={text.body}>Pull down or tap the search field in the header and type a name. The toolbar below has two actions and a badge.</Text>
      <Text style={text.heading}>Last toolbar press: {pressed}</Text>
      <Text style={text.caption}>The toolbar is {toolbar.height} points tall.</Text>
    </View>
  </SafeAreaView>
</Screen>
