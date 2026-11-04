// The transformer Metro runs, on the files remote functions involve: the server module of a remote function is replaced by the client stubs before Metro reads
// its imports, and SvelteKit's client files get their globals. Runs under Node, which is what loads the transformer in Metro's workers.
import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { kitRoot } from "../src/remote/transform.ts";

const run = (cases: { filename: string; src?: string; root: string }[]) => {
  const done = spawnSync("node", [join(import.meta.dirname, "remote-transformer-probe.ts"), JSON.stringify(cases)], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (done.status !== 0) throw new Error(`the transformer failed:\n${done.stderr.slice(-2000)}`);
  return JSON.parse(done.stdout.trim().split("\n").at(-1) as string) as { filename: string; dependencies: string[] }[];
};

test("a remote module's imports are the runtime's alone: $app/server and the server code never reach Metro", () => {
  const root = "/work/apps/platform";
  const server = `import { query, command } from "$app/server";\nimport { db } from "$lib/server/db";\nimport * as v from "valibot";\nexport const list = query(async () => db.all());\nexport const add = command(v.string(), async (name) => db.add(name));\n`;
  const [remote, ordinary] = run([
    { filename: `${root}/src/lib/data.remote.ts`, src: server, root },
    { filename: `${root}/src/lib/data.ts`, src: `import { db } from "$lib/server/db";\nexport const x = db;\n`, root },
  ]);
  expect(remote.dependencies.filter((dependency) => !dependency.startsWith("@babel/runtime"))).toEqual(["@rasheed/svelte-native/remote/runtime"]);
  // Only remote modules are replaced.
  expect(ordinary.dependencies).toContain("$lib/server/db");
  // The same module under another name is not one.
  expect(run([{ filename: `${root}/src/lib/data.remotes.ts`, src: server, root }])[0].dependencies).toContain("$app/server");
});

test("SvelteKit's client files import their globals from the package, and files outside the list are untouched", () => {
  const kit = kitRoot();
  const root = "/work/apps/platform";
  const [shared, iterator, formUtils, transport] = run([
    { filename: join(kit, "src/runtime/client/remote-functions/shared.svelte.js"), root },
    { filename: join(kit, "src/runtime/client/remote-functions/query-live/iterator.js"), root },
    { filename: join(kit, "src/runtime/form-utils.js"), root },
    { filename: join(kit, "src/runtime/app/internal/transport.js"), root },
  ]);
  for (const file of [shared, iterator]) expect(file.dependencies).toContain("@rasheed/svelte-native/remote/globals");
  expect(formUtils.dependencies).toContain("@rasheed/svelte-native/remote/globals");
  expect(transport.dependencies).not.toContain("@rasheed/svelte-native/remote/globals");
  // The relative imports are still SvelteKit's (the resolver redirects the ones that are shims).
  expect(shared.dependencies).toContain("../client.js");
  expect(shared.dependencies).toContain("#app/state/client");
});
