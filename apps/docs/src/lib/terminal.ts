// A terminal block is written once, with npm commands, and shown with the reader's package manager:
//
//   ```sh terminal
//   npx sv create my-app
//   ```
//
// `terminalVariants` turns each line into the four package managers' spelling of it. A line that is not a package-manager command (a comment, `cd my-app`) is the same in all four.

export const PACKAGE_MANAGERS = ["npm", "yarn", "pnpm", "bun"] as const;
export type PackageManager = (typeof PACKAGE_MANAGERS)[number];

const DEV_FLAGS = new Set(["-D", "--save-dev", "-d"]);

function convertLine(line: string, manager: PackageManager): string {
	const indent = /^\s*/.exec(line)?.[0] ?? "";
	const words = line.trim().split(/\s+/);
	const [command, sub, ...rest] = words;
	const tail = (list: string[]) => (list.length ? ` ${list.join(" ")}` : "");

	if (command === "npx") {
		const args = words.slice(1).join(" ");
		return `${indent}${{ npm: "npx", yarn: "yarn dlx", pnpm: "pnpm dlx", bun: "bunx" }[manager]} ${args}`;
	}
	if (command !== "npm") return line;

	// npm install / npm i / npm add
	if (sub === "install" || sub === "i" || sub === "add") {
		const packages = rest.filter((word) => !DEV_FLAGS.has(word));
		const dev = rest.some((word) => DEV_FLAGS.has(word));
		if (!packages.length) return `${indent}${manager} install`;
		switch (manager) {
			case "npm":
				return `${indent}npm install${dev ? " -D" : ""}${tail(packages)}`;
			case "bun":
				return `${indent}bun add${dev ? " -d" : ""}${tail(packages)}`;
			default:
				return `${indent}${manager} add${dev ? " -D" : ""}${tail(packages)}`;
		}
	}
	// npm create <template>
	if (sub === "create") return `${indent}${manager} create${tail(rest)}`;
	// npm run <script>: yarn and pnpm run a script by its name
	if (sub === "run" && rest.length) return manager === "npm" || manager === "bun" ? `${indent}${manager} run${tail(rest)}` : `${indent}${manager}${tail(rest)}`;
	return line;
}

const isCommand = (line: string) => /^\s*(npx|npm)\b/.test(line);

/** The block in each package manager's spelling, and whether it has any command to translate: a block without one needs no tabs. */
export function terminalVariants(source: string): { variants: Record<PackageManager, string>; switchable: boolean } {
	const lines = source.replace(/\n+$/, "").split("\n");
	const variants = Object.fromEntries(PACKAGE_MANAGERS.map((manager) => [manager, lines.map((line) => (isCommand(line) ? convertLine(line, manager) : line)).join("\n")])) as Record<PackageManager, string>;
	return { variants, switchable: lines.some(isCommand) };
}

/** A line of a terminal block that starts with a prompt: not a blank line, a comment or the continuation of the line before. */
export const hasPrompt = (line: string) => line.trim() !== "" && !/^\s/.test(line) && !line.startsWith("#");
