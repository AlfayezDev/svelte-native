import * as nodeModule from "node:module";
import { readFileSync, realpathSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type * as SvelteCompiler from "svelte/compiler";

const require = nodeModule.createRequire(import.meta.url);

/**
 * Svelte's compiler, as the Metro transformer uses it (`transformer.ts`). Two things are done to load it.
 *
 * It is loaded from its sources. Metro loads the transformer as CommonJS, and under `require` the `svelte/compiler` export is Svelte's prebuilt bundle (`compiler/index.js`), which this
 * file's second step cannot reach; `import` resolves the export to the sources, so only a CommonJS load shows the difference (`tests/package/node-modules.test.ts`). Node `require`s an ES module from 22.12.
 *
 * The custom-renderer build refuses `transition:`, `in:`, `out:` and `animate:` on any element (`e.incompatible_with_custom_renderer`, in the two visitors that analyse them), and the
 * library plays them on native elements, so the two refusals are removed from the sources as Node loads them (`acceptDirectives`, through a synchronous module hook). This does not depend on
 * what the app's package manager did to Svelte: a pnpm patch is applied to a package of the registry but not, with pnpm 12 and a fresh store, to the one that `pkg.pr.new` serves (the
 * guide's install), and an app has no reason to carry one.
 */
let compiler: typeof SvelteCompiler | null = null;
export function svelteCompiler(): typeof SvelteCompiler {
  if (compiler) return compiler;
  const root = dirname(require.resolve("svelte/package.json"));
  acceptDirectivesIn(root);
  compiler = require(join(root, "src/compiler/index.js")) as typeof SvelteCompiler;
  return compiler;
}

const VISITORS = "src/compiler/phases/2-analyze/visitors";
const REFUSAL = "incompatible_with_custom_renderer";

/** The blocks of the two visitors that refuse the directives, exactly as Svelte 5.56.7's custom-renderer build has them (tabs, and the blank line after). */
const REFUSALS: Record<string, string> = {
  "TransitionDirective.js":
    "\tif (custom_renderer) {\n\t\tconst directive = node.intro && node.outro ? '`transition:`' : node.intro ? '`in:`' : '`out:`';\n\t\te.incompatible_with_custom_renderer(node, directive);\n\t}\n\n",
  "AnimateDirective.js": "\tif (custom_renderer) {\n\t\te.incompatible_with_custom_renderer(node, '`animate:`');\n\t}\n\n",
};

/**
 * The source of one of the two visitors without its refusal. A file that has none (it is patched, or a Svelte that accepts the directives) is returned as it is; one that refuses in a form
 * this does not know (a Svelte that was updated) fails, naming the file, instead of compiling with a refusal that would then surface as a compile error of the app's own file.
 */
export function acceptDirectives(file: string, source: string): string {
  if (!source.includes(REFUSAL)) return source;
  const block = REFUSALS[file];
  if (block === undefined) throw new Error(`${file} is not one of the Svelte files whose refusal of the transition directives is removed (${Object.keys(REFUSALS).join(", ")})`);
  if (!source.includes(block)) {
    throw new Error(
      `expo-svelte: ${file} of the installed Svelte refuses \`transition:\`, \`in:\`, \`out:\` and \`animate:\` on a custom renderer in a form this version of the library does not know how to remove ` +
        "(Svelte was updated: the library is written against the custom-renderer build 5.56.7 at commit 216f258, which the guide installs).",
    );
  }
  const accepted = source.replace(block, "");
  if (accepted.includes(`${REFUSAL}(`)) throw new Error(`expo-svelte: ${file} of the installed Svelte refuses a directive in more than one place`);
  return accepted;
}

type LoadResult = { format?: string | null; source?: string | ArrayBuffer | NodeJS.ArrayBufferView | null; shortCircuit?: boolean };
type Hooks = { load(url: string, context: object, next: (url: string, context?: object) => LoadResult): LoadResult };
let hookedFor: string | undefined;

/** Installs the hook that removes the refusals from the Svelte at [root], once per process, when that Svelte has them. */
function acceptDirectivesIn(root: string): void {
  if (hookedFor !== undefined) return;
  const needed = Object.keys(REFUSALS)
    .map((file) => realpathSync(join(root, VISITORS, file)))
    .filter((path) => readFileSync(path, "utf8").includes(REFUSAL));
  if (needed.length === 0) return;
  const register = (nodeModule as unknown as { registerHooks?: (hooks: Hooks) => unknown }).registerHooks;
  if (typeof register !== "function") {
    throw new Error(
      `expo-svelte: Svelte's compiler refuses \`transition:\`, \`in:\`, \`out:\` and \`animate:\` on native elements, and the Metro transformer removes the refusal as the compiler loads ` +
        `(\`module.registerHooks\`), which Node ${process.version} does not have: use Node 22.15 or newer (the library asks for 22.17, 24.3 or 26).`,
    );
  }
  register({
    load(url, context, next) {
      const result = next(url, context);
      if (!url.startsWith("file:") || result.source === undefined || result.source === null) return result;
      let path: string;
      try {
        path = realpathSync(fileURLToPath(url));
      } catch {
        return result;
      }
      if (!needed.includes(path)) return result;
      const text = typeof result.source === "string" ? result.source : Buffer.from(result.source as ArrayBuffer).toString("utf8");
      return { ...result, source: acceptDirectives(basename(path), text) };
    },
  });
  hookedFor = root;
}
