<script lang="ts">
  import { ActivityIndicator, Image, Modal, Pressable, ScrollView, Text, View } from "@example/svelte-native";
  import Button from "#lib/components/Button.svelte";
  import Page from "#lib/components/Page.svelte";
  import Section from "#lib/components/Section.svelte";
  import { text, theme } from "#lib/theme.svelte.ts";
  import photo from "../../../assets/images/photo.png";

  // The building blocks: View (a box), Text (the only place text can go), Image (a bundled file or a URL), Pressable (anything you can tap),
  // ScrollView, ActivityIndicator and Modal. They are the same names and props as React Native's, but they are Svelte components.
  let taps = $state(0);
  let pressed = $state(false);
  let photoStatus = $state("loading");
  let modalOpen = $state(false);
</script>

<Page title="Primitives" intro="Every screen is built from a handful of native views. A View is a box, a Text holds text, an Image shows a picture, and a Pressable reacts to a tap.">
  <Section title="View and Text" note="Text can nest: the inner Text inherits and overrides the style of the outer one.">
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
      <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: theme.colors.accent }} />
      <Text style={[text.body, { flex: 1 }]}>A plain View, and a Text with <Text style={{ fontWeight: "700" }}>bold words</Text> inside it.</Text>
    </View>
  </Section>

  <Section title="Image" note="The left one is a file bundled with the app, the right one comes from a URL. Both need a size.">
    <View style={{ flexDirection: "row", gap: 12 }}>
      <View style={{ flex: 1, gap: 6 }}>
        <Image source={photo} resizeMode="cover" accessibilityLabel="A sunset over hills" style={{ height: 100, borderRadius: 8 }} />
        <Text style={text.caption}>require()d file</Text>
      </View>
      <View style={{ flex: 1, gap: 6 }}>
        <Image
          source={{ uri: "https://picsum.photos/id/1015/300/200" }}
          resizeMode="cover"
          accessibilityLabel="A river between mountains"
          onLoad={() => (photoStatus = "loaded")}
          onError={() => (photoStatus = "failed (offline?)")}
          style={{ height: 100, borderRadius: 8, backgroundColor: theme.colors.border }}
        />
        <Text style={text.caption}>URL: {photoStatus}</Text>
      </View>
    </View>
  </Section>

  <Section title="Pressable" note="Wrap anything in a Pressable to make it tappable. onPressIn and onPressOut tell you when a finger is down.">
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Tapped ${taps} times`}
      onPress={() => (taps += 1)}
      onPressIn={() => (pressed = true)}
      onPressOut={() => (pressed = false)}
      style={{ padding: 20, borderRadius: 12, alignItems: "center", backgroundColor: pressed ? theme.colors.accent : theme.colors.border }}
    >
      <Text style={{ color: pressed ? theme.colors.onAccent : theme.colors.text, fontSize: 16, fontWeight: "600" }}>Tapped {taps} times</Text>
    </Pressable>
  </Section>

  <Section title="ScrollView" note="Content that does not fit scrolls. This one scrolls sideways.">
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
      {#each [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as value (value)}
        <View style={{ width: 64, height: 64, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.border }}>
          <Text style={text.heading}>{value}</Text>
        </View>
      {/each}
    </ScrollView>
  </Section>

  <Section title="ActivityIndicator and Modal">
    <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
      <ActivityIndicator size="large" color={theme.colors.accent} accessibilityLabel="Loading" />
      <View style={{ flex: 1 }}><Button label="Open a Modal" variant="secondary" onPress={() => (modalOpen = true)} /></View>
    </View>
    <Modal visible={modalOpen} transparent animationType="fade" onRequestClose={() => (modalOpen = false)}>
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32, backgroundColor: "rgba(0, 0, 0, 0.5)" }}>
        <View style={{ alignSelf: "stretch", gap: 12, padding: 20, borderRadius: 16, backgroundColor: theme.colors.surface }}>
          <Text style={text.heading}>A Modal</Text>
          <Text style={text.body}>It covers the whole screen, header included. The back button or the Close button closes it.</Text>
          <Button label="Close" onPress={() => (modalOpen = false)} />
        </View>
      </View>
    </Modal>
  </Section>
</Page>
