// The root router, for the remote runtime (`link.ts`): registered while its `<Router>` is mounted (`connectHost`). A file of its own with no imports, so the
// product, which has the router and not the remote runtime, carries only these few lines of it.
export type LinkedRouter = { goto(href: string): void; readonly current: { readonly url: URL } };

let linked: LinkedRouter | undefined;

/** Registers the root router; the returned function unregisters it (when it is still the registered one). */
export function linkRouter(router: LinkedRouter): () => void {
  linked = router;
  return () => { if (linked === router) linked = undefined; };
}

/** The registered root router, if any. */
export const linkedRouter = (): LinkedRouter | undefined => linked;
