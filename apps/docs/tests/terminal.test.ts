import { describe, expect, test } from "bun:test";

import { hasPrompt, terminalVariants } from "../src/lib/terminal";

/** The command in each manager's spelling, for a block of one line. */
const of = (line: string) => {
	const { variants, switchable } = terminalVariants(line);
	return { switchable, npm: variants.npm, yarn: variants.yarn, pnpm: variants.pnpm, bun: variants.bun };
};

describe("npx", () => {
	test("is dlx, or bunx", () => {
		expect(of("npx sv create my-app --template minimal")).toEqual({
			switchable: true,
			npm: "npx sv create my-app --template minimal",
			yarn: "yarn dlx sv create my-app --template minimal",
			pnpm: "pnpm dlx sv create my-app --template minimal",
			bun: "bunx sv create my-app --template minimal",
		});
	});
	test("-y is npx's alone", () => {
		expect(of("npx -y create-foo app")).toEqual({ switchable: true, npm: "npx -y create-foo app", yarn: "yarn dlx create-foo app", pnpm: "pnpm dlx create-foo app", bun: "bunx create-foo app" });
	});
	test("another flag before the package is not translated", () => {
		expect(of("npx --no-install foo").switchable).toBe(false);
		expect(of("npx -p foo bar").switchable).toBe(false);
	});
});

describe("npm install", () => {
	test("a package, a dev package, an exact one", () => {
		expect(of("npm install zod")).toMatchObject({ yarn: "yarn add zod", pnpm: "pnpm add zod", bun: "bun add zod" });
		expect(of("npm install -D tailwindcss@4.3.3")).toMatchObject({ npm: "npm install -D tailwindcss@4.3.3", yarn: "yarn add -D tailwindcss@4.3.3", pnpm: "pnpm add -D tailwindcss@4.3.3", bun: "bun add -d tailwindcss@4.3.3" });
		expect(of("npm i --save-dev --save-exact a b")).toMatchObject({ npm: "npm install -D -E a b", yarn: "yarn add -D --exact a b", pnpm: "pnpm add -D --save-exact a b", bun: "bun add -d --exact a b" });
		expect(of("npm install zod -D")).toMatchObject({ yarn: "yarn add -D zod", bun: "bun add -d zod" });
		expect(of('npm install "zod@^3"')).toMatchObject({ pnpm: 'pnpm add "zod@^3"' });
	});
	test("global", () => {
		expect(of("npm install -g typescript")).toMatchObject({ npm: "npm install -g typescript", yarn: "yarn global add typescript", pnpm: "pnpm add -g typescript", bun: "bun add -g typescript" });
		expect(of("npm i --global a b")).toMatchObject({ yarn: "yarn global add a b", pnpm: "pnpm add -g a b" });
	});
	test("nothing to add installs the dependencies", () => {
		expect(of("npm install")).toEqual({ switchable: true, npm: "npm install", yarn: "yarn install", pnpm: "pnpm install", bun: "bun install" });
	});
	test("a flag the others have no equivalent of keeps the block as written", () => {
		const block = of("npm install --legacy-peer-deps zod");
		expect(block.switchable).toBe(false);
		expect(block.pnpm).toBe("npm install --legacy-peer-deps zod");
		expect(of("npm install --force").switchable).toBe(false);
		expect(of("npm install --save-optional x").switchable).toBe(false);
		expect(of("npm install -D").switchable).toBe(false);
	});
});

describe("other npm commands", () => {
	test("uninstall is remove", () => {
		expect(of("npm uninstall zod")).toMatchObject({ yarn: "yarn remove zod", pnpm: "pnpm remove zod", bun: "bun remove zod" });
		expect(of("npm rm -g zod")).toMatchObject({ npm: "npm uninstall -g zod", yarn: "yarn global remove zod", pnpm: "pnpm remove -g zod", bun: "bun remove -g zod" });
	});
	test("run is run: pnpm run, never a bare pnpm <script>", () => {
		expect(of("npm run dev")).toEqual({ switchable: true, npm: "npm run dev", yarn: "yarn run dev", pnpm: "pnpm run dev", bun: "bun run dev" });
		expect(of("npm run audit").pnpm).toBe("pnpm run audit");
	});
	test("run passes flags after --, which the others do not need", () => {
		expect(of("npm run dev -- --port 3000")).toEqual({ switchable: true, npm: "npm run dev -- --port 3000", yarn: "yarn run dev --port 3000", pnpm: "pnpm run dev --port 3000", bun: "bun run dev --port 3000" });
		// without it the flag is npm's own
		expect(of("npm run dev --port 3000").switchable).toBe(false);
		expect(of("npm run").switchable).toBe(false);
	});
	test("test runs the script, in Bun too (`bun test` is Bun's own runner)", () => {
		expect(of("npm test")).toEqual({ switchable: true, npm: "npm test", yarn: "yarn test", pnpm: "pnpm test", bun: "bun run test" });
		expect(of("npm test -- --watch")).toMatchObject({ yarn: "yarn test --watch", bun: "bun run test --watch" });
		expect(of("npm t")).toMatchObject({ npm: "npm test" });
	});
	test("ci is a frozen install", () => {
		expect(of("npm ci")).toEqual({ switchable: true, npm: "npm ci", yarn: "yarn install --frozen-lockfile", pnpm: "pnpm install --frozen-lockfile", bun: "bun install --frozen-lockfile" });
		expect(of("npm ci --omit=dev").switchable).toBe(false);
	});
	test("init and create", () => {
		expect(of("npm init")).toMatchObject({ npm: "npm init", yarn: "yarn init", pnpm: "pnpm init", bun: "bun init" });
		expect(of("npm init -y")).toMatchObject({ npm: "npm init -y", yarn: "yarn init -y", pnpm: "pnpm init", bun: "bun init -y" });
		expect(of("npm init svelte@latest my-app")).toMatchObject({ npm: "npm create svelte@latest my-app", yarn: "yarn create svelte@latest my-app", pnpm: "pnpm create svelte@latest my-app", bun: "bun create svelte@latest my-app" });
		expect(of("npm create vite@latest app -- --template svelte")).toMatchObject({ npm: "npm create vite@latest app -- --template svelte", pnpm: "pnpm create vite@latest app --template svelte" });
	});
	test("a command with no translation keeps the block as written", () => {
		expect(of("npm update").switchable).toBe(false);
		expect(of("npm link").switchable).toBe(false);
		expect(of("npm install -g").switchable).toBe(false);
	});
});

describe("a block", () => {
	test("keeps what is not a package-manager command, and comments", () => {
		const { variants, switchable } = terminalVariants("# install\nnpm install -D zod # the schema library\ncd my-app\n\nnpx sv check");
		expect(switchable).toBe(true);
		expect(variants.pnpm).toBe("# install\npnpm add -D zod # the schema library\ncd my-app\n\npnpm dlx sv check");
		expect(variants.npm).toBe("# install\nnpm install -D zod # the schema library\ncd my-app\n\nnpx sv check");
	});
	test("variables in front stay in front, and && joins commands each translated", () => {
		expect(of("CI=1 npm install")).toMatchObject({ pnpm: "CI=1 pnpm install" });
		expect(of("npm install && npm run build")).toMatchObject({ yarn: "yarn install && yarn run build", pnpm: "pnpm install && pnpm run build", bun: "bun install && bun run build" });
		expect(of("cd app && npm ci")).toMatchObject({ pnpm: "cd app && pnpm install --frozen-lockfile" });
	});
	test("a chain that is not && is not taken apart", () => {
		expect(of("npm run build | tee log").switchable).toBe(false);
		expect(of("npm run build; npm test").switchable).toBe(false);
		expect(of("npm run build > out.txt").switchable).toBe(false);
		expect(of("sudo npm install -g zod").switchable).toBe(false);
	});
	test("a block with no npm command has no tabs", () => {
		expect(terminalVariants("cd my-app\nls").switchable).toBe(false);
	});
	test("a block that already has another manager's command is shown as written", () => {
		const { variants, switchable } = terminalVariants("npm install\npnpm exec foo");
		expect(switchable).toBe(false);
		expect(variants.yarn).toBe("npm install\npnpm exec foo");
	});
	test("a command that goes over several lines is shown as written", () => {
		expect(terminalVariants("npm install \\\n  zod").switchable).toBe(false);
	});
	test("indentation is kept", () => {
		expect(terminalVariants("  npm install zod").variants.pnpm).toBe("  pnpm add zod");
	});
});

test("a prompt starts a command, not a blank line, a comment or a continuation", () => {
	expect(hasPrompt("pnpm add zod")).toBe(true);
	expect(hasPrompt("")).toBe(false);
	expect(hasPrompt("# note")).toBe(false);
	expect(hasPrompt("  zod")).toBe(false);
});
