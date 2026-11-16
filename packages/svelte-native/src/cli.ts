#!/usr/bin/env node
import { watch } from "node:fs";
import { resolve } from "node:path";
import { exportNative, runExpo, syncNative } from "./build.ts";
import { variantName } from "./variant.ts";

const [command = "dev", ...args] = process.argv.slice(2);
const root = process.cwd();
if (command === "help" || command === "--help" || command === "-h") {
  console.log(`Usage: svelte-native <command>

  init       turn a SvelteKit project (npx sv create) into a Svelte Native app; \`init --help\` lists its options
  doctor     check the app's setup (peer versions, patches, Metro and Expo wiring)
  android    sync, prebuild if android/ is missing, build and run on a device or emulator (arguments go to expo run:android)
  ios        the same for iOS (a Mac with Xcode)
  dev        regenerate .svelte-native/ when a route file changes and start Metro (arguments go to expo start)
  build      export the Hermes bytecode of a platform (--platform android|ios) without building the host
  sync       only regenerate .svelte-native/
  css <file> compile the app's CSS file (Tailwind 4) into the class table of \`class\` (.svelte-native/classes.<variant>.ts); --variant <name> picks the variant, --json prints the result as JSON`);
  process.exit(0);
}
if (command === "init") {
  // Before the sync, like the doctor: the project is not set up yet (its Svelte is still the registry's), and init is what sets it up.
  const { runInit } = await import("./init-app.ts");
  process.exit(runInit(root, args));
}
if (command === "doctor") {
  // Before the sync: the doctor is for an app that may not be set up yet, and it must not write anything.
  const { runDoctor } = await import("./doctor/index.ts");
  process.exit(runDoctor(root, args));
}
if (command === "android-autolinking") {
  // Not a command for people: settings.gradle runs it around React Native's autolinking config command (`autolinking.ts`). Before the sync: it needs no routes.
  const { runAndroidAutolinking } = await import("./autolinking.ts");
  const status = runAndroidAutolinking(args);
  // A pipe takes the JSON in pieces: exit once all of it is written.
  await new Promise<void>((flushed) => process.stdout.write("", () => flushed()));
  process.exit(status);
}
if (command === "css") {
  // What the Metro integration runs in a process of its own (`buildClassesSync`), and a way to see what a CSS file compiles to. Before the sync: it needs no routes.
  const { buildClasses } = await import("./css/build.ts");
  const variantIndex = args.indexOf("--variant");
  const file = args.find((arg, index) => !arg.startsWith("--") && (variantIndex < 0 || index !== variantIndex + 1));
  if (file === undefined) throw new Error("Usage: svelte-native css <css file> [--variant <name>] [--json]");
  try {
    const result = await buildClasses({ root, css: file, variant: variantIndex < 0 ? variantName() : (args[variantIndex + 1] ?? variantName()) });
    if (args.includes("--json")) await new Promise<void>((flushed) => process.stdout.write(JSON.stringify(result), () => flushed()));
    else {
      console.log(`svelte-native: ${result.changed ? "wrote" : "kept"} ${result.file}`);
      for (const { className, property, reason } of result.unsupported) console.log(`  ${className}: ${property}: ${reason}`);
      for (const line of result.skipped) console.log(`  ${line}: ignored (plugins and JS config do not apply on native)`);
    }
    process.exit(0);
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
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
  throw new Error(`Unknown command: ${command}. Use init, dev, android, ios, build, sync, css or doctor.`);
}
