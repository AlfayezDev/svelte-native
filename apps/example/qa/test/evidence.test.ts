import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { runCase, type Context } from "../commands/parity.ts";
import { DeviceSession, DeviceStateError, newSessionNotes, type SessionOptions } from "../lib/device.ts";
import { dumpWithOwnControls, NodeNotFoundError, ObservedError, waitForNode } from "../lib/drive.ts";
import {
	AttemptsFailed,
	attemptCase,
	capText,
	captureEvidence,
	describeTopWindow,
	digest,
	EvidenceBudget,
	failedFields,
	lastLines,
	logcatLines,
	maxDumpBytes,
	retriedFields,
	type EvidenceDeps,
	type EvidenceTarget,
} from "../lib/evidence.ts";
import { decodePng, encodePng, redactedColor, type Image } from "../lib/png.ts";
import { useAccount } from "../lib/qa-account.ts";
import { emptyManifest } from "../lib/parity.ts";
import { cases, referenceName, variants, type ScreenCase } from "../lib/screens.ts";
import type { FailureEvidence } from "../lib/types.ts";
import { parseHierarchy, type UiTree } from "../lib/uia.ts";
import { FakeDevice } from "./fake-device.ts";

const normalScreen = cases.find((entry) => entry.network === "normal") as ScreenCase;
const pkg = "io.rasheed.svelteqa";

const node = (attributes: string, children = "") => `<node index="0" text="" resource-id="" class="android.view.View" package="${pkg}" content-desc="" checkable="false" checked="false" clickable="false" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" ${attributes}>${children}</node>`;
const hierarchy = (root: string) => `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0">${root}</hierarchy>`;
/** The startup screen: the app's own window with a title and a spinner, not the menu the case waits for. */
const loadingXml = hierarchy(
	node('class="android.widget.FrameLayout" bounds="[0,0][1080,2400]"', node('text="Rasheed" bounds="[63,300][400,360]"') + node('content-desc="Loading" bounds="[63,360][116,414]"')),
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
	useAccount(undefined);
	for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

async function setup(device = new FakeDevice(), budget?: EvidenceBudget) {
	const root = await temporary("native-qa-evidence-");
	const directory = join(root, "runs", "parity-localhost_5555-x");
	const deps: EvidenceDeps = { run: device.run, png: async () => encodePng(picture()), dump: async () => loading, base: root, ...(budget ? { budget } : {}) };
	const target: EvidenceTarget = { serial: device.serial, packageName: device.packageName, directory, stem: "screens-sheet-auto--light-rtl-normal", signedIn: false };
	return { device, root, directory, deps, target };
}

const notFound = (tree: UiTree | null = loading) => new NodeNotFoundError('no node "Sheet that fits its content" on screen after 15000 ms', { tree, dumps: 6, elapsedMs: 31_250 });

describe("what a dump says of the window it walked", () => {
	test("its package and class, bounds, node count and first texts", () => {
		expect(describeTopWindow(loading)).toBe(`${pkg} android.widget.FrameLayout [0,0][1080,2400], 3 nodes: "Rasheed", "Loading"`);
	});

	test("a dump with no nodes, and a window that is not the app's, say so", () => {
		expect(describeTopWindow(parseHierarchy(hierarchy("")))).toBe("an empty dump (no nodes)");
		const launcher = parseHierarchy(hierarchy(node('class="android.widget.FrameLayout" bounds="[0,0][1080,2400]"').replace(pkg, "com.google.android.apps.nexuslauncher")));
		expect(describeTopWindow(launcher)).toStartWith("com.google.android.apps.nexuslauncher android.widget.FrameLayout");
	});

	test("the account's address is not in the line", () => {
		useAccount("qa-user@example.test");
		const withAccount = parseHierarchy(hierarchy(node('class="android.widget.FrameLayout" bounds="[0,0][10,10]"', node('text="qa-user@example.test" bounds="[0,0][10,10]"'))));
		expect(describeTopWindow(withAccount)).toContain("<qa-account>");
		expect(describeTopWindow(withAccount)).not.toContain("example.test");
	});
});

describe("the evidence of a failed try", () => {
	test("keeps the screenshot, the dump the wait last read, the windows, the activity and the app's logcat, and names where", async () => {
		const { device, root, directory, deps, target } = await setup();
		device.windowsText = "  mCurrentFocus=Window{1a2b3c u0 io.rasheed.svelteqa/io.rasheed.svelteqa.MainActivity}\n  mFocusedApp=ActivityRecord{4d5e u0 io.rasheed.svelteqa/.MainActivity t12}\n";
		device.activityText = "  topResumedActivity=ActivityRecord{4d5e u0 io.rasheed.svelteqa/.MainActivity t12}\n";
		device.logcatText = "11-04 11:11:00.000  4321  4390 I ReactNativeJS: [native startup] TypeError: Network request failed\n";

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
		expect(await readFile(join(root, `${stem}.logcat.txt`), "utf8")).toContain("Network request failed");
		expect(decodePng(await readFile(join(root, `${stem}.png`))).width).toBe(24);
		// The app's own process, the newest 400 lines; the window and activity commands are the grep of the focus and the window list.
		expect(device.commands("logcat")).toEqual([`shell logcat -d -v threadtime --pid=4321 -t ${logcatLines}`]);
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

	test("an app with no process gets the buffer's lines that name it or a crash, and the record says so", async () => {
		const { device, deps, target } = await setup();
		device.pid = null;
		device.logcatText = "11-04 11:11:00.000  1000  1000 I ActivityManager: Process io.rasheed.svelteqa (pid 4321) has died\n";
		const evidence = await captureEvidence(deps, target, 1, notFound());
		expect(device.commands("logcat")[0]).toContain("grep -E 'io.rasheed.svelteqa|FATAL EXCEPTION|AndroidRuntime");
		expect(device.commands("logcat")[0]).not.toContain("--pid");
		expect(evidence.logcat).not.toBeNull();
		expect(evidence.missing).toEqual([`logcat: ${pkg} had no process; the lines that name it or a crash`]);
	});

	test("a command that fails loses its part and nothing else, and the capture never throws", async () => {
		const { device, deps, target } = await setup();
		device.failing = ["dumpsys window windows", "logcat "];
		deps.png = async () => {
			throw new Error("screencap failed (exit 1)");
		};
		const evidence = await captureEvidence(deps, target, 2, notFound());
		expect(evidence).toMatchObject({ attempt: 2, screenshot: null, windows: null, logcat: null });
		expect(evidence.uiDump).not.toBeNull();
		expect(evidence.activity).not.toBeNull();
		expect(evidence.missing.map((entry) => entry.split(":")[0])).toEqual(["screenshot", "windows.txt", "logcat.txt"]);
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

	test("the account's address is painted out of the screenshot and redacted from every text, and a file with it is never written", async () => {
		useAccount("qa-user@example.test");
		const xml = hierarchy(node('class="android.widget.FrameLayout" bounds="[0,0][24,48]"', node('text="qa-user@example.test" bounds="[4,8][12,16]"')));
		const tree: UiTree = { ...parseHierarchy(xml), raw: xml };
		const { device, root, deps, target } = await setup();
		device.logcatText = "I ReactNativeJS: signed in as qa-user@example.test\n";
		device.windowsText = "mCurrentFocus=Window{qa-user%40example.test}\n";
		const evidence = await captureEvidence(deps, target, 1, new NodeNotFoundError("no node X on screen after 15000 ms (qa-user@example.test)", { tree, dumps: 1, elapsedMs: 15_100 }));
		expect(JSON.stringify(evidence)).not.toContain("example.test");
		for (const part of [evidence.uiDump, evidence.windows, evidence.logcat]) {
			const text = await readFile(join(root, part ?? "missing"), "utf8");
			expect(text).toContain("<qa-account>");
			expect(text.toLowerCase()).not.toContain("example.test");
		}
		const painted = decodePng(await readFile(join(root, evidence.screenshot ?? "missing")));
		const at = (x: number, y: number) => [...painted.data.subarray((y * painted.width + x) * 4, (y * painted.width + x) * 4 + 4)];
		expect(at(5, 9)).toEqual([...redactedColor]);
		expect(at(20, 40)).not.toEqual([...redactedColor]);
	});

	test("a signed-in screen with no tree to paint over from keeps no screenshot", async () => {
		useAccount("qa-user@example.test");
		const { deps, target } = await setup();
		deps.dump = async () => {
			throw new Error("no dump");
		};
		const evidence = await captureEvidence(deps, { ...target, signedIn: true }, 1, new Error("boom"));
		expect(evidence.screenshot).toBeNull();
		expect(evidence.missing.join("\n")).toContain("the screen is the QA account's");
	});

	test("every part is capped: the dump, the text, and the logcat to its newest lines", async () => {
		const { device, root, deps, target } = await setup();
		const huge: UiTree = { ...loading, raw: `${loadingXml}${"<!-- padding -->".repeat(100_000)}` };
		device.logcatText = Array.from({ length: 1000 }, (_, index) => `line ${index}`).join("\n");
		const evidence = await captureEvidence(deps, target, 1, notFound(huge));
		const dump = await readFile(join(root, evidence.uiDump ?? "missing"), "utf8");
		expect(Buffer.byteLength(dump)).toBeLessThan(maxDumpBytes + 100);
		expect(dump).toContain("bytes left out]");
		const log = (await readFile(join(root, evidence.logcat ?? "missing"), "utf8")).trimEnd().split("\n");
		expect(log).toHaveLength(logcatLines);
		expect(log[0]).toBe("line 600");
		expect(log.at(-1)).toBe("line 999");
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

describe("a parity case that never gets its screen", () => {
	test("is tried twice and recorded as an error whose attempts are 2, with the evidence of both tries and the first error", async () => {
		const device = new FakeDevice();
		const { deps, directory, root } = await setup(device);
		const dir = await temporary("native-qa-parity-case-");
		const session = await DeviceSession.open(device.serial, device.packageName, { run: device.run, stateDir: dir, warn: () => undefined, notes: newSessionNotes() });
		const screen = cases.find((entry) => entry.id === "login") as ScreenCase;
		const variant = variants[0];
		if (!variant) throw new Error("no variants");
		const name = referenceName(screen, variant);
		const statusBar = { x: 0, y: 0, width: 24, height: 4 };
		// A reference whose image is not there: the launch is fine and reading the reference throws, on every try.
		const manifest = emptyManifest("fake-kind");
		manifest.references[name] = {
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
		const context: Context = {
			session,
			serial: device.serial,
			deviceKind: "fake-kind",
			manifest,
			statusBar,
			navigationBar: null,
			update: false,
			backend: { ok: true, detail: "fake" },
			artifacts: directory,
			evidence: deps,
			source: { commit: "abc1234", dirty: false },
		};
		const log = console.log;
		console.log = () => undefined;
		let record;
		try {
			record = await runCase(context, screen, variant);
		} finally {
			console.log = log;
			await session.close();
		}
		expect(record.verdict).toBe("error");
		expect(record.attempts).toBe(2);
		expect(record.tries).toBe(2);
		expect(record.failures?.map((entry) => entry.attempt)).toEqual([1, 2]);
		expect(record.failures?.[0]?.error).toContain("ENOENT");
		expect(record.detail).toContain("ENOENT");
		expect(record.detail).toContain("(try 2");
		expect(record.differingPixels).toBeNull();
		for (const entry of record.failures ?? []) expect((await stat(join(root, entry.screenshot ?? "missing"))).size > 0).toBe(true);
		// Both launches happened: the case was run twice, with the evidence of the first taken in between.
		expect(device.commands("am force-stop").length).toBe(2);
	}, 30_000);
});
