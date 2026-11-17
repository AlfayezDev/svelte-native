import type { NativePushModule, NativePushEvents } from "../../../src/push/client.ts";
import type { PushPermission } from "../../../src/push/client.ts";
import type { PushMessage, PushToken } from "../../../src/push/types.ts";

/**
 * A stand-in for the native module `SveltePush` for the tests that load the library's bundle (`wiring.test.ts`, `router.test.ts`): `world()` makes it and puts it where the bundle's
 * stand-in for `expo-modules-core` finds it (`globalThis.__pushWorld`), with the React Native modules the push client reads (the foreground event, `Linking`) recorded beside it.
 */
export type PushWorld = {
  native: NativePushModule | null;
  /** The modules the bundle asked `requireOptionalNativeModule` for. */
  lookups: string[];
  /** The listeners `AppState.addEventListener("change", …)` got. */
  appState: ((state: string) => void)[];
  calls: string[];
  /** `Linking.getInitialURL`'s answer. */
  initialURL: string | null;
  /** The `getInitialURL` the stand-in for `Linking` was made with: what it still is when nothing wrapped it. */
  originalGetInitialURL: (() => Promise<string | null>) | undefined;
  permission: PushPermission;
  /** While set, the module's `permission()` does not answer until it resolves. */
  holdPermission: Promise<void> | undefined;
  launch: PushMessage | null;
  token: PushToken;
  dispatch(event: keyof NativePushEvents, payload: unknown): void;
};

export const TOKEN: PushToken = { provider: "fcm", token: "token-1", app: "dev.example.app" };
export const message = (patch: Partial<PushMessage> = {}): PushMessage => ({ id: "m1", title: "Order ready", body: "Pickup at gate 3", data: {}, provider: "fcm", ...patch });

export function world(options: { module?: false } = {}): PushWorld {
  const listeners: { event: string; listener: (payload: unknown) => void }[] = [];
  const state: PushWorld = {
    native: null, lookups: [], appState: [], calls: [], initialURL: null, originalGetInitialURL: undefined, permission: "prompt", holdPermission: undefined, launch: null, token: TOKEN,
    dispatch: (event, payload) => { for (const { event: name, listener } of [...listeners]) if (name === event) listener(payload); },
  };
  state.native = options.module === false ? null : {
    permission: async () => { await state.holdPermission; return state.permission; },
    requestPermission: async () => { state.calls.push("request"); state.permission = "granted"; return state.permission; },
    register: async () => { state.calls.push("register"); return state.token; },
    unregister: async () => { state.calls.push("unregister"); },
    show: async (shown, presentation) => { state.calls.push(`show ${shown.id} ${JSON.stringify(presentation)}`); },
    takeLaunchMessage: () => { state.calls.push("take"); const taken = state.launch; state.launch = null; return taken; },
    backgroundDone: (id) => { state.calls.push(`done ${id}`); },
    addListener: (event, listener) => {
      const entry = { event, listener: listener as (payload: unknown) => void };
      listeners.push(entry);
      return { remove: () => { listeners.splice(listeners.indexOf(entry), 1); } };
    },
  };
  (globalThis as { __pushWorld?: PushWorld }).__pushWorld = state;
  return state;
}

/** The bundle's stand-ins for `expo-modules-core`, `AppState` and `Linking`, which read the world above. */
export const pushStubs: Record<string, string> = {
  "expo-modules-core": `export const EventEmitter = class {};
    export const requireOptionalNativeModule = (name) => {
      globalThis.__pushWorld.lookups.push(name);
      if (name === 'SveltePush') return globalThis.__pushWorld.native;
      if (name === 'SvelteEngine' && globalThis.__navigationInsets) return { install: () => false, getInsets: () => globalThis.__navigationInsets, addListener: () => ({ remove() {} }) };
      return null;
    };`,
  "react-native/Libraries/AppState/AppState": "export default { currentState: 'active', addEventListener: (type, handler) => { globalThis.__pushWorld.appState.push(handler); return { remove() {} }; } };",
  "react-native/Libraries/Linking/Linking": `const handlers = (globalThis.__linkHandlers ??= []);
    const getInitialURL = () => Promise.resolve(globalThis.__pushWorld.initialURL);
    globalThis.__pushWorld.originalGetInitialURL = getInitialURL;
    export default {
      addEventListener(name, handler) { handlers.push(handler); return { remove() { const at = handlers.indexOf(handler); if (at >= 0) handlers.splice(at, 1); } }; },
      emit(name, payload) { for (const handler of [...handlers]) handler(payload); },
      getInitialURL,
      openURL: () => Promise.resolve(),
    };`,
};
