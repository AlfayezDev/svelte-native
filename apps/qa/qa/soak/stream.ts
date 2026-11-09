import { spawn } from "node:child_process";

export type LogcatWatch = {
	/** Everything read so far. */
	text(): string;
	/** Set when `adb logcat` ended before `stop()` was called (device offline, adb server restarted). */
	failure(): Error | null;
	/** Ends the stream and returns the whole capture; rejects when `adb logcat` itself failed. */
	stop(): Promise<string>;
};

/**
 * Follows `adb logcat -v threadtime` from now on (the default buffers: main, system, crash), handing each complete line
 * to `onLine` as it arrives. The soak needs the lines live (a sample is taken when the lab announces a window), which
 * `followLogcat` in lib/adb.ts, built for one marker, cannot do.
 */
export function watchLogcat(serial: string, onLine: (line: string) => void): LogcatWatch {
	const child = spawn("adb", ["-s", serial, "logcat", "-v", "threadtime"], {
		stdio: ["ignore", "pipe", "pipe"],
	});
	const chunks: string[] = [];
	let pending = "";
	let failure: Error | null = null;
	let stopping = false;
	let stderr = "";
	child.stdout.setEncoding("utf8");
	child.stdout.on("data", (chunk: string) => {
		chunks.push(chunk);
		const parts = (pending + chunk).split("\n");
		pending = parts.pop() ?? "";
		for (const line of parts) onLine(line);
	});
	child.stderr.setEncoding("utf8");
	child.stderr.on("data", (chunk: string) => (stderr += chunk));
	child.on("error", (error) => {
		failure = error;
	});
	const closed = new Promise<void>((resolve) =>
		child.on("close", (code) => {
			if (!stopping && !failure)
				failure = new Error(`adb logcat exited with ${code}: ${stderr.trim().slice(0, 300)}`);
			resolve();
		}),
	);
	return {
		text: () => chunks.join(""),
		failure: () => failure,
		async stop() {
			stopping = true;
			child.kill("SIGTERM");
			await closed;
			if (pending) onLine(pending);
			if (failure) throw failure;
			return chunks.join("");
		},
	};
}
