/** The module of the native lab's remote functions, which the development server loads at startup (`vite.config.ts`, `server.warmup`). */
export const remoteLabModule = "src/lib/native/dev/remote-lab.remote.ts";

/**
 * Whether the lab's remote functions are served: by the development server only. `vite preview` also runs with `command === "serve"` (and `isPreview`), and
 * serves a build, which has no lab; a build does not either. (Anyone who can reach the dev server, which listens on the LAN, can call them: they hold
 * nothing but in-memory counters, and the rest of the dev server is as reachable.)
 */
export const remoteLabServed = ({
	command,
	isPreview,
}: {
	command: string;
	isPreview?: boolean;
}): boolean => command === "serve" && !isPreview;
