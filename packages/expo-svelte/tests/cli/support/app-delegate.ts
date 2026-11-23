import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

/** A file of the installed Expo's template (`expo/template.tgz`, for the SDK this repository is on), read from the tarball and not copied: an Expo update that changes the template fails the tests that depend on its shape, and says what changed. */
function templateFile(path: string): string {
  const tarball = join(dirname(require.resolve("expo/package.json")), "template.tgz");
  const unpacked = Bun.spawnSync(["tar", "-xzOf", tarball, `package/${path}`], { stdout: "pipe", stderr: "pipe" });
  if (unpacked.exitCode !== 0) throw new Error(`could not read ${path} from ${tarball}: ${unpacked.stderr.toString()}`);
  return unpacked.stdout.toString();
}

/** The `AppDelegate.swift` of the template: the file a prebuild starts from, which the plugin's AppDelegate patches are written against. */
export const expoTemplateAppDelegate = (): string => templateFile("ios/HelloWorld/AppDelegate.swift");

/** The `SceneDelegate.swift` of the same template (Expo SDK 58): the scene starts React Native, and the plugin's state restoration patch (`applySceneDelegate`) is written against this file. */
export const expoTemplateSceneDelegate = (): string => templateFile("ios/HelloWorld/SceneDelegate.swift");

/** The `android/app/build.gradle` of the same template: what the plugin's Gradle patch (Firebase Messaging's dependency for push) is written against. */
export const expoTemplateAppBuildGradle = (): string => templateFile("android/app/build.gradle");
