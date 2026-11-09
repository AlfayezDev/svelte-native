<script lang="ts">
  import { Text } from "@rasheed/svelte-native";
  import { WebView, type WebViewHandle } from "@rasheed/svelte-native/foreign";
  import Button from "#lib/components/Button.svelte";
  import Page from "#lib/components/Page.svelte";
  import Section from "#lib/components/Section.svelte";
  import { text, theme } from "#lib/theme.svelte.ts";

  // `WebView` is react-native-webview's native view. `source` is `{ uri }` or `{ html }`; the page talks to the app with
  // `window.ReactNativeWebView.postMessage` (heard by `onMessage`), and the app talks to the page through `ref`: `injectJavaScript`, `reload`...
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head>
    <body style="margin:0;font:18px sans-serif;background:#eef3ff;display:flex;flex-direction:column;gap:12px;align-items:center;justify-content:center;height:100vh">
      <div id="label">Hello from a web page</div>
      <button style="font-size:18px;padding:8px 16px" onclick="window.ReactNativeWebView.postMessage('The page was pressed')">Tell the app</button>
    </body></html>`;
  let web: WebViewHandle | null = null;
  let heard = $state("Nothing yet");
</script>

<Page title="WebView" intro="WebView shows a web page inside the app. Here the page is a few lines of HTML; it can send the app a message, and the app can run a script in the page.">
  <Section title="WebView" note="Press the button inside the page, then the one below it.">
    <WebView
      source={{ html }}
      originWhitelist={["*"]}
      accessibilityLabel="A small web page"
      ref={(handle) => { web = handle; }}
      onMessage={(event) => { heard = event.nativeEvent.data; }}
      style={{ height: 180, borderRadius: 12, overflow: "hidden", backgroundColor: theme.colors.border }}
    />
    <Text style={text.caption}>The page said: {heard}</Text>
    <Button label="Change the page's text" variant="secondary" onPress={() => web?.injectJavaScript("document.getElementById('label').textContent = 'Changed by the app'; true;")} />
  </Section>
</Page>
