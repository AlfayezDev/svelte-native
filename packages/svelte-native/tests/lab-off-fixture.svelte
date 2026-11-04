<script>
  import Root from "../src/Root.svelte";
  import Shell from "./lab-off-shell.svelte";
  import { tree } from "@rasheed/svelte-native/routes";
  // The platform app as the product runs it: the real root layout (its session, its pages) around the route table the Metro integration generated.
  let { initial = "/workspaces", navigation } = $props();
</script>
<Root shell={Shell} {tree} {initial} {navigation} />
