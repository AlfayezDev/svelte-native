import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { runCase, type Context } from "../commands/parity.ts";
import { DeviceSession, DeviceStateError, DumpError, newSessionNotes, type SessionOptions } from "../lib/device.ts";
import { dumpWithOwnControls, isWaitFailure, NodeNotFoundError, ObservedError, waitForNode } from "../lib/drive.ts";
import {
	AttemptsFailed,
	attemptCase,
	capText,
	captureEvidence,
	crashLines,
	describeTopWindow,
	digest,
	EvidenceBudget,
	failedFields,
	lastLines,
	linesSince,
	logcatLines,
	logcatStamp,
	maxDumpBytes,
	plainDumpAttempts,
	retriedFields,
	type EvidenceDeps,
	type EvidenceTarget,
} from "../lib/evidence.ts";
import { decodePng, encodePng, type Image } from "../lib/png.ts";
import { emptyManifest } from "../lib/parity.ts";
import { cases, referenceName, variants, type ScreenCase } from "../lib/screens.ts";
import type { FailureEvidence } from "../lib/types.ts";
import { parseHierarchy, type UiTree } from "../lib/uia.ts";
import { FakeDevice } from "./fake-device.ts";
import { form } from "./fixture-cases.ts";

const normalScreen = cases.find((entry) => entry.network === "normal") as ScreenCase;
const pkg = "dev.alfayez.exposvelte.qa";

const node = (attributes: string, children = "") => `<node index="0" text="" resource-id="" class="android.view.View" package="${pkg}" content-desc="" checkable="false" checked="false" clickable="false" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" ${attributes}>${children}</node>`;
const hierarchy = (root: string) => `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0">${root}</hierarchy>`;
/** The startup screen: the app's own window with a title and a spinner, not the menu the case waits for. */
const loadingXml = hierarchy(
	node('class="android.widget.FrameLayout" bounds="[0,0][1080,2400]"', node('text="Expo Svelte" bounds="[63,300][400,360]"') + node('content-desc="Loading" bounds="[63,360][116,414]"')),
);
const loading: UiTree = { ...parseHierarchy(loadingXml), raw: loadingXml };

function picture(width = 24, height = 48): Image {
	const data = Buffer.alloc(width * height * 4, 255);
	for (let i = 0; i < width * height; i++) data[i * 4] = (i * 7) & 0xff;
	return { width, height, data };
}

const directories: string[] = [];
async function temporary(prefix: string): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), prefix));
	directories.push(directory);
	return directory;
}
afterEach(async () => {
	for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

async function setup(device = new FakeDevice(), budget?: EvidenceBudget) {
	const root = await temporary("native-qa-evidence-");
	const directory = join(root, "runs", "parity-localhost_5555-x");
	const deps: EvidenceDeps = { run: device.run, png: async () => encodePng(picture()), dump: async () => loading, base: root, ...(budget ? { budget } : {}) };
	const target: EvidenceTarget = { serial: device.serial, packageName: device.packageName, directory, stem: "screens-sheet-auto--light-rtl-normal", screen: normalScreen, direction: "rtl" };
	return { device, root, directory, deps, target };
}

/** An `adb` on the PATH that answers `uiautomator dump` with the file in FAKE_SCREEN. */
async function withScreen<T>(xml: string, body: () => Promise<T>): Promise<T> {
	const directory = await temporary("native-qa-wait-");
	const bin = join(directory, "bin");
	mkdirSync(bin, { recursive: true });
	const screen = join(directory, "screen.xml");
	writeFileSync(screen, xml);
	writeFileSync(join(bin, "adb"), `#!/bin/bash\ncase "$*" in\n  *uiautomator*) cat "$FAKE_SCREEN";;\n  *) ;;\nesac\n`);
	chmodSync(join(bin, "adb"), 0o755);
	const saved = { PATH: process.env.PATH, FAKE_SCREEN: process.env.FAKE_SCREEN };
	process.env.PATH = `${bin}:${process.env.PATH}`;
	process.env.FAKE_SCREEN = screen;
	try {
		return await body();
	} finally {
		process.env.PATH = saved.PATH;
		if (saved.FAKE_SCREEN === undefined) delete process.env.FAKE_SCREEN;
		else process.env.FAKE_SCREEN = saved.FAKE_SCREEN;
	}
}

const notFound = (tree: UiTree | null = loading) => new NodeNotFoundError('no node "Sheet that fits its content" on screen after 15000 ms', { tree, dumps: 6, elapsedMs: 31_250 });

describe("what a dump says of the window it walked", () => {
	test("its package and class, bounds, node count and first texts", () => {
		expect(describeTopWindow(loading)).toBe(`${pkg} android.widget.FrameLayout [0,0][1080,2400], 3 nodes: "Expo Svelte", "Loading"`);
	});

	test("a dump with no nodes, and a window that is not the app's, say so", () => {
		expect(describeTopWindow(parseHierarchy(hierarchy("")))).toBe("an empty dump (no nodes)");
		const launcher = parseHierarchy(hierarchy(node('class="android.widget.FrameLayout" bounds="[0,0][1080,2400]"').replace(pkg, "com.google.android.apps.nexuslauncher")));
		expect(describeTopWindow(launcher)).toStartWith("com.google.android.apps.nexuslauncher android.widget.FrameLayout");
	});

});

describe("the evidence of a failed try", () => {
	test("keeps the screenshot, the dump the wait last read, the windows, the activity and the app's logcat, and names where", async () => {
		const { device, root, directory, deps, target } = await setup();
		device.windowsText = "  mCurrentFocus=Window{1a2b3c u0 dev.alfayez.exposvelte.qa/dev.alfayez.exposvelte.qa.MainActivity}\n  mFocusedApp=ActivityRecord{4d5e u0 dev.alfayez.exposvelte.qa/.MainActivity t12}\n";
		device.activityText = "  topResumedActivity=ActivityRecord{4d5e u0 dev.alfayez.exposvelte.qa/.MainActivity t12}\n";
		device.logcatText = "11-04 11:11:00.000  4321  4390 I ReactNativeJS: [native startup] TypeError: Network request failed\n";
		device.crashText = "11-04 11:10:58.000  4000  4000 E AndroidRuntime: FATAL EXCEPTION: main (the process the case before this launch killed)\n";

		const evidence = await captureEvidence(deps, target, 1, notFound());

		expect(evidence.attempt).toBe(1);
		expect(evidence.error).toBe('no node "Sheet that fits its content" on screen after 15000 ms');
		expect(evidence.waited).toEqual({ ms: 31_250, dumps: 6 });
		expect(evidence.topWindow).toBe(describeTopWindow(loading));
		expect(evidence.missing).toEqual([]);
		const stem = "runs/parity-localhost_5555-x/screens-sheet-auto--light-rtl-normal.attempt1";
		expect(evidence).toMatchObject({ screenshot: `${stem}.png`, uiDump: `${stem}.uidump.xml`, windows: `${stem}.windows.txt`, activity: `${stem}.activity.txt`, logcat: `${stem}.logcat.txt` });
		expect(await readdir(directory)).toHaveLength(5);
		expect(await readFile(join(root, `${stem}.uidump.xml`), "utf8")).toBe(loadingXml);
		expect(await readFile(join(root, `${stem}.windows.txt`), "utf8")).toContain("mCurrentFocus=Window{1a2b3c");
		expect(await readFile(join(root, `${stem}.activity.txt`), "utf8")).toContain("topResumedActivity");
		const log = await readFile(join(root, `${stem}.logcat.txt`), "utf8");
		expect(log).toContain("Network request failed");
		// The crash buffer is read every time: the dead process's crash is not in the new process's lines.
		expect(log).toContain("--- crash buffer (logcat -b crash -d -t 100) ---");
		expect(log).toContain("FATAL EXCEPTION: main");
		expect(decodePng(await readFile(join(root, `${stem}.png`))).width).toBe(24);
		// The app's own process, the newest 400 lines, then the crash buffer; the window and activity commands are the grep of the focus and the window list.
		expect(device.commands("logcat")).toEqual([`shell logcat -d -v threadtime --pid=4321 -t ${logcatLines}`, `shell logcat -b crash -d -v threadtime -t ${crashLines}`]);
		expect(device.commands("dumpsys window windows")[0]).toContain("mCurrentFocus|mFocusedApp|Window #");
		expect(digest(evidence)).toBe(`try 1, waited 31.3 s over 6 dumps, top window ${describeTopWindow(loading)}`);
	});

	test("a failure that is not a wait takes a dump of its own, and says it was read after the failure", async () => {
		const { deps, target } = await setup();
		const evidence = await captureEvidence(deps, target, 1, new Error("am start exited with 1"));
		expect(evidence.waited).toBeNull();
		expect(evidence.topWindow).toBe(`${describeTopWindow(loading)} (read after the failure)`);
		expect(evidence.uiDump).not.toBeNull();
	});

	test("an app with no process gets the buffer's lines that name the package, the crash buffer all the same, and the record says so", async () => {
		const { device, root, deps, target } = await setup();
		device.pid = null;
		device.logcatText = "11-04 11:11:00.000  1000  1000 I ActivityManager: Process dev.alfayez.exposvelte.qa (pid 4321) has died\n";
		const evidence = await captureEvidence(deps, target, 1, notFound());
		const [app, crash] = device.commands("logcat");
		expect(app).toContain("grep -E 'dev.alfayez.exposvelte.qa' | tail -n 400");
		expect(app).not.toContain("--pid");
		expect(app).not.toContain("FATAL");
		expect(crash).toContain("logcat -b crash -d");
		const log = await readFile(join(root, evidence.logcat ?? "missing"), "utf8");
		expect(log).toContain("--- lines that name dev.alfayez.exposvelte.qa (the app had no process) ---");
		expect(log).toContain("has died");
		expect(log).toContain("--- crash buffer (logcat -b crash -d -t 100) ---\n(no lines)");
		expect(evidence.missing).toEqual([`logcat: ${pkg} had no process; the lines that name it`]);
	});

	test("an empty answer for the windows falls back to the plain `dumpsys window`, and nothing at all is a missing part, not an empty file", async () => {
		const { device, root, deps, target } = await setup();
		device.windowsText = "";
		device.windowText = "  mCurrentFocus=Window{9f8e u0 dev.alfayez.exposvelte.qa/dev.alfayez.exposvelte.qa.MainActivity}\n";
		const evidence = await captureEvidence(deps, target, 1, notFound());
		expect(device.commands("dumpsys window windows")).toHaveLength(1);
		expect(device.commands("dumpsys window |")).toHaveLength(1);
		expect(await readFile(join(root, evidence.windows ?? "missing"), "utf8")).toContain("mCurrentFocus=Window{9f8e");
		expect(evidence.missing).toEqual([]);

		device.windowText = "";
		const none = await captureEvidence(deps, { ...target, stem: "none" }, 1, notFound());
		expect(none.windows).toBeNull();
		expect(none.missing).toEqual(["windows.txt: dumpsys window windows: empty; dumpsys window: empty"]);

		// The first command failing is no different: the second answers.
		device.windowText = "  mFocusedApp=ActivityRecord{1 u0 dev.alfayez.exposvelte.qa/.MainActivity t3}\n";
		device.failing = ["dumpsys window windows"];
		const second = await captureEvidence(deps, { ...target, stem: "second" }, 1, notFound());
		expect(second.windows).not.toBeNull();
		expect(second.missing).toEqual([]);
	});

	test("a command that fails loses its part and nothing else, and the capture never throws", async () => {
		const { device, deps, target } = await setup();
		device.failing = ["dumpsys window", "logcat "];
		deps.png = async () => {
			throw new Error("screencap failed (exit 1)");
		};
		const evidence = await captureEvidence(deps, target, 2, notFound());
		expect(evidence).toMatchObject({ attempt: 2, screenshot: null, windows: null, logcat: null });
		expect(evidence.uiDump).not.toBeNull();
		expect(evidence.activity).not.toBeNull();
		// Both window commands and both logcat commands failed: one entry each, none of them an empty file.
		expect(evidence.missing.map((entry) => entry.split(":")[0])).toEqual(["screenshot", "windows.txt", "logcat.txt", "logcat.txt"]);
		expect(evidence.missing[0]).toContain("screencap failed");
	});

	test("no dump to be read at all is a null top window and a reason, not a failure of the case", async () => {
		const { deps, target } = await setup();
		deps.dump = async () => {
			throw new Error("uiautomator dump on localhost:5555 produced no tree after 1 attempt (ERROR: could not get idle state.)");
		};
		const evidence = await captureEvidence(deps, target, 1, new Error("boom"));
		expect(evidence.topWindow).toBeNull();
		expect(evidence.uiDump).toBeNull();
		expect(evidence.missing[0]).toStartWith("dump: uiautomator dump on localhost:5555 produced no tree");
		expect(evidence.screenshot).not.toBeNull();
	});

	test("the crash buffer is narrowed to the try: an earlier case's crash is not filed under it", async () => {
		const { device, root, deps, target } = await setup();
		device.clock = "11-04 11:11:30\n";
		device.crashText = [
			"--------- beginning of crash",
			"11-04 11:10:20.000  3999  3999 E AndroidRuntime: FATAL EXCEPTION: main (an earlier case's process)",
			"11-04 11:11:10.500  4000  4000 E AndroidRuntime: FATAL EXCEPTION: main (this try's first process)",
		].join("\n");
		// The try began 40 s ago by this host's clock, so at 11:11:30 on the device's it began at 11:10:50, less a second.
		const evidence = await captureEvidence(deps, target, 1, notFound(), Date.now() - 40_000);
		const log = await readFile(join(root, evidence.logcat ?? "missing"), "utf8");
		expect(log).toMatch(/--- crash buffer since 11-04 11:10:4\d\.\d{3} \(logcat -b crash -d -t 100\) ---/);
		expect(log).toContain("this try's first process");
		expect(log).not.toContain("an earlier case's process");
		expect(log).not.toContain("beginning of crash");
		expect(device.commands("date ")).toHaveLength(1);
	});

	test("an app with no process is narrowed the same way, and the app's own process is not", async () => {
		const { device, root, deps, target } = await setup();
		device.pid = null;
		device.logcatText = ["11-04 11:09:00.000  1  1 I ActivityManager: Start proc dev.alfayez.exposvelte.qa (an earlier case)", "11-04 11:11:05.000  1  1 I ActivityManager: Process dev.alfayez.exposvelte.qa has died (this try)"].join("\n");
		const evidence = await captureEvidence(deps, target, 1, notFound(), Date.now() - 40_000);
		const log = await readFile(join(root, evidence.logcat ?? "missing"), "utf8");
		expect(log).toContain("has died (this try)");
		expect(log).not.toContain("an earlier case");

		device.pid = 4321;
		device.logcatText = "11-04 11:09:00.000  4321  4321 I ReactNativeJS: the process was started for this try, whatever its stamps say\n";
		const own = await captureEvidence(deps, { ...target, stem: "own" }, 1, notFound(), Date.now() - 40_000);
		expect(await readFile(join(root, own.logcat ?? "missing"), "utf8")).toContain("whatever its stamps say");
	});

	test("a device whose clock cannot be read gives the whole crash buffer and says so", async () => {
		const { device, root, deps, target } = await setup();
		device.clock = "not a date\n";
		device.crashText = "11-04 11:10:20.000  3999  3999 E AndroidRuntime: FATAL EXCEPTION: main (older)\n";
		const evidence = await captureEvidence(deps, target, 1, notFound(), Date.now() - 40_000);
		expect(await readFile(join(root, evidence.logcat ?? "missing"), "utf8")).toContain("(older)");
		expect(evidence.missing).toEqual(["logcat.txt: the device's clock could not be read, so the crash buffer is not narrowed to the try"]);
	});

	test("the stamps: the device's moment as logcat writes it, and the lines at or after one, across the new year", () => {
		expect(logcatStamp(new Date(Date.UTC(2026, 10, 4, 11, 10, 49, 5)))).toBe("11-04 11:10:49.005");
		expect(linesSince("a\n11-04 11:10:48.999 x\n11-04 11:10:49.000 y\n11-04 11:12:00.000 z\n", "11-04 11:10:49.000")).toBe("11-04 11:10:49.000 y\n11-04 11:12:00.000 z\n");
		expect(linesSince("11-04 11:10:48.999 x\n", "11-04 11:10:49.000")).toBe("");
		expect(linesSince("12-31 23:59:58.000 a\n01-01 00:00:01.000 b\n12-31 23:00:00.000 c\n", "12-31 23:59:50.000")).toBe("12-31 23:59:58.000 a\n01-01 00:00:01.000 b\n");
	});

	test("the picture is taken first, and a try that read no dump takes one with several attempts", async () => {
		const events: string[] = [];
		const { deps, target } = await setup();
		deps.dump = async (_serial, options) => {
			events.push(`dump x${options?.attempts}`);
			return loading;
		};
		deps.png = async () => {
			events.push("png");
			return encodePng(picture());
		};
		await captureEvidence(deps, target, 1, notFound());
		expect(events).toEqual(["png"]);
		events.length = 0;
		await captureEvidence(deps, { ...target, stem: "none" }, 1, new Error("boom"));
		expect(events).toEqual(["png", `dump x${plainDumpAttempts}`]);
		expect(plainDumpAttempts).toBeGreaterThanOrEqual(2);
	});

	test("every part is capped: the dump, the text, and the logcat to its newest lines", async () => {
		const { device, root, deps, target } = await setup();
		const huge: UiTree = { ...loading, raw: `${loadingXml}${"<!-- padding -->".repeat(100_000)}` };
		device.logcatText = Array.from({ length: 1000 }, (_, index) => `line ${index}`).join("\n");
		const evidence = await captureEvidence(deps, target, 1, notFound(huge));
		const dump = await readFile(join(root, evidence.uiDump ?? "missing"), "utf8");
		expect(Buffer.byteLength(dump)).toBeLessThan(maxDumpBytes + 100);
		expect(dump).toContain("bytes left out]");
		// The app's section: its header and the newest 400 lines; the crash buffer follows it.
		const section = (await readFile(join(root, evidence.logcat ?? "missing"), "utf8")).split("\n\n")[0]?.split("\n") ?? [];
		expect(section).toHaveLength(logcatLines + 1);
		expect(section[1]).toBe("line 600");
		expect(section.at(-1)).toBe("line 999");
		expect(capText("héllo", 2)).toContain("bytes left out");
		expect(lastLines("a\nb\nc\n", 2)).toBe("b\nc\n");
	});

	test("the run's budget bounds the sets and the bytes, and a spent budget still names the window", async () => {
		const budget = new EvidenceBudget({ sets: 1, bytes: 1_000_000 });
		const { directory, deps, target } = await setup(new FakeDevice(), budget);
		const first = await captureEvidence(deps, target, 1, notFound());
		expect(first.screenshot).not.toBeNull();
		const second = await captureEvidence(deps, { ...target, stem: "other" }, 1, notFound());
		expect(second).toMatchObject({ screenshot: null, uiDump: null, windows: null, activity: null, logcat: null });
		expect(second.topWindow).toBe(describeTopWindow(loading));
		expect(second.missing[0]).toContain("evidence budget is spent");
		expect((await readdir(directory)).filter((name) => name.startsWith("other"))).toEqual([]);

		const tight = new EvidenceBudget({ sets: 10, bytes: 300 });
		const small = await setup(new FakeDevice(), tight);
		const squeezed = await captureEvidence(small.deps, small.target, 1, notFound());
		expect(squeezed.uiDump).toBeNull();
		expect(squeezed.missing.some((entry) => entry.includes("do not fit the run's evidence budget"))).toBe(true);
		expect(tight.bytes <= 300).toBe(true);
	});
});

describe("a case that is tried again", () => {
	async function withSession<T>(device: FakeDevice, body: (session: DeviceSession, dir: string) => Promise<T>): Promise<T> {
		const dir = await temporary("native-qa-attempt-");
		const options: SessionOptions = { run: device.run, stateDir: dir, warn: () => undefined, notes: newSessionNotes() };
		const session = await DeviceSession.open(device.serial, device.packageName, options);
		try {
			return await body(session, dir);
		} finally {
			await session.close();
		}
	}

	test("a case that passes its first try takes no evidence: no command, no file", async () => {
		const device = new FakeDevice();
		const { deps, target, directory } = await setup(device);
		await withSession(device, async (session) => {
			const before = device.log.length;
			const attempted = await attemptCase({ session, screen: normalScreen, fontScale: 1, label: "case", body: async () => "ok", evidence: { deps, target }, log: () => undefined });
			expect(attempted).toEqual({ value: "ok", tries: 1, failures: [] });
			expect(retriedFields(attempted)).toEqual({});
			expect(device.log.slice(before).filter((line) => /dumpsys|logcat|pidof/.test(line))).toEqual([]);
			expect(await stat(directory).catch(() => null)).toBeNull();
		});
	});

	test("a failed first try is photographed before the retry launches the case again, and the retry that passes says it was one", async () => {
		const device = new FakeDevice();
		const { deps, target, root } = await setup(device);
		device.logcatText = "I ReactNativeJS: slow\n";
		await withSession(device, async (session) => {
			const order: string[] = [];
			const lines: string[] = [];
			let run = 0;
			const attempted = await attemptCase({
				session,
				screen: normalScreen,
				fontScale: 1,
				label: "case",
				evidence: { deps, target },
				log: (line) => lines.push(line),
				body: async () => {
					order.push(`try ${++run} (dumpsys so far: ${device.commands("dumpsys window windows").length})`);
					if (run === 1) throw notFound();
					return "second";
				},
			});
			expect(attempted.value).toBe("second");
			expect(attempted.tries).toBe(2);
			expect(attempted.failures).toHaveLength(1);
			expect(attempted.failures[0]).toMatchObject({ attempt: 1, error: 'no node "Sheet that fits its content" on screen after 15000 ms', waited: { ms: 31_250, dumps: 6 } });
			// The window manager was asked after the first try and before the second began.
			expect(order).toEqual(["try 1 (dumpsys so far: 0)", "try 2 (dumpsys so far: 1)"]);
			expect(retriedFields(attempted)).toEqual({ tries: 2, failures: attempted.failures });
			expect(lines.some((line) => line.startsWith("  evidence (try 1, waited 31.3 s over 6 dumps"))).toBe(true);
			expect(lines.some((line) => line.startsWith("  retrying case: no node"))).toBe(true);
			expect(await readFile(join(root, attempted.failures[0]?.logcat ?? "missing"), "utf8")).toContain("slow");
		});
	});

	test("the evidence of a failed try is narrowed to the run that failed: the crash of the run before it stays out", async () => {
		const device = new FakeDevice();
		const { deps, target, root } = await setup(device);
		device.clock = "11-04 11:11:30\n";
		device.crashText = ["11-04 11:05:00.000  1  1 E AndroidRuntime: FATAL EXCEPTION: main (the case before)", "11-04 11:11:29.500  2  2 E AndroidRuntime: FATAL EXCEPTION: main (this run)"].join("\n");
		await withSession(device, async (session) => {
			let run = 0;
			const attempted = await attemptCase({
				session,
				screen: normalScreen,
				fontScale: 1,
				label: "case",
				evidence: { deps, target },
				log: () => undefined,
				body: async () => {
					if (++run === 1) throw notFound();
					return "second";
				},
			});
			const log = await readFile(join(root, attempted.failures[0]?.logcat ?? "missing"), "utf8");
			expect(log).toContain("(this run)");
			expect(log).not.toContain("(the case before)");
		});
	});

	test("a case that fails every try keeps both errors and both pictures: attempts says 2, never null", async () => {
		const device = new FakeDevice();
		const { deps, target, root } = await setup(device);
		await withSession(device, async (session) => {
			let run = 0;
			const failure = await attemptCase({
				session,
				screen: normalScreen,
				fontScale: 1,
				label: "case",
				evidence: { deps, target },
				log: () => undefined,
				body: async () => {
					run++;
					throw run === 1 ? notFound() : new NodeNotFoundError('no node "Sheet that fits its content" on screen after 15000 ms', { tree: null, dumps: 0, elapsedMs: 15_000 });
				},
			}).then(
				() => null,
				(error: unknown) => error,
			);
			expect(failure instanceof AttemptsFailed).toBe(true);
			const failed = failure as AttemptsFailed;
			expect(failed.tries).toBe(2);
			expect(failed.cause instanceof NodeNotFoundError).toBe(true);
			const fields = failedFields(failed);
			expect(fields.attempts).toBe(2);
			expect(fields.tries).toBe(2);
			expect(fields.failures.map((entry) => entry.attempt)).toEqual([1, 2]);
			// The first try's error and window are kept, and the last try's digest is in the detail.
			expect(fields.failures[0]?.topWindow).toBe(describeTopWindow(loading));
			expect(fields.detail).toStartWith('no node "Sheet that fits its content" on screen after 15000 ms (try 2');
			expect(fields.detail).toContain(`top window ${describeTopWindow(loading)} (read after the failure)`);
			for (const entry of fields.failures) expect((await stat(join(root, entry.screenshot ?? "missing"))).size > 0).toBe(true);
			expect((await readdir(target.directory)).filter((name) => name.endsWith(".png")).sort()).toEqual([`${target.stem}.attempt1.png`, `${target.stem}.attempt2.png`]);
		});
	});

	test("with `retryable`, only a failed wait or dump gets the retry: any other failure is one run, no evidence, thrown as it is", async () => {
		const device = new FakeDevice();
		const { deps, target, directory } = await setup(device);
		await withSession(device, async (session) => {
			const run = async (failure: Error) => {
				let runs = 0;
				const outcome = await attemptCase({
					session,
					screen: normalScreen,
					fontScale: 1,
					label: "case",
					retryable: isWaitFailure,
					evidence: { deps, target },
					log: () => undefined,
					body: async () => {
						if (++runs === 1) throw failure;
						return "second";
					},
				}).then(
					(attempted) => attempted,
					(error: unknown) => error,
				);
				return { runs, outcome };
			};

			// A reference that is not there, or a bug of the harness, fails the same way again: one run, the error as it is.
			const corrupt = await run(new Error("ENOENT: no such file or directory, open 'missing.png'"));
			expect(corrupt.runs).toBe(1);
			expect(corrupt.outcome instanceof AttemptsFailed).toBe(false);
			expect((corrupt.outcome as Error).message).toContain("ENOENT");
			expect(device.commands("dumpsys")).toEqual([]);
			expect(await stat(directory).catch(() => null)).toBeNull();

			// The screen not showing up is what a second launch may cure: a node that never came, a dump that held less than the screen, a dump that could not be read.
			for (const failure of [notFound(), new ObservedError("the important-views dump lacks \"Done\" of the screen itself after 3 dumps"), new DumpError("uiautomator dump on localhost:5555 produced no tree after 5 attempts (no output)")]) {
				const retried = await run(failure);
				expect(retried.runs).toBe(2);
				expect((retried.outcome as { tries: number }).tries).toBe(2);
				expect((retried.outcome as { failures: unknown[] }).failures).toHaveLength(1);
			}
			expect(isWaitFailure(new Error("ENOENT"))).toBe(false);
		});
	});

	test("a device that is gone, or in the wrong state, ends the run as it always did: no wrapper, no evidence for the one that ended it", async () => {
		const device = new FakeDevice();
		const { deps, target } = await setup(device);
		await withSession(device, async (session) => {
			const gone = attemptCase({
				session,
				screen: normalScreen,
				fontScale: 1,
				label: "case",
				evidence: { deps, target },
				log: () => undefined,
				body: async () => {
					throw new Error("device 'localhost:5555' not found");
				},
			});
			await expect(gone).rejects.toThrow("not found");
			expect(await gone.catch((error: unknown) => error) instanceof AttemptsFailed).toBe(false);

			device.set("global/http_proxy", "localhost:33699");
			const wrongState = attemptCase({
				session,
				screen: normalScreen,
				fontScale: 1,
				label: "case",
				evidence: { deps, target },
				log: () => undefined,
				body: async () => {
					throw notFound();
				},
			});
			expect(await wrongState.catch((error: unknown) => error) instanceof DeviceStateError).toBe(true);
			device.set("global/http_proxy", null);
		});
	});
});

describe("what the records carry", () => {
	const evidence = (attempt: number): FailureEvidence => ({ attempt, error: "no node", waited: null, topWindow: null, screenshot: null, uiDump: null, windows: null, activity: null, logcat: null, missing: [] });

	test("a retried case says so, and an untried one adds nothing", () => {
		expect(retriedFields({ tries: 1, failures: [] })).toEqual({});
		expect(retriedFields({ tries: 2, failures: [evidence(1)] })).toEqual({ tries: 2, failures: [evidence(1)] });
	});

	test("a failure of every try is an error record with the tries as its attempts and the first error kept", () => {
		const fields = failedFields(new AttemptsFailed(new Error("second"), 2, [{ ...evidence(1), error: "first" }, evidence(2)]));
		expect(fields).toMatchObject({ attempts: 2, tries: 2, detail: "second (try 2, top window unknown)" });
		expect(fields.failures[0]?.error).toBe("first");
	});
});

describe("a wait for a node keeps what it saw", () => {
	test("a node that never comes: the error carries the last raw dump, the dumps it took and how long it ran", async () => {
		await withScreen(loadingXml, async () => {
			const failure = await waitForNode("localhost:5555", { label: "Sheet that fits its content" }, "rtl", 50).catch((error: unknown) => error);
			expect(failure instanceof NodeNotFoundError).toBe(true);
			const observation = (failure as NodeNotFoundError).observation;
			expect(observation?.tree?.raw).toContain("</hierarchy>");
			expect(observation?.tree?.root?.packageName).toBe(pkg);
			expect(observation?.dumps).toBeGreaterThanOrEqual(1);
			expect(observation?.elapsedMs).toBeGreaterThanOrEqual(50);
			expect((failure as Error).message).toBe('no node "Sheet that fits its content" on screen after 50 ms');
		});
	});

	test("a dump that cannot be read after earlier ones keeps the last one it read, and the same message", async () => {
		const directory = await temporary("native-qa-wait-");
		const bin = join(directory, "bin");
		mkdirSync(bin, { recursive: true });
		const counter = join(directory, "count");
		writeFileSync(counter, "0");
		const screen = join(directory, "screen.xml");
		writeFileSync(screen, loadingXml);
		// The first dump answers, every later one fails the way `could not get idle state` does (nothing on stdout).
		writeFileSync(join(bin, "adb"), `#!/bin/bash\ncase "$*" in\n  *uiautomator*) n=$(cat "${counter}"); echo $((n+1)) > "${counter}"; if [ "$n" = 0 ]; then cat "${screen}"; else echo "ERROR: could not get idle state." >&2; fi;;\n  *) ;;\nesac\n`);
		chmodSync(join(bin, "adb"), 0o755);
		const saved = process.env.PATH;
		process.env.PATH = `${bin}:${process.env.PATH}`;
		try {
			const failure = await waitForNode("localhost:5555", { label: "Sheet that fits its content" }, "ltr", 1500).catch((error: unknown) => error);
			expect(failure instanceof ObservedError && !(failure instanceof NodeNotFoundError)).toBe(true);
			expect((failure as ObservedError).message).toStartWith("uiautomator dump on localhost:5555 produced no tree after 5 attempts");
			expect((failure as ObservedError).observation?.tree?.raw).toBe(loadingXml);
			expect((failure as ObservedError).observation?.dumps).toBe(1);
		} finally {
			process.env.PATH = saved;
		}
	}, 30_000);

	test("the dump of the screen's own controls keeps the last tree it took when it gives up", async () => {
		const failure = await dumpWithOwnControls(async () => loading, ["Two detents"], 2, 0).catch((error: unknown) => error);
		expect(failure instanceof ObservedError).toBe(true);
		expect((failure as ObservedError).message).toContain('lacks "Two detents"');
		expect((failure as ObservedError).observation).toMatchObject({ dumps: 2 });
		expect((failure as ObservedError).observation?.tree).toBe(loading);
	});
});

describe("a parity case", () => {
	/** A parity context on a fake device, with a reference in the manifest whose image is not on disk. */
	async function parityContext() {
		const device = new FakeDevice();
		const { deps, directory, root } = await setup(device);
		const dir = await temporary("native-qa-parity-case-");
		const session = await DeviceSession.open(device.serial, device.packageName, { run: device.run, stateDir: dir, warn: () => undefined, notes: newSessionNotes() });
		const variant = variants[0];
		if (!variant) throw new Error("no variants");
		const statusBar = { x: 0, y: 0, width: 24, height: 4 };
		const manifest = emptyManifest("fake-kind");
		const reference = (screen: ScreenCase) => {
			manifest.references[referenceName(screen, variant)] = {
				file: "missing.png",
				sha256: "0".repeat(64),
				width: 24,
				height: 48,
				masks: [{ name: "status bar", ...statusBar }],
				screen: screen.id,
				route: screen.route,
				state: screen.state,
				theme: variant.theme,
				direction: variant.direction,
				fontScale: variant.fontScale,
				updatedAt: "2026-11-04T00:00:00.000Z",
				source: { commit: "abc1234", dirty: false },
			};
		};
		const context: Context = {
			session,
			serial: device.serial,
			deviceKind: "fake-kind",
			manifest,
			statusBar,
			navigationBar: null,
			update: false,
			artifacts: directory,
			evidence: deps,
			source: { commit: "abc1234", dirty: false },
		};
		const quietly = async <T>(body: () => Promise<T>): Promise<T> => {
			const log = console.log;
			console.log = () => undefined;
			try {
				return await body();
			} finally {
				console.log = log;
			}
		};
		return { device, root, directory, session, variant, context, reference, quietly };
	}

	test("with a reference that cannot be read is one run and an error: attempts 1, no second launch, no evidence set", async () => {
		const { device, directory, session, variant, context, reference, quietly } = await parityContext();
		const screen = form;
		reference(screen);
		try {
			const record = await quietly(() => runCase(context, screen, variant));
			expect(record.verdict).toBe("error");
			expect(record.attempts).toBe(1);
			expect(record.tries).toBe(1);
			expect(record.failures).toBeUndefined();
			expect(record.detail).toContain("ENOENT");
			expect(device.commands("am force-stop")).toHaveLength(1);
			expect(await stat(directory).catch(() => null)).toBeNull();
		} finally {
			await session.close();
		}
	}, 30_000);

	test("whose screen never shows up is tried twice and recorded as an error whose attempts are 2, with the evidence of both tries and the first error", async () => {
		const { device, root, session, variant, context, reference, quietly } = await parityContext();
		// A step that waits for a node that is not on the startup screen the fake adb shows, for 50 ms.
		const screen: ScreenCase = { ...form, id: "form-never", steps: [{ wait: { label: "never there" }, timeoutMs: 50 }] };
		reference(screen);
		try {
			const record = await withScreen(loadingXml, () => quietly(() => runCase(context, screen, variant)));
			expect(record.verdict).toBe("error");
			expect(record.attempts).toBe(2);
			expect(record.tries).toBe(2);
			expect(record.failures?.map((entry) => entry.attempt)).toEqual([1, 2]);
			expect(record.failures?.[0]?.error).toBe('no node "never there" on screen after 50 ms');
			expect(record.failures?.[0]?.topWindow).toContain('"Expo Svelte", "Loading"');
			expect(record.failures?.[0]?.waited?.dumps).toBeGreaterThanOrEqual(1);
			expect(record.detail).toStartWith('no node "never there" on screen after 50 ms (try 2');
			expect(record.differingPixels).toBeNull();
			for (const entry of record.failures ?? []) expect((await stat(join(root, entry.screenshot ?? "missing"))).size > 0).toBe(true);
			// Both launches happened, with the evidence of the first taken in between.
			expect(device.commands("am force-stop")).toHaveLength(2);
		} finally {
			await session.close();
		}
	}, 30_000);
});
