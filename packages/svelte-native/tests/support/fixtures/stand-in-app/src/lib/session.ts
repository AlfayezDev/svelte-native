import { getContext, setContext } from "svelte";
import type { Visitor } from "./gate.ts";

/**
 * The stand-in for an app's session: a visitor who is signed in (or not, by `globalThis.__standInSignedOut`), known at once. Opening it is
 * counted (`globalThis.__standInSessions`), which is how the tests see whether the app started it.
 */
export type Session = { readonly visitor: Visitor };
const key = Symbol("stand-in-session");

export function openSession(): Session {
  const environment = globalThis as { __standInSessions?: number; __standInSignedOut?: boolean };
  environment.__standInSessions = (environment.__standInSessions ?? 0) + 1;
  const session: Session = {
    visitor: { user: environment.__standInSignedOut ? undefined : { id: "u1" }, needsSetup: false, projects: [{ slug: "acme" }] },
  };
  setContext(key, session);
  return session;
}

export function useSession(): Session {
  const session = getContext<Session | undefined>(key);
  if (!session) throw new Error("The session is missing above this screen");
  return session;
}
