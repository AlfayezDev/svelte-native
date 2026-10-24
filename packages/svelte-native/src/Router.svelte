<script lang="ts">
  import { onMount } from "svelte";
  import { BackHandler, Linking } from "react-native";
  import Host from "./components/Host.svelte";
  import RouteView from "./RouteView.svelte";
  import type { createRouter } from "./router.svelte.ts";
  let { router }: { router: ReturnType<typeof createRouter> } = $props();
  onMount(() => {
    const back = BackHandler.addEventListener("hardwareBackPress", () => router.back());
    let active = true;
    const links = Linking.addEventListener("url", ({ url }) => router.openURL(url));
    void Linking.getInitialURL().then((url) => { if (active && url) router.openURL(url); });
    return () => { active = false; back.remove(); links.remove(); };
  });
</script>

<Host name="native-stack" attributes={{ style: { flex: 1 } }}>
  {#each router.entries as entry (entry.key)}
    <Host name="native-screen" attributes={{
      style: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
      isNativeStack: true,
      activityState: 2,
      stackPresentation: entry.route.presentation === "modal" ? "modal" : "push",
      stackAnimation: "default",
      onDismissed: () => router.dismissed(entry.key),
    }}>
      <RouteView {entry} />
    </Host>
  {/each}
</Host>
