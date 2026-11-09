import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Where the host checks of the native code (`*-native.test.ts`, `big-cores.test.ts`, `tests/native/*Host.kt`) find what they compile and
 * run against. `kotlinc`, `java` and `g++` are found on the path; the two jars are not on any path:
 *
 * - `android.jar` (compile-time types of the Android framework, newest platform first): `ANDROID_HOME`, `ANDROID_SDK_ROOT`, else `~/Android/sdk`.
 * - the `org.json` jar (the real implementation, which Android provides at run time): `ORG_JSON_JAR`
 *   (`apps/qa/qa/ci/host-tools.sh` sets it on a CI runner), else Gradle's cache (`GRADLE_USER_HOME`, else `~/.gradle`).
 */
function find(directory: string, match: (path: string) => boolean): string | null {
  if (!existsSync(directory)) return null;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      const found = find(path, match);
      if (found) return found;
    } else if (match(path)) return path;
  }
  return null;
}

function names(path: string): string[] {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}

export function findHostJars(env: Record<string, string | undefined> = process.env, home: string = homedir()): { androidJar: string | null; jsonJar: string | null } {
  const androidHome = env.ANDROID_HOME ?? env.ANDROID_SDK_ROOT ?? join(home, "Android/sdk");
  const androidJar =
    names(join(androidHome, "platforms"))
      .sort()
      .reverse()
      .map((platform) => join(androidHome, "platforms", platform, "android.jar"))
      .find(existsSync) ?? null;
  const configured = env.ORG_JSON_JAR?.trim();
  const jsonJar =
    configured && existsSync(configured)
      ? configured
      : find(join(env.GRADLE_USER_HOME ?? join(home, ".gradle"), "caches/modules-2/files-2.1/org.json"), (path) => /json-\d+\.jar$/.test(path));
  return { androidJar, jsonJar };
}

/** Which of the tools the host checks need are missing, by name; empty when every check can run. */
export function missingHostTools(which: (name: string) => string | null = Bun.which, env: Record<string, string | undefined> = process.env): string[] {
  const { androidJar, jsonJar } = findHostJars(env);
  const missing = ["kotlinc", "java", "g++"].filter((tool) => which(tool) === null);
  if (androidJar === null) missing.push("android.jar (ANDROID_HOME/platforms/*/android.jar)");
  if (jsonJar === null) missing.push("the org.json jar (ORG_JSON_JAR)");
  return missing;
}
