import { afterEach, describe, expect, test } from "bun:test";
import { diffHits } from "../commands/leakcheck.ts";
import { useAccount } from "../lib/qa-account.ts";

// A made-up address: the real one is never written in a test either.
const address = "qa.person+tests@example.test";

afterEach(() => useAccount(undefined));

const diff = (name: string, ...lines: string[]) => `diff --git a/${name} b/${name}\n--- a/${name}\n+++ b/${name}\n@@ -1 +1 @@\n${lines.join("\n")}\n`;

describe("what leakcheck reads of a diff", () => {
	test("an added line with the address is a hit, a removed one is the cure and is not", () => {
		useAccount(address);
		expect(diffHits(diff("README.md", `+owner ${address}`))).toEqual(["README.md"]);
		expect(diffHits(diff("README.md", `-owner ${address}`, "+owner <placeholder>"))).toEqual([]);
		expect(diffHits(diff("a.md", `-${address}`) + diff("b.md", "-x", `+${address.toUpperCase()}`))).toEqual(["b.md"]);
	});
});
