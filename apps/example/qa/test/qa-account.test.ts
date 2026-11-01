import { afterEach, describe, expect, test } from "bun:test";
import { assertClean, configuredCode, containsAccount, developmentCode, envFileValue, placeholder, qaCode, redact, redactDeep, requireAccount, useAccount } from "../lib/qa-account.ts";

// A made-up address: the real one is never written in a test either.
const address = "qa.person+tests@example.test";

afterEach(() => useAccount(undefined));

describe("reading the account from a dotenv file", () => {
	test("only the key asked for is read, quotes and trailing comments are not part of the value", () => {
		const file = ["# secrets", "OTHER=nope", `RASHEED_QA_EMAIL=${address}`, 'QUOTED="x"'].join("\n");
		expect(envFileValue(file, "RASHEED_QA_EMAIL")).toBe(address);
		expect(envFileValue(`export RASHEED_QA_EMAIL='${address}'  # the QA account`, "RASHEED_QA_EMAIL")).toBe(address);
		expect(envFileValue(`RASHEED_QA_EMAIL=${address}   # a comment`, "RASHEED_QA_EMAIL")).toBe(address);
		expect(envFileValue("RASHEED_QA_EMAIL=\n", "RASHEED_QA_EMAIL")).toBeNull();
		expect(envFileValue("RASHEED_QA_EMAIL_OLD=x", "RASHEED_QA_EMAIL")).toBeNull();
		expect(envFileValue("", "RASHEED_QA_EMAIL")).toBeNull();
	});
});

describe("keeping the address out of what is written", () => {
	test("it is redacted in any case and in the encodings a URL, a shell or an XML attribute would give it", () => {
		useAccount(address);
		expect(redact(`typed ${address.toUpperCase()} and ${encodeURIComponent(address)} and ${address.replace("@", "%40")}`)).toBe(
			`typed ${placeholder} and ${placeholder} and ${placeholder}`,
		);
		expect(redact("nothing here")).toBe("nothing here");
		expect(redact("code 000000", ["000000"])).toBe(`code ${placeholder}`);
	});

	test("redactDeep reaches every string of a result, keys included", () => {
		useAccount(address);
		const result = { stops: [`${address}`, "Sign out"], findings: [{ element: `Text "${address}" [1,2 3x4]`, detail: "x" }], [address]: 1 };
		const clean = redactDeep(result);
		expect(JSON.stringify(clean)).not.toContain("example.test");
		expect(clean.stops).toEqual([placeholder, "Sign out"]);
		expect(clean.findings[0]?.element).toBe(`Text "${placeholder}" [1,2 3x4]`);
	});

	test("a file with the address in it is refused, without quoting it", () => {
		useAccount(address);
		expect(() => assertClean(`{"stops":["${address}"]}`, "the a11y run file")).toThrow("refusing to write the a11y run file");
		let message = "";
		try {
			assertClean(address, "a file");
		} catch (error) {
			message = error instanceof Error ? error.message : "";
		}
		expect(message).not.toContain("example.test");
		expect(() => assertClean(`{"stops":["${placeholder}"]}`, "the a11y run file")).not.toThrow();
	});

	test("without an account nothing is looked for, and asking for one names the variable, not a value", () => {
		useAccount(null);
		expect(containsAccount(address)).toBe(false);
		expect(redact(address)).toBe(address);
		expect(() => requireAccount()).toThrow("RASHEED_QA_EMAIL");
	});
});

describe("the sign-in code of the QA account", () => {
	test("it is the development code only when no code is configured, and the configured one otherwise", () => {
		useAccount(address);
		expect(configuredCode()).toBeNull();
		expect(qaCode()).toBe(developmentCode);
		useAccount(address, "135790");
		expect(configuredCode()).toBe("135790");
		expect(qaCode()).toBe("135790");
	});

	test("a configured code is hidden like the address, as a whole number only", () => {
		useAccount(address, "135790");
		expect(redact("typed 135790 into the field")).toBe(`typed ${placeholder} into the field`);
		expect(redact("a count of 1357901 and 2135790")).toBe("a count of 1357901 and 2135790");
		expect(containsAccount("code 135790.")).toBe(true);
		expect(containsAccount("code 1357901")).toBe(false);
		expect(() => assertClean('{"detail":"135790"}', "the parity run file")).toThrow("refusing to write the parity run file");
		let message = "";
		try {
			assertClean("135790", "a file");
		} catch (error) {
			message = error instanceof Error ? error.message : "";
		}
		expect(message).not.toContain("135790");
	});

	test("the public development code is not a secret and is left alone", () => {
		useAccount(address, developmentCode);
		expect(redact("the code 000000 was typed")).toBe("the code 000000 was typed");
		expect(containsAccount("000000")).toBe(false);
	});
});
