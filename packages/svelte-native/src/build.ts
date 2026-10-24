import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";

const require = createRequire(import.meta.url);
const posix = (path: string) => path.split(sep).join("/");

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
  const imported: string[] = [];
  const routeRows: string[] = [];
  for (const [index, file] of pages.entries()) {
    const id = posix(relative(routesRoot, dirname(file)));
    const path = `/${id.split("/").filter((part) => !part.startsWith("(")).join("/")}`;
    imported.push(`import * as page${index} from ${JSON.stringify(posix(relative(output, file)))};`);
    const ancestors = id.split("/");
    const layouts: string[] = [];
    for (let depth = 1; depth <= ancestors.length; depth++) {
      const layout = resolve(routesRoot, ...ancestors.slice(0, depth), "+layout.mobile.svelte");
      if (files.includes(layout)) {
        const name = `layout${index}_${depth}`;
        imported.push(`import ${name} from ${JSON.stringify(posix(relative(output, layout)))};`);
        layouts.push(name);
      }
    }
    routeRows.push(`{ id: ${JSON.stringify(id)}, path: ${JSON.stringify(path)}, component: page${index}.default, layouts: [${layouts}], presentation: 'presentation' in page${index} && page${index}.presentation === 'modal' ? 'modal' : 'push' }`);
  }
  const manifest = `${imported.join("\n")}\nimport type { NativeRoute } from '@rasheed/svelte-native/router';\nexport const routes: NativeRoute[] = [\n${routeRows.join(",\n")}\n];\n`;
  const entry = `import '@rasheed/svelte-native/polyfills';\nimport { registerRootComponent } from 'expo';\nimport { createNativeApp } from '@rasheed/svelte-native/host';\nimport App from '../src/routes/+layout.mobile.svelte';\nimport { routes } from './routes';\nregisterRootComponent(createNativeApp(App, { routes }));\n`;
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
