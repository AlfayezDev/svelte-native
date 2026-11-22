<script lang="ts">
  import { useRouter } from "expo-svelte";
  import Button from "#lib/native/components/Button.svelte";
  /** The way into the lab from the screens that offer it; the product has neither this module nor the route (shared code renders it only behind `nativeLabEnabled`). */
  const router = useRouter();
</script>
<Button label="Mobile development lab" variant="secondary" onPress={() => router.goto("/__dev")} />
