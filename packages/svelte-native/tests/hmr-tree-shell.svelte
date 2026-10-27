<script>
  import { useRouter } from "../src/router.svelte.ts";
  let { children } = $props();
  // The root layout is the shell around the root navigator, inside the router's context.
  globalThis.__shellRouter = useRouter();
</script>
<native-view testID="shell">{@render children()}</native-view>
