#!/usr/bin/env node
import { watch } from "node:fs";
import { resolve } from "node:path";
import { exportNative, runExpo, syncNative } from "./build.ts";

const [command = "dev", ...args] = process.argv.slice(2);
const root = process.cwd();
if (command === "doctor") {
  // Before the sync: the doctor is for an app that may not be set up yet, and it must not write anything.
  const { runDoctor } = await import("./doctor/index.ts");
  process.exit(runDoctor(root, args));
}
await syncNative(root);
if (command === "build") {
  const platformIndex = args.indexOf("--platform");
  const platform = platformIndex < 0 ? "android" : args[platformIndex + 1];
  if (platform !== "ios" && platform !== "android") throw new Error("Choose --platform android or ios");
  await exportNative(root, platform);
} else if (command === "android" || command === "ios") {
  const child = runExpo(root, [`run:${command}`, ...args]);
  process.once("SIGINT", () => child.kill("SIGINT"));
  process.once("SIGTERM", () => child.kill("SIGTERM"));
  child.once("error", (error) => { console.error(error); process.exitCode = 1; });
  child.once("exit", (code) => { process.exitCode = code ?? 1; });
} else if (command === "dev") {
  await syncNative(root);
  let syncing = Promise.resolve();
  const watcher = watch(resolve(root, "src/routes"), { recursive: true }, (_event, file) => {
    if (file && /\+(?:mobile|layout\.mobile)\.svelte$/.test(file)) {
      syncing = syncing.then(() => syncNative(root)).catch((error: unknown) => { console.error(error); });
    }
  });
  const child = runExpo(root, ["start", ...args]);
  const stop = () => { watcher.close(); child.kill("SIGTERM"); };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  child.once("error", (error) => { watcher.close(); console.error(error); process.exitCode = 1; });
  child.once("exit", (code) => { watcher.close(); process.exitCode = code ?? 1; });
} else if (command !== "sync") {
  throw new Error(`Unknown command: ${command}. Use dev, android, ios, build, sync or doctor.`);
}
