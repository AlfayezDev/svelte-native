// Stands in for SvelteKit's `#app/state/client` in the client files this package reuses: `page.url` is the native router's current URL (the
// remote function requests send it as `x-sveltekit-pathname`/`-search`, so `getRequestEvent().url` on the server is the screen), there is
// no navigation in flight to report and no deployment to detect.
import { currentUrl } from "../link.ts";

export const navigating = null;
export const page = {
  get url(): URL { return currentUrl(); },
};
export function notify_version(): void {}
