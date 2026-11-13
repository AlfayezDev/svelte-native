<script lang="ts">
  import { List, SafeAreaView, Screen, ScrollView, Text, View } from "@alfayez/svelte-native";
  import { scroller, useDemo } from "#lib/demo.ts";
  import { text, theme } from "#lib/theme.svelte.ts";

  // Two ways to show rows. A ScrollView with an {#each} mounts every row, which is fine for a few dozen. `List` mounts only the rows near
  // the screen, so thousands of rows cost the same as a handful: give it the items, a fixed `rowHeight` (or let it measure the rows), a
  // `keyOf` and a `row` snippet. This screen is a Screen and a SafeAreaView with two boxes, because a List is a scroll view itself and
  // cannot sit inside another one. Both lists draw the same `row` snippet.
  type Person = { id: number; name: string };
  const people: Person[] = Array.from({ length: 5000 }, (_, index) => ({ id: index, name: `Person ${index + 1}` }));
  const few = people.slice(0, 40);
  let shown = $state("Scroll to see which rows are on screen.");
  const box = $derived({ flex: 1, overflow: "hidden" as const, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface });

  // `?demo`: scroll the plain list a little, then the windowed one, jump it far down the 5,000 rows and scroll on, and back to the top.
  let { url }: { url: URL } = $props();
  const plain = scroller();
  const windowed = scroller();
  useDemo(() => url, [
    [() => plain.glide(560, 1600), 400],
    [() => windowed.glide(52 * 24, 2000), 400],
    [() => windowed.jump(52 * 2400), 500],
    [() => windowed.glide(52 * 2412, 1500), 600],
    [() => { plain.jump(0); windowed.jump(0); }, 0],
  ], { hold: 1200 });
</script>

{#snippet row(person: Person)}
  <View style={{ height: 52, justifyContent: "center", paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
    <Text style={text.body}>{person.name}</Text>
  </View>
{/snippet}

<Screen title="Lists">
  <SafeAreaView edges={["left", "right", "bottom"]} style={{ flex: 1, padding: 20, gap: 12 }}>
    <Text style={text.body}>A plain list mounts all of its rows. A windowed list mounts the few that are on screen, however many there are.</Text>

    <View style={{ flex: 1, gap: 6 }}>
      <Text style={text.heading}>ScrollView with each: 40 rows</Text>
      <View style={box}>
        <ScrollView ref={plain.ref}>
          {#each few as person (person.id)}{@render row(person)}{/each}
        </ScrollView>
      </View>
    </View>

    <View style={{ flex: 1, gap: 6 }}>
      <Text style={text.heading}>List: 5,000 rows</Text>
      <Text style={text.caption}>{shown}</Text>
      <View style={box}>
        <List
          items={people}
          ref={windowed.ref}
          rowHeight={52}
          keyOf={(person) => person.id}
          {row}
          onViewableItemsChanged={({ viewableItems }) => {
            const first = viewableItems[0]?.item.name;
            const last = viewableItems[viewableItems.length - 1]?.item.name;
            if (first && last) shown = `On screen: ${first} to ${last}`;
          }}
        />
      </View>
    </View>
  </SafeAreaView>
</Screen>
