<script>
  import Layout from "./fixtures/stand-in-app/src/routes/+layout.mobile.svelte";
  import { useRouter } from "../src/router.svelte.ts";
  let { children } = $props();
  globalThis.__standInRouter = useRouter("root");
</script>
<Layout>{@render children()}</Layout>
