import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

/**
 * The `AppDelegate.swift` of the installed Expo's template (`expo/template.tgz`, for the SDK this repository is on): the file a prebuild starts from, which the plugin's AppDelegate
 * patches are written against. Read from the tarball and not copied, so an Expo update that changes the template fails the tests that depend on its shape, and says what changed.
 */
export function expoTemplateAppDelegate(): string {
  const tarball = join(dirname(require.resolve("expo/package.json")), "template.tgz");
  const unpacked = Bun.spawnSync(["tar", "-xzOf", tarball, "package/ios/HelloWorld/AppDelegate.swift"], { stdout: "pipe", stderr: "pipe" });
  if (unpacked.exitCode !== 0) throw new Error(`could not read AppDelegate.swift from ${tarball}: ${unpacked.stderr.toString()}`);
  return unpacked.stdout.toString();
}
