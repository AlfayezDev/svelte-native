import { describe, expect, test } from "bun:test";
import { findHostJars, missingHostTools } from "../native/host-tools.ts";
import { createProject } from "../support/project.ts";

// The host checks of the native code skip themselves when kotlinc, java, g++ or a jar is missing, which is right on a machine without
// them and wrong on CI, where a skipped check is a check nobody ran. On CI (CI=1, as the workflow sets it) they must all be there.
describe("the host tools of the native checks", () => {
  test.if(process.env.CI === "1")("are all installed on CI (qa/ci/host-tools.sh, actions/setup-java), so no native check is skipped", () => {
    expect(missingHostTools()).toEqual([]);
  });

  test("a tool that is missing is named, and nothing is missing when every tool and jar is there", () => {
    using sdk = createProject({ "platforms/android-34/android.jar": "", "platforms/android-36/android.jar": "", "json-1.jar": "" }, "svelte-native-tools-");
    const env = { ANDROID_HOME: sdk.directory, ORG_JSON_JAR: sdk.path("json-1.jar"), GRADLE_USER_HOME: sdk.path("no-gradle") };
    const found = (names: string[]) => (name: string) => (names.includes(name) ? `/usr/bin/${name}` : null);
    expect(missingHostTools(found(["kotlinc", "java", "g++"]), env)).toEqual([]);
    expect(missingHostTools(found(["java"]), env)).toEqual(["kotlinc", "g++"]);
    expect(findHostJars(env).androidJar).toBe(sdk.path("platforms/android-36/android.jar"));
    expect(findHostJars(env).jsonJar).toBe(sdk.path("json-1.jar"));
    expect(missingHostTools(found(["kotlinc", "java", "g++"]), { ...env, ORG_JSON_JAR: sdk.path("absent.jar") })).toEqual(["the org.json jar (ORG_JSON_JAR)"]);
    expect(missingHostTools(found(["kotlinc", "java", "g++"]), { ...env, ANDROID_HOME: sdk.path("nowhere") })).toEqual(["android.jar (ANDROID_HOME/platforms/*/android.jar)"]);
  });

  test("the org.json jar is also found in Gradle's cache", () => {
    const jar = "caches/modules-2/files-2.1/org.json/json/20250517/abc/json-20250517.jar";
    using gradle = createProject({ [jar]: "" }, "svelte-native-gradle-");
    expect(findHostJars({ GRADLE_USER_HOME: gradle.directory, ANDROID_HOME: gradle.path("none") }, gradle.directory).jsonJar).toBe(gradle.path(jar));
  });
});
