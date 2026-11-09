import type { Dirent } from "node:fs";
import { readdir, readFile, rm, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { execOk } from "../lib/exec.ts";
import { parseFlags } from "../lib/flags.ts";
import { accountEmail, containsAccount, containsAddress, requireAccount, variable } from "../lib/qa-account.ts";
import { outDir, qaDir, repoRoot, runsDir } from "../lib/paths.ts";

/**
 * Looks for the QA account's address (`QA_ACCOUNT_EMAIL`) where it must never be: in the files the CI uploads (the run files and the evidence of failed tries under
 * qa/runs, the lane logs, the build records and gates tables of qa/out, the report), in what is about to be committed (the lines the staged diff adds, and with
 * `--all` the changes and the files git does not track yet) and in the references' manifests. It prints file names and counts, never the address or the line it was
 * found on, and exits 1 on a hit.
 *
 * The uploaded files are read first, before anything that needs git, and `--purge` deletes the ones that hold the address (the workflow uploads them as an artifact for
 * days, and its upload step runs after a failure too). A file that holds only the fixed sign-in code is reported and kept: six digits can be a pixel count. `--artifacts`
 * reads those files and nothing else, with no git at all, and does nothing when no account is configured: it is what the CI runs on every way out of the lane.
 * Run it before every commit that touches the harness, its references or its docs. It reads text: a reference image or a failure screenshot is kept clean by
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

/** The files of `qa/runs` that hold text: the run files and logs, and the failed tries' evidence (the raw dump is XML). */
export const runTextFile = (name: string): boolean => /\.(json|log|txt|xml)$/.test(name);

/** The files of `qa/out` the workflow uploads (`qa/out/*.log`, `build-*.json`, `lane-stages.tsv`, `gates*.md`): the lane logs are copies of console output. */
export const uploadedOutFile = (name: string): boolean => /^(?:.*\.log|build-.*\.json|lane-stages\.tsv|gates.*\.md)$/.test(name);

export type UploadedHit = {
	/** Relative to the directory the caller named. */
	path: string;
	/** `address`: the address is in it. `code`: only the fixed sign-in code is, which is reported and never deleted. */
	kind: "address" | "code";
	deleted: boolean;
	/** Why a file that should have been deleted was not. */
	failed?: string;
};

/**
 * The files the CI uploads that contain the account: every text file under `runs`, the files of `out` that `uploadedOutFile` names, and the report. With `purge` the
 * ones that hold the address are deleted, the lane logs among them, and a hit on the code alone is reported and kept. A file that cannot be deleted is a hit with
 * `failed`, never a silent pass.
 */
export async function artifactHits(places: { runs: string; out: string; report: string }, relativeTo: string, purge = false): Promise<UploadedHit[]> {
	let outNames: string[] = [];
	try {
		outNames = (await readdir(places.out)).filter(uploadedOutFile);
	} catch {
		// no qa/out: no lane logs
	}
	const paths = [...(await files(places.runs, runTextFile)), ...outNames.map((name) => join(places.out, name)), places.report];
	const hits: UploadedHit[] = [];
	for (const path of paths) {
		let text: string;
		try {
			if ((await stat(path)).size > 50_000_000) continue;
			text = (await readFile(path)).toString("latin1");
		} catch {
			// a file that is not there has nothing to leak
			continue;
		}
		const address = containsAddress(text);
		if (!address && !containsAccount(text)) continue;
		const hit: UploadedHit = { path: relative(relativeTo, path), kind: address ? "address" : "code", deleted: false };
		if (address && purge) {
			try {
				await rm(path, { force: true });
				hit.deleted = true;
			} catch (error) {
				hit.failed = (error instanceof Error ? error.message : String(error)).slice(0, 160);
			}
		}
		hits.push(hit);
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

/** What the command works on; tests hand a directory of their own and a git that fails. */
export type LeakcheckDeps = {
	places?: { runs: string; out: string; report: string };
	git?: (args: string[]) => Promise<string>;
};

export async function leakcheck(argv: string[], deps: LeakcheckDeps = {}): Promise<void> {
	const { values } = parseFlags(argv, { staged: { type: "boolean" }, all: { type: "boolean" }, purge: { type: "boolean" }, artifacts: { type: "boolean" } });
	const artifactsOnly = values.artifacts === true;
	if (artifactsOnly && accountEmail() === null) {
		console.log("leakcheck: no QA account is configured, so there is no address to look for in the uploaded files");
		return;
	}
	requireAccount();
	const hits = new Set<string>();
	const problems: string[] = [];
	const scanned: string[] = [];
	const purge = values.purge === true;

	// First, before anything that needs git: what the CI uploads.
	scanned.push("the run files and failure evidence", "the lane logs, build records and gates tables", "the report");
	for (const hit of await artifactHits(deps.places ?? { runs: runsDir, out: outDir, report: join(qaDir, "report.json") }, repoRoot, purge)) {
		const state = hit.failed ? `could not delete: ${hit.failed}` : hit.deleted ? "deleted" : hit.kind === "code" ? "the sign-in code only, kept" : "";
		hits.add(`uploaded${state ? ` (${state})` : ""}: ${hit.path}`);
	}

	if (!artifactsOnly) {
		// A git that fails is a failure of this check, reported with the others; the files above were read and purged before it ran.
		const git = async (what: string, args: string[]): Promise<string> => {
			try {
				return await (deps.git ?? ((gitArgs: string[]) => execOk("git", gitArgs, { cwd: repoRoot })))(args);
			} catch (error) {
				problems.push(`git could not read ${what}: ${(error instanceof Error ? error.message : String(error)).split("\n")[0]?.slice(0, 200) ?? ""}`);
				return "";
			}
		};
		scanned.push("the staged diff");
		for (const hit of diffHits(await git("the staged diff", ["diff", "--cached", "--no-color", "-U0"]))) hits.add(`staged: ${hit}`);
		if (values.staged !== true) {
			scanned.push("the unstaged diff", "untracked files");
			for (const hit of diffHits(await git("the unstaged diff", ["diff", "--no-color", "-U0"]))) hits.add(`unstaged: ${hit}`);
			const untracked = (await git("the untracked files", ["ls-files", "--others", "--exclude-standard"])).split("\n").filter(Boolean);
			for (const hit of await fileHits(untracked.map((path) => join(repoRoot, path)))) hits.add(`untracked: ${hit}`);
		}
		if (values.all === true) {
			scanned.push("every tracked file");
			const tracked = (await git("the tracked files", ["ls-files"])).split("\n").filter(Boolean);
			for (const hit of await fileHits(tracked.map((path) => join(repoRoot, path)))) hits.add(`tracked: ${hit}`);
		}
		scanned.push("the manifests of the references");
		for (const hit of await fileHits(await files(join(qaDir, "screenshots"), (name) => name === "manifest.json"))) hits.add(`manifest: ${hit}`);
	}

	if (problems.length > 0) {
		console.error("leakcheck: it could not look everywhere:");
		for (const problem of problems) console.error(`  ${problem}`);
		process.exitCode = 1;
	}
	if (hits.size > 0) {
		console.error(`leakcheck: the QA account's address (${variable}) or sign-in code is in ${hits.size} place(s):`);
		for (const hit of [...hits].sort()) console.error(`  ${hit}`);
		process.exitCode = 1;
		return;
	}
	if (problems.length === 0) console.log(`leakcheck: the QA account's address is not in ${scanned.join(", ")}`);
}
