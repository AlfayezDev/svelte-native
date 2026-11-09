<script>
  import Root from "../src/Root.svelte";
  import Shell from "./stand-in-shell.svelte";
  import { tree } from "@rasheed/svelte-native/routes";
  // The stand-in app as a build runs it: its real root layout (its session, its pages) around the route table the Metro integration generated.
  let { initial = "/projects", navigation } = $props();
</script>
<Root shell={Shell} {tree} {initial} {navigation} />
