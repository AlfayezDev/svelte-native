import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Compiles native code for the host and runs it, for the tests of rules that live in Kotlin or C++ (`tests/native-host/fixtures/*Host.kt`, `*.cpp`): a build is cached in the temp directory by a
 * digest of its input files, so a run compiles only what changed, and a build that is cut short never leaves a file that looks finished. Where the tools are found is
 * `tests/support/host-tools.ts`'s business (`native-tools.test.ts` fails on CI when one is missing); a test that needs `kotlinc` and `java` says
 * `test.skipIf(!hostTools("kotlinc", "java"))`.
 */
export const hostTools = (...names: string[]): boolean => names.every((name) => Bun.which(name) !== null);

function output(command: string[], stdin?: string): string {
  const result = Bun.spawnSync(command, { stdin: stdin === undefined ? undefined : new TextEncoder().encode(stdin), stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`${command[0]} failed: ${result.stderr.toString()}`);
  return result.stdout.toString();
}

/**
 * The path of `name` built from `inputs` by `command(target)`: the file is in the temp directory under a digest of the inputs' contents (and `flavour`, for what the command does
 * that the inputs do not say), and the command runs only when it is not there yet. The command writes to a path of its own, which is renamed when it succeeds.
 */
export function cachedBuild(options: { name: string; file: string; inputs: string[]; flavour?: string; command: (target: string) => string[] }): string {
  const digest = createHash("sha1");
  digest.update(options.flavour ?? "");
  for (const input of options.inputs) digest.update(readFileSync(input));
  const directory = join(tmpdir(), `svelte-native-${options.name}-${digest.digest("hex").slice(0, 12)}`);
  const target = join(directory, options.file);
  if (existsSync(target)) return target;
  mkdirSync(directory, { recursive: true });
  const building = join(directory, `building-${process.pid}-${options.file}`);
  output(options.command(building));
  renameSync(building, target);
  return target;
}

/** A Kotlin program the host runs: `sources` compiled to a jar with the runtime, which reads commands on stdin, one per line, and answers one line each. */
export function kotlinHost(options: { name: string; sources: string[]; /** Jars the program needs at compile and run time. */ classpath?: string[]; /** Default: the jar's own main class. */ mainClass?: string }) {
  const classpath = options.classpath ?? [];
  const jar = () => cachedBuild({
    name: options.name, file: `${options.name}.jar`, inputs: options.sources, flavour: classpath.join(":"),
    command: (target) => ["kotlinc", ...options.sources, ...(classpath.length ? ["-cp", classpath.join(":")] : []), "-include-runtime", "-d", target],
  });
  /** Runs the program with this stdin, in one process, and returns what it printed. */
  const runRaw = (stdin: string): string => {
    const command = options.mainClass ? ["java", "-cp", [jar(), ...classpath].join(":"), options.mainClass] : ["java", "-jar", jar()];
    return output(command, stdin);
  };
  return {
    jar,
    runRaw,
    /** Runs the program on the commands, one per line, and returns its answers, one per line. */
    run: (lines: string[]): string[] => runRaw(`${lines.join("\n")}\n`).trim().split("\n"),
  };
}

/** A C++ program the host runs: `sources` compiled with `flags` (`-I` directories included), run with a stdin. */
export function cppHost(options: { name: string; sources: string[]; flags?: string[]; /** Files that change the build but are not compiled (headers). */ dependencies?: string[] }) {
  const flags = options.flags ?? [];
  const binary = () => cachedBuild({
    name: options.name, file: options.name, inputs: [...options.sources, ...(options.dependencies ?? [])], flavour: flags.join(" "),
    command: (target) => ["g++", ...flags, ...options.sources, "-o", target],
  });
  return { binary, run: (stdin?: string): string => output([binary()], stdin) };
}
