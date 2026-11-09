/**
 * What the link the app was launched with says about the first screen: it names a screen of the development lab (`rasheed-svelte:///__dev`,
 * `rasheed-svelte://__dev/screens`, a web link whose path is under `/__dev`), it names anything else (a product screen, the development
 * client's own link), or there is none (the launcher's icon, or a restart that restores the screens it had). A guess from the text: the router
 * decides whether a screen matches, so `labOnly` of where it ends up has the last word.
 */
export function launchKind(url: string | null | undefined): "lab" | "other" | "none" {
  if (!url) return "none";
  return /\/__dev(?:[/?#]|$)/.test(url.replace(/^[a-z-]+:\/\/+/, "/")) ? "lab" : "other";
}

/** Whether a router path is the lab's. */
export function isLabPath(pathname: string): boolean {
  return pathname === "/__dev" || pathname.startsWith("/__dev/");
}

/**
 * Whether every screen on the root stack is the lab's. A restored stack that has the home screen under the lab (a user went there from the
 * home screen's link) is not.
 */
export function labOnly(pathnames: readonly string[]): boolean {
  return pathnames.length > 0 && pathnames.every(isLabPath);
}
