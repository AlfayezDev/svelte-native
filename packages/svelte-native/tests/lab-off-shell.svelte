<script>
  import Layout from "../../../apps/platform/src/routes/+layout.mobile.svelte";
  import { useRouter } from "../src/router.svelte.ts";
  let { children } = $props();
  globalThis.__labOffRouter = useRouter("root");
</script>
<Layout>{@render children()}</Layout>
