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

	readonly serial = "localhost:5555";
	readonly packageName = "io.rasheed.svelteqa";

	set(key: string, value: string | null): void {
		if (value === null) this.settings.delete(key);
		else this.settings.set(key, value);
	}

	get(key: string): string | null {
		return this.settings.get(key) ?? null;
	}

	/** The commands of the log that contain the text, for "was the app launched". */
	commands(text: string): string[] {
		return this.log.filter((line) => line.includes(text));
	}

	readonly run: AdbRun = async (serial, args) => {
		this.log.push(args.join(" "));
		if (this.lost)
			throw new Error(`adb -s ${serial} ${args.join(" ")} exited with 1: error: device '${serial}' not found`);
		if (args[0] === "reverse" || args[0] !== "shell") return "";
		const [, first, second, third, fourth] = args;
		if (first === "settings" && second === "get") return `${this.get(`${third}/${fourth}`) ?? "null"}\n`;
		if (first === "settings" && second === "put") {
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
