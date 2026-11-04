// biome-ignore-all lint/suspicious/noExplicitAny: the client is a bundle loaded at run time and its remote functions are not typed
// What the remote function tests share: the fixture's SvelteKit server in its own process, and the native client runtime (what Metro builds from
// `src/remote`, SvelteKit's client files and a `*.remote.ts` module's stubs) bundled the way the other tests bundle the package, with the React Native and
// Expo modules stubbed.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build, transform } from "esbuild";
import { compileModule } from "svelte/compiler";
import { isRemoteModule, kitGlobalsImport, remoteResolution, transformRemoteModule } from "../src/remote/transform.ts";

export const fixtureRoot = resolve(import.meta.dirname, "fixtures/kit-app");

export type Server = { origin: string; stop(): void };

/** Starts the fixture's SvelteKit server (`dev`: Vite's dev server; `preview`: a production build) and resolves once it listens. */
export async function startServer(mode: "dev" | "preview"): Promise<Server> {
  const child: ChildProcess = spawn("node", ["serve.ts", mode], { cwd: fixtureRoot, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: mode === "dev" ? "development" : "production" } });
  let output = "";
  const origin = await new Promise<string>((resolveOrigin, reject) => {
    const timer = setTimeout(() => reject(new Error(`the fixture server (${mode}) did not start in 120 s:\n${output}`)), 120_000);
    const read = (chunk: Buffer) => {
      output += chunk.toString();
      const match = /READY (\S+)/.exec(output);
      if (match) { clearTimeout(timer); resolveOrigin(match[1]); }
    };
    child.stdout?.on("data", read);
    child.stderr?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`the fixture server (${mode}) exited with ${code}:\n${output}`)); });
  });
  return { origin, stop: () => { child.kill("SIGTERM"); } };
}

const stubs: Record<string, string> = {
  "react-native/Libraries/AppState/AppState": "const handlers = new Set(); export default { addEventListener(_type, handler) { handlers.add(handler); return { remove() { handlers.delete(handler); } }; } }; globalThis.__appState = (state) => { for (const handler of [...handlers]) handler(state); };",
  "react-native/Libraries/Linking/Linking": "export default { openURL: async (url) => { (globalThis.__opened ??= []).push(url); } };",
  "expo-constants": "export default { get expoConfig() { return globalThis.__expoConfig; } };",
  "expo/fetch": "export const fetch = (...args) => globalThis.__transport ? globalThis.__transport(...args) : globalThis.fetch(...args);",
};

const clientOf = (path: string) => path.includes("/node_modules/@sveltejs/kit/src/");

/**
 * Bundles `entry` (a module that imports `.remote.ts` modules and `src/remote/index.ts`) as Metro would see it: remote modules replaced by their
 * stubs, SvelteKit's client files given the globals of `kitGlobalsImport` and the shims of `remoteResolution`, `.svelte.js/.ts` compiled by Svelte.
 * `serverFile` says where the server has a remote module the bundle names by another path (the id is that of the server's file). Returns the loaded module.
 */
export async function loadClient(entry: string, root: string = fixtureRoot, serverFile: (file: string) => string = (file) => file): Promise<Record<string, any>> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const bundle = await build({
    stdin: { contents: entry, resolveDir: import.meta.dirname, loader: "ts" },
    bundle: true, format: "esm", platform: "neutral", conditions: ["browser"], write: false, logLevel: "error",
    plugins: [{
      name: "remote-client",
      setup(builder) {
        builder.onResolve({ filter: /^svelte(\/|$)/ }, (args) => (args.pluginData === "inner" ? undefined : builder.resolve(args.path, { resolveDir: import.meta.dirname, kind: args.kind, pluginData: "inner" })));
        builder.onResolve({ filter: /^@rasheed\/svelte-native\/remote\/(runtime|globals)$/ }, (args) => ({ path: resolve(import.meta.dirname, `../src/remote/${args.path.split("/").pop()}.ts`) }));
        builder.onResolve({ filter: /^@rasheed\/svelte-native\/remote$/ }, () => ({ path: resolve(import.meta.dirname, "../src/remote/index.ts") }));
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
  const directory = await mkdtemp(resolve(tmpdir(), "svelte-native-remote-"));
  const file = resolve(directory, "bundle.mjs");
  await writeFile(file, bundle.outputFiles[0].contents);
  try {
    return await import(pathToFileURL(file).href);
  } finally {
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
