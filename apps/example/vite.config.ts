import { defineConfig } from "vite";
import { svelteNative } from "@example/svelte-native/vite";
import { remoteLabModule, remoteLabServed } from "./remote-lab.ts";

export default defineConfig(({ mode, command, isPreview }) => {
	const remoteLab = remoteLabServed({ command, isPreview });
	return {
		// The development server serves the native lab's remote functions (remote-lab.ts); `vite preview` and builds do not. SvelteKit registers a remote
		// module when the server first loads it, which for a module no web page imports is never, so it is asked for at startup. `host` lets a device on the LAN reach it.
		server: {
			port: 3000,
			strictPort: true,
			host: true,
			...(remoteLab ? { warmup: { ssrFiles: [remoteLabModule] } } : {}),
		},
		plugins: [
			svelteNative({
				target: mode === "native" ? "native" : "web",
				kit: {
					compilerOptions: { experimental: { async: true } },
					// Remote functions are the native lab's: on in development, off in a build.
					experimental: { remoteFunctions: remoteLab },
				},
			}),
		],
	};
});
