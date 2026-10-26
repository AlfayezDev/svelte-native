<script>
  import SafeAreaView from "../src/components/SafeAreaView.svelte";
  import KeyboardAvoidingView from "../src/components/KeyboardAvoidingView.svelte";
  let { behavior = "padding", offset = 0, edges = undefined } = $props();
</script>
<SafeAreaView style={{ flex: 1, paddingTop: 4 }} {edges}>
  <KeyboardAvoidingView {behavior} keyboardVerticalOffset={offset} style={{ flex: 1 }} contentContainerStyle={{ flex: 1 }}>
    <native-view testID="content"></native-view>
  </KeyboardAvoidingView>
</SafeAreaView>
