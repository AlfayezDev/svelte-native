/**
 * The slice of React Native's `AppRegistry` the native host calls in bridgeless mode: runnables registered by
 * key and started with `runApplication`. No component providers, no `renderApplication`, so no React.
 */
type Runnable = (parameters: { rootTag: number; initialProps?: Record<string, unknown> }, displayMode?: number) => void;
const runnables: Record<string, Runnable> = {};

export const AppRegistry = {
  registerRunnable(appKey: string, run: Runnable): string {
    runnables[appKey] = run;
    return appKey;
  },
  /**
   * React component registration is accepted and ignored: the Fabric host renders Svelte components registered by
   * `createFabricApp`. Expo's `Expo.fx` registers a placeholder "main" component in development and expects
   * `registerRootComponent` to replace it; here `createFabricApp` is what replaces it. The provider argument is
   * not read.
   */
  registerComponent(appKey: string): string {
    return appKey;
  },
  getAppKeys: () => Object.keys(runnables),
  runApplication(appKey: string, parameters: Parameters<Runnable>[0], displayMode?: number): void {
    console.log(`Running "${appKey}"`);
    const run = runnables[appKey];
    if (!run) throw new Error(`"${appKey}" has not been registered`);
    run(parameters, displayMode);
  },
  setSurfaceProps(appKey: string, parameters: Parameters<Runnable>[0], displayMode?: number): void {
    const run = runnables[appKey];
    if (!run) throw new Error(`"${appKey}" has not been registered`);
    run(parameters, displayMode);
  },
  unmountApplicationComponentAtRootTag(rootTag: number): void {
    (globalThis as { __svelteFabricStop?: (rootTag: number) => void }).__svelteFabricStop?.(rootTag);
  },
};
