import { afterEach, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { satisfies } from "../src/doctor/semver.ts";
import { patchFiles } from "../src/doctor/patches.ts";
import { appDependencies, appNames, mergeWorkspaceYaml, parseInitArguments, planInit, runInit, svelteNativeViteConfig } from "../src/init-app.ts";
import { requiredSvelte } from "../src/svelte-build.ts";

// `svelte-native init`: what it does to a project `npx sv create` made (tests/fixtures/sv-minimal is what sv 1.3.0 writes for the minimal template with
// TypeScript, no add-ons and pnpm), and that running it again changes nothing.
const fixture = join(import.meta.dirname, "fixtures/sv-minimal");
const repository = join(import.meta.dirname, "../../..");
const library = "git+ssh://git@github.com/AlfayezDev/svelte-native.git#v0.3.0&path:packages/svelte-native";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

/** A copy of the sv project with the library added to its dependencies, which is what `pnpm add` does before `init`. */
function project(adjust?: (root: string) => void): string {
  const root = mkdtempSync(join(tmpdir(), "svelte-native-init-"));
  directories.push(root);
  cpSync(fixture, root, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { dependencies?: Record<string, string> };
  manifest.dependencies = { "@rasheed/svelte-native": library };
  writeFileSync(join(root, "package.json"), `${JSON.stringify(manifest, null, "\t")}\n`);
  adjust?.(root);
  return root;
}

function run(root: string, args: string[] = []) {
  const out: string[] = [];
  const err: string[] = [];
  const status = runInit(root, ["--no-install", ...args], { out: (text) => out.push(text), err: (text) => err.push(text) });
  return { status, out: out.join("\n"), err: err.join("\n") };
}

/** Every file under a directory, with its content: what "nothing changed" compares. */
function snapshot(root: string): Record<string, string> {
  const files: Record<string, string> = {};
  for (const file of readdirSync(root, { recursive: true, encoding: "utf8" })) {
    if (file.includes("node_modules")) continue;
    const path = join(root, file);
    try {
      files[file] = readFileSync(path, "utf8");
    } catch {
      // a directory
    }
  }
  return files;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- parsed JSON of a project's files, read by path in the assertions */
// biome-ignore lint/suspicious/noExplicitAny: the same
type Json = Record<string, any>;
const readJson = (root: string, file: string): Json => JSON.parse(readFileSync(join(root, file), "utf8")) as Json;

describe("init in a fresh sv project", () => {
  test("adds what the library needs to package.json, keeping the project's own entries and its formatting", () => {
    const root = project();
    const before = readFileSync(join(root, "package.json"), "utf8");
    const result = run(root);
    expect(result.status).toBe(0);
    const text = readFileSync(join(root, "package.json"), "utf8");
    expect(text.startsWith("{\n\t\"name\": \"my-app\"")).toBe(true);
    expect(text.endsWith("}\n")).toBe(true);
    expect(before).toContain('"dev": "vite dev"');
    const manifest = readJson(root, "package.json");
    expect(manifest.main).toBe(".svelte-native/entry.ts");
    expect(manifest.devDependencies.svelte).toBe(requiredSvelte.preview);
    expect(manifest.dependencies["@rasheed/svelte-native"]).toBe(library);
    for (const [name, version] of Object.entries(appDependencies)) expect(manifest.dependencies[name], name).toBe(version);
    // The SvelteKit sv installed is pinned to a version the library has a patch for, exactly.
    const kitVersions = patchFiles().filter((patch) => patch.package === "@sveltejs/kit").map((patch) => patch.version);
    expect(kitVersions).toContain(manifest.devDependencies["@sveltejs/kit"]);
    // The web scripts are the project's; the native ones are new and do not clash with them or with pnpm's own commands.
    expect(manifest.scripts.dev).toBe("vite dev");
    expect(manifest.scripts.build).toBe("vite build");
    expect(manifest.scripts).toMatchObject({ native: "svelte-native dev", android: "svelte-native android", ios: "svelte-native ios", "check-setup": "svelte-native doctor" });
    expect(manifest.reanimated).toEqual({ staticFeatureFlags: { ANDROID_SYNCHRONOUSLY_UPDATE_UI_PROPS: true } });
    // A sorted dependency list stays sorted.
    const names = Object.keys(manifest.dependencies);
    expect(names).toEqual([...names].sort());
  });

  test("declares pnpm's settings and the patches, copies the patch files and keeps what sv wrote", () => {
    const root = project();
    run(root);
    const yaml = readFileSync(join(root, "pnpm-workspace.yaml"), "utf8");
    expect(yaml.startsWith("engineStrict: true\nallowBuilds:\n  esbuild: true\n")).toBe(true);
    expect(yaml).toContain("overrides:\n  expo-modules-core: 57.0.23\n");
    const declared = [...yaml.matchAll(/^ {2}"?([^\s":]+(?:@[^\s":]+)*)"?: (patches\/svelte-native\/\S+)$/gm)].map((match) => match[2] as string);
    expect(declared.length).toBeGreaterThanOrEqual(5);
    for (const path of declared) expect(existsSync(join(root, path)), path).toBe(true);
    // The library's four always-needed patches and SvelteKit's, and none of the optional view libraries'.
    expect(declared.map((path) => path.replace("patches/svelte-native/", "").replace(/@[^@]+\.patch$/, "")).sort()).toEqual(
      ["@sveltejs__kit", "expo-modules-core", "react-native-gesture-handler", "react-native-reanimated", "react-native-worklets"].sort(),
    );
    expect(yaml).not.toContain("lottie-react-native");
    // Each patch file is the library's own, byte for byte.
    for (const patch of patchFiles().filter((entry) => declared.some((path) => path.endsWith(entry.file)))) {
      expect(readFileSync(join(root, "patches/svelte-native", patch.file)).equals(readFileSync(patch.path))).toBe(true);
    }
  });

  test("writes metro.config.cjs, app.json named after the project, the Vite plugin, the first routes and the .gitignore entries", () => {
    const root = project();
    run(root);
    expect(readFileSync(join(root, "metro.config.cjs"), "utf8")).toContain("withSvelteNative(getDefaultConfig(__dirname))");
    const app = readJson(root, "app.json").expo;
    expect(app).toMatchObject({ name: "my-app", slug: "my-app", scheme: "my-app", android: { package: "dev.example.myapp" }, ios: { bundleIdentifier: "dev.example.myapp" }, plugins: ["@rasheed/svelte-native/expo"] });
    const vite = readFileSync(join(root, "vite.config.ts"), "utf8");
    expect(vite).toContain("import { svelteNative } from '@rasheed/svelte-native/vite';");
    expect(vite).toContain("defineConfig(({ mode }) => ({");
    expect(vite).toContain("svelteNative({");
    expect(vite).toContain("target: mode === 'native' ? 'native' : 'web',");
    expect(vite).not.toContain("sveltekit(");
    expect(vite).toContain("adapter: adapter()");
    for (const file of ["src/routes/+layout.mobile.svelte", "src/routes/+mobile.svelte", "src/routes/details/+mobile.svelte"]) expect(existsSync(join(root, file)), file).toBe(true);
    // The web routes are untouched.
    expect(readFileSync(join(root, "src/routes/+page.svelte"), "utf8")).toBe(readFileSync(join(fixture, "src/routes/+page.svelte"), "utf8"));
    const ignore = readFileSync(join(root, ".gitignore"), "utf8");
    for (const line of [".svelte-native", ".expo", "/android", "/ios"]) expect(ignore.split("\n")).toContain(line);
    expect(ignore.startsWith(readFileSync(join(fixture, ".gitignore"), "utf8"))).toBe(true);
  });

  test("a second run changes nothing and says so", () => {
    const root = project();
    expect(run(root).status).toBe(0);
    const first = snapshot(root);
    const second = run(root);
    expect(second.status).toBe(0);
    expect(second.out).toContain("Nothing to change");
    expect(snapshot(root)).toEqual(first);
    expect(planInit(root).changes.filter((change) => change.action === "create" || change.action === "edit")).toEqual([]);
  });

  test("--dry-run prints the plan and writes nothing", () => {
    const root = project();
    const before = snapshot(root);
    const result = run(root, ["--dry-run"]);
    expect(result.status).toBe(0);
    expect(result.out).toContain("(dry run)");
    expect(result.out).toContain("package.json");
    expect(result.out).toContain("Nothing was written");
    expect(snapshot(root)).toEqual(before);
  });

  test("--name and the identifier flags override what the package name gives", () => {
    const root = project();
    run(root, ["--name", "My Great App", "--android-package", "com.acme.great", "--ios-bundle-id", "com.acme.great.ios"]);
    expect(readJson(root, "app.json").expo).toMatchObject({ name: "My Great App", slug: "my-app", android: { package: "com.acme.great" }, ios: { bundleIdentifier: "com.acme.great.ios" } });
    expect(parseInitArguments(["--name"])).toContain("--name needs a value");
    expect(parseInitArguments(["--bogus"])).toContain("Unknown option --bogus");
    expect(parseInitArguments(["--dry-run", "--no-install"])).toEqual({ dryRun: true, install: false });
  });
});

describe("init in a project that already has things", () => {
  test("never replaces a file it would write differently: it is left alone and the change is printed", () => {
    const root = project((dir) => {
      writeFileSync(join(dir, "metro.config.cjs"), "module.exports = require('expo/metro-config').getDefaultConfig(__dirname);\n");
      mkdirSync(join(dir, "src/routes"), { recursive: true });
      writeFileSync(join(dir, "src/routes/+mobile.svelte"), "<p>mine</p>\n");
    });
    const result = run(root);
    expect(result.status).toBe(1);
    expect(readFileSync(join(root, "metro.config.cjs"), "utf8")).toContain("require('expo/metro-config')");
    expect(result.out).toContain("withSvelteNative");
    expect(result.out).toContain("YOU");
    expect(readFileSync(join(root, "src/routes/+mobile.svelte"), "utf8")).toBe("<p>mine</p>\n");
    expect(existsSync(join(root, "src/routes/details/+mobile.svelte"))).toBe(false);
    expect(existsSync(join(root, "src/routes/+layout.mobile.svelte"))).toBe(true);
  });

  test("keeps a script or a main of the project's own and says so; --force replaces the main", () => {
    const edit = (dir: string) => {
      const manifest = readJson(dir, "package.json");
      manifest.scripts.native = "echo mine";
      manifest.main = "index.js";
      writeFileSync(join(dir, "package.json"), `${JSON.stringify(manifest, null, "\t")}\n`);
    };
    const root = project(edit);
    const result = run(root);
    expect(readJson(root, "package.json").scripts.native).toBe("echo mine");
    expect(readJson(root, "package.json").main).toBe("index.js");
    expect(result.out).toContain('the script "native" is "echo mine"');
    expect(result.out).toContain('"main" is "index.js"');
    const forced = project(edit);
    run(forced, ["--force"]);
    expect(readJson(forced, "package.json").main).toBe(".svelte-native/entry.ts");
    expect(readJson(forced, "package.json").scripts.native).toBe("echo mine");
  });

  test("adds the plugin to an app.json that has other settings and keeps them", () => {
    const root = project((dir) => writeFileSync(join(dir, "app.json"), `${JSON.stringify({ expo: { name: "Mine", slug: "mine", icon: "./icon.png", plugins: ["expo-font"] } }, null, 2)}\n`));
    run(root);
    const app = readJson(root, "app.json").expo;
    expect(app).toMatchObject({ name: "Mine", slug: "mine", icon: "./icon.png", plugins: ["expo-font", "@rasheed/svelte-native/expo"] });
    expect(app.android.package).toBe("dev.example.myapp");
    expect(readFileSync(join(root, "app.json"), "utf8").startsWith('{\n  "expo"')).toBe(true);
    expect(run(root).out).toContain("Nothing to change");
  });

  test("an app configured in code gets instructions, and nothing is written for it", () => {
    const root = project((dir) => writeFileSync(join(dir, "app.config.ts"), "export default {};\n"));
    const result = run(root);
    expect(existsSync(join(root, "app.json"))).toBe(false);
    expect(result.out).toContain("app.config.ts");
    expect(result.out).toContain('plugins: ["@rasheed/svelte-native/expo"]');
  });

  test("a different version of SvelteKit that has no patch is pinned to the newest one that has; an installed one that has a patch is kept", () => {
    const kitPatches = patchFiles().filter((patch) => patch.package === "@sveltejs/kit");
    const root = project((dir) => {
      mkdirSync(join(dir, "node_modules/@sveltejs/kit"), { recursive: true });
      writeFileSync(join(dir, "node_modules/@sveltejs/kit/package.json"), JSON.stringify({ name: "@sveltejs/kit", version: "9.9.9" }));
    });
    run(root);
    expect(kitPatches.map((patch) => patch.version)).toContain(readJson(root, "package.json").devDependencies["@sveltejs/kit"]);
    for (const patch of kitPatches) {
      const kept = project((dir) => {
        mkdirSync(join(dir, "node_modules/@sveltejs/kit"), { recursive: true });
        writeFileSync(join(dir, "node_modules/@sveltejs/kit/package.json"), JSON.stringify({ name: "@sveltejs/kit", version: patch.version }));
      });
      run(kept);
      expect(readJson(kept, "package.json").devDependencies["@sveltejs/kit"]).toBe(patch.version);
      expect(readFileSync(join(kept, "pnpm-workspace.yaml"), "utf8")).toContain(`@sveltejs/kit@${patch.version}`);
    }
  });

  test("a view library listed at the patch's version gets its patch; at another version it is a warning and nothing is declared", () => {
    const lottie = patchFiles().find((patch) => patch.package === "lottie-react-native");
    expect(lottie).toBeDefined();
    const root = project((dir) => {
      const manifest = readJson(dir, "package.json");
      manifest.dependencies["lottie-react-native"] = lottie?.version;
      manifest.dependencies["react-native-maps"] = "1.0.0";
      writeFileSync(join(dir, "package.json"), `${JSON.stringify(manifest, null, "\t")}\n`);
    });
    const result = run(root);
    const yaml = readFileSync(join(root, "pnpm-workspace.yaml"), "utf8");
    expect(yaml).toContain(`lottie-react-native@${lottie?.version}`);
    expect(yaml).not.toContain("react-native-maps");
    expect(result.out).toContain("react-native-maps: package.json asks for 1.0.0");
  });

  test("a project on another package manager than pnpm is refused before anything is written", () => {
    const root = project((dir) => {
      rmSync(join(dir, "pnpm-workspace.yaml"));
      writeFileSync(join(dir, "package-lock.json"), "{}");
    });
    const before = snapshot(root);
    const result = run(root);
    expect(result.status).toBe(1);
    expect(result.err).toContain("another package manager than pnpm");
    expect(snapshot(root)).toEqual(before);
    const empty = mkdtempSync(join(tmpdir(), "svelte-native-init-empty-"));
    directories.push(empty);
    expect(run(empty).err).toContain("has no package.json");
  });

  test("a native-only project (no SvelteKit) gets no Vite config, no SvelteKit pin and no SvelteKit patch", () => {
    const root = project((dir) => {
      rmSync(join(dir, "vite.config.ts"));
      const manifest = readJson(dir, "package.json");
      delete manifest.devDependencies["@sveltejs/kit"];
      writeFileSync(join(dir, "package.json"), `${JSON.stringify(manifest, null, "\t")}\n`);
    });
    const result = run(root);
    expect(result.status).toBe(0);
    expect(existsSync(join(root, "vite.config.ts"))).toBe(false);
    expect(readJson(root, "package.json").devDependencies["@sveltejs/kit"]).toBeUndefined();
    expect(readFileSync(join(root, "pnpm-workspace.yaml"), "utf8")).not.toContain("sveltejs/kit");
  });
});

describe("the edit of pnpm-workspace.yaml", () => {
  const wanted = { allowBuilds: { esbuild: "true" }, overrides: { "expo-modules-core": "57.0.23" }, patchedDependencies: { "@sveltejs/kit@3.1.1": "patches/svelte-native/kit.patch", "expo-modules-core@57.0.23": "patches/svelte-native/e.patch" } };

  test("a missing file is written whole, and blocks the project has are added to, not rewritten", () => {
    const fresh = mergeWorkspaceYaml("", wanted);
    expect(fresh.text).toBe('allowBuilds:\n  esbuild: true\noverrides:\n  expo-modules-core: 57.0.23\npatchedDependencies:\n  "@sveltejs/kit@3.1.1": patches/svelte-native/kit.patch\n  expo-modules-core@57.0.23: patches/svelte-native/e.patch\n');
    const merged = mergeWorkspaceYaml("# mine\nengineStrict: true\nallowBuilds:\n  esbuild: true\n  sharp: false # not this one\noverrides:\n  left-pad: 1.3.0\n", wanted);
    expect(merged.text).toBe('# mine\nengineStrict: true\nallowBuilds:\n  esbuild: true\n  sharp: false # not this one\noverrides:\n  left-pad: 1.3.0\n  expo-modules-core: 57.0.23\n\npatchedDependencies:\n  "@sveltejs/kit@3.1.1": patches/svelte-native/kit.patch\n  expo-modules-core@57.0.23: patches/svelte-native/e.patch\n');
    expect(mergeWorkspaceYaml(merged.text, wanted).changes).toEqual([]);
    expect(mergeWorkspaceYaml(merged.text, wanted).text).toBe(merged.text);
  });

  test("an entry with another value is replaced and said so, and a block in flow style is left to the person", () => {
    const replaced = mergeWorkspaceYaml("allowBuilds:\n  esbuild: false\noverrides:\n  expo-modules-core: 57.0.25\n", { allowBuilds: wanted.allowBuilds, overrides: wanted.overrides });
    expect(replaced.text).toBe("allowBuilds:\n  esbuild: true\noverrides:\n  expo-modules-core: 57.0.23\n");
    expect(replaced.changes).toEqual(["allowBuilds: esbuild (was false)", "overrides: expo-modules-core (was 57.0.25)"]);
    const flow = mergeWorkspaceYaml("allowBuilds: { esbuild: true }\n", { allowBuilds: wanted.allowBuilds });
    expect(flow.manual).toEqual(["allowBuilds: esbuild: true"]);
    expect(flow.text).toBe("allowBuilds: { esbuild: true }\n");
  });

  test("line endings and a file without a final newline are kept sensible", () => {
    const crlf = mergeWorkspaceYaml("allowBuilds:\r\n  esbuild: true\r\n", { overrides: wanted.overrides });
    expect(crlf.text).toBe("allowBuilds:\r\n  esbuild: true\r\n\r\noverrides:\r\n  expo-modules-core: 57.0.23\r\n");
    expect(mergeWorkspaceYaml("allowBuilds:\n  esbuild: true", { overrides: wanted.overrides }).text).toBe("allowBuilds:\n  esbuild: true\n\noverrides:\n  expo-modules-core: 57.0.23\n");
  });
});

describe("the edit of vite.config", () => {
  const sv = readFileSync(join(fixture, "vite.config.ts"), "utf8");

  test("sv's config becomes svelteNative() around SvelteKit's options, in sv's own style", () => {
    expect(svelteNativeViteConfig(sv)).toBe(`import adapter from '@sveltejs/adapter-auto';
import { svelteNative } from '@rasheed/svelte-native/vite';
import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
	plugins: [
		svelteNative({
			target: mode === 'native' ? 'native' : 'web',
			kit: {
				compilerOptions: {
					// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
					runes: ({ filename }) =>
						filename.split(/[/\\\\]/).includes('node_modules') ? undefined : true
				},

				// adapter-auto only supports some environments, see https://svelte.dev/docs/kit/adapter-auto for a list.
				// If your environment is not supported, or you settled on a specific environment, switch out the adapter.
				// See https://svelte.dev/docs/kit/adapters for more information about adapters.
				adapter: adapter()
			}
		})
	]
}));
`);
  });

  test("other plugins stay, no options give no kit, and double quotes are kept", () => {
    const withTailwind = `import tailwindcss from "@tailwindcss/vite";
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()]
});
`;
    expect(svelteNativeViteConfig(withTailwind)).toBe(`import tailwindcss from "@tailwindcss/vite";
import { svelteNative } from "@rasheed/svelte-native/vite";
import { defineConfig } from "vite";

export default defineConfig(({ mode }) => ({
  plugins: [tailwindcss(), svelteNative({ target: mode === "native" ? "native" : "web" })]
}));
`);
  });

  test("a config that is already a function of the mode is edited in place; one that is not in a known shape is not edited", () => {
    const asFunction = "import { sveltekit } from '@sveltejs/kit/vite';\nimport { defineConfig } from 'vite';\nexport default defineConfig(({ mode }) => ({ plugins: [sveltekit()], define: { m: mode } }));\n";
    expect(svelteNativeViteConfig(asFunction)).toContain("defineConfig(({ mode }) => ({ plugins: [svelteNative({ target: mode === 'native' ? 'native' : 'web' })], define: { m: mode } }));");
    expect(svelteNativeViteConfig("import { sveltekit } from '@sveltejs/kit/vite';\nexport default { plugins: [sveltekit()] };\n")).toBeUndefined();
    expect(svelteNativeViteConfig("import { sveltekit } from '@sveltejs/kit/vite';\nimport { defineConfig } from 'vite';\nexport default defineConfig(() => ({ plugins: [sveltekit()] }));\n")).toBeUndefined();
    expect(svelteNativeViteConfig("export default {};\n")).toBeUndefined();
  });

  test("a project whose config cannot be edited gets the exact change, and its file is not touched", () => {
    const odd = "import { sveltekit } from '@sveltejs/kit/vite';\nexport default { plugins: [sveltekit()] };\n";
    const root = project((dir) => writeFileSync(join(dir, "vite.config.ts"), odd));
    const result = run(root);
    expect(readFileSync(join(root, "vite.config.ts"), "utf8")).toBe(odd);
    expect(result.out).toContain("vite.config.ts");
    expect(result.out).toContain("kit: { /* what you passed to sveltekit() */ }");
    expect(result.status).toBe(1);
  });
});

describe("what init writes is what the library was exercised on", () => {
  test("the dependencies are examples/minimal's and inside the package's peer ranges, and the patched ones are the patches' versions", () => {
    const minimal = JSON.parse(readFileSync(join(repository, "examples/minimal/package.json"), "utf8")) as { dependencies: Record<string, string>; main: string; reanimated: unknown; scripts: Record<string, string> };
    for (const [name, version] of Object.entries(appDependencies)) expect(minimal.dependencies[name], name).toBe(version);
    const peers = (JSON.parse(readFileSync(join(import.meta.dirname, "../package.json"), "utf8")) as { peerDependencies: Record<string, string> }).peerDependencies;
    for (const [name, version] of Object.entries(appDependencies)) expect(satisfies(version.replace(/^[\^~]/, ""), peers[name] ?? "*"), `${name} ${version} satisfies ${peers[name]}`).toBe(true);
    for (const patch of patchFiles().filter((entry) => ["react-native-gesture-handler", "react-native-reanimated", "react-native-worklets"].includes(entry.package))) {
      expect(appDependencies[patch.package]).toBe(patch.version);
    }
    expect(minimal.main).toBe(".svelte-native/entry.ts");
    // examples/minimal's script for the doctor has the name init gives it (`pnpm doctor` is pnpm's own command).
    expect(minimal.scripts["check-setup"]).toBe("svelte-native doctor");
  });

  test("the names derive from the package name: scoped, uppercase and numeric names stay valid identifiers", () => {
    expect(appNames("my-app")).toMatchObject({ title: "my-app", slug: "my-app", androidPackage: "dev.example.myapp" });
    expect(appNames("@acme/Shop App")).toMatchObject({ slug: "shop-app", androidPackage: "dev.example.shopapp" });
    expect(appNames("123go")).toMatchObject({ slug: "app-123go", androidPackage: "dev.example.app123go" });
    expect(appNames(undefined)).toMatchObject({ slug: "app" });
  });
});

describe("the guide says what init writes", () => {
  test("docs/02's snippets carry the versions, the patches and the Svelte build init writes", () => {
    const page = readFileSync(join(repository, "docs/02-creating-a-project.md"), "utf8");
    for (const [name, version] of Object.entries(appDependencies)) expect(page, name).toContain(`"${name}": "${version}"`);
    expect(page).toContain(`"svelte": "${requiredSvelte.preview}"`);
    expect(page).toContain('"main": ".svelte-native/entry.ts"');
    // The yaml of the page is the one a run writes for an sv project, from "overrides" on.
    const root = project();
    run(root);
    const written = readFileSync(join(root, "pnpm-workspace.yaml"), "utf8");
    const block = written.slice(written.indexOf("overrides:"));
    expect(page).toContain(block.trimEnd());
    // The kit pin and the scripts of the page are what the manifest has.
    const manifest = readJson(root, "package.json");
    expect(page).toContain(`"@sveltejs/kit": "${manifest.devDependencies["@sveltejs/kit"]}"`);
    for (const [name, command] of Object.entries(manifest.scripts as Record<string, string>)) if (/^(native|android|ios|check-setup)$/.test(name)) expect(page).toContain(`"${name}": "${command}"`);
  });
});
