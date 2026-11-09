import { spawn } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { TraceMap, originalPositionFor } from "@jridgewell/trace-mapping";
import { flagString, parseFlags } from "../lib/flags.ts";
import { outDir, repoRoot } from "../lib/paths.ts";
import { extractCrashes, frameLines, messageOf, type RawCrash } from "./signatures.ts";

/**
 * Turns the stacks of a failed run into file:line:column.
 *
 * JavaScript: the release bundle is Hermes bytecode, so a frame carries a bytecode offset, not a source position. Two
 * forms reach logcat: Hermes's own `at name (address at index.android.bundle:1:OFFSET)` (the offset is 0-based,
 * line 1) and React Native's fatal-exception text, `name@1:OFFSET` per frame (`JSStackTrace.format`). Both go through
 * the composed source map the build keeps next to the APK (`qa/out/app-<abi>.bundle.map`).
 *
 * Native: `ndk-stack` over the original logcat lines of a tombstone, with the unstripped libraries the build keeps
 * (`qa/out/app-<abi>.symbols/`).
 */

export type Symbolizer = {
	map: TraceMap | null;
	symbolsDir: string | null;
	ndkStack: string | null;
};

const hermesFrame = /^(.*?\bat\s+)(.*?)\s*\(address at\s+\S+?:(\d+):(\d+)\)\s*$/;
const reactNativeFrame = /^(.*?)([^\s@]*)@(?:\S+?\.js:)?(\d+):(\d+)\s*$/;

/** `packages/svelte-native/src/init.ts:65:11`, from a source position the map gives (its paths start at the repository root). */
function formatPosition(source: string, line: number, column: number): string {
	return `${source.replace(/^\/+/, "")}:${line}:${column + 1}`;
}

/** Where a bytecode offset on line `line` came from, or null when the map has nothing there. */
export function originalFrame(
	map: TraceMap,
	line: number,
	offset: number,
): { text: string; name: string | null } | null {
	const position = originalPositionFor(map, { line, column: offset });
	if (position.source === null || position.line === null || position.column === null) return null;
	return {
		text: formatPosition(position.source, position.line, position.column),
		name: position.name,
	};
}

/**
 * One log line with its JavaScript frame rewritten to the original position, or the line unchanged when it is not a
 * bytecode frame or the map has no position for it. React Native's `name@line:offset` form only counts on line 1,
 * where Hermes puts every bytecode frame; `foo@12:3` elsewhere is not a bytecode offset.
 */
export function symbolicateJsLine(line: string, map: TraceMap): string {
	const hermes = hermesFrame.exec(line);
	if (hermes) {
		const [, prefix, name, lineText, offsetText] = hermes;
		const found = originalFrame(map, Number(lineText), Number(offsetText));
		return found ? `${prefix}${found.name ?? name} (${found.text})` : line;
	}
	const native = reactNativeFrame.exec(line);
	if (native && native[3] === "1") {
		const [, prefix, name, , offsetText] = native;
		const found = originalFrame(map, 1, Number(offsetText));
		return found ? `${prefix}at ${found.name ?? name} (${found.text})` : line;
	}
	return line;
}

export function symbolicateJs(text: string, map: TraceMap): string {
	return text
		.split("\n")
		.map((line) => symbolicateJsLine(line, map))
		.join("\n");
}

/** `ndk-stack`: the `ANDROID_NDK_HOME` one, else the newest in the SDK's `ndk/` directory, else the one on the path. */
export async function findNdkStack(): Promise<string | null> {
	const candidates: string[] = [];
	if (process.env.ANDROID_NDK_HOME)
		candidates.push(join(process.env.ANDROID_NDK_HOME, "ndk-stack"));
	for (const sdk of [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT]) {
		if (!sdk) continue;
		let versions: string[];
		try {
			versions = await readdir(join(sdk, "ndk"));
		} catch (error) {
			if (error instanceof Error && "code" in error && error.code === "ENOENT") continue;
			throw error;
		}
		for (const version of versions.sort().reverse())
			candidates.push(join(sdk, "ndk", version, "ndk-stack"));
	}
	for (const dir of (process.env.PATH ?? "").split(":"))
		if (dir) candidates.push(join(dir, "ndk-stack"));
	for (const candidate of candidates) {
		try {
			if ((await stat(candidate)).isFile()) return candidate;
		} catch (error) {
			if (error instanceof Error && "code" in error && error.code === "ENOENT") continue;
			throw error;
		}
	}
	return null;
}

function run(
	command: string,
	args: string[],
	input: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
		child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
		child.on("error", reject);
		child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
		child.stdin.end(input);
	});
}

/**
 * The frames of ndk-stack's output (NDK r27 format), one string each: `#00 name (file:line:column)`, or
 * `#02 libname.so+0xpc` for a frame the symbols did not cover. Each frame is a `#NN 0xPC path` line followed by an
 * indented function name and an indented `file:line:column` per inlined level; the innermost level is the one shown.
 * Paths under `root` are shown relative to it.
 */
export function parseNdkStack(output: string, root: string): string[] {
	const frames: string[] = [];
	let current: { index: string; pc: string; library: string; details: string[] } | null = null;
	const finish = () => {
		if (!current) return;
		const [name, location] = current.details;
		frames.push(
			name !== undefined && location !== undefined
				? `${current.index} ${name} (${location.startsWith(root) ? location.slice(root.length) : location})`
				: `${current.index} ${current.library}+0x${current.pc.replace(/^0+/, "") || "0"}`,
		);
		current = null;
	};
	for (const line of output.split("\n")) {
		const header = /^(#\d+)\s+0x([0-9a-f]+)\s+(\S+)/.exec(line);
		if (header?.[1] && header[2] && header[3]) {
			finish();
			const path = header[3];
			current = {
				index: header[1],
				pc: header[2],
				library: path.slice(path.lastIndexOf("/") + 1),
				details: [],
			};
		} else if (current && /^\s+\S/.test(line)) current.details.push(line.trim());
		else finish();
	}
	finish();
	return frames;
}

/** A native crash's frames through ndk-stack; throws when the tool fails, returns [] when it found no frame to resolve. */
export async function symbolicateNative(
	raw: string[],
	symbolsDir: string,
	ndkStack: string,
): Promise<string[]> {
	const result = await run(ndkStack, ["-sym", symbolsDir], `${raw.join("\n")}\n`);
	if (result.code !== 0)
		throw new Error(`ndk-stack exited with ${result.code}: ${result.stderr.trim().slice(0, 400)}`);
	return parseNdkStack(result.stdout, `${repoRoot}/`);
}

export async function loadSymbolizer(options: {
	map?: string;
	symbols?: string;
	abi?: string;
}): Promise<Symbolizer> {
	const abi = options.abi ?? "x86_64";
	const mapPath = options.map ?? join(outDir, `app-${abi}.bundle.map`);
	const symbolsDir = options.symbols ?? join(outDir, `app-${abi}.symbols`);
	const map = await readOptional(
		mapPath,
		async () => new TraceMap(await readFile(mapPath, "utf8")),
	);
	const symbols = await readOptional(symbolsDir, async () =>
		(await stat(symbolsDir)).isDirectory() ? symbolsDir : null,
	);
	return { map, symbolsDir: symbols, ndkStack: symbols ? await findNdkStack() : null };
}

async function readOptional<T>(path: string, load: () => Promise<T | null>): Promise<T | null> {
	try {
		return await load();
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
		throw new Error(`${path}: ${error instanceof Error ? error.message : String(error)}`, {
			cause: error,
		});
	}
}

export type SymbolicatedCrash = { crash: RawCrash; frames: string[]; symbolicated: boolean };

/**
 * The frames of one crash, symbolicated as far as the map and the symbols reach: JavaScript frames through the source
 * map, native frames through ndk-stack. `symbolicated` is true when at least one frame was resolved.
 */
export async function symbolicateCrash(
	crash: RawCrash,
	symbolizer: Symbolizer,
): Promise<SymbolicatedCrash> {
	const plain = frameLines(crash.raw);
	let frames = plain;
	let symbolicated = false;
	if (symbolizer.map) {
		const rewritten = crash.raw.map((line) =>
			symbolicateJsLine(messageOf(line), symbolizer.map as TraceMap),
		);
		const original = crash.raw.map(messageOf);
		if (rewritten.some((line, index) => line !== original[index])) {
			frames = frameLines(rewritten);
			symbolicated = true;
		}
	}
	if (crash.kind === "native" && symbolizer.symbolsDir && symbolizer.ndkStack) {
		const native = await symbolicateNative(crash.raw, symbolizer.symbolsDir, symbolizer.ndkStack);
		if (native.length > 0) {
			frames = native;
			symbolicated = true;
		}
	}
	return { crash, frames, symbolicated };
}

async function readInput(path: string | undefined): Promise<string> {
	if (path !== undefined && path !== "-") return readFile(path, "utf8");
	const chunks: Buffer[] = [];
	for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
	return Buffer.concat(chunks).toString("utf8");
}

const usage = `usage: node qa/soak/symbolicate.ts [--input <logcat file> | -] [--package <id>] [--map <file>] [--symbols <dir>] [--abi x86_64] [--all]
  Reads a logcat capture (stdin by default) and prints every crash of the package with its frames resolved:
  JavaScript through the source map (default qa/out/app-<abi>.bundle.map), native through ndk-stack with the
  unstripped libraries (default qa/out/app-<abi>.symbols/). --all prints the whole capture with every JavaScript
  frame rewritten instead.`;

export async function symbolicate(argv: string[]): Promise<void> {
	const { values } = parseFlags(argv, {
		input: { type: "string" },
		package: { type: "string" },
		map: { type: "string" },
		symbols: { type: "string" },
		abi: { type: "string" },
		all: { type: "boolean" },
		help: { type: "boolean" },
	});
	if (values.help) {
		console.log(usage);
		return;
	}
	const text = await readInput(flagString(values.input));
	const symbolizer = await loadSymbolizer({
		map: flagString(values.map),
		symbols: flagString(values.symbols),
		abi: flagString(values.abi),
	});
	if (!symbolizer.map)
		console.error(
			"no source map: JavaScript frames stay as bytecode offsets (build with `native-qa build` or pass --map)",
		);
	if (symbolizer.symbolsDir && !symbolizer.ndkStack)
		console.error(
			"no ndk-stack found (set ANDROID_NDK_HOME or ANDROID_HOME): native frames stay unresolved",
		);
	if (values.all) {
		if (!symbolizer.map) throw new Error("--all needs a source map");
		process.stdout.write(symbolicateJs(text, symbolizer.map));
		return;
	}
	const crashes = extractCrashes(text, flagString(values.package) ?? "io.example.svelteqa");
	if (crashes.length === 0) console.log("no crash of the package in the capture");
	for (const crash of crashes) {
		const result = await symbolicateCrash(crash, symbolizer);
		console.log(
			`${crash.kind}: ${crash.title}${result.symbolicated ? "" : "  [frames not symbolicated]"}`,
		);
		for (const frame of result.frames) console.log(`    ${frame}`);
	}
}

if (import.meta.main) {
	try {
		await symbolicate(process.argv.slice(2));
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}
