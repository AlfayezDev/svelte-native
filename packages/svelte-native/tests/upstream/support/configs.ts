import type { Platform } from "../../rn-reference.ts";
import { load, src } from "../../support/bundle.ts";

/**
 * The host's static view configs and payload builders (`src/fabric/view-configs.ts`), as an app's bundle holds them, with React Native's own style converters resolved: what the drift
 * tests compare with the libraries' sources. Nothing is mounted and no global is set, so there is nothing to put back.
 */
export type Configs = typeof import("../../../src/fabric/view-configs.ts");

export async function viewConfigs(platform: Platform): Promise<Configs> {
  return (await load<{ configs: Configs }>({ entry: `export * as configs from ${JSON.stringify(src("fabric/view-configs.ts"))};`, platform })).configs;
}
