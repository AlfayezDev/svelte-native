import { withAppBuildGradle, withDangerousMod, type ConfigPlugin } from "expo/config-plugins";
import { syncNative } from "./build.ts";

const marker = "// Svelte native: bundle the current Metro graph on every release build.";
const withSvelteNative: ConfigPlugin = (config) => {
  for (const platform of ["android", "ios"] as const) {
    config = withDangerousMod(config, [platform, async (config) => {
      await syncNative(config.modRequest.projectRoot);
      return config;
    }]);
  }
  return withAppBuildGradle(config, (config) => {
    if (config.modResults.language !== "groovy") throw new Error("Svelte native requires Expo's Groovy Android template");
    if (!config.modResults.contents.includes(marker)) {
      // React Native's Gradle input list omits Svelte files and workspace packages.
      config.modResults.contents += `\n${marker}\ntasks.withType(com.facebook.react.tasks.BundleHermesCTask).configureEach {\n    outputs.upToDateWhen { false }\n}\n`;
    }
    return config;
  });
};

export default withSvelteNative;
