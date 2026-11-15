<script>
  import { page, updated } from "../../../src/kit/state.ts";
  // A component with no router above it, mounted before the app's router exists (a splash screen, a bottom bar of its own surface): it reads `page` and `updated` in effects.
  const seen = (globalThis.__kitReads = []);
  $effect(() => { seen.push(`page ${page.url.pathname} ${page.route.id}`); });
  $effect(() => { seen.push(`updated ${updated.current}`); });
</script>
<native-text>{page.url.pathname}</native-text>
