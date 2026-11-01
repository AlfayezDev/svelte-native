import { test, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";

/** svelte-check over the fixtures: `types-fixture.svelte` uses every builder method and `gesture` on each primitive and host tag; `types-errors-fixture.svelte` the uses that must fail. */
test("types: the builders, the attribute on every primitive, the sugar and the exports type-check, and the wrong uses do not", () => {
  const bin = createRequire(import.meta.url).resolve("svelte-check/bin/svelte-check");
  const result = spawnSync(process.execPath, [bin, "--tsconfig", resolve(import.meta.dirname, "tsconfig.json"), "--output", "machine"], { cwd: resolve(import.meta.dirname, "../.."), encoding: "utf8" });
  const problems = (result.stdout + result.stderr).split("\n").filter((line) => / (ERROR|WARNING) /.test(line));
  expect(problems.filter((line) => line.includes("types-fixture.svelte"))).toEqual([]);
  const errors = problems.filter((line) => line.includes("types-errors-fixture.svelte"));
  expect(errors).toHaveLength(4);
  expect(errors[0]).toContain("Property 'ForceTouch' does not exist");
  expect(errors[1]).toContain("Type 'number' is not assignable to type 'GestureAttribute'");
  expect(errors[2]).toContain("Type 'number' is not assignable to type 'GestureAttribute | undefined'");
  expect(errors[3]).toContain("Property 'gesture' is missing");
  expect(problems).toHaveLength(errors.length);
}, 60_000);
