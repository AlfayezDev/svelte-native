import { describe, expect, test } from "bun:test";
import { pressDriver, type Screen } from "../lib/foreign-press.ts";

const line = (message: string) => `11-01 12:00:00.123  4242  4290 I ReactNativeJS: ${message}`;
const request = (token: string | null, id = "date-ok", resourceId = "android:id/button1") => line(`'[Svelte foreign press]', '${JSON.stringify({ id, resourceId, ...(token ? { token } : {}) })}'`);
const answered = (token: string, id = "date-ok") => line(`'[Svelte foreign press done]', '${JSON.stringify({ id, token })}'`);
const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/**
 * The emulator of the failing run, in milliseconds: one dialog at a time on the screen, a `uiautomator dump` that reads the screen when it ends (the real one
 * fetches the windows while the lab goes on), a tap that does whatever the test says. Every dialog has an OK button with the same resource id, as Android's
 * dialogs do, so a dump cannot tell one from the next.
 */
class World {
	open: string | null = "A";
	/** The y of the OK button on the screen (a date dialog moves its buttons while it settles). */
	buttonTop = 1700;
	readonly taps: { dialog: string | null; x: number; y: number }[] = [];
	dumps = 0;
	emit: (line: string) => void = () => undefined;
	onTap: (tapNumber: number, world: World) => void = () => undefined;
	readonly dumpMs: number | number[];
	constructor(dumpMs: number | number[]) {
		this.dumpMs = dumpMs;
	}

	readonly screen: Screen = {
		dump: async () => {
			const duration = Array.isArray(this.dumpMs) ? (this.dumpMs[this.dumps] ?? this.dumpMs[this.dumpMs.length - 1] ?? 0) : this.dumpMs;
			this.dumps++;
			await wait(duration);
			return this.open === null
				? `<hierarchy rotation="0"><node resource-id="" bounds="[0,0][1080,2400]" /></hierarchy>`
				: `<hierarchy rotation="0"><node resource-id="android:id/button1" bounds="[760,${this.buttonTop}][900,${this.buttonTop + 130}]" /></hierarchy>`;
		},
		tap: async (x, y) => {
			this.taps.push({ dialog: this.open, x, y });
			this.onTap(this.taps.length, this);
		},
	};
	readonly tail = (onLine: (line: string) => void) => {
		this.emit = onLine;
		return { stop: () => undefined };
	};
	/** The dialog ends [after] milliseconds from now, the lab hears it (and says so, with [token]), and [next] opens [pause] milliseconds after that. */
	closeIn(after: number, token: string | null, next: string | null, pause: number): void {
		setTimeout(() => {
			this.open = null;
			if (token) this.emit(answered(token));
			if (next) setTimeout(() => { this.open = next; }, pause);
		}, after);
	}
}

describe("the harness presses the dialog the lab asked about, and no other", () => {
	test("a dialog that ended is not pressed again on the next one, however long the look at the screen takes", async () => {
		// The failing emulator run: the look at the screen after a tap took longer than the lab's pause, and the next dialog (the same resource ids) was on it.
		const world = new World(50);
		world.onTap = () => world.closeIn(10, "a-1", "B", 60);
		const driver = pressDriver("serial", { screen: world.screen, tail: world.tail, timing: { afterTap: 40, settle: 400 } });
		world.emit(request("a-1"));
		await driver.idle();
		await wait(250);
		expect(world.taps.map((tap) => tap.dialog)).toEqual(["A"]);
		expect(driver.errors).toEqual([]);
		expect(driver.log).toHaveLength(1);
		driver.stop();
	});

	test("a tap whose effect is late is not followed by a look that lands on the next dialog", async () => {
		// The first tap has not closed the dialog when the harness looks again; the dialog closes while the second look is under way, and the next one opens before it ends.
		const world = new World([30, 120]);
		world.onTap = (number) => { if (number === 1) world.closeIn(80, "a-1", "B", 40); };
		const driver = pressDriver("serial", { screen: world.screen, tail: world.tail, timing: { afterTap: 40, settle: 40 } });
		world.emit(request("a-1"));
		await driver.idle();
		await wait(150);
		expect(world.taps.map((tap) => tap.dialog)).toEqual(["A"]);
		expect(driver.errors).toEqual([]);
		driver.stop();
	});

	test("a request that was answered before its turn is not pressed at all", async () => {
		// The second request waits behind the first one's look; the lab has already heard its dialog end (a stale press would meet whatever dialog is up by then).
		const world = new World(100);
		world.onTap = () => world.closeIn(10, "a-1", null, 0);
		const driver = pressDriver("serial", { screen: world.screen, tail: world.tail, timing: { afterTap: 40, settle: 400 } });
		world.emit(request("a-1"));
		await wait(20);
		world.emit(request("a-2", "date-cancel", "android:id/button2"));
		world.emit(answered("a-2", "date-cancel"));
		await driver.idle();
		expect(world.dumps).toBe(1);
		expect(world.taps).toHaveLength(1);
		expect(driver.errors).toEqual([]);
		expect(driver.log).toHaveLength(2);
		driver.stop();
	});

	test("a tap that did not close the dialog is made again at the button's new place", async () => {
		const world = new World(20);
		world.onTap = (number) => {
			if (number === 1) world.buttonTop = 1600;
			else world.closeIn(5, "a-1", null, 0);
		};
		const driver = pressDriver("serial", { screen: world.screen, tail: world.tail, timing: { afterTap: 30, settle: 60 } });
		world.emit(request("a-1"));
		await driver.idle();
		expect(world.taps.map((tap) => [tap.x, tap.y])).toEqual([[830, 1765], [830, 1665]]);
		expect(driver.errors).toEqual([]);
		driver.stop();
	});

	test("a dialog that never goes away is reported after the last try", async () => {
		const world = new World(5);
		const driver = pressDriver("serial", { screen: world.screen, tail: world.tail, timing: { afterTap: 5, settle: 10 } });
		world.emit(request("a-1"));
		await driver.idle();
		expect(world.taps).toHaveLength(6);
		expect(driver.errors).toHaveLength(1);
		expect(driver.errors[0]).toContain("still there after");
		driver.stop();
	});

	test("an app that does not say when a press is over is looked at again, as before", async () => {
		const world = new World(10);
		world.onTap = () => world.closeIn(5, null, null, 0);
		const driver = pressDriver("serial", { screen: world.screen, tail: world.tail, timing: { afterTap: 30, settle: 400 } });
		world.emit(request(null));
		await driver.idle();
		expect(world.taps.map((tap) => tap.dialog)).toEqual(["A"]);
		expect(world.dumps).toBe(2);
		expect(driver.errors).toEqual([]);
		driver.stop();
	});

	test("a press with nothing on the screen to press is an error", async () => {
		const world = new World(5);
		world.open = null;
		const driver = pressDriver("serial", { screen: world.screen, tail: world.tail, timing: { afterTap: 5, settle: 10 } });
		world.emit(request("a-1"));
		await driver.idle();
		expect(world.taps).toHaveLength(0);
		expect(driver.errors).toEqual(["no android:id/button1 on the screen for date-ok"]);
		driver.stop();
	});
});
