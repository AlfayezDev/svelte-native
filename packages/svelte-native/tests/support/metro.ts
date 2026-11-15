import type { ConfigT } from "@expo/metro/metro-config";

/**
 * Metro's resolver as the tests of `withSvelteNative` (`src/metro.ts`) see it: a config with the parts the wrapper reads, and the resolution of an import through the
 * resolver it installs. What the wrapper does not take, Metro's own resolver would answer; here that answer is the module's name under `/real/`, so a test sees an import that fell
 * through to it.
 */
export function fakeConfig(projectRoot: string): ConfigT {
  return { projectRoot, resolver: { sourceExts: ["ts"], resolveRequest: undefined }, serializer: { getModulesRunBeforeMainModule: () => [] }, transformer: {} } as unknown as ConfigT;
}

const real = { resolveRequest: (_context: unknown, moduleName: string) => ({ type: "sourceFile", filePath: `/real/${moduleName}` }) };

/** The file `moduleName` resolves to when it is imported by the file at `origin`, through the resolver `withSvelteNative` installed in `config`. */
export function resolveFrom(config: ConfigT, origin: string, moduleName: string, platform = "android"): string {
  const resolveRequest = config.resolver.resolveRequest as (context: unknown, moduleName: string, platform: string) => { filePath: string };
  return resolveRequest({ ...real, originModulePath: origin, unstable_conditionNames: [] }, moduleName, platform).filePath;
}
