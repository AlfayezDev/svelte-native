import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

// The patch to react-native-gesture-handler that the iOS screens rely on (`patches/react-native-gesture-handler@2.32.0.patch`), the lockfile
// that pins it and the Objective-C that calls what it adds. The patch is compiled on the Mac; these are the parts that can be held on the host.

const root = resolve(import.meta.dirname, "../../..");
const read = (path: string) => readFile(resolve(root, path), "utf8");
const patchPath = "patches/react-native-gesture-handler@2.32.0.patch";

test("pnpm-lock.yaml pins the patch that is in the repo (every patch_hash of the library is the sha256 of the file)", async () => {
  const hash = createHash("sha256").update(await readFile(resolve(root, patchPath))).digest("hex");
  const lock = await read("pnpm-lock.yaml");
  expect(lock).toContain(`react-native-gesture-handler@2.32.0: ${hash}`);
  const hashes = new Set([...lock.matchAll(/react-native-gesture-handler: 2\.32\.0\(patch_hash=([0-9a-f]+)\)/g)].map((match) => match[1]));
  expect([...hashes]).toEqual([hash]);
});

test("the patch adds the manager's current-manager accessor and the registration the screens ask for, and keeps the walk that stops at a touch handler", async () => {
  const patch = await read(patchPath);
  expect(patch).toContain("+ (nullable RNGestureHandlerManager *)currentManager;");
  expect(patch).toContain("+- (void)registerRootViewGestureRecognizerIfAttachedBelow:(nonnull RNGHUIView *)view;");
  expect(patch).toContain("+- (void)registerRootViewGestureRecognizerIfAttachedBelow:(RNGHUIView *)view");
  // The registration reuses the library's own, which also adds the recognizer to `_rootViewGestureRecognizers` and makes the manager its delegate.
  expect(patch).toMatch(/\+\s+\[self registerViewWithGestureRecognizerAttachedIfNeeded:view\];/);
  expect(patch).toContain("RNGHViewHasSurfaceTouchHandler(touchHandlerView)");
});

test("SvelteEnsureGestureRoot asks the library's manager instead of walking views and creating a recognizer of its own", async () => {
  const support = await read("apps/platform/modules/svelte-screens-ios/native/Views/SvelteSupport.mm");
  const start = support.indexOf("void SvelteEnsureGestureRoot(");
  expect(start).toBeGreaterThan(0);
  const section = support.slice(support.indexOf("#pragma mark - react-native-gesture-handler"), support.indexOf("@implementation SvelteTouchHost"));
  const body = support.slice(start, support.indexOf("@implementation SvelteTouchHost", start));
  expect(body).toContain('NSClassFromString(@"RNGestureHandlerManager")');
  expect(body).toContain("[managerClass currentManager]");
  expect(body).toContain("registerRootViewGestureRecognizerIfAttachedBelow:view");
  // Nothing of the old version: no walk of the subtree, no recognizer class of the library created here, no delegate of the module's own
  // (a recognizer outside the manager's set is skipped by `handleSetJSResponder`).
  for (const gone of ["subviews", "RNRootViewGestureRecognizer", "addGestureRecognizer", "SvelteGestureRootDelegate", "SvelteHoldsGestureHandler"]) {
    expect(section, gone).not.toContain(gone);
  }
  // The manager is asked only after the cheap exits.
  expect(body.indexOf("if (managerClass == nil) return;")).toBeLessThan(body.indexOf("[managerClass currentManager]"));
  expect(body.indexOf("if (manager == nil) return;")).toBeLessThan(body.indexOf("registerRootViewGestureRecognizerIfAttachedBelow:view"));
});
