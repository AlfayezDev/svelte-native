// A terminal block is written once, with npm commands, and shown with the reader's package manager:
//
//   ```sh terminal
//   npx sv create my-app
//   ```
//
// `terminalVariants` turns each npm command into the four package managers' spelling of it. What is not a package-manager command (a comment,
// `cd my-app`) is the same in all four. A command it cannot translate faithfully (an npm flag the others have no equivalent of, such as
// `--legacy-peer-deps`; a pipe; `sudo npm ...`; a block that already has yarn, pnpm or bun commands in it) makes the whole block
// `switchable: false`: it is shown as written, with no tabs, rather than as a command that does something else.

export const PACKAGE_MANAGERS = ["npm", "yarn", "pnpm", "bun"] as const;
export type PackageManager = (typeof PACKAGE_MANAGERS)[number];

/** The four spellings of one command, or undefined when there is no faithful translation. */
type Spelling = Record<PackageManager, string> | undefined;

/** The words of a command line: a run of characters and quoted strings is one word. */
const WORD = /(?:[^\s"']+|"[^"]*"|'[^']*')+/g;

const spell = (npm: string, yarn: string, pnpm: string, bun: string): Spelling => ({ npm, yarn, pnpm, bun });
const join = (...parts: (string | string[])[]) => parts.flat().filter(Boolean).join(" ");
const isNpm = (word: string) => word === "npm" || word === "npx";

const DEV = new Set(["-D", "--save-dev"]);
const SAVE = new Set(["-S", "--save"]);
const EXACT = new Set(["-E", "--save-exact"]);
const GLOBAL = new Set(["-g", "--global"]);

/** The flags among the arguments of `npm install` and `npm uninstall` (they may come anywhere), and the packages. Undefined when a flag is not one of `known`. */
function split(words: string[], known: Set<string>) {
	const flags = words.filter((word) => word.startsWith("-"));
	if (flags.some((flag) => !known.has(flag))) return undefined;
	return { flags, packages: words.filter((word) => !word.startsWith("-")) };
}

/** `npm install` and its relatives. The flags that mean the same everywhere are `-D`, `-E` and `-g`; any other flag has no equivalent to promise. */
function install(words: string[]): Spelling {
	const parsed = split(words, new Set([...DEV, ...SAVE, ...EXACT, ...GLOBAL]));
	if (!parsed) return undefined;
	const { flags, packages } = parsed;
	const dev = flags.some((flag) => DEV.has(flag));
	const exact = flags.some((flag) => EXACT.has(flag));
	const global = flags.some((flag) => GLOBAL.has(flag));
	// Bare `npm install` installs the project's dependencies: a flag that adds a kind of dependency makes no sense there.
	if (!packages.length) return flags.length ? undefined : spell("npm install", "yarn install", "pnpm install", "bun install");
	if (global) return dev || exact ? undefined : spell(join("npm install -g", packages), join("yarn global add", packages), join("pnpm add -g", packages), join("bun add -g", packages));
	return spell(
		join("npm install", dev ? "-D" : "", exact ? "-E" : "", packages),
		join("yarn add", dev ? "-D" : "", exact ? "--exact" : "", packages),
		join("pnpm add", dev ? "-D" : "", exact ? "--save-exact" : "", packages),
		join("bun add", dev ? "-d" : "", exact ? "--exact" : "", packages),
	);
}

function uninstall(words: string[]): Spelling {
	const parsed = split(words, new Set([...DEV, ...SAVE, ...GLOBAL]));
	if (!parsed?.packages.length) return undefined;
	const { flags, packages } = parsed;
	if (flags.some((flag) => GLOBAL.has(flag))) return spell(join("npm uninstall -g", packages), join("yarn global remove", packages), join("pnpm remove -g", packages), join("bun remove -g", packages));
	return spell(join("npm uninstall", packages), join("yarn remove", packages), join("pnpm remove", packages), join("bun remove", packages));
}

/** The words after the first `--`, which npm needs to pass flags on to a script and the others do not; and whether the words before it have a flag, which npm would take for its own. */
function passed(words: string[]) {
	const at = words.indexOf("--");
	const before = at === -1 ? words : words.slice(0, at);
	return { before, after: at === -1 ? [] : words.slice(at + 1), npmFlag: before.some((word) => word.startsWith("-")) };
}

/** `npm run dev -- --port 3000`. `pnpm run`, not `pnpm dev`: a script named `audit` or `list` is the script's, not pnpm's own command. */
function run(words: string[]): Spelling {
	const [script, ...args] = words;
	if (!script || script.startsWith("-")) return undefined;
	const { before, after, npmFlag } = passed(args);
	if (npmFlag) return undefined;
	const rest = [...before, ...after];
	return spell(join("npm run", words), join("yarn run", script, rest), join("pnpm run", script, rest), join("bun run", script, rest));
}

/** `npm test` runs the project's `test` script. `bun test` is Bun's own test runner, so Bun runs the script by its name. */
function test(words: string[]): Spelling {
	const { before, after, npmFlag } = passed(words);
	if (npmFlag) return undefined;
	const rest = [...before, ...after];
	return spell(join("npm test", words), join("yarn test", rest), join("pnpm test", rest), join("bun run test", rest));
}

function create(words: string[]): Spelling {
	if (!words.length || words[0].startsWith("-")) return undefined;
	const at = words.indexOf("--");
	const rest = at === -1 ? words : [...words.slice(0, at), ...words.slice(at + 1)];
	return spell(join("npm create", words), join("yarn create", rest), join("pnpm create", rest), join("bun create", rest));
}

function init(words: string[]): Spelling {
	if (!words.length) return spell("npm init", "yarn init", "pnpm init", "bun init");
	if (words.every((word) => word === "-y" || word === "--yes")) return spell(join("npm init", words), "yarn init -y", "pnpm init", "bun init -y");
	// `npm init <initializer>` is `npm create <initializer>`
	return create(words);
}

function npm(words: string[]): Spelling {
	const [command, ...rest] = words;
	switch (command) {
		case "install":
		case "i":
		case "add":
			return install(rest);
		case "uninstall":
		case "remove":
		case "rm":
		case "un":
			return uninstall(rest);
		case "run":
		case "run-script":
			return run(rest);
		case "test":
		case "t":
			return test(rest);
		case "ci":
			return rest.length ? undefined : spell("npm ci", "yarn install --frozen-lockfile", "pnpm install --frozen-lockfile", "bun install --frozen-lockfile");
		case "create":
			return create(rest);
		case "init":
			return init(rest);
		default:
			return undefined;
	}
}

/** `npx [-y] <package> <arguments>`: the dlx of each. Only `-y` / `--yes`, which the others never ask for, may come before the package. */
function npx(words: string[]): Spelling {
	const skip = words.findIndex((word) => word !== "-y" && word !== "--yes");
	const rest = skip === -1 ? [] : words.slice(skip);
	if (!rest.length || rest[0].startsWith("-")) return undefined;
	return spell(join("npx", words), join("yarn dlx", rest), join("pnpm dlx", rest), join("bunx", rest));
}

/** `yarn add x` written by hand in a block meant to be translated is not translated: the block is shown as written. */
const OTHER_MANAGER = /^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*(?:yarn|pnpm|pnpx|bun|bunx|corepack)\b/;

/** The spelling of one command line: `undefined` when the line is not a package-manager command, `null` when it is one and has no faithful translation. */
function convertLine(line: string): Spelling | null {
	if (OTHER_MANAGER.test(line)) return null;
	const indent = /^\s*/.exec(line)?.[0] ?? "";
	const words = line.trim().match(WORD) ?? [];
	// A trailing comment stays as it is.
	const hash = words.findIndex((word) => word.startsWith("#"));
	const command = hash === -1 ? words : words.slice(0, hash);
	const comment = hash === -1 ? "" : ` ${words.slice(hash).join(" ")}`;
	if (!command.some(isNpm)) return undefined;

	// `a && b`: each part is converted by itself. Anything else that chains, pipes or redirects is not translated.
	const parts: string[][] = [[]];
	for (const word of command) {
		if (word === "&&") parts.push([]);
		else if (/[|;<>&`]|\$\(/.test(word.replace(/"[^"]*"|'[^']*'/g, ""))) return null;
		else parts.at(-1)?.push(word);
	}

	const converted: Record<PackageManager, string>[] = [];
	for (const part of parts) {
		// `CI=1 npm install`: the variables in front stay in front.
		const variables: string[] = [];
		while (part.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(part[0])) variables.push(part.shift() as string);
		const [program, ...rest] = part;
		const prefix = variables.length ? `${variables.join(" ")} ` : "";
		if (!part.some(isNpm)) {
			const plain = `${prefix}${part.join(" ")}`;
			converted.push({ npm: plain, yarn: plain, pnpm: plain, bun: plain });
			continue;
		}
		// `sudo npm ...` and `time npm ...` are not translated.
		const spelling = program === "npm" ? npm(rest) : program === "npx" ? npx(rest) : undefined;
		if (!spelling) return null;
		converted.push(Object.fromEntries(PACKAGE_MANAGERS.map((manager) => [manager, `${prefix}${spelling[manager]}`])) as Record<PackageManager, string>);
	}
	return Object.fromEntries(PACKAGE_MANAGERS.map((manager) => [manager, `${indent}${converted.map((part) => part[manager]).join(" && ")}${comment}`])) as Record<PackageManager, string>;
}

/**
 * The block in each package manager's spelling. `switchable` is false when the block has no package-manager command (nothing to translate, so no
 * tabs) or has one that cannot be translated faithfully: every variant is then the block as written.
 */
export function terminalVariants(source: string): { variants: Record<PackageManager, string>; switchable: boolean } {
	const lines = source.replace(/\n+$/, "").split("\n");
	const written = lines.join("\n");
	const asWritten = { variants: { npm: written, yarn: written, pnpm: written, bun: written }, switchable: false };

	const spelled = lines.map((line, index): Spelling | null => {
		if (line.trim() === "" || line.trimStart().startsWith("#")) return undefined;
		// A line that goes on (a trailing backslash) or continues the one before is not taken apart: with a package-manager command in it, the block is shown as written.
		const continues = index > 0 && /\\\s*$/.test(lines[index - 1]);
		if (continues || /\\\s*$/.test(line)) return /\b(npm|npx|yarn|pnpm|bunx?)\b/.test(line) ? null : undefined;
		return convertLine(line);
	});
	if (spelled.includes(null) || !spelled.some(Boolean)) return asWritten;
	const variants = Object.fromEntries(PACKAGE_MANAGERS.map((manager) => [manager, lines.map((line, index) => spelled[index]?.[manager] ?? line).join("\n")])) as Record<PackageManager, string>;
	return { variants, switchable: true };
}

/** A line of a terminal block that starts with a prompt: not a blank line, a comment or the continuation of the line before. */
export const hasPrompt = (line: string) => line.trim() !== "" && !/^\s/.test(line) && !line.startsWith("#");
