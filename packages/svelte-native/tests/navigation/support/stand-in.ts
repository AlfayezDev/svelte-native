import { afterEach } from "bun:test";
import type { Plugin } from "esbuild";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { relative, resolve } from "node:path";
import { syncNative } from "../../../src/build.ts";
import { stubCoreSource, stubSource } from "../../../src/metro.ts";
import { src } from "../../support/bundle.ts";
import type { RouterBundleOptions } from "../../support/router.ts";
import { svgLibraryStubs } from "../../svg-library-stubs.ts";
import { type TreeRouter, type navigationWorld, handlersOf, standInRoutes } from "./world.ts";

/**
 * The stand-in app (`tests/fixtures/stand-in-app`) built and mounted the way a build runs it: the whole library bundled with the route table the Metro integration generates for
 * a variant, the lab's directories either real (a lab build) or replaced by the stub a store build has (`stubSource` over `stubCoreSource`: a Proxy that throws on any property read
 * and on a call), and the application id the host reports chosen per test. A lab call that is not behind the flag then fails the test instead of a phone.
 *
 * The stub throws on a READ of a binding as much as on a call, because Metro's transform reads a named import where it is used (`_probe.lateFault`, a property read on the stub), while
 * esbuild copies the exports of a CommonJS module into a namespace object when it is imported, and the stub has none to copy (`ownKeys` is empty): `lateFault === "mount"` was
 * `undefined === "mount"` here, and a read of a lab binding that was not behind the flag passed this test and crashed a root layout. So each import of a stubbed directory goes through
 * a module that names the bindings the importer imports from it (`ownKeys`), and esbuild's copy then reads them through the stub's `get` when they are used, which throws.
 */
export const appRoot = resolve(import.meta.dirname, "../../fixtures/stand-in-app");
export const appRoutes = standInRoutes;
const labDirectories = [`${resolve(appRoot, "src/lib/lab")}/`, `${resolve(appRoot, "src/routes/__dev")}/`];
/** The application ids the host can report (`expo-application`): the store build never runs the lab, the lab build may. */
export const storeApplication = "com.example.app";
export const labApplication = "com.example.lab";

/**
 * The names `importer` imports from `specifier` as bindings (`import { a, b as c } from`, `export { a } from`): the ones a bundler reads on the
 * module where they are used. A default import, a namespace import and a type-only import read no named binding. Reads the importer's source,
 * so a statement it cannot read is an error and not a binding the test would never check.
 */
export function importedNames(source: string, specifier: string, importer = "the importer"): string[] {
  const escaped = specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const names = new Set<string>();
  const statement = new RegExp(`\\b(?:import|export)\\s+(type\\s+)?([^;'"]*?)\\bfrom\\s*(["'])${escaped}\\3`, "g");
  let found = 0;
  for (const match of source.matchAll(statement)) {
    found++;
    if (match[1] !== undefined) continue;
    const braces = /\{([^}]*)\}/.exec(match[2] ?? "");
    for (const entry of (braces?.[1] ?? "").replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "").split(",")) {
      const name = entry.trim().split(/\s+as\s+/)[0]?.trim() ?? "";
      if (name === "" || /^type\s/.test(name)) continue;
      if (!/^[A-Za-z_$][\w$]*$/.test(name)) throw new Error(`cannot read the binding ${JSON.stringify(name)} that ${importer} imports from ${specifier}`);
      names.add(name);
    }
  }
  // A mention that is no import statement we read (a dynamic import, a side-effect import) reads no named binding, as Metro's interop does.
  if (found === 0 && new RegExp(`\\bfrom\\s*["']${escaped}["']`).test(source)) throw new Error(`cannot read how ${importer} imports ${specifier}`);
  return [...names];
}

/**
 * The bundle options of the stand-in app for `variant`, for `load`. With `lab` the lab is the real one (a lab build); without it the lab's directories are the stubs a store build has,
 * whatever the variant's route table says. The bundle is built once per (variant, lab) for the run: the project the table is generated in exists only while it is built.
 */
export function standInBundle(variant: string, { lab = false }: { lab?: boolean } = {}): RouterBundleOptions {
  const plugin: Plugin = {
    name: "stand-in-app",
    async setup(builder) {
      const directory = await mkdtemp(resolve(tmpdir(), "svelte-native-stand-in-app-"));
      builder.onDispose(() => { void rm(directory, { recursive: true, force: true }); });
      // A project whose `src` is the app's, so the generated table requires the real pages.
      await symlink(resolve(appRoot, "src"), resolve(directory, "src"));
      await syncNative(directory, { variant });
      const table = resolve(directory, ".svelte-native", `routes.${variant}.ts`);
      await mkdir(resolve(directory, "stubs"), { recursive: true });
      await writeFile(resolve(directory, "stubs/_core.js"), stubCoreSource);
      // One stub per stubbed directory, as `withSvelteNative` writes them: its name is the directory relative to the project, and the stub reads `./_core.js` next to it.
      const stubFiles = new Map<string, string>();
      for (const labDirectory of labDirectories) {
        const name = `${relative(appRoot, labDirectory)}/`.replaceAll("\\", "/");
        const file = resolve(directory, "stubs", `${name.replace(/[^A-Za-z0-9_.-]/g, "_")}.js`);
        await writeFile(file, stubSource(name, variant));
        stubFiles.set(labDirectory, file);
      }
      builder.onResolve({ filter: /^@alfayez\/svelte-native$/ }, () => ({ path: src("index.ts") }));
      builder.onResolve({ filter: /^@alfayez\/svelte-native\/routes$/ }, () => ({ path: table }));
      builder.onResolve({ filter: /^expo-application$/ }, (args) => ({ path: args.path, namespace: "stand-in-host" }));
      builder.onLoad({ filter: /.*/, namespace: "stand-in-host" }, () => ({ contents: "export const applicationId = globalThis.__standInApplicationId;", loader: "js" }));
      // The stub of a store build, byte for byte, behind a Proxy that lists the bindings this importer names, so that esbuild's namespace copy
      // reads each one through the stub's `get` (which throws) where it is used, as Metro's `_stub.name` does. Everything else is the stub's:
      // a read of any other property, a call and a construction throw, `has` and `getOwnPropertyDescriptor` answer nothing.
      builder.onLoad({ filter: /.*/, namespace: "lab-stub" }, (args) => {
        const { stub, names } = args.pluginData as { stub: string; names: string[] };
        return { contents: `const stub = require(${JSON.stringify(stub)});\nmodule.exports = new Proxy(stub, { ownKeys: () => ${JSON.stringify(names)} });\n`, resolveDir: directory, loader: "js" };
      });
      builder.onResolve({ filter: /^[.#]/ }, async (args) => {
        if (args.pluginData?.standIn || lab) return undefined;
        const found = await builder.resolve(args.path, { resolveDir: args.resolveDir, importer: args.importer, kind: args.kind, namespace: args.namespace, pluginData: { standIn: true } });
        if (found.errors.length > 0) return undefined;
        const labDirectory = labDirectories.find((candidate) => found.path.startsWith(candidate));
        if (labDirectory === undefined) return undefined;
        const names = importedNames(await readFile(args.importer, "utf8"), args.path, args.importer);
        return { path: `${args.importer} > ${args.path}`, namespace: "lab-stub", pluginData: { stub: stubFiles.get(labDirectory), names } };
      });
    },
  };
  return { plugins: [plugin], cacheKey: `stand-in-app:${variant}:${lab}`, stubs: svgLibraryStubs };
}

const standIn = globalThis as { __standInApplicationId?: string; __standInRouter?: TreeRouter; __standInSignedOut?: boolean; __standInSessions?: number; __standInStart?: () => Promise<void> };
export type StandInOptions = { variant: string; applicationId: string; initial: string; signedOut?: boolean; lab?: boolean; start?: () => Promise<void>; navigation?: string };

/** What went wrong in an app that should be fine: a stub that threw, a call to a lab export that is not there, the shell's failure page. */
export const trouble = (texts: string[], errors: string[]): string[] => [...texts, ...errors].filter((line) => /not in this app|is not a function|is not a constructor|went wrong/i.test(line));
export const neverAnswers = (): Promise<void> => new Promise<void>(() => {});
/** A link that reaches the running app, as the system's link event does. */
export const sendLink = (url: string): void => { for (const handler of handlersOf("__linkHandlers")) (handler as (event: { url: string }) => void)({ url }); };

/** The stand-in app's loaders for a test file that called `navigationWorld()` (the fake host it mounts on). Call it at the top level of the file. */
export function standInWorld({ mountTree }: Pick<ReturnType<typeof navigationWorld>, "mountTree">) {
  const closers: (() => void)[] = [];
  // What an app that is still mounted at the end of a test put on the console goes back with the test.
  afterEach(() => { while (closers.length > 0) closers.pop()?.(); });

  /**
   * Mounts the stand-in app's root layout on `Root` with the generated table of `variant`. `start` is what the session waits for before it opens
   * (the backend of a real app); `starts()` counts the times the app asked, `sessions()` the times a session was opened. What the app logged is
   * collected in `errors` and `warnings`; `close()` gives the console back.
   */
  async function mountStandIn(surface: number, options: StandInOptions) {
    let starts = 0;
    standIn.__standInApplicationId = options.applicationId;
    standIn.__standInStart = () => { starts++; return (options.start ?? (async () => {}))(); };
    // An app mounted earlier in the same test leaves nothing for this one.
    if (options.signedOut) standIn.__standInSignedOut = true; else delete standIn.__standInSignedOut;
    delete standIn.__standInRouter;
    standIn.__standInSessions = 0;
    const errors: string[] = [];
    const warnings: string[] = [];
    const logged = { error: console.error, warn: console.warn };
    console.error = (...args: unknown[]) => { errors.push(args.map(String).join(" ")); };
    console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(" ")); };
    const close = () => { console.error = logged.error; console.warn = logged.warn; };
    closers.push(close);
    try {
      const mounted = await mountTree(surface, { initial: options.initial, navigation: options.navigation }, resolve(import.meta.dirname, "../fixtures/stand-in-fixture.svelte"), standInBundle(options.variant, { lab: options.lab }));
      await mounted.settled();
      await mounted.settled();
      return { ...mounted, errors, warnings, starts: () => starts, sessions: () => standIn.__standInSessions ?? 0, router: standIn.__standInRouter as TreeRouter, close };
    } catch (error) {
      close();
      throw error;
    }
  }

  const labStart = (surface: number, options: Partial<StandInOptions> = {}) => mountStandIn(surface, { variant: "qa", applicationId: labApplication, initial: "/sign-in", lab: true, ...options });
  return { mountStandIn, labStart };
}
