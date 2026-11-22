import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { readerFor } from "../../src/doctor/resolve.ts";
import { rnghAdditions, rnghProblems, rnghRegistration, rnghUses, rnghWorkletsLookup } from "../../src/doctor/shapes.ts";
import { packageRoot, repoRoot, vendored } from "../support/paths.ts";

// The patches to react-native-gesture-handler (3.3.0) that the iOS screens rely on (`vendor-patches/react-native-gesture-handler/0001-root-recognizer-for-presented-screens.patch`, and `0002-worklets-is-the-copy-beside-it.patch`
// for its podspec), applied to the library's copy (`vendor/react-native-gesture-handler`, VENDORING.md) by `scripts/vendor.ts`. The first is compiled on the Mac; these are the parts that can be held on the host. The Objective-C that
// calls what it adds is `native-host/contracts/gesture-root.test.ts`. What the patches add is listed once, in `src/doctor/shapes.ts`, which `expo-svelte doctor` checks the copy against.

const patchPath = resolve(packageRoot, "vendor-patches/react-native-gesture-handler/0001-root-recognizer-for-presented-screens.patch");
const workletsPatchPath = resolve(packageRoot, "vendor-patches/react-native-gesture-handler/0002-worklets-is-the-copy-beside-it.patch");

test("pnpm patches nothing of the package any more: it is a copy in vendor/, and the lockfile pins no patch of it", async () => {
  const lock = await readFile(resolve(repoRoot, "pnpm-lock.yaml"), "utf8");
  expect(lock).not.toMatch(/react-native-gesture-handler[^\n]*patch_hash/);
  expect(await readFile(resolve(repoRoot, "pnpm-workspace.yaml"), "utf8")).not.toContain("react-native-gesture-handler");
});

test("the patch adds the manager's current-manager accessor and the registration the screens ask for, and keeps the walk that stops at a touch handler", async () => {
  const patch = await readFile(patchPath, "utf8");
  // Every line of `rnghAdditions` is in the patch as an added line (the diff's `+` before each line of it).
  for (const [file, lines] of Object.entries(rnghAdditions)) {
    for (const line of lines) expect(patch, `${file}: ${line}`).toContain(`+${line.replaceAll("\n", "\n+")}`);
  }
  // The registration reuses the library's own, which also adds the recognizer to `_rootViewGestureRecognizers` and makes the manager its delegate.
  expect(patch).toMatch(new RegExp(`\\+\\s+${rnghRegistration.source}`));
  for (const use of rnghUses) expect(patch).toContain(use);
});

test("the second patch makes the podspec's helper find the Worklets copy beside the package, before it asks Node for an installed one", async () => {
  const patch = await readFile(workletsPatchPath, "utf8");
  expect(patch).toContain(`+        copy = ${rnghWorkletsLookup}`);
  expect(patch).toMatch(/\+        return copy if File\.exist\?\(File\.join\(copy, 'package\.json'\)\)/);
});

test("the copy carries it: the manager has the accessor and the registration, and the doctor's check of the copy finds nothing missing", () => {
  expect(rnghProblems(readerFor(vendored("react-native-gesture-handler")))).toEqual([]);
});
