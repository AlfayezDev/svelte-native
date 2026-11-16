import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { rnghAdditions, rnghRegistration, rnghUses } from "../../src/doctor/shapes.ts";
import { patchVersion } from "../support/versions.ts";

// The patch to react-native-gesture-handler that the iOS screens rely on (`patches/react-native-gesture-handler@<version>.patch` of the package) and the lockfile
// that pins it. The patch is compiled on the Mac; these are the parts that can be held on the host. The Objective-C that calls what it adds is `native-host/contracts/gesture-root.test.ts`.
// What the patch adds is listed once, in `src/doctor/shapes.ts`, which `svelte-native doctor` checks an app's installed package against.

const root = resolve(import.meta.dirname, "../../../..");
const read = (path: string) => readFile(resolve(root, path), "utf8");
const version = patchVersion("react-native-gesture-handler");
const patchPath = `packages/svelte-native/patches/react-native-gesture-handler@${version}.patch`;

test("every patch_hash of the library in pnpm-lock.yaml is the sha256 of the patch that is in the repo", async () => {
  const hash = createHash("sha256").update(await readFile(resolve(root, patchPath))).digest("hex");
  const lock = await read("pnpm-lock.yaml");
  const hashes = new Set([...lock.matchAll(new RegExp(`react-native-gesture-handler: ${version.replaceAll(".", "\\.")}\\(patch_hash=([0-9a-f]+)\\)`, "g"))].map((match) => match[1]));
  expect([...hashes]).toEqual([hash]);
});

test("the patch adds the manager's current-manager accessor and the registration the screens ask for, and keeps the walk that stops at a touch handler", async () => {
  const patch = await read(patchPath);
  // Every line of `rnghAdditions` is in the patch as an added line (the diff's `+` before each line of it).
  for (const [file, lines] of Object.entries(rnghAdditions)) {
    for (const line of lines) expect(patch, `${file}: ${line}`).toContain(`+${line.replaceAll("\n", "\n+")}`);
  }
  // The registration reuses the library's own, which also adds the recognizer to `_rootViewGestureRecognizers` and makes the manager its delegate.
  expect(patch).toMatch(new RegExp(`\\+\\s+${rnghRegistration.source}`));
  for (const use of rnghUses) expect(patch).toContain(use);
});
