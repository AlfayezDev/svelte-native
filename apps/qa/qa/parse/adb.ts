export type AdbDevice = { serial: string; state: string };

/** `adb devices` output: a header line, then `<serial>\t<state>` per device. */
export function parseDevices(stdout: string): AdbDevice[] {
	return stdout
		.split("\n")
		.map((line) => line.trim().split(/\s+/))
		.filter(
			(parts): parts is [string, string, ...string[]] => parts.length >= 2 && parts[0] !== "List",
		)
		.map(([serial, state]) => ({ serial, state }));
}

/** `getprop` output: `[key]: [value]` per line. */
export function parseGetprop(stdout: string): Record<string, string> {
	const props: Record<string, string> = {};
	for (const line of stdout.split("\n")) {
		const match = /^\[([^\]]+)\]: \[(.*)\]\s*$/.exec(line);
		if (match?.[1] !== undefined) props[match[1]] = match[2] ?? "";
	}
	return props;
}

export type AmStart = {
	status: string | null;
	launchState: string | null;
	totalTimeMs: number | null;
	waitTimeMs: number | null;
	thisTimeMs: number | null;
};

/** `am start -W` output. */
export function parseAmStart(stdout: string): AmStart {
	const text = (key: string) => new RegExp(`^${key}: (.+?)\\s*$`, "m").exec(stdout)?.[1] ?? null;
	const ms = (key: string) => {
		const value = text(key);
		return value !== null && /^\d+$/.test(value) ? Number(value) : null;
	};
	return {
		status: text("Status"),
		launchState: text("LaunchState"),
		totalTimeMs: ms("TotalTime"),
		waitTimeMs: ms("WaitTime"),
		thisTimeMs: ms("ThisTime"),
	};
}

export type PackageDump = {
	versionName: string | null;
	versionCode: number | null;
	lastUpdateTime: string | null;
};

/** `dumpsys package <name>` output, the fields that identify an installed build. */
export function parsePackageDump(stdout: string): PackageDump {
	const code = /^\s*versionCode=(\d+)/m.exec(stdout)?.[1];
	return {
		versionName: /^\s*versionName=(\S+)/m.exec(stdout)?.[1] ?? null,
		versionCode: code === undefined ? null : Number(code),
		lastUpdateTime: /^\s*lastUpdateTime=(.+?)\s*$/m.exec(stdout)?.[1] ?? null,
	};
}

/** `dumpsys display` output: the render frame rate of the built-in display. */
export function parseRefreshRate(stdout: string): number | null {
	const rate = /renderFrameRate ([\d.]+)/.exec(stdout)?.[1];
	return rate === undefined ? null : Math.round(Number(rate));
}

/** `pm path <package>` output: the base APK location. */
export function parseBaseApkPath(stdout: string): string | null {
	const paths = stdout
		.split("\n")
		.map((line) => /^package:(.+?)\s*$/.exec(line)?.[1])
		.filter((path): path is string => path !== undefined);
	return paths.find((path) => path.endsWith("/base.apk")) ?? paths[0] ?? null;
}
