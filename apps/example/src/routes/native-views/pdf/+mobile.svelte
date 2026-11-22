<script lang="ts">
  import { Text, View } from "expo-svelte";
  import { Pdf, type PdfHandle } from "expo-svelte/foreign";
  import Button from "#lib/components/Button.svelte";
  import Page from "#lib/components/Page.svelte";
  import Section from "#lib/components/Section.svelte";
  import { useDemo } from "#lib/demo.ts";
  import { samplePdf } from "#lib/media.ts";
  import { text } from "#lib/theme.svelte.ts";

  // `Pdf` is react-native-pdf's native view (AndroidPdfViewer, PDFKit). `source` is `{ uri }` with a web address, a file or a data URI (the
  // sample is a data URI, see media.ts). `enablePaging` snaps to a page; `onLoadComplete` and `onPageChanged` tell the page count and the page;
  // `ref` gives `setPage`.
  let page = $state(1);
  let pages = $state(0);
  let pdf: PdfHandle | null = null;

  // `?demo`: let the document open, turn to the second page, and back.
  let { url }: { url: URL } = $props();
  useDemo(() => url, [
    [() => pdf?.setPage(2), 2400],
    [() => pdf?.setPage(1), 1800],
  ], { settle: 2800, hold: 800 });
</script>

<Page title="PDF" intro="Pdf shows a document with the platform's PDF engine. Swipe the pages or use the buttons; the screen reads the page number from the events.">
  <Section title="Pdf" note={pages ? `Page ${page} of ${pages}` : "Opening the document"}>
    <Pdf
      source={{ uri: samplePdf }}
      enablePaging
      accessibilityLabel="A two page document"
      ref={(handle) => { pdf = handle; }}
      onLoadComplete={(count) => { pages = count; }}
      onPageChanged={(current) => { page = current; }}
      style={{ height: 300, borderRadius: 8, overflow: "hidden" }}
    >
      {#snippet loading()}<Text style={text.caption}>Opening the document</Text>{/snippet}
    </Pdf>
    <View style={{ flexDirection: "row", gap: 8 }}>
      <Button label="Previous" variant="secondary" disabled={page <= 1} onPress={() => pdf?.setPage(page - 1)} />
      <Button label="Next" variant="secondary" disabled={page >= pages} onPress={() => pdf?.setPage(page + 1)} />
    </View>
  </Section>
</Page>
