import { getContext, setContext } from "svelte";
import { accountForms } from "../../client/account-forms.ts";
import { bindForm } from "../../../apps/platform/src/lib/client/form.svelte.ts";
import { getLocale, t } from "../../../apps/platform/src/lib/native/state.svelte.ts";

/**
 * `apps/platform/src/lib/native/session.svelte.ts` without the SpacetimeDB connection: an account that is signed in (or not, by
 * `globalThis.__labOffUser`), loaded and ready, with the real forms and the real `createNativeForm`. The app-lab-off test mounts the app on it.
 */
export type NativeConfiguration = { uri: string; databaseName: string };
export const deviceToken = () => "";
export const forgetDevice = async () => {};
export function createNativeForm(config: Parameters<typeof bindForm>[0]) {
  return bindForm(config, { t, onDefect: (error) => console.error("[native form]", error) });
}
const key = Symbol("native-account");
export function openNativeAccount() {
  const signedIn = (globalThis as { __labOffUser?: unknown }).__labOffUser !== null;
  const account = {
    db() { throw new Error("offline"); },
    get user() { return signedIn ? { id: "u1", email: "a@example.test" } : undefined; },
    needsProfile: false,
    completeProfile() {},
    workspaces: [{ id: "w1", slug: "acme", name: "Acme" }],
    devices: [],
    loaded: true,
    ready: true,
    error: undefined,
    retry() {},
    async resetDevice() {},
    identity: "id",
    selected: "",
    choose() {},
    signOut: async () => {},
    forms: accountForms({ connection: () => { throw new Error("offline"); }, locale: getLocale, t, randomUUID: () => "uuid", userAgent: () => "test" } as unknown as Parameters<typeof accountForms>[0]),
  };
  setContext(key, account);
  return account;
}
export function useNativeAccount() {
  const account = getContext<ReturnType<typeof openNativeAccount>>(key);
  if (!account) throw new Error("Native account is missing above this screen");
  return account;
}
