import { afterAll, afterEach, beforeAll, beforeEach } from "bun:test";
import { type FabricHost, type HostOptions, type Installed, createHost } from "./host.ts";

/**
 * The fake for a test file: installed before each test and restored after it, with the log and the surfaces empty at the start of each (`scope: "file"`: once
 * for the file, for a file whose tests build on one another). `globals` are put on the global object with the binding. Call it at the top level of the file.
 */
export function fakeHost(options: HostOptions & { globals?: Record<string, unknown>; scope?: "test" | "file" } = {}): FabricHost {
  const host = createHost(options);
  let installed: Installed | undefined;
  const open = () => { host.reset(); installed = host.install(options.globals); };
  const close = () => { installed?.restore(); installed = undefined; };
  if (options.scope === "file") { beforeAll(open); afterAll(close); } else { beforeEach(open); afterEach(close); }
  return host;
}
