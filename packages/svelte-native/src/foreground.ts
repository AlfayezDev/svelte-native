/**
 * Calls a listener each time the app returns to the foreground (React Native's `AppState` reports `active`): the moment to read again what the user may have changed
 * in the system's settings, such as a permission (`geolocation.ts`, `push/client.ts`). React Native's `AppState` is required on the first call, not when this module loads.
 * Returns what stops the listener.
 */
export function onForeground(listener: () => void): () => void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- required on the first call
  const appState = (require("react-native/Libraries/AppState/AppState") as { default: { addEventListener(type: "change", listener: (state: string) => void): { remove(): void } } }).default;
  const subscription = appState.addEventListener("change", (state) => { if (state === "active") listener(); });
  return () => { subscription.remove(); };
}
