import { execOk } from "./exec.ts";
import { repoRoot } from "./paths.ts";
import type { Source } from "./types.ts";

export async function currentSource(): Promise<Source> {
	const commit = (await execOk("git", ["rev-parse", "--short", "HEAD"], { cwd: repoRoot })).trim();
	const status = await execOk("git", ["status", "--porcelain"], { cwd: repoRoot });
	return { commit, dirty: status.trim().length > 0 };
}
