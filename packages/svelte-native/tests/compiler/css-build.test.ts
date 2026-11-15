import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildClasses, buildClassesSync, candidatesIn, candidatesOf, reportSkipped, reportUnsupported, resetReports, sourceFiles, TAILWIND_VERSION, unsupportedReasons, watchClasses, type ClassBuildOptions, type Converter } from "../../src/css/build.ts";
import type { ClassTable } from "../../src/css/table.ts";
import { classesTableFile } from "../../src/variant.ts";
import { cssProject, removeCssProjects, tailwindDirectory } from "../css-project.ts";

// The build step of `class`: the class names the sources use, Tailwind (the app's own) compiling the app's CSS for them, the converter, and the
// table file Metro serves as `@alfayez/svelte-native/classes-table`.
afterAll(removeCssProjects);

const options = (root: string, extra: Partial<ClassBuildOptions> = {}): ClassBuildOptions => ({ root, css: "src/global.css", variant: "app", ...extra });
const tableFile = (root: string, variant = "app") => join(root, ".svelte-native", classesTableFile(variant));
/** The table a project's build wrote, loaded the way an app does (the file is TypeScript data). */
const loadTable = async (root: string, variant = "app"): Promise<ClassTable> => ((await import(`${tableFile(root, variant)}?${statSync(tableFile(root, variant)).mtimeMs}`)) as { default: ClassTable }).default;
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
const until = async (condition: () => boolean, ms = 10_000) => {
  const deadline = Date.now() + ms;
  while (!condition() && Date.now() < deadline) await sleep(25);
};

describe("the class names the sources use", () => {
  const names = (source: string) => [...candidatesIn(source)].sort();

  test("a class attribute, an expression and the strings in it, and a class: directive's name", () => {
    expect(names('<View class="p-4 md:p-10 -mt-2 w-1/2 bg-sky-500/50 !p-1 p-4!" />')).toEqual(expect.arrayContaining(["!p-1", "-mt-2", "bg-sky-500/50", "md:p-10", "p-4", "p-4!", "w-1/2"]));
    // biome-ignore lint/suspicious/noTemplateCurlyInString: Svelte source
    const expression = "<View class={[a && 'flex-1', `gap-${n} gap-2`, { 'bg-red-500': x, active: y }]} />";
    expect(names(expression)).toEqual(expect.arrayContaining(["flex-1", "gap-2", "bg-red-500", "active"]));
    expect(names("<View class:tracking-wide={on} class:dark:bg-black={dark} class:card />")).toEqual(expect.arrayContaining(["tracking-wide", "dark:bg-black", "card"]));
  });

  test("an arbitrary value keeps what would end a class anywhere else: a comma, parentheses, an operator", () => {
    expect(names('<View class="shadow-[0_0_4px_rgb(0,0,0)] w-[calc(100%-2rem)] pt-[env(safe-area-inset-top)] bg-[#fff] content-[\'x\'] [mask-type:alpha] h-(--my-height)" />')).toEqual(
      expect.arrayContaining(["shadow-[0_0_4px_rgb(0,0,0)]", "w-[calc(100%-2rem)]", "pt-[env(safe-area-inset-top)]", "bg-[#fff]", "content-['x']", "[mask-type:alpha]", "h-(--my-height)"]),
    );
  });

  test("an unclosed bracket ends at the space, not at the end of the file", () => {
    expect(names("const a = ['x', 'y'];\nconst b = 'p-4';")).toEqual(expect.arrayContaining(["p-4"]));
  });

  test("only the sources under src/ count: .svelte, .ts, .js and .svelte.ts, not node_modules, .svelte-native, other extensions or other directories", () => {
    const root = cssProject({
      "src/lib/a.ts": "export const a = 'text-a';",
      "src/lib/b.js": "export const b = 'text-b';",
      "src/lib/state.svelte.ts": "export const c = 'text-c';",
      "src/lib/notes.md": "text-md",
      "src/node_modules/pkg/index.js": "text-pkg",
      "src/.svelte-native/routes.app.ts": "text-generated",
      "elsewhere/x.ts": "text-elsewhere",
    });
    const candidates = candidatesOf(root);
    for (const name of ["text-a", "text-b", "text-c", "p-4"]) expect(candidates).toContain(name);
    for (const name of ["text-md", "text-pkg", "text-generated", "text-elsewhere"]) expect(candidates).not.toContain(name);
    expect(sourceFiles(root).map((file) => file.slice(root.length + 1))).toEqual(["src/lib/a.ts", "src/lib/b.js", "src/lib/state.svelte.ts", "src/routes/+mobile.svelte"]);
    expect(candidates).toEqual([...candidates].sort());
  });

  test("a project without src/ has none", () => {
    expect(candidatesOf(join(cssProject({}, { tailwind: false }), "nowhere"))).toEqual([]);
  });
});

describe("buildClasses with the app's Tailwind and the converter", () => {
  test("writes the table: the classes the sources use, from Tailwind and from the app's own CSS", async () => {
    const root = cssProject();
    const result = await buildClasses(options(root));
    expect(result.file).toBe(tableFile(root));
    expect(result.changed).toBe(true);
    expect(result.stylesheets).toEqual([join(root, "src/global.css"), join(tailwindDirectory, "index.css")]);
    const table = await loadTable(root);
    expect(table.version).toBe(1);
    expect(Object.keys(table.classes).sort()).toEqual(["card", "dark:bg-slate-900", "md:p-10", "p-4", "text-red-500", "text-sm", "tracking-wide"]);
    expect(table.classes["p-4"]?.[0]?.style).toMatchObject({ paddingTop: 16 });
    expect(table.classes["md:p-10"]?.[0]?.when).toEqual({ minWidth: 768 });
    expect(table.classes["dark:bg-slate-900"]?.[0]?.when).toEqual({ scheme: "dark" });
    expect(table.classes.card?.[0]?.style).toMatchObject({ paddingTop: 4 });
    expect(readFileSync(tableFile(root), "utf8")).toStartWith("// Generated by @alfayez/svelte-native");
  });

  test("is one file per variant", async () => {
    const root = cssProject();
    await buildClasses(options(root, { variant: "qa" }));
    await buildClasses(options(root, { variant: "production" }));
    expect(existsSync(tableFile(root, "qa"))).toBe(true);
    expect(existsSync(tableFile(root, "production"))).toBe(true);
    expect(existsSync(tableFile(root, "app"))).toBe(false);
  });

  test("does not write a table that did not change, and writes one that did", async () => {
    const root = cssProject();
    expect((await buildClasses(options(root))).changed).toBe(true);
    const written = statSync(tableFile(root)).mtimeMs;
    await sleep(20);
    // Nothing changed: not even compiled.
    expect((await buildClasses(options(root))).changed).toBe(false);
    // The CSS changed, the table did not (a comment): Tailwind and the converter run, and the file is left alone.
    writeFileSync(join(root, "src/global.css"), '@import "tailwindcss";\n\n/* the card */\n.card { padding: 4px; }\n');
    expect((await buildClasses(options(root))).changed).toBe(false);
    expect(statSync(tableFile(root)).mtimeMs).toBe(written);
    // A class the sources did not use before.
    writeFileSync(join(root, "src/routes/+mobile.svelte"), '<View class="p-4 card dark:bg-slate-900 md:p-10 rounded-xl" />\n<Text class={["text-sm", on && "text-red-500"]} class:tracking-wide={on}>hi</Text>\n');
    const grown = await buildClasses(options(root));
    expect(grown.changed).toBe(true);
    expect(statSync(tableFile(root)).mtimeMs).toBeGreaterThan(written);
    expect(Object.keys((await loadTable(root)).classes)).toContain("rounded-xl");
    // A class the sources stopped using is gone from the table: it is built for what the sources use now, not for what they once did.
    writeFileSync(join(root, "src/routes/+mobile.svelte"), '<View class="p-4" />\n');
    expect((await buildClasses(options(root))).changed).toBe(true);
    expect(Object.keys((await loadTable(root)).classes).sort()).toEqual(["card", "p-4"].sort());
  });

  test("a table file that is gone is written again", async () => {
    const root = cssProject();
    await buildClasses(options(root));
    const { rmSync } = await import("node:fs");
    rmSync(tableFile(root));
    expect((await buildClasses(options(root))).changed).toBe(true);
    expect(existsSync(tableFile(root))).toBe(true);
  });

  test("reads the CSS an @import names: Tailwind's parts by their names, a relative file from the importing one", async () => {
    const root = cssProject({
      "src/global.css": '@import "tailwindcss/theme" layer(theme);\n@import "tailwindcss/utilities.css" layer(utilities);\n@import "./styles/brand.css";\n',
      "src/styles/brand.css": "@import './more.css';\n.brand { opacity: 0.5; }\n",
      "src/styles/more.css": ".more { opacity: 0.25; }\n",
      "src/routes/+mobile.svelte": '<View class="p-4 brand more" />\n',
    });
    const result = await buildClasses(options(root));
    expect(result.stylesheets).toEqual([join(root, "src/global.css"), join(tailwindDirectory, "theme.css"), join(tailwindDirectory, "utilities.css"), join(root, "src/styles/brand.css"), join(root, "src/styles/more.css")]);
    const table = await loadTable(root);
    expect(Object.keys(table.classes).sort()).toEqual(["brand", "more", "p-4"]);
    expect(table.classes.more?.[0]?.style).toEqual({ opacity: 0.25 });
    // The files the build read are what a watcher follows: a change in one of them is a change in the table.
    writeFileSync(join(root, "src/styles/more.css"), ".more { opacity: 0.75; }\n");
    expect((await buildClasses(options(root))).changed).toBe(true);
    expect((await loadTable(root)).classes.more?.[0]?.style).toEqual({ opacity: 0.75 });
  });

  test("hands the converter Tailwind's CSS for the sources' classes, and writes the table it returns (an injected converter)", async () => {
    const root = cssProject();
    const seen: string[] = [];
    const convert: Converter = (css) => {
      seen.push(css);
      return { table: { version: 1, classes: { fake: [{ order: 1, style: { opacity: 0.1 } }] } }, unsupported: [{ className: "fake", property: "filter", reason: "no filter" }] };
    };
    const result = await buildClasses(options(root, { convert }));
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain(".p-4");
    expect(seen[0]).toContain("prefers-color-scheme: dark");
    expect(seen[0]).toContain(".card");
    expect(seen[0]).not.toContain(".rounded-xl");
    expect(result.unsupported).toEqual([{ className: "fake", property: "filter", reason: "no filter" }]);
    expect(await loadTable(root)).toEqual({ version: 1, classes: { fake: [{ order: 1, style: { opacity: 0.1 } }] }, unsupported: { fake: "filter: no filter" } });
  });

  test("the table says why each class the converter left out is not in it: a line a class, its properties joined", async () => {
    const root = cssProject();
    const convert: Converter = () => ({
      table: { version: 1, classes: {} },
      unsupported: [
        { className: "transition", property: "transition-property", reason: "no React Native style for transition-property" },
        { className: "hover:p-4", property: ":hover", reason: "pseudo-classes need state" },
        { className: "transition", property: "transition-duration", reason: "no React Native style for transition-duration" },
        { className: "transition", property: "transition-property", reason: "no React Native style for transition-property" },
      ],
    });
    await buildClasses(options(root, { convert }));
    expect((await loadTable(root)).unsupported).toEqual({
      "hover:p-4": ":hover: pseudo-classes need state",
      transition: "transition-property: no React Native style for transition-property; transition-duration: no React Native style for transition-duration",
    });
    // A table with nothing left out has no such block.
    expect(readFileSync(tableFile(root), "utf8")).toContain('"unsupported": {\n    "hover:p-4"');
    const other = cssProject();
    await buildClasses(options(other, { convert: () => ({ table: { version: 1, classes: { a: [{ order: 1, style: {} }] } }, unsupported: [] }) }));
    expect(readFileSync(tableFile(other), "utf8")).not.toContain("unsupported");
    expect(unsupportedReasons([])).toEqual({});
  });

  test("with the real converter, the classes the sources mention that React Native cannot express are in the table's unsupported, and not in its classes", async () => {
    const root = cssProject({ "src/routes/+mobile.svelte": '<View class="p-4 hover:opacity-50 fixed" />\n<!-- the table of contents -->\n' });
    await buildClasses(options(root));
    const table = await loadTable(root);
    // The app's own class is in the table whether or not a source uses it; `contents` is a utility React Native can express.
    expect(Object.keys(table.classes).sort()).toEqual(["card", "contents", "p-4"]);
    expect(Object.keys(table.unsupported ?? {}).sort()).toEqual(["fixed", "hover:opacity-50", "table"]);
    expect(table.unsupported?.fixed).toMatch(/^position: .*fixed/);
    expect(table.unsupported?.["hover:opacity-50"]).toContain(":hover");
    for (const name of Object.keys(table.unsupported ?? {})) expect(table.classes).not.toHaveProperty([name]);
  });

  test("an empty table is a valid one", async () => {
    const root = cssProject({ "src/routes/+mobile.svelte": "<View />\n", "src/global.css": ".nothing { }\n" });
    await buildClasses(options(root));
    expect(await loadTable(root)).toEqual({ version: 1, classes: {} });
  });
});

describe("what the build refuses, with what to do", () => {
  test("Tailwind is not in the app", async () => {
    const root = cssProject({}, { tailwind: false });
    const error = await buildClasses(options(root)).catch((reason: Error) => reason);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(`pnpm add -D tailwindcss@${TAILWIND_VERSION}`);
    expect((error as Error).message).toContain("the css option needs Tailwind CSS");
    // The version the message tells the app to install is the one the tests link into their projects (the repository's own Tailwind): a bump of one without the other fails here.
    expect(TAILWIND_VERSION).toBe((JSON.parse(readFileSync(join(tailwindDirectory, "package.json"), "utf8")) as { version: string }).version);
  });

  test("Tailwind is not version 4", async () => {
    const root = cssProject({ "node_modules/tailwindcss/package.json": JSON.stringify({ name: "tailwindcss", version: "3.4.17" }) }, { tailwind: false });
    await expect(buildClasses(options(root))).rejects.toThrow(new RegExp(`needs Tailwind CSS 4, the app has 3\\.4\\.17: pnpm add -D tailwindcss@${TAILWIND_VERSION.replaceAll(".", "\\.")}`));
  });

  test("the CSS entry is not a file", async () => {
    const root = cssProject();
    await expect(buildClasses(options(root, { css: "src/missing.css" }))).rejects.toThrow(/the css option names src\/missing\.css, which is not a file/);
  });

  test("an @import that is not there names the file and the importer", async () => {
    const root = cssProject({ "src/global.css": '@import "tailwindcss";\n@import "./nope.css";\n' });
    await expect(buildClasses(options(root))).rejects.toThrow(/cannot read @import "\.\/nope\.css" from .*src: ENOENT/);
    const bare = cssProject({ "src/global.css": '@import "no-such-package/style.css";\n' });
    await expect(buildClasses(options(bare))).rejects.toThrow(/cannot resolve @import "no-such-package\/style\.css"/);
  });
});

describe("a CSS file shared with the web build", () => {
  test("@plugin and @config are skipped, not fatal: the classes that do not need them are built, and the result says what was skipped", async () => {
    const root = cssProject({
      "src/global.css": '@import "tailwindcss";\n@plugin "@tailwindcss/typography";\n@plugin "./my-plugin.js" { size: 4; }\n@config "./tailwind.config.js";\n.card { padding: 4px; }\n',
    });
    const result = await buildClasses(options(root));
    expect(result.skipped.sort()).toEqual(['@config "./tailwind.config.js"', '@plugin "./my-plugin.js"', '@plugin "@tailwindcss/typography"']);
    expect(Object.keys((await loadTable(root)).classes).sort()).toEqual(["card", "dark:bg-slate-900", "md:p-10", "p-4", "text-red-500", "text-sm", "tracking-wide"]);
    const clean = await buildClasses(options(cssProject()));
    expect(clean.skipped).toEqual([]);
  });

  test("the child process of the sync build reports them too, and the report is one line a plugin, once", () => {
    const root = cssProject({ "src/global.css": '@import "tailwindcss";\n@plugin "sync-only-plugin";\n' });
    const result = buildClassesSync({ root, css: "src/global.css", variant: "app" });
    expect(result.skipped).toEqual(['@plugin "sync-only-plugin"']);
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      reportSkipped(result.skipped);
      reportSkipped(result.skipped);
      reportSkipped(['@plugin "sync-only-plugin"', '@config "./c.js"']);
      reportSkipped([]);
      expect(warn.mock.calls.map((call) => call[0])).toEqual([
        'svelte-native: plugins and JS config do not apply on native: @plugin "sync-only-plugin" is ignored',
        'svelte-native: plugins and JS config do not apply on native: @config "./c.js" is ignored',
      ]);
    } finally {
      warn.mockRestore();
    }
  });
});

describe("@import resolution", () => {
  const brand = (name: string, manifest: object, files: Record<string, string>) => ({
    [`node_modules/${name}/package.json`]: JSON.stringify({ name, ...manifest }),
    ...Object.fromEntries(Object.entries(files).map(([file, content]) => [`node_modules/${name}/${file}`, content])),
  });
  const classesOf = async (root: string) => (await loadTable(root)).classes;

  test("a bare relative name is the file next to the importing one, first; from a nested file it is next to that one", async () => {
    const root = cssProject({
      "src/global.css": '@import "tailwindcss";\n@import "rel.css";\n@import "styles/brand.css";\n',
      "src/rel.css": ".rel { opacity: 0.1; }\n",
      "src/styles/brand.css": '@import "more.css";\n.brand { opacity: 0.2; }\n',
      "src/styles/more.css": ".more { opacity: 0.3; }\n",
      "src/routes/+mobile.svelte": '<View class="rel brand more" />\n',
      // A package of the same name is not preferred over the file.
      ...{ "node_modules/rel.css/package.json": JSON.stringify({ name: "rel.css", style: "other.css" }), "node_modules/rel.css/other.css": ".other { opacity: 0.9; }\n" },
    });
    const result = await buildClasses(options(root));
    expect(Object.keys(await classesOf(root)).sort()).toEqual(["brand", "more", "rel"]);
    expect(result.stylesheets).toEqual(expect.arrayContaining([join(root, "src/rel.css"), join(root, "src/styles/brand.css"), join(root, "src/styles/more.css")]));
  });

  test("a package's CSS: its `style` export condition, its `style` field, a scoped package, a subpath its exports map has, and a file of it", async () => {
    const root = cssProject({
      "src/global.css": '@import "tailwindcss";\n@import "by-condition";\n@import "by-field";\n@import "@scope/kit";\n@import "by-condition/extra.css";\n@import "plain/theme.css";\n@import "plain/bare";\n',
      ...brand("by-condition", { exports: { ".": { style: "./brand.css", default: "./index.js" }, "./extra.css": { style: "./extra.css" } } }, { "brand.css": ".from-condition { opacity: 0.1; }\n", "extra.css": ".extra { opacity: 0.2; }\n", "index.js": "" }),
      ...brand("by-field", { style: "dist/theme.css", main: "index.js" }, { "dist/theme.css": ".from-field { opacity: 0.3; }\n" }),
      ...brand("@scope/kit", { style: "kit.css" }, { "kit.css": ".kit { opacity: 0.4; }\n" }),
      ...brand("plain", {}, { "theme.css": ".plain { opacity: 0.5; }\n", "bare.css": ".bare { opacity: 0.6; }\n" }),
      "src/routes/+mobile.svelte": '<View class="from-condition from-field kit extra plain bare" />\n',
    });
    await buildClasses(options(root));
    expect(Object.keys(await classesOf(root)).sort()).toEqual(["bare", "extra", "from-condition", "from-field", "kit", "plain"]);
  });

  test("a package that has no CSS is an error that names the import", async () => {
    const root = cssProject({ "src/global.css": '@import "tailwindcss";\n@import "code-only";\n', ...brand("code-only", { main: "index.js" }, { "index.js": "" }) });
    await expect(buildClasses(options(root))).rejects.toThrow(/cannot (resolve|read) @import "code-only"/);
  });
});

describe("buildClassesSync, for the Metro config that cannot wait", () => {
  test("builds in a process of its own, with the real converter, and gives the same result", async () => {
    const root = cssProject();
    const result = buildClassesSync({ root, css: "src/global.css", variant: "qa" });
    expect(result.file).toBe(tableFile(root, "qa"));
    expect(result.changed).toBe(true);
    expect(result.stylesheets[0]).toBe(join(root, "src/global.css"));
    expect(Object.keys((await loadTable(root, "qa")).classes)).toContain("md:p-10");
    // The same inputs again (Expo loads the config more than once): not built, not written.
    const written = statSync(tableFile(root, "qa")).mtimeMs;
    expect(buildClassesSync({ root, css: "src/global.css", variant: "qa" }).changed).toBe(false);
    expect(statSync(tableFile(root, "qa")).mtimeMs).toBe(written);
    // A new class is built.
    mkdirSync(join(root, "src/lib"), { recursive: true });
    writeFileSync(join(root, "src/lib/a.ts"), "export const a = 'rounded-lg';");
    expect(buildClassesSync({ root, css: "src/global.css", variant: "qa" }).changed).toBe(true);
    expect(Object.keys((await loadTable(root, "qa")).classes)).toContain("rounded-lg");
  });

  test("a build that fails throws what the build said, so the Metro config fails with the way out", () => {
    const root = cssProject({}, { tailwind: false });
    expect(() => buildClassesSync({ root, css: "src/global.css", variant: "app" })).toThrow(`pnpm add -D tailwindcss@${TAILWIND_VERSION}`);
    const missing = cssProject({ "src/global.css": '@import "./nope.css";\n' });
    expect(() => buildClassesSync({ root: missing, css: "src/global.css", variant: "app" })).toThrow(/cannot read @import "\.\/nope\.css"/);
  });
});

describe("what the converter left out is summarised", () => {
  const entry = (className: string, property = "p") => ({ className, property, reason: "r" });
  // The counts are per process, and the test runner shares one process with every other file that builds a class table.
  beforeEach(resetReports);
  afterEach(() => spyOn(console, "warn").mockRestore());

  test("in development one line with the number of classes, again only when there are more; in any other build nothing", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const said = () => warn.mock.calls.map((call) => call[0]);
    reportUnsupported([entry("hover:p-4", ":hover"), entry("hover:p-4", "x"), entry("blur", "filter")], true);
    expect(said()).toEqual(["svelte-native: 2 classes the sources mention are not supported on native; a class that is used warns when it renders"]);
    // The watcher builds again: nothing new.
    warn.mockClear();
    reportUnsupported([entry("hover:p-4"), entry("blur")], true);
    expect(warn).not.toHaveBeenCalled();
    reportUnsupported([], true);
    expect(warn).not.toHaveBeenCalled();
    reportUnsupported([entry("blur"), entry("grid", "display")], true);
    expect(said()).toEqual(["svelte-native: 3 classes the sources mention are not supported on native; a class that is used warns when it renders"]);
    warn.mockClear();
    reportUnsupported([entry("fixed"), entry("table")], false);
    expect(warn).not.toHaveBeenCalled();
  });

  test("the development default is NODE_ENV", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const environment = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "production";
      reportUnsupported([entry("env-a")]);
      expect(warn).not.toHaveBeenCalled();
      process.env.NODE_ENV = "development";
      reportUnsupported([entry("env-b")]);
    } finally {
      if (environment === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = environment;
    }
    expect(warn.mock.calls).toHaveLength(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/^svelte-native: \d+ class(es)? the sources mention (is|are) not supported on native; a class that is used warns when it renders$/);
  });
});

describe("watchClasses", () => {
  // What the converter leaves out is reported by the watcher too (the report has its own test).
  afterEach(() => spyOn(console, "warn").mockRestore());

  test("builds again when a source gets a class, when the CSS changes, and when a CSS file outside src/ it imports changes; closing stops it", async () => {
    const root = cssProject({
      "src/global.css": '@import "tailwindcss";\n@import "../styles/extra.css";\n',
      "styles/extra.css": ".extra { opacity: 0.5; }\n",
      "src/routes/+mobile.svelte": '<View class="p-4 extra" />\n',
    });
    const first = await buildClasses(options(root));
    spyOn(console, "warn").mockImplementation(() => {});
    const watcher = watchClasses(options(root), first.stylesheets, 40);
    try {
      const classes = async () => Object.keys((await loadTable(root)).classes).sort();
      expect(await classes()).toEqual(["extra", "p-4"]);
      writeFileSync(join(root, "src/routes/+mobile.svelte"), '<View class="p-4 extra rounded-xl" />\n');
      await until(() => readFileSync(tableFile(root), "utf8").includes("rounded-xl"));
      expect(await classes()).toEqual(["extra", "p-4", "rounded-xl"]);
      writeFileSync(join(root, "styles/extra.css"), ".extra { opacity: 0.75; }\n");
      await until(() => readFileSync(tableFile(root), "utf8").includes("0.75"));
      expect((await loadTable(root)).classes.extra?.[0]?.style).toEqual({ opacity: 0.75 });
      writeFileSync(join(root, "src/global.css"), '@import "tailwindcss";\n@import "../styles/extra.css";\n.added { opacity: 0.1; }\n');
      writeFileSync(join(root, "src/routes/+mobile.svelte"), '<View class="p-4 extra rounded-xl added" />\n');
      await until(() => readFileSync(tableFile(root), "utf8").includes('"added"'));
      expect(await classes()).toEqual(["added", "extra", "p-4", "rounded-xl"]);
    } finally {
      watcher.close();
    }
    const written = readFileSync(tableFile(root), "utf8");
    writeFileSync(join(root, "src/routes/+mobile.svelte"), '<View class="p-4 extra rounded-xl added shadow-md" />\n');
    await sleep(400);
    expect(readFileSync(tableFile(root), "utf8")).toBe(written);
  });

  test("a source saved by a rename (sed -i, vim, many editors) is seen every time, not only the first (11 Nov 2026: a recursive fs.watch went silent)", async () => {
    const root = cssProject({ "src/routes/+mobile.svelte": '<View class="p-4" />\n' });
    await buildClasses(options(root));
    spyOn(console, "warn").mockImplementation(() => {});
    const watcher = watchClasses(options(root), [], 40);
    const file = join(root, "src/routes/+mobile.svelte");
    const save = (content: string) => {
      writeFileSync(`${file}.tmp`, content);
      renameSync(`${file}.tmp`, file);
    };
    try {
      for (const added of ["bg-rose-200", "bg-lime-300", "bg-violet-300", "bg-amber-300"]) {
        save(`<View class="p-4 ${added}" />\n`);
        await until(() => readFileSync(tableFile(root), "utf8").includes(`"${added}"`));
        expect(readFileSync(tableFile(root), "utf8")).toContain(`"${added}"`);
      }
    } finally {
      watcher.close();
    }
  });

  test("a build that fails (a CSS file mid-edit) is logged and the next change builds", async () => {
    const root = cssProject();
    await buildClasses(options(root));
    const error = spyOn(console, "error").mockImplementation(() => {});
    spyOn(console, "warn").mockImplementation(() => {});
    const watcher = watchClasses(options(root), [], 40);
    try {
      writeFileSync(join(root, "src/global.css"), '@import "tailwindcss";\n@import "./half-typed.css";\n');
      await until(() => error.mock.calls.length > 0);
      expect(String((error.mock.calls[0]?.[0] as Error | undefined)?.message)).toContain("half-typed.css");
      writeFileSync(join(root, "src/global.css"), '@import "tailwindcss";\n.fixed { opacity: 0.3; }\n');
      writeFileSync(join(root, "src/routes/+mobile.svelte"), '<View class="p-4 fixed" />\n');
      await until(() => readFileSync(tableFile(root), "utf8").includes('"fixed"'));
      expect(readFileSync(tableFile(root), "utf8")).toContain('"fixed"');
    } finally {
      watcher.close();
      error.mockRestore();
    }
  });
});
