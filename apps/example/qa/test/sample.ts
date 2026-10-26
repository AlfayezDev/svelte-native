import { readFileSync } from "node:fs";
import { join } from "node:path";

/** A captured device output kept under test/samples (see the README there for where each came from). */
export function sample(name: string): string {
	return readFileSync(join(import.meta.dirname, "samples", name), "utf8");
}
