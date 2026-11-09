<script lang="ts">
  import type { Snippet } from "svelte";
  import { useRouter } from "@rasheed/svelte-native";
  import { labEnabled } from "#lib/flag.ts";
  import { enforceGate } from "#lib/gate.ts";
  import { openSession } from "#lib/session.ts";
  /** The session of the app: opened once the shell has started it, it keeps the root navigator on a screen the visitor may see. */
  let { children }: { children: Snippet } = $props();
  const session = openSession();
  const router = useRouter("root");
  $effect(() => { enforceGate(session.visitor, router, labEnabled); });
</script>
{@render children()}
