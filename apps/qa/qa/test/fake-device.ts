import type { AdbRun } from "../lib/device.ts";

/**
 * An Android device as far as the settings the suites change go: what `settings get|put|delete`, `cmd uimode night` and
 * `cmd locale` answer, and every command it was given. `lost` makes every command fail the way adb does for a device that
 * dropped off (`device 'localhost:5555' not found`); `ignoreProxyWrites` is a device that accepts `settings put global
 * http_proxy` and keeps the old value.
 */
export class FakeDevice {
	readonly settings = new Map<string, string>();
	readonly log: string[] = [];
	night = "no";
	locales = "";
	lost = false;
	ignoreProxyWrites = false;
	/** What `cat /proc/sys/kernel/random/boot_id` answers; a restart changes it. Null: the file cannot be read (then `ro.boottime.init` is the identity). */
	bootId: string | null = "0f1c2a3b-0000-4000-8000-000000000001";
	bootTimeInit = "1000000000";
	/** The `adb reverse` mappings the device holds (`tcp:<port>`): they die with it. */
	readonly reverses = new Set<string>();
	/** Settings the device refuses to take back after a restart (a `settings put` that reads differently). */
	ignoreFontScaleWrites = false;
	/** The app's process id (`pidof`); null: the app has no process. */
	pid: number | null = 4321;
	/** What the evidence commands answer: the app's logcat and the crash buffer, the window manager's focus and windows (`dumpsys window windows`, and the plain `dumpsys window` when that answers nothing), the resumed activity. */
	logcatText = "";
	crashText = "";
	windowsText = "  mCurrentFocus=Window{1a2b u0 dev.alfayez.exposvelte.qa/dev.alfayez.exposvelte.qa.MainActivity}\n";
	windowText = "";
	activityText = "  topResumedActivity=ActivityRecord{3c4d u0 dev.alfayez.exposvelte.qa/.MainActivity t7}\n";
	/** The device's clock, as `date +'%m-%d %H:%M:%S'` prints it (the stamps of its logcat). */
	clock = "11-04 11:11:30\n";
	/** Commands that start with one of these fail the way a command that exits with 1 does. */
	failing: string[] = [];

	readonly serial = "localhost:5555";
	readonly packageName = "dev.alfayez.exposvelte.qa";

	set(key: string, value: string | null): void {
		if (value === null) this.settings.delete(key);
		else this.settings.set(key, value);
	}

	get(key: string): string | null {
		return this.settings.get(key) ?? null;
	}

	/**
	 * The emulator was killed and booted again: a new boot id, the system's defaults (night off, no text size, no proxy, no
	 * per-app language, no rotation setting), and no reverse mapping.
	 */
	restart(): void {
		this.bootId = this.bootId === null ? null : `${this.bootId.slice(0, -4)}${(Number.parseInt(this.bootId.slice(-4), 16) + 1).toString(16).padStart(4, "0")}`;
		this.bootTimeInit = String(Number(this.bootTimeInit) + 1);
		this.night = "no";
		this.locales = "";
		this.settings.clear();
		this.reverses.clear();
	}

	/** The commands of the log that contain the text, for "was the app launched". */
	commands(text: string): string[] {
		return this.log.filter((line) => line.includes(text));
	}

	readonly run: AdbRun = async (serial, args) => {
		this.log.push(args.join(" "));
		if (this.lost)
			throw new Error(`adb -s ${serial} ${args.join(" ")} exited with 1: error: device '${serial}' not found`);
		if (args[0] === "reverse") {
			if (args[1] === "--remove") this.reverses.delete(args[2] ?? "");
			else this.reverses.add(args[1] ?? "");
			return "";
		}
		if (args[0] !== "shell") return "";
		const [, first, second, third, fourth] = args;
		if (first && this.failing.some((prefix) => first.startsWith(prefix)))
			throw new Error(`adb -s ${serial} ${args.join(" ")} exited with 1`);
		if (first?.startsWith("date ")) return this.clock;
		if (first?.startsWith("pidof ")) return this.pid === null ? "" : `${this.pid}\n`;
		if (first?.startsWith("logcat -b crash")) return this.crashText;
		if (first?.startsWith("logcat ")) return this.logcatText;
		if (first?.startsWith("dumpsys window windows")) return this.windowsText;
		if (first?.startsWith("dumpsys window |")) return this.windowText;
		if (first?.startsWith("dumpsys activity activities")) return this.activityText;
		if (first === "cat" && second === "/proc/sys/kernel/random/boot_id") return this.bootId === null ? "" : `${this.bootId}\n`;
		if (first === "cat" && second === "/proc/uptime") return "120.50 400.00\n";
		if (first === "getprop" && second === "ro.boottime.init") return `${this.bootTimeInit}\n`;
		if (first === "getprop" && second === "sys.boot_completed") return "1\n";
		if (first === "settings" && second === "get") return `${this.get(`${third}/${fourth}`) ?? "null"}\n`;
		if (first === "settings" && second === "put") {
			if (this.ignoreFontScaleWrites && fourth === "font_scale") return "";
			if (!(this.ignoreProxyWrites && fourth === "http_proxy")) this.set(`${third}/${fourth}`, args[5] ?? "");
			return "";
		}
		if (first === "settings" && second === "delete") {
			if (!(this.ignoreProxyWrites && fourth === "http_proxy")) this.set(`${third}/${fourth}`, null);
			return "";
		}
		if (first === "cmd" && second === "uimode") {
			if (fourth) this.night = fourth;
			return `Night mode: ${this.night}\n`;
		}
		if (first === "cmd" && second === "locale" && third === "get-app-locales")
			return `Locales for ${fourth} for user 0 are [${this.locales}]\n`;
		if (first === "cmd" && second === "locale" && third === "set-app-locales") {
			const locales = args[args.indexOf("--locales") + 1] ?? "";
			this.locales = locales === '""' ? "" : locales;
			return "";
		}
		return "";
	};
}
