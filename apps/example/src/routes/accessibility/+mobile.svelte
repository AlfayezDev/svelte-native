<script lang="ts">
  import { Image, Pressable, Text, View } from "@rasheed/svelte-native";
  import Page from "#lib/components/Page.svelte";
  import Section from "#lib/components/Section.svelte";
  import { text, theme } from "#lib/theme.svelte.ts";
  import photo from "../../../assets/images/photo.png";

  // Accessibility. A screen reader (TalkBack, VoiceOver) reads the screen from the same views that draw it, so the work is to say what they
  // mean: `accessibilityLabel` (what to say), `accessibilityRole` (what it is), `accessibilityState` (checked, selected, expanded, disabled),
  // `accessibilityHint` (what happens), `accessibilityLiveRegion` (announce changes) and `accessibilityActions` (things a gesture does,
  // offered as a menu). The reader goes through the views in the order of this file, so write them in the order they should be read.
  let notifications = $state(false);
  let expanded = $state(false);
  let count = $state(0);
  let archived = $state("Nothing archived yet.");
</script>

<Page title="Accessibility" intro="Turn on TalkBack or VoiceOver and swipe through this screen. Everything below is said aloud, and every control can be used without seeing it.">
  <Section title="Labels and roles" note="An icon says nothing to a screen reader. A label does. A heading role lets a user jump from heading to heading.">
    <Text accessibilityRole="header" style={text.heading}>Messages</Text>
    <Pressable accessibilityRole="button" accessibilityLabel="Close" accessibilityHint="Closes the message list" onPress={() => {}} style={{ width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.border }}>
      <Text style={text.heading}>✕</Text>
    </Pressable>
    <Image source={photo} accessibilityLabel="A sunset over hills" style={{ height: 64, borderRadius: 8 }} />
  </Section>

  <Section title="State" note="A switch says on or off, and a disclosure says whether it is open. Visible colours alone are not enough.">
    <Pressable accessibilityRole="switch" accessibilityLabel="Notifications" accessibilityState={{ checked: notifications }} onPress={() => (notifications = !notifications)} style={{ minHeight: 48, justifyContent: "center" }}>
      <Text style={text.body}>Notifications: {notifications ? "on" : "off"}</Text>
    </Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel="Details" accessibilityState={{ expanded }} onPress={() => (expanded = !expanded)} style={{ minHeight: 48, justifyContent: "center" }}>
      <Text style={text.body}>{expanded ? "Hide" : "Show"} details</Text>
    </Pressable>
    {#if expanded}<Text style={text.caption}>Details are shown. A screen reader announced "expanded".</Text>{/if}
  </Section>

  <Section title="Grouping" note="accessible makes the whole card one stop, read as a single label. Decoration is hidden from the reader.">
    <View accessible accessibilityLabel="Flat white, 3 dollars 50" style={{ flexDirection: "row", justifyContent: "space-between", padding: 12, borderRadius: 8, backgroundColor: theme.colors.background }}>
      <Text style={text.body}>Flat white</Text>
      <Text style={text.body}>$3.50</Text>
    </View>
    <View aria-hidden={true} importantForAccessibility="no-hide-descendants" style={{ height: 4, borderRadius: 2, backgroundColor: theme.colors.accent }} />
  </Section>

  <Section title="Announcements" note="A live region is read out when its text changes, without moving the reader's focus.">
    <Pressable accessibilityRole="button" accessibilityLabel="Add one" onPress={() => count++} style={{ minHeight: 48, justifyContent: "center" }}>
      <Text style={text.body}>Add one</Text>
    </Pressable>
    <Text accessibilityLiveRegion="polite" style={text.heading}>{count} added</Text>
  </Section>

  <Section title="Actions" note="Swiping a row is invisible to a screen reader, so offer the same thing as a named action. Open the actions menu of the row with your screen reader to use it.">
    <View
      accessible
      accessibilityLabel="Invoice 117"
      accessibilityActions={[{ name: "archive", label: "Archive" }]}
      onAccessibilityAction={(event) => { if (event.nativeEvent.actionName === "archive") archived = "Invoice 117 archived."; }}
      style={{ padding: 12, borderRadius: 8, backgroundColor: theme.colors.background }}
    >
      <Text style={text.body}>Invoice 117</Text>
    </View>
    <Text accessibilityLiveRegion="polite" style={text.caption}>{archived}</Text>
  </Section>
</Page>
