import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { libraryVersion, patchVersion, peerRange, peerVersion } from "./versions.ts";

const manifest = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../package.json"), "utf8"));

test("the versions are the package's own: its version, its peer ranges, and the versions its patches are for", () => {
  expect(libraryVersion).toBe(manifest.version);
  expect(peerRange("expo")).toBe(manifest.peerDependencies.expo);
  expect(peerVersion("expo")).toBe(manifest.peerDependencies.expo.replace(/^[~^]/, ""));
  expect(peerVersion("react-native")).toBe(manifest.peerDependencies["react-native"]);
  expect(patchVersion("expo-modules-core")).toMatch(/^\d+\.\d+\.\d+$/);
  expect(patchVersion("@sveltejs/kit")).toBe(manifest.peerDependencies["@sveltejs/kit"]);
});

test("a name the package does not know is an error, not a guess", () => {
  expect(() => peerRange("left-pad")).toThrow("left-pad is not a peer dependency");
  expect(() => patchVersion("left-pad")).toThrow("no patch for left-pad");
});
