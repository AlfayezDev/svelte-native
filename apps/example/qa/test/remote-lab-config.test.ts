// The remote functions lab is served by the development server and by nothing else: not `vite preview` (which runs with `command === "serve"`), not a build.
import { expect, test } from "bun:test";
import { remoteLabModule, remoteLabServed } from "../../remote-lab.ts";

test("the lab's remote functions are served by `vite dev` only", () => {
	expect(remoteLabServed({ command: "serve" })).toBe(true);
	expect(remoteLabServed({ command: "serve", isPreview: false })).toBe(true);
	expect(remoteLabServed({ command: "serve", isPreview: true })).toBe(false);
	expect(remoteLabServed({ command: "build" })).toBe(false);
	expect(remoteLabServed({ command: "build", isPreview: false })).toBe(false);
});

test("the module that is loaded at startup is the lab's", async () => {
	const { existsSync } = await import("node:fs");
	const { resolve } = await import("node:path");
	expect(existsSync(resolve(import.meta.dirname, "../..", remoteLabModule))).toBe(true);
});
