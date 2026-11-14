/**
 * React Native's `AppRegistry` for an app without React: runnables registered by key and started with `runApplication` (what the native
 * host calls in bridgeless mode), and headless tasks (`registerHeadlessTask`, `startHeadlessTask`: what Android's `HeadlessJsTaskContext`
 * calls, for a background task, a push handler or Expo's task service). No component providers and no `renderApplication`, so no React.
 *
 * Metro resolves `react-native/Libraries/ReactNative/AppRegistry.js` and `AppRegistryImpl.js` to this module (`RENDERER_STUBS` in `metro.ts`),
 * so a library that imports `AppRegistry` from `react-native` (expo-task-manager registers a headless task with it) registers here: React
 * Native's own would bring React's renderer into the bundle and take `RN$AppRegistry` over, while native code calls this one.
 */
type Runnable = (parameters: { rootTag: number; initialProps?: Record<string, unknown> }, displayMode?: number) => void;
type TaskProvider = () => (data: unknown) => Promise<void>;
type TaskCancelProvider = () => () => void;
type HeadlessSupport = { notifyTaskFinished(taskId: number): void; notifyTaskRetry(taskId: number): Promise<boolean> };

const runnables: Record<string, Runnable> = {};
const taskProviders = new Map<string, TaskProvider>();
const taskCancelProviders = new Map<string, TaskCancelProvider>();

/* eslint-disable @typescript-eslint/no-require-imports -- loaded when a headless task starts, never at boot */
const headlessSupport = (): HeadlessSupport | null =>
  (require("react-native/Libraries/ReactNative/NativeHeadlessJsTaskSupport") as { default?: HeadlessSupport | null }).default ?? null;
const HeadlessJsTaskError = (): abstract new (...args: never[]) => Error =>
  (require("react-native/Libraries/ReactNative/HeadlessJsTaskError") as { default: abstract new (...args: never[]) => Error }).default;
/* eslint-enable @typescript-eslint/no-require-imports */

export function registerRunnable(appKey: string, run: Runnable): string {
  runnables[appKey] = run;
  return appKey;
}

/**
 * React component registration is accepted and ignored: the Fabric host renders Svelte components registered by `createFabricApp`.
 * Expo's `Expo.fx` registers a placeholder "main" component in development and expects `registerRootComponent` to replace it; here
 * `createFabricApp` is what replaces it. The provider argument is not read.
 */
export function registerComponent(appKey: string): string {
  return appKey;
}

export const getAppKeys = (): string[] => Object.keys(runnables);
export const getRunnable = (appKey: string): Runnable | undefined => runnables[appKey];

export function runApplication(appKey: string, parameters: Parameters<Runnable>[0], displayMode?: number): void {
  console.log(`Running "${appKey}"`);
  const run = runnables[appKey];
  if (!run) throw new Error(`"${appKey}" has not been registered`);
  run(parameters, displayMode);
}

export function setSurfaceProps(appKey: string, parameters: Parameters<Runnable>[0], displayMode?: number): void {
  const run = runnables[appKey];
  if (!run) throw new Error(`"${appKey}" has not been registered`);
  run(parameters, displayMode);
}

export function unmountApplicationComponentAtRootTag(rootTag: number): void {
  (globalThis as { __svelteFabricStop?: (rootTag: number) => void }).__svelteFabricStop?.(rootTag);
}

/** A headless task: code that runs without a screen, started by native code (`startHeadlessTask`) under `taskKey`. As React Native's. */
export function registerHeadlessTask(taskKey: string, taskProvider: TaskProvider): void {
  registerCancellableHeadlessTask(taskKey, taskProvider, () => () => {});
}

export function registerCancellableHeadlessTask(taskKey: string, taskProvider: TaskProvider, taskCancelProvider: TaskCancelProvider): void {
  if (taskProviders.has(taskKey)) console.warn(`registerHeadlessTask or registerCancellableHeadlessTask called multiple times for same key '${taskKey}'`);
  taskProviders.set(taskKey, taskProvider);
  taskCancelProviders.set(taskKey, taskCancelProvider);
}

/**
 * Only called from native code: runs the task registered under `taskKey` and tells the native side when it is done. A task that throws a
 * `HeadlessJsTaskError` asks for a retry; any other failure is logged and the task is finished (React Native's leaves it to the native
 * timeout), so it does not keep the JavaScript timers of a background launch alive for nothing.
 */
export function startHeadlessTask(taskId: number, taskKey: string, data: unknown): void {
  const support = headlessSupport();
  const finish = () => support?.notifyTaskFinished(taskId);
  const taskProvider = taskProviders.get(taskKey);
  if (!taskProvider) {
    console.warn(`No task registered for key ${taskKey}`);
    finish();
    return;
  }
  let running: Promise<void>;
  try {
    running = Promise.resolve(taskProvider()(data));
  } catch (error) {
    running = Promise.reject(error);
  }
  running.then(finish, (reason: unknown) => {
    console.error(reason);
    if (support && reason instanceof HeadlessJsTaskError()) {
      void support.notifyTaskRetry(taskId).then((posted) => { if (!posted) finish(); }, finish);
    } else {
      finish();
    }
  });
}

/** Only called from native code: cancels a running headless task through its cancel provider. */
export function cancelHeadlessTask(_taskId: number, taskKey: string): void {
  const taskCancelProvider = taskCancelProviders.get(taskKey);
  if (!taskCancelProvider) throw new Error(`No task canceller registered for key '${taskKey}'`);
  taskCancelProvider()();
}

/** React Native's hooks for wrapping the React root and styling it: there is no React root, so they are accepted and ignored. */
export function setWrapperComponentProvider(provider: unknown): void { void provider; }
export function setRootViewStyleProvider(provider: unknown): void { void provider; }
export function setComponentProviderInstrumentationHook(hook: unknown): void { void hook; }

export const AppRegistry = {
  registerRunnable, registerComponent, getAppKeys, getRunnable, runApplication, setSurfaceProps, unmountApplicationComponentAtRootTag,
  registerHeadlessTask, registerCancellableHeadlessTask, startHeadlessTask, cancelHeadlessTask,
  setWrapperComponentProvider, setRootViewStyleProvider, setComponentProviderInstrumentationHook,
};
