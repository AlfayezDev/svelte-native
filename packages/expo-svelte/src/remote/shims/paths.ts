// Stands in for SvelteKit's `#app/paths` in the client files this package reuses (`client/remote-functions/*` build `${base}/${app_dir}/remote/${id}`).
// Both are live bindings: `configureRemote` and the app config set them, and the files read them each time they build a URL.
export let base = "";
export let app_dir = "_app";

export function setPaths(nextBase: string, nextAppDir: string): void {
  base = nextBase;
  app_dir = nextAppDir;
}
