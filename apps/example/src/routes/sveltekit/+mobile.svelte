<script lang="ts">
  import { Text, TextInput, View } from "@alfayez/svelte-native";
  import { goto } from "$app/navigation";
  import { browser, dev, mobile, version } from "$app/env";
  import { resolve } from "$app/paths";
  import { page } from "$app/state";
  import { MediaQuery } from "svelte/reactivity";
  import { Spring, prefersReducedMotion } from "svelte/motion";
  import Button from "#lib/components/Button.svelte";
  import Page from "#lib/components/Page.svelte";
  import Section from "#lib/components/Section.svelte";
  import { scroller, typeInto, useDemo } from "#lib/demo.ts";
  import { text, theme } from "#lib/theme.svelte.ts";

  // The same imports a SvelteKit page makes. Metro answers each one with the library's file for the device (packages/svelte-native/src/kit), so
  // nothing here asks which platform it runs on. `goto` to this screen with another search changes its `url` prop in place: the screen is not built
  // again, and a screen reads its own data from `url` and `params` (`page` is the screen on top, for the whole app).
  const row = { flexDirection: "row", justifyContent: "space-between" } as const;
  const environment = [["mobile", mobile], ["browser", browser], ["dev", dev], ["version", version || "(none)"]] as const;
  // `MediaQuery` is Svelte's own, as on the web: the library gives the device a `window.matchMedia`, so a media query reads the window and the system. Turn the phone, or switch to dark mode, and the row changes.
  const queries = [["(orientation: portrait)", new MediaQuery("(orientation: portrait)")], ["(prefers-color-scheme: dark)", new MediaQuery("(prefers-color-scheme: dark)")]] as const;
  const filters = [["All", "all"], ["Open", "open"], ["Done", "done"]] as const;
  let { url }: { url: URL } = $props();
  const filter = $derived(url.searchParams.get("filter") ?? "all");
  let note = $state("");
  const pick = (value: string) => goto(`?filter=${value}`, { replace: true });
  const target = resolve("/navigation/stack/[id]", { id: "7" });

  // A spring on `requestAnimationFrame`: `target` moves, `current` follows with an overshoot. With Reduce Motion on, it jumps.
  const ball = new Spring(0, { stiffness: 0.08, damping: 0.3 });
  let right = $state(false);
  const toggle = () => { right = !right; ball.set(right ? 180 : 0, { instant: prefersReducedMotion.current }); };

  // `?demo`: type a word, go through the three filters (the word stays), toggle the spring twice, then open the screen `resolve` built.
  const view = scroller();
  useDemo(() => url, [
    [() => view.glide(260, 600), 300],
    [(signal) => typeInto((value) => (note = value), "Groceries", 50, signal), 300],
    [() => pick("open"), 900],
    [() => pick("done"), 900],
    [() => pick("all"), 900],
    [() => view.glide(700, 800), 400],
    [toggle, 1400],
    [toggle, 1400],
    [() => goto(target), 0],
  ], { hold: 1000 });
</script>

<Page title="SvelteKit modules" scrollRef={view.ref} intro="A page written for SvelteKit imports goto, page, resolve and spring from SvelteKit's modules. On the device Metro answers each import with a version that reads the app's router and the system.">
  <Section title="Environment" note="$app/env: browser is false on a phone, and mobile, which the library adds, is true. The two media queries are new MediaQuery(...) from svelte/reactivity.">
    {#each environment as [name, value] (name)}
      <View style={row}><Text style={text.body}>{name}</Text><Text style={text.body}>{String(value)}</Text></View>
    {/each}
    {#each queries as [query, media] (query)}
      <View style={row}><Text style={text.body}>{query}</Text><Text style={text.body}>{String(media.current)}</Text></View>
    {/each}
  </Section>

  <Section title="Page" note="page from $app/state follows the screen on top, and what reads it runs again when it changes.">
    <View style={row}><Text style={text.body}>url.pathname</Text><Text style={text.body}>{page.url.pathname}</Text></View>
    <View style={row}><Text style={text.body}>url.search</Text><Text style={text.body}>{page.url.search || "(empty)"}</Text></View>
    <View style={row}><Text style={text.body}>route.id</Text><Text style={text.body}>{page.route.id}</Text></View>
  </Section>

  <Section title="goto on this screen" note="A goto with another search changes this screen's url, not the screen. What you typed stays, and the chip comes from the url prop.">
    <TextInput bind:value={note} placeholder="Type, then pick a filter" placeholderTextColor={theme.colors.muted} accessibilityLabel="A note" style={{ minHeight: 48, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, color: theme.colors.text, fontSize: 16 }} />
    <View style={{ flexDirection: "row", gap: 8 }}>
      {#each filters as [label, value] (value)}
        <View style={{ flex: 1 }}><Button {label} variant={filter === value ? "primary" : "secondary"} onPress={() => pick(value)} /></View>
      {/each}
    </View>
    <Text style={text.caption}>url.searchParams.get("filter") is {filter}</Text>
  </Section>

  <Section title="goto across the app" note="resolve from $app/paths builds the path of a route from its id, and goto opens it: the stack gets a new screen.">
    <Text style={text.body}>{target}</Text>
    <Button label="Open item 7" onPress={() => goto(target)} />
  </Section>

  <Section title="Motion" note="Spring from svelte/motion runs on requestAnimationFrame. prefersReducedMotion reads the system's setting.">
    <View style={{ justifyContent: "center", height: 44, borderRadius: 8, backgroundColor: theme.colors.border }}>
      <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: theme.colors.accent, transform: [{ translateX: 6 + ball.current }] }} />
    </View>
    <Button label="Move the ball" variant="secondary" onPress={toggle} />
    <Text style={text.caption}>prefersReducedMotion.current is {String(prefersReducedMotion.current)}</Text>
  </Section>
</Page>
