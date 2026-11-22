// The primitives and the insets store only; `index.ts` adds `Native` and the router.
export { default as View } from "./components/View.svelte";
export { default as Text } from "./components/Text.svelte";
export { default as TextInput } from "./components/TextInput.svelte";
export { default as Pressable } from "./components/Pressable.svelte";
export { default as ScrollView } from "./components/ScrollView.svelte";
export { default as Image } from "./components/Image.svelte";
export { default as Modal } from "./components/Modal.svelte";
export { default as SafeAreaView } from "./components/SafeAreaView.svelte";
export { default as ActivityIndicator } from "./components/ActivityIndicator.svelte";
export { default as Switch } from "./components/Switch.svelte";
export { default as List } from "./components/List.svelte";
export { default as KeyboardAvoidingView } from "./components/KeyboardAvoidingView.svelte";
export { insets, connectInsets } from "./insets.svelte.ts";
