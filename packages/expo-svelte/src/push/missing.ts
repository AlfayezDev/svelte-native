/** Why `push` does nothing in a build: `capabilities.push` did not turn it on for this platform. Shared by the client and its stand-in (`absent.ts`). */
export const MISSING_PUSH =
  "[Svelte push] push is not on in this app's build: turn on `capabilities: { push: { … } }` in the expo-svelte plugin of the app config (naming this platform), prebuild and rebuild the native app. Until then `push.permission` reads \"denied\" and `push.subscribe` resolves with null";
