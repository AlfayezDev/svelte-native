import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runChecks, type Check, type Context } from "../src/doctor/checks.ts";
import { patchedDependenciesOfYaml } from "../src/doctor/declared.ts";
import { parsePatch } from "../src/doctor/hunks.ts";
import { formatReport, runDoctor } from "../src/doctor/index.ts";
import { findPackage } from "../src/doctor/resolve.ts";
import { expoPluginFinding, metroFinding, withoutJsComments } from "../src/doctor/integration.ts";
import { patchFiles, patchKey, patchSpecs } from "../src/doctor/patches.ts";
import { compareVersions, parseVersion, satisfies } from "../src/doctor/semver.ts";
import { library, makeFakeApp, repository, type FakeApp } from "./doctor-fixture.ts";

// `svelte-native doctor` against fake apps: node_modules stubs with patched and unpatched copies of the files the patches change (doctor-fixture.ts),
// the configs it reads, and the tools it asks about. The repository's own install is checked in doctor-repository.test.ts.

const apps: string[] = [];
afterAll(() => { for (const app of apps) rmSync(app, { recursive: true, force: true }); });

const tools = { node: "26.0.0", pnpm: () => "12.3.4" };
function check(options: FakeApp = {}, context: Partial<Context> = {}): { root: string; checks: Check[] } {
  const root = makeFakeApp(options);
  apps.push(root);
  return { root, checks: runChecks({ appRoot: root, packageRoot: join(repository, "packages/svelte-native"), ...tools, ...context }) };
}
const failed = (checks: Check[]) => checks.filter((entry) => entry.status === "fail");
const find = (checks: Check[], text: string) => checks.find((entry) => entry.message.includes(text));
const patchChecks = (checks: Check[]) => checks.filter((entry) => entry.group === "patches");

describe("an app that is set up", () => {
  const { checks } = check();

  test("passes every check", () => {
    expect(failed(checks)).toEqual([]);
    expect(checks.filter((entry) => entry.status === "unknown")).toEqual([]);
  });

  test("looks at every patch of the library, each as applied", () => {
    const patches = patchFiles();
    expect(patchChecks(checks).map((entry) => entry.status)).toEqual(patches.map(() => "pass"));
    for (const patch of patches) expect(find(checks, `${patchKey(patch)} applied`), patchKey(patch)).toBeDefined();
  });

  test("names the versions it found, the renderer build of Svelte among them", () => {
    expect(find(checks, "svelte 5.56.7 has the ./renderer export")?.status).toBe("pass");
    expect(find(checks, "react-native 0.86.3 satisfies 0.86.3")?.status).toBe("pass");
    expect(find(checks, "expo 57.0.27 satisfies ~57.0.27")?.status).toBe("pass");
    expect(find(checks, "react 19.2.7 satisfies 19.2.7")?.status).toBe("pass");
    expect(find(checks, "node 26.0.0")?.status).toBe("pass");
    expect(find(checks, "pnpm 12.3.4")?.status).toBe("pass");
  });
});

describe("a patch that is not applied", () => {
  for (const patch of patchFiles()) {
    test(`${patchKey(patch)} fails alone, with what is missing and how to fix it`, () => {
      const { checks } = check({ unpatched: [patch.package] });
      const failures = failed(checks);
      expect(failures.map((entry) => entry.message)).toEqual([expect.stringContaining(`${patchKey(patch)} is not applied`)]);
      const [failure] = failures;
      expect(failure?.group).toBe("patches");
      expect(failure?.details?.length).toBeGreaterThan(0);
      // Declared in the app's pnpm-workspace.yaml, so the fix is to install again (and, failing that, to copy the library's patch over the app's).
      expect(failure?.fix).toContain("pnpm install");
      expect(failure?.fix).toContain(`node_modules/${library.name}/patches/${patch.file}`);
    });
  }

  test("every patch unapplied is a failure each", () => {
    const { checks } = check({ unpatched: "all" });
    expect(patchChecks(checks).map((entry) => entry.status)).toEqual(patchFiles().map(() => "fail"));
  });

  test("one that the app does not declare is told how to declare it", () => {
    const { checks } = check({ unpatched: ["react-native-pdf"], declared: false });
    const failure = find(checks, "react-native-pdf@7.0.3 is not applied");
    expect(failure?.fix).toContain('declare "react-native-pdf@7.0.3: patches/svelte-native/react-native-pdf@7.0.3.patch" under patchedDependencies');
  });

  test("a patch declared at a file that is not there is told so", () => {
    const { checks } = check({ unpatched: ["react-native-pdf"], files: { "patches/svelte-native/react-native-pdf@7.0.3.patch": null } });
    expect(find(checks, "react-native-pdf@7.0.3 is not applied")?.fix).toContain("which does not exist");
  });

  test("a package patched with an older copy of the patch is not applied as this version of the library has it", () => {
    // The worklets shape is all there, but the loop's condition is the older one: the hunk of the library's patch is not in the file.
    const { root } = check();
    const file = join(root, "node_modules/react-native-worklets/lib/module/runLoop/uiRuntime/requestAnimationFrame.js");
    writeFileSync(file, readFileSync(file, "utf8").replace("queuedCallbacks.length > 0 || queuedFinalizers.length > 0", "queuedCallbacks.length > 0"));
    const again = runChecks({ appRoot: root, packageRoot: join(repository, "packages/svelte-native"), ...tools });
    const failure = find(again, "react-native-worklets@0.10.1 is patched, but not with this version of the library's patch");
    expect(failure?.status).toBe("fail");
    expect(failure?.details?.[0]).toContain("lib/module/runLoop/uiRuntime/requestAnimationFrame.js: hunk");
    expect(failed(again)).toHaveLength(1);
  });

  test("a patch for another version of the package cannot apply", () => {
    const { checks } = check({ versions: { "react-native-video": "6.19.4" } });
    expect(find(checks, "react-native-video 6.19.4 is installed, the patch is for exactly 6.19.3")?.status).toBe("fail");
    expect(find(checks, "react-native-video 6.19.4 does not satisfy 6.19.3")?.status).toBe("fail");
  });

  test("a library the app does not use needs no patch; one it must have is a failure when it is missing", () => {
    const optional = check({ without: ["react-native-pdf", "react-native-video", "lottie-react-native", "react-native-maps"] }).checks;
    expect(failed(optional)).toEqual([]);
    expect(find(optional, "react-native-pdf@7.0.3: react-native-pdf is not installed (optional)")?.status).toBe("skip");
    expect(find(optional, "optional view libraries not installed, nothing to check:")?.message).toContain("react-native-pdf");
    const required = check({ without: ["react-native-worklets", "react-native-reanimated"] }).checks;
    expect(failed(required).map((entry) => entry.message).sort()).toEqual([
      "react-native-reanimated is not installed (needs 4.5.1)",
      "react-native-reanimated@4.5.1: react-native-reanimated is not installed",
      "react-native-worklets is not installed (needs 0.10.1)",
      "react-native-worklets@0.10.1: react-native-worklets is not installed",
    ]);
  });

  test("expo-modules-core is found through expo, which the app depends on and it does not", () => {
    const { checks } = check({ without: ["expo", "expo-modules-core"] });
    expect(find(checks, "expo-modules-core@57.0.23: expo-modules-core is not installed (expo is not either)")?.status).toBe("fail");
    expect(find(checks, "expo is not installed (needs ~57.0.27)")?.status).toBe("fail");
  });
});

describe("finding an installed package", () => {
  test("in a hoisted install, in a workspace's root and, from a package's real directory, among the dependencies pnpm links beside it", () => {
    const root = makeFakeApp();
    apps.push(root);
    expect(findPackage("react-native", root)?.version).toBe("0.86.3");
    expect(findPackage("react-native", join(root, "apps/deep/inside"))?.version).toBe("0.86.3");
    expect(findPackage("not-installed", root)).toBeUndefined();
    // pnpm's own layout: the app links `expo`; `expo-modules-core` is only beside the real `expo`, in `.pnpm/expo@1/node_modules`.
    const isolated = makeFakeApp({ without: ["expo", "expo-modules-core"] });
    apps.push(isolated);
    const store = join(isolated, "node_modules/.pnpm/expo@1/node_modules");
    for (const [name, version] of [["expo", "57.0.30"], ["expo-modules-core", "57.0.23"]] as const) {
      mkdirSync(join(store, name), { recursive: true });
      writeFileSync(join(store, name, "package.json"), JSON.stringify({ name, version }));
    }
    symlinkSync(join(store, "expo"), join(isolated, "node_modules/expo"));
    const expo = findPackage("expo", isolated);
    expect(expo?.directory).toBe(join(store, "expo"));
    expect(findPackage("expo-modules-core", isolated)).toBeUndefined();
    expect(findPackage("expo-modules-core", expo?.directory ?? "")?.version).toBe("57.0.23");
  });
});

describe("versions", () => {
  test("react-native, expo and react must satisfy the library's peers", () => {
    const { checks } = check({ versions: { "react-native": "0.85.1", expo: "57.1.0", react: "19.2.6" } });
    expect(failed(checks).map((entry) => entry.message).sort()).toEqual([
      "expo 57.1.0 does not satisfy ~57.0.27",
      "react 19.2.6 does not satisfy 19.2.7",
      "react-native 0.85.1 does not satisfy 0.86.3",
    ]);
    expect(find(checks, "react-native 0.85.1")?.fix).toBe("pnpm add react-native@0.86.3");
  });

  test("an optional view library that is installed must match too", () => {
    const { checks } = check({ versions: { "expo-image": "57.1.0" } });
    expect(find(checks, "expo-image 57.1.0 does not satisfy ~57.0.5")?.status).toBe("fail");
  });

  test("a peer that is not installed is a failure unless it is optional", () => {
    expect(find(check({ without: ["react"] }).checks, "react is not installed (needs 19.2.7)")?.status).toBe("fail");
    expect(find(check({ without: ["react-native-svg"] }).checks, "react-native-svg")?.status).not.toBe("fail");
  });

  test("a range it cannot read is not guessed", () => {
    expect(satisfies("1.2.3", "file:../x.tgz")).toBeUndefined();
    expect(satisfies("1.2.3", "git+ssh://git@example.com/x.git#v1")).toBeUndefined();
    expect(satisfies("not a version", "^1.0.0")).toBeUndefined();
  });

  test("semver ranges", () => {
    const table: [string, string, boolean][] = [
      ["57.0.30", "~57.0.27", true], ["57.0.26", "~57.0.27", false], ["57.1.0", "~57.0.27", false], ["8.1.4", "^8.1.4", true], ["8.9.0", "^8.1.4", true], ["9.0.0", "^8.1.4", false],
      ["0.2.1", "~0.2.1", true], ["0.3.0", "~0.2.1", false], ["0.2.5", "^0.2.1", true], ["0.3.0", "^0.2.1", false], ["0.0.4", "^0.0.3", false], ["19.2.7", "19.2.7", true], ["19.2.8", "19.2.7", false],
      ["3.0.0-next.27", "3.0.0-next.27", true], ["3.0.0-next.28", "3.0.0-next.27", false], ["3.0.0", "3.0.0-next.27", false], ["3.0.0-next.28", "^3.0.0-next.27", true], ["3.0.0-next.26", "^3.0.0-next.27", false],
      ["3.1.0-next.1", "^3.0.0-next.27", false], ["2.0.0-beta.1", "^1.0.0", false], ["1.5.0", "1.x", true], ["2.0.0", "1.x", false], ["1.2.9", "1.2", true], ["1.3.0", "1.2", false], ["5.0.0", "*", true],
      ["1.5.0", ">=1.2.0 <2.0.0", true], ["2.0.0", ">=1.2.0 <2.0.0", false], ["1.0.0", "^1.0.0 || ^2.0.0", true], ["2.4.0", "^1.0.0 || ^2.0.0", true], ["3.0.0", "^1.0.0 || ^2.0.0", false], ["1.5.0", ">= 1.2.0", true],
    ];
    for (const [version, range, expected] of table) expect(satisfies(version, range), `${version} in ${range}`).toBe(expected);
    const [a, b, c] = ["1.0.0-alpha", "1.0.0-alpha.1", "1.0.0"].map((text) => parseVersion(text));
    expect(a && b && c && [compareVersions(a, b), compareVersions(b, c), compareVersions(c, a)]).toEqual([-1, -1, 1]);
  });
});

describe("Svelte", () => {
  test("the stock build, without the renderer export, is a failure that names it", () => {
    const { checks } = check({ stockSvelte: true });
    const failure = find(checks, "svelte 5.56.7 is the stock Svelte: it has no ./renderer export");
    expect(failure?.status).toBe("fail");
    expect(failure?.fix).toContain("custom-renderer build of Svelte");
  });

  test("an export that points at a file that is not there does not count", () => {
    const { checks } = check({ files: { "node_modules/svelte/src/renderer/index.js": null } });
    expect(find(checks, "svelte 5.56.7 is the stock Svelte")?.status).toBe("fail");
  });

  test("a compiler without the customRenderer option does not count", () => {
    const { checks } = check({ files: { "node_modules/svelte/src/compiler/validate-options.js": "export const options = {};\n" } });
    expect(find(checks, "its compiler has no customRenderer option")?.status).toBe("fail");
  });

  test("a missing Svelte is a failure", () => {
    expect(find(check({ without: ["svelte"] }).checks, "svelte is not installed")?.status).toBe("fail");
  });
});

describe("the tools", () => {
  test("an older Node fails, with what to install", () => {
    const entry = find(check({}, { node: "24.9.0" }).checks, "node 24.9.0 does not satisfy");
    expect(entry?.status).toBe("fail");
    expect(entry?.fix).toContain("25.0.0");
  });

  test("a Node that cannot be found is not guessed", () => {
    const entry = find(check({}, { node: undefined }).checks, "could not run node");
    expect(entry?.status).toBe("unknown");
  });

  test("an older pnpm fails and a pnpm that cannot run is not a guess", () => {
    expect(find(check({}, { pnpm: () => "10.8.0" }).checks, "pnpm 10.8.0 does not satisfy")?.status).toBe("fail");
    expect(find(check({}, { pnpm: () => undefined }).checks, "could not run pnpm")?.status).toBe("unknown");
  });
});

describe("the app's configs", () => {
  test("a Metro config without withSvelteNative could not be judged, and none at all is a failure", () => {
    expect(find(check({ files: { "metro.config.cjs": 'module.exports = require("./shared-metro.cjs");\n' } }).checks, "could not tell: metro.config.cjs does not mention withSvelteNative")?.status).toBe("unknown");
    const none = check({ files: { "metro.config.cjs": null } }).checks;
    expect(find(none, "no metro.config.js in the app")?.status).toBe("fail");
  });

  test("a withSvelteNative that is only in a comment does not count", () => {
    const text = `// module.exports = withSvelteNative(getDefaultConfig(__dirname));\n/* withSvelteNative */\nmodule.exports = getDefaultConfig(__dirname);\n`;
    expect(find(check({ files: { "metro.config.cjs": text } }).checks, "metro.config.cjs")?.status).toBe("unknown");
    expect(withoutJsComments("a // b\nc /* d */ e\nhttps://x.y // z")).toBe("a \nc  e\nhttps://x.y ");
  });

  test("the Expo plugin is looked for in app.json and in app.config", () => {
    const listed = check().checks;
    expect(find(listed, `app.json lists the ${library.name}/expo plugin`)?.status).toBe("pass");
    const bare = check({ files: { "app.json": JSON.stringify({ expo: { plugins: ["expo-font"] } }) } }).checks;
    expect(find(bare, `app.json does not list the ${library.name}/expo plugin`)?.status).toBe("fail");
    const code = check({ files: { "app.json": JSON.stringify({ expo: { plugins: [] } }), "app.config.ts": `export default ({ config }) => ({ ...config, plugins: [["${library.name}/expo", {}]] });\n` } }).checks;
    expect(find(code, `app.config.ts lists the ${library.name}/expo plugin`)?.status).toBe("pass");
    const dynamic = check({ files: { "app.json": JSON.stringify({ expo: { plugins: [] } }), "app.config.ts": "export default ({ config }) => ({ ...config, plugins: pluginsFor(process.env) });\n" } }).checks;
    expect(find(dynamic, "could not tell: app.config.ts does not name")?.status).toBe("unknown");
    const none = check({ files: { "app.json": null } }).checks;
    expect(find(none, "no app.json or app.config.* in the app")?.status).toBe("fail");
    // The bare form of app.json, without the `expo` key, is Expo's too.
    const unwrapped = check({ files: { "app.json": JSON.stringify({ plugins: [[`${library.name}/expo`, {}]] }) } }).checks;
    expect(find(unwrapped, `app.json lists the ${library.name}/expo plugin`)?.status).toBe("pass");
  });

  test("the findings, directly", () => {
    const root = makeFakeApp();
    apps.push(root);
    expect(metroFinding(root)).toEqual({ state: "found", file: "metro.config.cjs" });
    expect(expoPluginFinding(root, library.name)).toEqual({ state: "found", file: "app.json" });
  });

  test("an app that does not depend on the library is a failure", () => {
    const { checks } = check({ files: { "package.json": JSON.stringify({ name: "fake-app" }) } });
    expect(find(checks, `${library.name} is not a dependency of the app`)?.status).toBe("fail");
  });

  test("a directory that is not an app is one failure and nothing else", () => {
    const { checks } = check({ files: { "package.json": null } });
    expect(checks).toHaveLength(1);
    expect(checks[0]?.status).toBe("fail");
    expect(checks[0]?.message).toContain("has no package.json");
  });
});

describe("what is declared", () => {
  test("patchedDependencies of a pnpm-workspace.yaml, quoted or not, and what follows it", () => {
    const yaml = [
      "packages:", "  - apps/*", "patchedDependencies:", "# the library's patches", '  "@sveltejs/kit@3.0.0-next.27": packages/svelte-native/patches/kit.patch  # a comment', "  expo-modules-core@57.0.23: 'patches/a b.patch'",
      "  react-native-pdf@7.0.3: \"patches/pdf.patch\"", "overrides:", "  other@1.0.0: patches/not-a-patch", "",
    ].join("\n");
    expect([...patchedDependenciesOfYaml(yaml)]).toEqual([
      ["@sveltejs/kit@3.0.0-next.27", "packages/svelte-native/patches/kit.patch"], ["expo-modules-core@57.0.23", "patches/a b.patch"], ["react-native-pdf@7.0.3", "patches/pdf.patch"],
    ]);
    expect(patchedDependenciesOfYaml("packages: []\n").size).toBe(0);
  });

  test("pnpm.patchedDependencies of the app's package.json counts too", () => {
    const { checks } = check({
      unpatched: ["react-native-pdf"], declared: false,
      files: { "package.json": JSON.stringify({ name: "fake-app", dependencies: { [library.name]: "*" }, pnpm: { patchedDependencies: { "react-native-pdf@7.0.3": "patches/pdf.patch" } } }), "patches/pdf.patch": "" },
    });
    expect(find(checks, "react-native-pdf@7.0.3 is not applied")?.fix).toContain("package.json declares react-native-pdf@7.0.3 (patches/pdf.patch)");
  });
});

describe("the patch files", () => {
  test("a file of the library parses into its files and hunks, a removed line that looks like a header included", () => {
    const patch = ["diff --git a/x.txt b/x.txt", "index 1..2 100644", "--- a/x.txt", "+++ b/x.txt", "@@ -1,3 +1,3 @@", " keep", "--- looks like a header", "+++ looks like a header", " end",
      "diff --git a/new.txt b/new.txt", "new file mode 100644", "--- /dev/null", "+++ b/new.txt", "@@ -0,0 +1,2 @@", "+one", "+two", "\\ No newline at end of file", ""].join("\n");
    expect(parsePatch(patch)).toEqual([
      { path: "x.txt", created: false, removed: false, hunks: [{ before: ["keep", "-- looks like a header", "end"], after: ["keep", "++ looks like a header", "end"] }] },
      { path: "new.txt", created: true, removed: false, hunks: [{ before: [], after: ["one", "two"] }] },
    ]);
  });

  test("every patch of the library parses, with hunks, and names a package the doctor knows", () => {
    for (const patch of patchFiles()) {
      const files = parsePatch(readFileSync(patch.path, "utf8"));
      expect(files.length, patch.file).toBeGreaterThan(0);
      for (const file of files) expect(file.hunks.length, `${patch.file}: ${file.path}`).toBeGreaterThan(0);
      expect(patchSpecs.some((spec) => spec.package === patch.package), patch.file).toBe(true);
    }
  });
});

describe("the report and the exit status", () => {
  const output = () => { const lines: string[] = []; return { lines, write: (text: string) => { lines.push(text); }, text: () => lines.join("") }; };

  test("a set-up app exits 0 and prints a line per check under its group", () => {
    const root = makeFakeApp();
    apps.push(root);
    const out = output();
    expect(runDoctor(root, [], out, { ...tools })).toBe(0);
    const text = out.text();
    expect(text).toContain(`svelte-native doctor: ${root}`);
    for (const group of ["environment", "svelte", "peer dependencies", "patches", "build integration"]) expect(text).toContain(`\n${group}\n`);
    expect(text).toContain("  pass  react-native-pdf@7.0.3 applied: the pdf view's one event");
    expect(text).toMatch(/\d+ passed, 0 failed, 0 could not tell, 0 skipped\n$/);
    expect(text).not.toContain("\u001b[");
  });

  test("a failure exits 1, with its details and fix under it", () => {
    const root = makeFakeApp({ unpatched: ["react-native-pdf"], versions: { react: "19.0.0" } });
    apps.push(root);
    const out = output();
    expect(runDoctor(root, [], out, { ...tools })).toBe(1);
    const text = out.text();
    expect(text).toMatch(/ {2}FAIL {2}react 19\.0\.0 does not satisfy 19\.2\.7\n {8}fix: pnpm add react@19\.2\.7\n/);
    expect(text).toMatch(/ {2}FAIL {2}react-native-pdf@7\.0\.3 is not applied: .*\n {8}android\/src\/main\/java\/org\/wonday\/pdf\/events\/TopChangeEvent\.java: canCoalesce\(\) is not overridden to return false\n {8}fix: /);
    expect(text).toMatch(/2 failed/);
  });

  test("a check that could not tell, or was skipped, does not fail it", () => {
    const root = makeFakeApp({ without: ["react-native-pdf"], files: { "metro.config.cjs": "module.exports = {};\n" } });
    apps.push(root);
    const out = output();
    expect(runDoctor(root, [], out, { ...tools })).toBe(0);
    expect(out.text()).toContain("  ????  could not tell: metro.config.cjs");
    expect(out.text()).toContain("  skip  react-native-pdf@7.0.3: react-native-pdf is not installed (optional)");
  });

  test("--json prints the checks and whether they all hold", () => {
    const root = makeFakeApp({ unpatched: ["react-native-pdf"] });
    apps.push(root);
    const out = output();
    expect(runDoctor(root, ["--json"], out, { ...tools })).toBe(1);
    const parsed = JSON.parse(out.text()) as { ok: boolean; appRoot: string; checks: Check[] };
    expect(parsed.ok).toBe(false);
    expect(parsed.appRoot).toBe(root);
    expect(parsed.checks.filter((entry) => entry.status === "fail")).toHaveLength(1);
  });

  test("an argument it does not know exits 2 with the usage, and --help prints it", () => {
    const out = output();
    expect(runDoctor("/", ["--fix"], out)).toBe(2);
    expect(out.text()).toContain("Unknown argument --fix");
    expect(out.text()).toContain("Usage: svelte-native doctor [--json]");
    const help = output();
    expect(runDoctor("/", ["--help"], help)).toBe(0);
    expect(help.text()).toContain("Usage: svelte-native doctor [--json]");
  });

  test("the words are coloured only when asked", () => {
    const text = formatReport([{ group: "patches", status: "fail", message: "m", fix: "f" }], { color: true });
    expect(text).toContain("\u001b[31mFAIL\u001b[0m");
  });
});

describe("the command", () => {
  test("`svelte-native doctor` exits 1 for an app that is not set up, prints the report, and writes nothing into the app", () => {
    const node = Bun.which("node");
    if (!node) return;
    const root = makeFakeApp({ unpatched: "all", stockSvelte: true });
    apps.push(root);
    const run = Bun.spawnSync([node, join(repository, "packages/svelte-native/src/cli.ts"), "doctor"], { cwd: root, env: { ...process.env, NO_COLOR: "1" } });
    const out = run.stdout.toString();
    expect(out).toContain(`svelte-native doctor: ${root}`);
    expect(out).toContain("FAIL");
    expect(run.exitCode).toBe(1);
    // The sync that every other command makes first is not made: the doctor reads, it does not write.
    expect(existsSync(join(root, ".svelte-native"))).toBe(false);
  });
});
