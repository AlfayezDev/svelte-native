import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findHostJars, missingHostTools } from "./native/host-tools.ts";

// The host checks of the native code skip themselves when kotlinc, java, g++ or a jar is missing, which is right on a machine without
// them and wrong on CI, where a skipped check is a check nobody ran. On CI (CI=1, as the workflow sets it) they must all be there.
describe("the host tools of the native checks", () => {
  test.if(process.env.CI === "1")("are all installed on CI (qa/ci/host-tools.sh, actions/setup-java), so no native check is skipped", () => {
    expect(missingHostTools()).toEqual([]);
  });

  test("a tool that is missing is named, and nothing is missing when every tool and jar is there", () => {
    const sdk = mkdtempSync(join(tmpdir(), "svelte-native-tools-"));
    try {
      mkdirSync(join(sdk, "platforms/android-34"), { recursive: true });
      mkdirSync(join(sdk, "platforms/android-36"), { recursive: true });
      writeFileSync(join(sdk, "platforms/android-34/android.jar"), "");
      writeFileSync(join(sdk, "platforms/android-36/android.jar"), "");
      writeFileSync(join(sdk, "json-1.jar"), "");
      const env = { ANDROID_HOME: sdk, ORG_JSON_JAR: join(sdk, "json-1.jar"), GRADLE_USER_HOME: join(sdk, "no-gradle") };
      const found = (names: string[]) => (name: string) => (names.includes(name) ? `/usr/bin/${name}` : null);
      expect(missingHostTools(found(["kotlinc", "java", "g++"]), env)).toEqual([]);
      expect(missingHostTools(found(["java"]), env)).toEqual(["kotlinc", "g++"]);
      expect(findHostJars(env).androidJar).toBe(join(sdk, "platforms/android-36/android.jar"));
      expect(findHostJars(env).jsonJar).toBe(join(sdk, "json-1.jar"));
      expect(missingHostTools(found(["kotlinc", "java", "g++"]), { ...env, ORG_JSON_JAR: join(sdk, "absent.jar") })).toEqual(["the org.json jar (ORG_JSON_JAR)"]);
      expect(missingHostTools(found(["kotlinc", "java", "g++"]), { ...env, ANDROID_HOME: join(sdk, "nowhere") })).toEqual(["android.jar (ANDROID_HOME/platforms/*/android.jar)"]);
    } finally {
      rmSync(sdk, { recursive: true, force: true });
    }
  });

  test("the org.json jar is also found in Gradle's cache", () => {
    const gradle = mkdtempSync(join(tmpdir(), "svelte-native-gradle-"));
    try {
      const directory = join(gradle, "caches/modules-2/files-2.1/org.json/json/20250517/abc");
      mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, "json-20250517.jar"), "");
      expect(findHostJars({ GRADLE_USER_HOME: gradle, ANDROID_HOME: join(gradle, "none") }, gradle).jsonJar).toBe(join(directory, "json-20250517.jar"));
    } finally {
      rmSync(gradle, { recursive: true, force: true });
    }
  });
});
