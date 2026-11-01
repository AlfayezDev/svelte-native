import type { Dirent } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { execOk } from "../lib/exec.ts";
import { parseFlags } from "../lib/flags.ts";
import { containsAccount, requireAccount, variable } from "../lib/qa-account.ts";
import { qaDir, repoRoot, runsDir } from "../lib/paths.ts";

/**
 * Looks for the QA account's address (`RASHEED_QA_EMAIL`) where it must never be: in what is about to be committed (the lines the staged diff
 * adds, and with `--all` the changes and the files git does not track yet), in the run files and report the suites wrote, and in the
 * references' manifests. It prints file names and counts, never the address or the line it was found on, and exits 1 on a hit.
 * Run it before every commit that touches the harness, its references or its docs. It reads text: a reference image is kept clean by
 * the masks the suites paint over (`paintOver`), which no text search can check.
 */

async function files(directory: string, keep: (name: string) => boolean): Promise<string[]> {
	const found: string[] = [];
	let entries: Dirent[];
	try {
		entries = await readdir(directory, { withFileTypes: true, encoding: "utf8" });
	} catch {
		return found;
	}
	for (const entry of entries) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) found.push(...(await files(path, keep)));
		else if (keep(entry.name)) found.push(path);
	}
	return found;
}

async function fileHits(paths: string[]): Promise<string[]> {
	const hits: string[] = [];
	for (const path of paths) {
		try {
			if ((await stat(path)).size > 50_000_000) continue;
			if (containsAccount((await readFile(path)).toString("latin1"))) hits.push(relative(repoRoot, path));
		} catch {
			// a file that vanished between the listing and the read has nothing to leak
		}
	}
	return hits;
}

/**
 * The files of a unified diff whose added lines contain the address. A removed line is not a hit: it was committed once, and a check that refuses the
 * commit taking it out would leave the leak where it is.
 */
export function diffHits(diff: string): string[] {
	const hits: string[] = [];
	for (const part of diff.split(/^diff --git /m).slice(1)) {
		const name = /^a\/(.+?) b\//.exec(part)?.[1] ?? "(unknown file)";
		const added = part.split("\n").filter((line) => line.startsWith("+") && !line.startsWith("+++"));
		if (containsAccount(added.join("\n"))) hits.push(name);
	}
	return hits;
}

export async function leakcheck(argv: string[]): Promise<void> {
	const { values } = parseFlags(argv, { staged: { type: "boolean" }, all: { type: "boolean" } });
	requireAccount();
	const hits = new Set<string>();
	const scanned: string[] = [];

	scanned.push("the staged diff");
	for (const hit of diffHits(await execOk("git", ["diff", "--cached", "--no-color", "-U0"], { cwd: repoRoot }))) hits.add(`staged: ${hit}`);
	if (values.staged !== true) {
		scanned.push("the unstaged diff", "untracked files");
		for (const hit of diffHits(await execOk("git", ["diff", "--no-color", "-U0"], { cwd: repoRoot }))) hits.add(`unstaged: ${hit}`);
		const untracked = (await execOk("git", ["ls-files", "--others", "--exclude-standard"], { cwd: repoRoot })).split("\n").filter(Boolean);
		for (const hit of await fileHits(untracked.map((path) => join(repoRoot, path)))) hits.add(`untracked: ${hit}`);
	}
	if (values.all === true) {
		scanned.push("every tracked file");
		const tracked = (await execOk("git", ["ls-files"], { cwd: repoRoot })).split("\n").filter(Boolean);
		for (const hit of await fileHits(tracked.map((path) => join(repoRoot, path)))) hits.add(`tracked: ${hit}`);
	}
	scanned.push("the run files", "the report", "the manifests of the references");
	for (const hit of await fileHits([...(await files(runsDir, (name) => /\.(json|log|txt)$/.test(name))), join(qaDir, "report.json")])) hits.add(`run: ${hit}`);
	for (const hit of await fileHits(await files(join(qaDir, "screenshots"), (name) => name === "manifest.json"))) hits.add(`manifest: ${hit}`);

	if (hits.size > 0) {
		console.error(`leakcheck: the QA account's address (${variable}) is in ${hits.size} place(s):`);
		for (const hit of [...hits].sort()) console.error(`  ${hit}`);
		process.exitCode = 1;
		return;
	}
	console.log(`leakcheck: the QA account's address is not in ${scanned.join(", ")}`);
}
