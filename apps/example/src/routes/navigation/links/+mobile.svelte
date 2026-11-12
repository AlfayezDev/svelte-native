<script lang="ts">
  import { onMount } from "svelte";
  import { Text, useRouter } from "@rasheed/svelte-native";
  import Button from "#lib/components/Button.svelte";
  import Page from "#lib/components/Page.svelte";
  import Section from "#lib/components/Section.svelte";
  import { useDemo } from "#lib/demo.ts";
  import { text, theme } from "#lib/theme.svelte.ts";
  import { Linking } from "@rasheed/svelte-native/platform";

  // Links. The app declares its scheme in app.config.ts (`scheme: "svelte-native"`), so `svelte-native:///navigation/stack/42` opens the
  // screen of that route: the router matches a link against the route tree, and a link the app was launched with becomes the first screen.
  // `router.openURL(href)` does the same from code and says whether any screen matched. `Linking` is React Native's own module, from `@rasheed/svelte-native/platform`.
  const router = useRouter();
  const links = ["svelte-native:///navigation/stack/42", "svelte-native:///navigation/tabs/feed/2", "svelte-native:///nowhere"];
  let launchedWith = $state("(asking)");
  let received = $state("nothing yet");
  let lastOpened = $state("");
  const open = (link: string) => { lastOpened = `${link}: ${router.openURL(link) ? "opened" : "no screen matches"}`; };

  // `?demo`: open the link to a stack item (it pushes the screen), come back, then try the link that matches nothing.
  let { url }: { url: URL } = $props();
  useDemo(() => url, [
    [() => open(links[0] as string), 1800],
    [() => router.back(), 1500],
    [() => open(links[2] as string), 1800],
  ]);

  onMount(() => {
    void Linking.getInitialURL().then((url) => { launchedWith = url ?? "no link: the app was opened normally"; });
    const subscription = Linking.addEventListener("url", ({ url }) => { received = url; });
    return () => subscription.remove();
  });
</script>

<Page title="Links" intro="A link is an address of a screen. Another app, a web page or a notification can open this app on a specific screen with it.">
  <Section title="Launched with" note="The link this app was started with. Open the app from a link and this screen shows it.">
    <Text style={text.body}>{launchedWith}</Text>
  </Section>

  <Section title="Open a link" note="openURL opens the screen of a link that matches a route, and returns false when nothing matches.">
    {#each links as link (link)}
      <Button label={link.replace("svelte-native://", "")} variant="secondary" onPress={() => open(link)} />
    {/each}
    {#if lastOpened}<Text style={text.caption}>{lastOpened}</Text>{/if}
  </Section>

  <Section title="From outside the app" note="From a computer, with a device or a simulator running the app. The app gets the link while it is open and shows it below.">
    <Text style={[text.caption, { fontFamily: "JetBrainsMono-Regular", color: theme.colors.text }]}>adb shell am start -a android.intent.action.VIEW -d svelte-native:///navigation/stack/42</Text>
    <Text style={[text.caption, { fontFamily: "JetBrainsMono-Regular", color: theme.colors.text }]}>xcrun simctl openurl booted svelte-native:///navigation/stack/42</Text>
    <Text style={text.body}>Last link received: {received}</Text>
  </Section>
</Page>
