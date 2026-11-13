import type { NativeRouter } from "@alfayez/svelte-native";

/** What the gate reads of the visitor (the stand-in for a signed-in account). */
export type Visitor = {
  readonly user: unknown;
  readonly needsSetup: boolean;
  readonly projects: readonly { readonly slug: string }[];
};

/**
 * Keeps the root navigator on a screen the visitor may see (run it where the visitor is known and the router is the root's): a visitor who
 * is not signed in goes to `/sign-in`, one who has not finished the setup to `/setup` (the preferences modal stays reachable), a signed-in
 * visitor leaves both for `/projects`, the lab only exists in lab builds, and a project that is no longer the visitor's gives way to the list.
 * The screens are read from the tree: `current` is the deepest shown entry (`/acme/home`, `/acme/settings`; a modal over the tabs is the
 * modal's own path), and a project is a root entry, the tabs screen, whose `params.slug` names it. Opening a project resets the root to its
 * tabs, so it is `entries[0]`; the modal above it stays up when the project goes (the base is replaced by the list). A project pushed over
 * other screens (a link) is dealt with when it is the shown one.
 */
export function enforceGate(visitor: Visitor, router: Pick<NativeRouter, "current" | "entries" | "goto" | "replaceBase">, labEnabled: boolean): void {
  const path = router.current.url.pathname;
  if (path === "/__dev" || path.startsWith("/__dev/")) {
    if (!labEnabled) router.goto(visitor.user ? "/projects" : "/sign-in", { reset: true });
    return;
  }
  if (!visitor.user && path !== "/sign-in") router.goto("/sign-in", { reset: true });
  else if (visitor.needsSetup && path !== "/setup" && path !== "/preferences") router.goto("/setup", { reset: true });
  else if (visitor.user && !visitor.needsSetup && (path === "/sign-in" || path === "/setup")) router.goto("/projects", { reset: true });
  const gone = (slug: string | undefined) => slug !== undefined && !visitor.projects.some((row) => row.slug === slug);
  if (!visitor.user) return;
  if (gone(router.entries[0]?.params.slug)) {
    if (router.entries.length > 1) router.replaceBase("/projects");
    else router.goto("/projects", { reset: true });
  } else if (gone(router.entries.at(-1)?.params.slug)) router.goto("/projects", { reset: true });
}
