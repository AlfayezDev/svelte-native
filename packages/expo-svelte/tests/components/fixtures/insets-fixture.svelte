<script>
  import SafeAreaView from "../../../src/components/SafeAreaView.svelte";
  import KeyboardAvoidingView from "../../../src/components/KeyboardAvoidingView.svelte";
  let { behavior = "padding", offset = 0, edges = undefined, enabled: initial = true } = $props();
  // What a test changes with `set` while the component is mounted.
  const view = $state({ enabled: initial });
  export function set(patch) { Object.assign(view, patch); }
</script>
<SafeAreaView style={{ flex: 1, paddingTop: 4 }} {edges}>
  <KeyboardAvoidingView {behavior} enabled={view.enabled} keyboardVerticalOffset={offset} style={{ flex: 1 }} contentContainerStyle={{ flex: 1 }}>
    <native-view testID="content"></native-view>
  </KeyboardAvoidingView>
</SafeAreaView>
