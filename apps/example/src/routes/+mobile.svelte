<script lang="ts">
  import { getLocale, nativeLabEnabled, setLocale, t } from "#lib/native/state.svelte.ts";
  import Page from "#lib/native/components/Page.svelte";
  import Button from "#lib/native/components/Button.svelte";
  import LabLink from "#lib/native/dev/LabLink.svelte";
  /**
   * The example's home: the first screen of the production variant, and of the QA and smoke apps when they are not started on a lab link.
   * It shows the app's name, one line about it, the language button (the interface switches between English and Arabic, which lays the
   * screen out right to left) and, only where the bundle carries the lab, the link into it (`LabLink` is a stub in the production variant).
   */
</script>
<Page title={t("home.title")} description={t("home.description")}>
  <Button label={getLocale() === "en" ? t("common.arabic") : t("common.english")} variant="secondary" onPress={() => setLocale(getLocale() === "en" ? "ar" : "en")} />
  {#if nativeLabEnabled}<LabLink />{/if}
</Page>
