import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

// The Objective-C++ of the iOS screens that calls what the react-native-gesture-handler patch adds (`upstream/react-native-gesture-handler-patch.test.ts` holds the patch). It is compiled
// on the Mac; this is the part that can be held on the host.
const root = resolve(import.meta.dirname, "../../../../..");
const read = (path: string) => readFile(resolve(root, path), "utf8");

test("SvelteEnsureGestureRoot asks the library's manager instead of walking views and creating a recognizer of its own", async () => {
  const support = await read("packages/expo-svelte/native/svelte-core/ios/screens/Views/SvelteSupport.mm");
  const start = support.indexOf("void SvelteEnsureGestureRoot(");
  expect(start).toBeGreaterThan(0);
  const section = support.slice(support.indexOf("#pragma mark - react-native-gesture-handler"), support.indexOf("@implementation SvelteTouchHost"));
  const body = support.slice(start, support.indexOf("@implementation SvelteTouchHost", start));
  expect(body).toContain('NSClassFromString(@"RNGestureHandlerManager")');
  expect(body).toContain("[managerClass currentManager]");
  expect(body).toContain("registerRootViewGestureRecognizerIfAttachedBelow:view");
  // Nothing of the old version: no walk of the subtree, no recognizer class of the library created here, no delegate of the module's own
  // (a recognizer outside the manager's set is not reached by what the manager does for its own).
  for (const gone of ["subviews", "RNRootViewGestureRecognizer", "addGestureRecognizer", "SvelteGestureRootDelegate", "SvelteHoldsGestureHandler"]) {
    expect(section, gone).not.toContain(gone);
  }
  // The manager is asked only after the cheap exits.
  expect(body.indexOf("if (managerClass == nil) return;")).toBeLessThan(body.indexOf("[managerClass currentManager]"));
  expect(body.indexOf("if (manager == nil) return;")).toBeLessThan(body.indexOf("registerRootViewGestureRecognizerIfAttachedBelow:view"));
});
