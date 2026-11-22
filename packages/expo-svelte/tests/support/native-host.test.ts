import { expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { cachedBuild, cppHost, hostTools } from "./native-host.ts";
import { withProject } from "./project.ts";

const name = `support-test-${process.pid}`;
/** A build that writes `built` to its target and a line to `runs`, so a test counts how often the command ran. */
const build = (inputs: string[], runs: string, flavour = "") => cachedBuild({ name, file: "out.txt", inputs, flavour, command: (target) => ["sh", "-c", 'echo run >> "$1"; echo built > "$0"', target, runs] });
const count = (runs: string) => (existsSync(runs) ? readFileSync(runs, "utf8").trim().split("\n").length : 0);

test("a build runs once for its inputs, again when an input or the flavour changes, and its output is kept in the temp directory", async () => {
  await withProject({ "a.txt": "one", "b.txt": "two" }, (project) => {
    const runs = project.path("runs");
    const targets = new Set<string>();
    try {
      const first = build([project.path("a.txt"), project.path("b.txt")], runs);
      targets.add(first);
      expect(readFileSync(first, "utf8")).toBe("built\n");
      expect(build([project.path("a.txt"), project.path("b.txt")], runs)).toBe(first);
      expect(count(runs)).toBe(1);

      writeFileSync(project.path("a.txt"), "changed");
      const second = build([project.path("a.txt"), project.path("b.txt")], runs);
      targets.add(second);
      expect(second).not.toBe(first);
      expect(count(runs)).toBe(2);

      targets.add(build([project.path("a.txt"), project.path("b.txt")], runs, "with another flag"));
      expect(count(runs)).toBe(3);
      expect(targets.size).toBe(3);
    } finally {
      for (const target of targets) rmSync(dirname(target), { recursive: true, force: true });
    }
  });
});

test("a command that fails throws with what it printed and leaves no output that looks finished", async () => {
  await withProject({ "a.txt": "input" }, (project) => {
    const failing = () => cachedBuild({ name: `${name}-failing`, file: "out.txt", inputs: [project.path("a.txt")], command: (target) => ["sh", "-c", 'echo "no such symbol" >&2; echo half > "$0"; exit 3', target] });
    expect(failing).toThrow("no such symbol");
    expect(failing).toThrow("no such symbol");
  });
});

test("the tools a check needs are found on the path or reported missing", () => {
  expect(hostTools("sh")).toBe(true);
  expect(hostTools("sh", "a-tool-nobody-installed")).toBe(false);
});

test.skipIf(!hostTools("g++"))("a C++ program is compiled once and run with the stdin it is given", async () => {
  await withProject({ "lengths.cpp": '#include <iostream>\n#include <string>\nint main() { std::string line; while (std::getline(std::cin, line)) std::cout << line.size() << "\\n"; }\n' }, (project) => {
    const host = cppHost({ name: `${name}-cpp`, sources: [project.path("lengths.cpp")] });
    try {
      expect(host.run("ab\nabcd\n")).toBe("2\n4\n");
      expect(host.run("x\n")).toBe("1\n");
    } finally {
      rmSync(dirname(host.binary()), { recursive: true, force: true });
    }
  });
});
