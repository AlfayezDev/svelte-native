<script lang="ts">
  import { SafeAreaView, Screen, ScrollView, Text, View, useRouter } from "@rasheed/svelte-native";
  import Button from "#lib/components/Button.svelte";
  import Section from "#lib/components/Section.svelte";
  import { text } from "#lib/theme.svelte.ts";

  // A stack of screens. Every folder in src/routes is a screen of the root stack, and `router.goto(href)` pushes one on top of the current
  // one. The header, the back arrow and the swipe or back button that pops a screen are native and need no code. `<Screen>` configures the
  // header of the screen it is in: this one asks for a large title that shrinks as the content scrolls.
  const router = useRouter();
</script>

<Screen title="Stack" header={{ large: true }}>
  <SafeAreaView edges={["left", "right", "bottom"]} style={{ flex: 1 }}>
    <ScrollView contentContainerStyle={{ padding: 20, gap: 24 }}>
      <Text style={text.body}>Push a screen to go deeper and the header gets a back arrow. Pop it with the arrow, the edge swipe on iOS or the back button on Android.</Text>
      <Section title="Push" note="router.goto('/navigation/stack/1') puts the screen of that route on top of this one. The 1 is a route parameter.">
        <View style={{ gap: 8 }}>
          <Button label="Push item 1" onPress={() => router.goto("/navigation/stack/1")} />
          <Button label="Push item 7" variant="secondary" onPress={() => router.goto("/navigation/stack/7")} />
        </View>
      </Section>
      <Section title="Header" note="title, subtitle, headerLeft, headerRight and header (large, hidden, backTitle, tint) are options of Screen. The next screen puts a button in the header.">
        <Text style={text.body}>Large title: this screen. Regular title: the next one.</Text>
      </Section>
    </ScrollView>
  </SafeAreaView>
</Screen>
