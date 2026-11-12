<script lang="ts" module>
  // Read when the route table is built, so it has to be a literal. A page with this export enters as a native sheet over the screen below it.
  export const presentation = "sheet";
</script>

<script lang="ts">
  import { Screen, Text, View, useRouter } from "@rasheed/svelte-native";
  import Button from "#lib/components/Button.svelte";
  import { useDemo } from "#lib/demo.ts";
  import { text, theme } from "#lib/theme.svelte.ts";

  // A bottom sheet. The `sheet` option of `<Screen>` gives it its heights (`detents`, fractions of the screen) and a grabber, and the user
  // drags it between them or down to dismiss it. `onDetentChange` reports where it rests.
  const router = useRouter();
  let detent = $state("the first height (40 %)");

  // `?demo`: stay a while, then close the sheet from code. Open it from another screen, so there is one below to go back to: a sheet that is the
  // first screen of the app (a cold link) has none, and stays.
  let { url }: { url: URL } = $props();
  useDemo(() => url, [[() => { if (router.entries.length > 1) router.back(); }, 0]], { settle: 6000, hold: 0 });
</script>

<Screen
  title="A sheet"
  sheet={{ detents: [0.4, 0.9], grabber: true }}
  onDetentChange={({ index }) => (detent = index === 0 ? "the first height (40 %)" : "the second height (90 %)")}
  style={{ backgroundColor: theme.colors.surface }}
>
  <View style={{ padding: 20, gap: 16 }}>
    <Text style={text.body}>Drag the handle up to the second height, or down to close the sheet. It rests at {detent}.</Text>
    <Button label="Close" onPress={() => router.back()} />
  </View>
</Screen>
