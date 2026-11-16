import { expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { createProject, withProject } from "./project.ts";

const prefix = `svelte-native-project-test-${process.pid}-`;
const leftOver = () => readdirSync(tmpdir()).filter((name) => name.startsWith(prefix));

test("a project holds the files it was given, below directories it made, and `using` removes it", () => {
  let directory: string | undefined;
  {
    using project = createProject({ "src/routes/+page.svelte": "<p>a</p>", "package.json": "{}" }, prefix);
    directory = project.directory;
    expect(project.read("src/routes/+page.svelte")).toBe("<p>a</p>");
    expect(project.write("deep/er/file.txt", "b")).toBe(project.path("deep", "er", "file.txt"));
    expect(project.read("deep/er/file.txt")).toBe("b");
    expect(existsSync(directory)).toBe(true);
  }
  expect(directory && existsSync(directory)).toBe(false);
});

test("withProject removes the directory when the callback returns, and when it throws", async () => {
  const directories: string[] = [];
  expect(await withProject({ "a.txt": "x" }, (project) => { directories.push(project.directory); return project.read("a.txt"); })).toBe("x");
  await expect(withProject({}, (project) => { directories.push(project.directory); throw new Error("the test failed"); })).rejects.toThrow("the test failed");
  expect(directories).toHaveLength(2);
  expect(directories.map(existsSync)).toEqual([false, false]);
});

test("a project whose files cannot be written leaves no directory behind", () => {
  // `a` is a file by the time `a/b` wants it to be a directory.
  expect(() => createProject({ a: "file", "a/b": "inside" }, prefix)).toThrow();
  expect(leftOver()).toEqual([]);
});
