import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import type { parse as parseSvelte } from "svelte/compiler";

const require = createRequire(import.meta.url);
const posix = (path: string) => path.split(sep).join("/");

/**
 * A page's `presentation` (`"push"` unless its module script exports `const presentation` as one of the five screen presentations). The route
 * table carries it so a screen's container is built before the page's modules load, which makes it a literal read here.
 */
const PRESENTATIONS = new Set(["push", "modal", "transparentModal", "sheet", "formSheet"]);
type RoutePresentation = "push" | "modal" | "transparentModal" | "sheet" | "formSheet";

function presentationOf(parse: typeof parseSvelte, file: string, source: string): RoutePresentation {
  const { module } = parse(source, { modern: true, filename: file });
  for (const statement of module?.content.body ?? []) {
    if (statement.type !== "ExportNamedDeclaration") continue;
    const declarations = statement.declaration?.type === "VariableDeclaration" ? statement.declaration.declarations : [];
    const declared = declarations.find((declaration) => declaration.id.type === "Identifier" && declaration.id.name === "presentation");
    const init = declared?.init;
    if (init?.type === "Literal" && typeof init.value === "string" && PRESENTATIONS.has(init.value)) return init.value as RoutePresentation;
    const aliased = statement.specifiers.some((specifier) => specifier.exported.type === "Identifier" && specifier.exported.name === "presentation");
    if (declared || aliased) throw new Error(`${file}: export \`presentation\` as one of the literals "push", "modal", "transparentModal", "sheet", "formSheet"; the route table reads it at build time`);
  }
  return "push";
}

export async function syncNative(root: string): Promise<void> {
  const routesRoot = resolve(root, "src/routes");
  const files: string[] = [];
  async function walk(directory: string) {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, item.name);
      if (item.isDirectory()) await walk(path);
      else files.push(path);
    }
  }
  await walk(routesRoot);
  const pages = files.filter((file) => file.endsWith("/+mobile.svelte")).sort((a, b) => {
    const score = (path: string) => posix(relative(routesRoot, path)).split("/").filter((part) => !part.startsWith("(")).reduce((sum, part) => sum + (part.startsWith("[") ? 0 : 1), 0);
    return score(b) - score(a) || a.localeCompare(b);
  });
  const output = resolve(root, ".svelte-native");
  await mkdir(output, { recursive: true });
  // The compiler is large; every Expo command that reads the app's config loads this module, so it is imported only here.
  const { parse } = await import("svelte/compiler");
  const routeRows: string[] = [];
  for (const file of pages) {
    const id = posix(relative(routesRoot, dirname(file)));
    const path = `/${id.split("/").filter((part) => !part.startsWith("(")).join("/")}`;
    const ancestors = id.split("/");
    const modules = [file];
    for (let depth = 1; depth <= ancestors.length; depth++) {
      const layout = resolve(routesRoot, ...ancestors.slice(0, depth), "+layout.mobile.svelte");
      if (files.includes(layout)) modules.push(layout);
    }
    const [page, ...layouts] = modules.map((target) => `require(${JSON.stringify(posix(relative(output, target)))}).default`);
    const presentation = presentationOf(parse, file, await readFile(file, "utf8"));
    routeRows.push(`  {
    id: ${JSON.stringify(id)}, path: ${JSON.stringify(path)}, presentation: ${JSON.stringify(presentation)},
    load: async () => ({ component: ${page}, layouts: [${layouts.join(", ")}] }),
  }`);
  }
  // Each route is a loader whose `require`s run when it is called, so a screen's modules (and whatever they import) evaluate when the
  // screen is first needed, not at boot. A `require` rather than `import()` keeps the page in the entry's module graph, which is
  // what lets a hot update of a page reach the entry's accept handler; `import()` would make Metro's development server serve it as a
  // separate bundle with no importer to accept the update. Metro's release export has a single bundle either way.
  const manifest = `import type { NativeRoute } from '@rasheed/svelte-native/router';\n\nexport const routes: NativeRoute[] = [\n${routeRows.join(",\n")}\n];\n`;
  // The entry boots the app layout with the generated routes; SVELTE_NATIVE_ROOT=<path> renders that component as the root
  // instead (the lab's spike roots).
  const customRoot = process.env.SVELTE_NATIVE_ROOT;
  const prelude = "import '@rasheed/svelte-native/init';\nimport '@rasheed/svelte-native/polyfills';\nimport { createFabricApp, remountSurfaces } from '@rasheed/svelte-native/fabric';\n";
  // In development the entry accepts every hot update itself (see `fabric/hmr.ts`): Metro re-runs the edited module and its importers up to
  // here, which re-registers the app, and the handler remounts the running surfaces.
  const hot = "declare const module: { hot?: { accept(callback?: () => void): void } };\nif (__DEV__) module.hot?.accept(() => remountSurfaces());\n";
  const entry = customRoot
    ? `${prelude}import App from ${JSON.stringify(posix(relative(output, resolve(root, customRoot))))};\ncreateFabricApp(App, {});\n${hot}`
    : `${prelude}import App from '../src/routes/+layout.mobile.svelte';\nimport { routes } from './routes';\ncreateFabricApp(App, { routes });\n${hot}`;
  for (const [file, content] of [["routes.ts", manifest], ["entry.ts", entry]]) {
    const destination = resolve(output, file);
    const current = await readFile(destination, "utf8").catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return ""; throw error; });
    if (current !== content) await writeFile(destination, content);
  }
}

export function runExpo(root: string, args: string[]) {
  const env: NodeJS.ProcessEnv = { ...process.env, EXPO_NO_TELEMETRY: "1" };
  // adb reverse connects over IPv4; Node may otherwise bind localhost to ::1.
  if (args.includes("--localhost")) env.NODE_OPTIONS = `${env.NODE_OPTIONS ?? ""} --dns-result-order=ipv4first`.trim();
  return spawn(process.execPath, [require.resolve("expo/bin/cli"), ...args], {
    cwd: root,
    stdio: "inherit",
    env,
  });
}

export async function exportNative(root: string, platform: "android" | "ios"): Promise<void> {
  await syncNative(root);
  const output = resolve(root, ".svelte-native/dist", platform);
  await mkdir(output, { recursive: true });
  const child = runExpo(root, ["export:embed", "--platform", platform,
    "--entry-file", ".svelte-native/entry.ts", "--bundle-output", resolve(output, "index.hbc"),
    "--sourcemap-output", resolve(output, "index.hbc.map"), "--assets-dest", resolve(output, "assets"),
    "--dev", "false", "--bytecode", "--reset-cache"]);
  const result = await new Promise<number | null>((done, reject) => { child.once("error", reject); child.once("exit", done); });
  if (result !== 0) throw new Error(`Native ${platform} export exited with ${result}`);
}
