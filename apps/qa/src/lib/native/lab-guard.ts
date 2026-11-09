/** What the guard reads and does of the root router (`NativeRouter` has both); declared here so the harness can test it without React Native's types. */
export type GuardedRouter = {
  readonly current: { readonly url: { readonly pathname: string } };
  goto(href: string, options?: { reset?: boolean }): void;
};

/**
 * Keeps a build without the development lab off its path: the product's route table has no lab route, and a link to one (a stale QA link, an
 * update made for another variant) would land on a screen that does not exist, so the router goes back to the home screen instead. Where the
 * lab is enabled (`nativeLabEnabled`) nothing is done. Defence in depth behind the route table, and the one place outside the lab's own
 * directories that knows its path: the product bundle test (`qa/test/bundle.test.ts`) expects exactly this line there.
 */
export function enforceLab(router: GuardedRouter, labEnabled: boolean): void {
  const path = router.current.url.pathname;
  if (path === "/__dev" || path.startsWith("/__dev/")) {
    if (!labEnabled) router.goto("/", { reset: true });
  }
}
