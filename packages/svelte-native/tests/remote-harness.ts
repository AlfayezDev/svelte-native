// biome-ignore-all lint/suspicious/noExplicitAny: the client is a bundle loaded at run time and its remote functions are not typed
// What the remote function tests share: the fixture's SvelteKit server in its own process, and the native client runtime (what Metro builds from
// `src/remote`, SvelteKit's client files and a `*.remote.ts` module's stubs) bundled the way the other tests bundle the package, with the React Native and
// Expo modules stubbed.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build, stop as stopEsbuild, transform } from "esbuild";
import { compileModule } from "svelte/compiler";
import { isRemoteModule, kitGlobalsImport, remoteHash, remoteResolution, transformRemoteModule } from "../src/remote/transform.ts";

export const fixtureRoot = resolve(import.meta.dirname, "fixtures/kit-app");

/** A running fixture server. `died()` says how it ended when it was not stopped on purpose; `assertAlive()` throws that. */
export type Server = { origin: string; pid: number | undefined; stop(): void; died(): string | undefined; assertAlive(): void };

/** The error of a server that did not start in time; `pid` is the process that was started (and has been killed). */
export class ServerStartTimeout extends Error {
  constructor(mode: string, readonly pid: number | undefined, output: string, ms: number) {
    super(`the fixture server (${mode}) did not start in ${ms} ms:\n${output}`);
    this.name = "ServerStartTimeout";
  }
}

const sleep = (ms: number) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

/**
 * One fixture server at a time across test runs: SvelteKit writes its generated files and Vite its dependency cache into the fixture's directory, which two
 * servers (two `bun test` runs at once, or a run and a person's) corrupt. The lock is a directory with the owner's pid; one whose owner is gone is taken over.
 * It is held until the server's process has ended. Returns what releases it.
 */
async function lockFixture(until: number): Promise<() => void> {
  const directory = resolve(fixtureRoot, ".run-lock");
  for (;;) {
    try {
      mkdirSync(directory);
      writeFileSync(join(directory, "pid"), String(process.pid));
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        rmSync(directory, { recursive: true, force: true });
      };
      process.once("exit", release);
      return release;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    let owner = 0;
    try { owner = Number(readFileSync(join(directory, "pid"), "utf8")); } catch { /* the owner is between mkdir and writing its pid */ }
    if (owner > 0 && owner !== process.pid && !alive(owner)) {
      rmSync(directory, { recursive: true, force: true });
      continue;
    }
    if (Date.now() > until) throw new Error(`another test run (pid ${owner || "unknown"}) holds the fixture server; waited until the start timeout`);
    await sleep(500);
  }
}

/**
 * Starts the fixture's SvelteKit server (`dev`: Vite's dev server; `preview`: a production build) and resolves once it listens and has answered a remote call
 * (Vite does the work of loading the hooks and the remote modules on the first request, 5 to 8 s of it on a busy machine: that is paid here, not by the first
 * test). A server that exits first is started once more (a busy machine); one that has not listened after `timeoutMs` is killed, not left running.
 *
 * Bun kills every child process of the test process when a test times out, the servers started by `beforeAll` included. A server that ends after it was
 * ready is therefore reported, with how it ended and the end of its output, by `died()` and `assertAlive()`: the tests that follow fail saying so.
 */
export async function startServer(mode: "dev" | "preview", { timeoutMs = 120_000 }: { timeoutMs?: number } = {}): Promise<Server> {
  try {
    return await startOnce(mode, timeoutMs);
  } catch (error) {
    if (!/exited with \d/.test(String(error))) throw error;
    return startOnce(mode, timeoutMs);
  }
}

/** Asks for a remote function of the fixture until the server answers it (the first request loads the hooks and the remote modules). */
async function warm(origin: string, until: number): Promise<void> {
  const url = `${origin}/_app/remote/${remoteHash(resolve(fixtureRoot, "src/lib/api.remote.ts"), fixtureRoot)}/buildInfo/`;
  let last = "no answer";
  while (Date.now() < until) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      await response.arrayBuffer();
      if (response.status === 200) return;
      last = `status ${response.status}`;
    } catch (error) {
      last = String(error);
    }
    await sleep(250);
  }
  throw new Error(`the fixture server listens but answered no remote call (${last})`);
}

async function startOnce(mode: "dev" | "preview", timeoutMs: number): Promise<Server> {
  // (The lock is the start's too: the time spent waiting for another run is not the server's.)
  const release = await lockFixture(Date.now() + timeoutMs);
  const child: ChildProcess = spawn("node", ["serve.ts", mode], { cwd: fixtureRoot, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: mode === "dev" ? "development" : "production" } });
  child.once("exit", release);
  const started = Date.now();
  let output = "";
  let stopping = false;
  let died: string | undefined;
  const origin = await new Promise<string>((resolveOrigin, reject) => {
    const timer = setTimeout(() => {
      // Nothing may be left behind by a test that could not start its server.
      stopping = true;
      child.kill("SIGKILL");
      reject(new ServerStartTimeout(mode, child.pid, output, timeoutMs));
    }, timeoutMs);
    const read = (chunk: Buffer) => {
      output += chunk.toString();
      const match = /READY (\S+)/.exec(output);
      if (match) { clearTimeout(timer); resolveOrigin(match[1]); }
    };
    child.stdout?.on("data", read);
    child.stderr?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      if (stopping) return;
      died = `the fixture server (${mode}) died (${signal ? `signal ${signal}` : `exit code ${code}`}); the end of its output:\n${output.slice(-1500)}`;
      reject(new Error(`the fixture server (${mode}) exited with ${signal ? `signal ${signal}` : code}:\n${output}`));
    });
  });
  const server: Server = {
    origin,
    pid: child.pid,
    stop: () => { stopping = true; child.kill("SIGTERM"); },
    died: () => died,
    assertAlive: () => { if (died) throw new Error(died); },
  };
  try {
    await warm(origin, started + timeoutMs);
  } catch (error) {
    server.stop();
    throw died ? new Error(`${died}\n(${String(error)})`) : error;
  }
  return server;
}

const stubs: Record<string, string> = {
  // (One set of handlers for every bundle that is loaded: `globalThis.__remoteAppState(state)` reaches the app of each of them.)
  "react-native/Libraries/AppState/AppState": "const handlers = (globalThis.__remoteAppStateHandlers ??= new Set()); globalThis.__remoteAppState ??= (state) => { for (const handler of [...globalThis.__remoteAppStateHandlers]) handler(state); }; export default { addEventListener(_type, handler) { handlers.add(handler); return { remove() { handlers.delete(handler); } }; } };",
  "react-native/Libraries/Linking/Linking": "export default { openURL: async (url) => { (globalThis.__opened ??= []).push(url); } };",
  "expo-constants": "export default { get expoConfig() { return globalThis.__expoConfig; } };",
};

const clientOf = (path: string) => path.includes("/node_modules/@sveltejs/kit/src/");

/**
 * Bundles `entry` (a module that imports `.remote.ts` modules and `src/remote/index.ts`) as Metro would see it: remote modules replaced by their
 * stubs, SvelteKit's client files given the globals of `kitGlobalsImport` and the shims of `remoteResolution`, `.svelte.js/.ts` compiled by Svelte.
 * `serverFile` says where the server has a remote module the bundle names by another path (the id is that of the server's file). `hermes` loads it in an
 * environment like React Native 0.86's Hermes, which has no `FinalizationRegistry`. Returns the loaded module.
 */
export async function loadClient(entry: string, root: string = fixtureRoot, serverFile: (file: string) => string = (file) => file, options: { hermes?: boolean } = {}): Promise<Record<string, any>> { // eslint-disable-line @typescript-eslint/no-explicit-any
  // esbuild's service is a child process of the tests, and Bun kills those when a test times out: the build after that finds no service. It is started
  // again once; any other failure is the build's.
  const run = async () => build({
    stdin: { contents: entry, resolveDir: import.meta.dirname, loader: "ts" },
    bundle: true, format: "esm", platform: "neutral", conditions: ["browser"], write: false, logLevel: "error",
    plugins: [{
      name: "remote-client",
      setup(builder) {
        builder.onResolve({ filter: /^svelte(\/|$)/ }, (args) => (args.pluginData === "inner" ? undefined : builder.resolve(args.path, { resolveDir: import.meta.dirname, kind: args.kind, pluginData: "inner" })));
        builder.onResolve({ filter: /^@alfayez\/svelte-native\/remote\/(runtime|globals)$/ }, (args) => ({ path: resolve(import.meta.dirname, `../src/remote/${args.path.split("/").pop()}.ts`) }));
        builder.onResolve({ filter: /^@alfayez\/svelte-native\/remote$/ }, () => ({ path: resolve(import.meta.dirname, "../src/remote/index.ts") }));
        builder.onResolve({ filter: /^esm-env$/ }, () => ({ path: resolve(import.meta.dirname, "../src/environment.ts") }));
        builder.onResolve({ filter: /^(react-native|expo-constants|expo\/fetch)/ }, (args) => ({ path: args.path, namespace: "stub" }));
        builder.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({ contents: stubs[args.path] ?? "export {};", loader: "js" }));
        builder.onResolve({ filter: /.*/ }, (args) => {
          const origin = args.importer || resolve(import.meta.dirname, "x.ts");
          const redirected = remoteResolution(args.path, origin);
          if (redirected !== undefined) return { path: redirected };
          return undefined;
        });
        builder.onLoad({ filter: /\.[cm]?[jt]s$/ }, async ({ path }) => {
          let source = await readFile(path, "utf8");
          if (isRemoteModule(path)) return { contents: transformRemoteModule(source, serverFile(path), root), loader: "js", resolveDir: dirname(path) };
          if (clientOf(path)) source += kitGlobalsImport(path) ?? "";
          if (/\.svelte\.[jt]s$/.test(path)) {
            if (path.endsWith(".ts")) source = (await transform(source, { loader: "ts" })).code;
            return { contents: compileModule(source, { filename: path }).js.code, loader: "js", resolveDir: dirname(path) };
          }
          return { contents: source, loader: path.endsWith(".ts") ? "ts" : "js", resolveDir: dirname(path) };
        });
      },
    }],
  });
  let bundle: Awaited<ReturnType<typeof run>>;
  try {
    bundle = await run();
  } catch (error) {
    if (!/service is no longer running/i.test(String(error))) throw error;
    await stopEsbuild();
    bundle = await run();
  }
  const directory = await mkdtemp(resolve(tmpdir(), "svelte-native-remote-"));
  const file = resolve(directory, "bundle.mjs");
  await writeFile(file, bundle.outputFiles[0].contents);
  const global = globalThis as { FinalizationRegistry?: unknown };
  const native = global.FinalizationRegistry;
  if (options.hermes) delete global.FinalizationRegistry;
  try {
    return await import(pathToFileURL(file).href);
  } finally {
    if (options.hermes) global.FinalizationRegistry = native;
    await rm(directory, { recursive: true });
  }
}

/** A fetch that keeps cookies, as the platform's cookie jar does for Expo's fetch, and records what it was asked. */
export function cookieFetch() {
  const jar = new Map<string, string>();
  const calls: { url: string; init: RequestInit }[] = [];
  const send = async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    const headers = new Headers(init.headers);
    if (jar.size > 0) headers.set("cookie", [...jar].map(([name, value]) => `${name}=${value}`).join("; "));
    const response = await fetch(url, { ...init, headers });
    for (const line of response.headers.getSetCookie()) {
      const [pair] = line.split(";");
      const [name, value] = pair.split("=");
      jar.set(name.trim(), value);
    }
    return response;
  };
  return { send: send as unknown as typeof fetch, calls, jar };
}
