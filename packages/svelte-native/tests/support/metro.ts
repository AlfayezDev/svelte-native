import { readFileSync, statSync, utimesSync } from "node:fs";
import { expect } from "bun:test";
import type { ConfigT } from "@expo/metro/metro-config";

/**
 * Helpers for the tests of `withSvelteNative` (`src/metro.ts`) and of the files it generates: the part of Metro's config it reads, a stand-in for Metro's own resolver, a wait
 * for a watcher, and a check that a generated file that is current is not written again (a running Metro watches the modification time).
 */

/** The part of Metro's config `withSvelteNative` reads. */
export const fakeConfig = (projectRoot: string, extra: object = {}): ConfigT => ({
  projectRoot,
  resolver: { sourceExts: ["ts"], resolveRequest: undefined },
  serializer: { getModulesRunBeforeMainModule: () => [] },
  transformer: {},
  ...extra,
}) as unknown as ConfigT;

type Resolved = { type: string; filePath: string };
/** What Metro's own resolver answers for a module: a file that stands for it. */
export type RealResolver = (context: { originModulePath: string }, moduleName: string) => Resolved;
export const realModule: RealResolver = () => ({ type: "sourceFile", filePath: "/real/module.ts" });

/** What the config's resolver answers for an import of `moduleName` by `origin`, with `real` standing for the resolver it wraps. */
export function resolveFrom(config: ConfigT, origin: string, moduleName: string, real: RealResolver = realModule): string {
  const resolveRequest = config.resolver.resolveRequest as (context: unknown, moduleName: string, platform: string) => Resolved;
  return resolveRequest({ resolveRequest: (context: { originModulePath: string }, name: string) => real(context, name), originModulePath: origin, unstable_conditionNames: [] }, moduleName, "android").filePath;
}

/** Waits for `condition`, polling, for at most `ms`: what a test of a file watcher waits with. */
export const until = async (condition: () => boolean, ms = 5_000): Promise<void> => {
  const deadline = Date.now() + ms;
  while (!condition() && Date.now() < deadline) await new Promise((done) => setTimeout(done, 25));
};

/**
 * Gives the files a modification time of an hour ago and returns what asserts that nothing wrote them since: a file that is written again gets the current time, so there is
 * nothing to sleep for. Call the returned function after the step that must leave them alone.
 */
export function watchUntouched(files: string[]): () => void {
  const before = files.map((file) => readFileSync(file, "utf8"));
  const hourAgo = new Date(Date.now() - 3_600_000);
  for (const file of files) utimesSync(file, hourAgo, hourAgo);
  const times = files.map((file) => statSync(file).mtimeMs);
  return () => {
    files.forEach((file, index) => {
      expect(readFileSync(file, "utf8"), file).toBe(before[index] as string);
      expect(statSync(file).mtimeMs, `${file} was not written again`).toBe(times[index] as number);
    });
  };
}
