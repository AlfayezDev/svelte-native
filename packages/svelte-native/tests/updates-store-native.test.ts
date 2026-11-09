import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { findHostJars } from "./native/host-tools.ts";

/**
 * The Android updates store (`UpdateStore.kt`), the QA reset decision (`QaReset.kt`) and the asset download (`Http.kt`) compiled for the
 * host and driven by scripted commands against a real directory (the download against a local HTTP server): launch selection, the
 * launch marker and its failure rules, clean-up, reset, a corrupt index, the per-directory lock, and which asset file is trusted. Skipped when `kotlinc`, `java`, an Android SDK `android.jar` (compile-time types only) or the `org.json`
 * jar (the real implementation Android provides) is not found (`native/host-tools.ts` says where they are looked for; under CI=1
 * `native-tools.test.ts` fails instead of letting this skip).
 */
const module = resolve(import.meta.dirname, "../../../apps/example/modules/svelte-updates/android/src/main/java/expo/modules/svelteupdates");
const sources = ["UpdateStore.kt", "UpdatesConfig.kt", "QaReset.kt", "Http.kt"].map((file) => join(module, file)).concat(resolve(import.meta.dirname, "native/UpdateStoreHost.kt"));

const { androidJar, jsonJar } = findHostJars();
// The first test compiles the host (about ten seconds).
setDefaultTimeout(120_000);
const tools = Bun.which("kotlinc") && Bun.which("java") && androidJar && jsonJar;

const digest = createHash("sha1");
for (const file of sources) digest.update(readFileSync(file));
const cache = join(tmpdir(), `svelte-native-updates-store-${digest.digest("hex").slice(0, 12)}`);

function jar() {
  const path = join(cache, "store-host.jar");
  if (existsSync(path)) return path;
  mkdirSync(cache, { recursive: true });
  // Built under another name and renamed, so a compile that is cut short never leaves a jar that looks finished.
  const building = join(cache, `store-host-${process.pid}.jar`);
  const result = Bun.spawnSync(["kotlinc", ...sources, "-cp", `${jsonJar}:${androidJar}`, "-include-runtime", "-d", building], { stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`kotlinc failed: ${result.stderr.toString()}`);
  renameSync(building, path);
  return path;
}

/** Runs the commands in one fresh store directory and returns one answer per command. */
function run(lines: string[]): string[] {
  const result = Bun.spawnSync(["java", "-cp", `${jar()}:${jsonJar}:${androidJar}`, "expo.modules.svelteupdates.UpdateStoreHostKt"], { stdin: new TextEncoder().encode(`${lines.join("\n")}\n`), stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`host failed: ${result.stderr.toString()}`);
  return result.stdout.toString().trim().split("\n");
}

const EMBEDDED = 1000;
const select = (markFailure = 1, token = "-") => `select ${EMBEDDED} ${markFailure} ${token}`;
const chosen = (answer: string | undefined) => /chosen=(\S+)/.exec(answer ?? "")?.[1];

describe.skipIf(!tools)("launch selection", () => {
  test("the newest ready update newer than the embedded bundle wins; the embedded bundle wins when none is", () => {
    const out = run([select(), "commit 1 2000", "commit 2 3000", "commit 3 500", select(), "launched 2", select()]);
    expect(chosen(out[0])).toBe("embedded");
    expect(chosen(out[4])).toBe("2");
    expect(chosen(out[6])).toBe("2");
  });
  test("an update older than the embedded bundle is never launched", () => {
    const out = run(["commit 1 900", select()]);
    expect(chosen(out[1])).toBe("embedded");
  });
});

describe.skipIf(!tools)("the launch marker", () => {
  test("a confirmed launch leaves no marker and no count", () => {
    const out = run(["commit 1 2000", select(), "state", "launched 1", "state", select(), "state"]);
    expect(out[2]).toContain("pending=1");
    expect(out[4]).toContain("pending=-");
    expect(out[4]).toContain("unconfirmed={}");
    expect(chosen(out[5])).toBe("1");
  });
  test("a recorded fatal fails the update at the next start, and the start falls back to the embedded bundle", () => {
    const out = run(["commit 1 2000", select(), "fatal 1", select(), "status", "state"]);
    expect(chosen(out[3])).toBe("embedded");
    expect(out[3]).toContain("recorded a fatal error");
    expect(out[4]).toBe("status=1:failed");
    expect(out[5]).toContain("failed=1");
  });
  test("a fatal falls back to the previous good update", () => {
    const out = run(["commit 1 2000", select(), "launched 1", "commit 2 3000", select(), "fatal 2", select()]);
    expect(chosen(out[4])).toBe("2");
    expect(chosen(out[6])).toBe("1");
  });
  test("a launch that is never confirmed and records no fatal does not fail the update the first time", () => {
    const out = run(["commit 1 2000", select(), select(), "state"]);
    expect(chosen(out[2])).toBe("1");
    expect(out[2]).toContain("launch 1 of 2");
    expect(out[3]).toContain('unconfirmed={"00000000-0000-0000-0000-000000000001":1}');
    expect(out[3]).toContain("pending=1");
  });
  test("two unconfirmed launches in a row fail it", () => {
    const out = run(["commit 1 2000", select(), select(), select(), "status"]);
    expect(chosen(out[1])).toBe("1");
    expect(chosen(out[2])).toBe("1");
    expect(chosen(out[3])).toBe("embedded");
    expect(out[3]).toContain("did not confirm its launch 2 times in a row");
    expect(out[4]).toBe("status=1:failed");
  });
  test("an unconfirmed launch, then a confirmed one: the count starts again", () => {
    const out = run(["commit 1 2000", select(), select(), "launched 1", select(), select(), "status"]);
    expect(chosen(out[5])).toBe("1");
    expect(out[6]).toBe("status=1:ready");
  });
  test("an unconfirmed launch, then a launch that records a fatal: failed at the start after (both orders)", () => {
    const unconfirmedFirst = run(["commit 1 2000", select(), select(), "fatal 1", select(), "status"]);
    expect(unconfirmedFirst[4]).toContain("recorded a fatal error");
    expect(unconfirmedFirst[5]).toBe("status=1:failed");
    // The fatal first, then the update is fixed by a newer one: the failed one stays failed and the newer one runs.
    const fatalFirst = run(["commit 1 2000", select(), "fatal 1", select(), "commit 2 3000", select(), "status"]);
    expect(chosen(fatalFirst[5])).toBe("2");
    expect(fatalFirst[6]).toBe("status=1:failed,2:ready");
  });
  test("a fatal reported after the launch was confirmed changes nothing", () => {
    const out = run(["commit 1 2000", select(), "launched 1", "fatal 1", select(), "status"]);
    expect(chosen(out[4])).toBe("1");
    expect(out[5]).toBe("status=1:ready");
  });
  test("a fatal for an update that is not the pending one changes nothing", () => {
    const out = run(["commit 1 2000", "commit 2 3000", select(), "fatal 1", select(), "status"]);
    expect(chosen(out[4])).toBe("2");
  });
  test("a reload within a run (markFailure off) leaves the marker alone", () => {
    const out = run(["commit 1 2000", select(), "fatal 1", select(0), "state"]);
    expect(out[3]).toContain("chosen=1");
    expect(out[4]).toContain("pending=1");
  });
});

describe.skipIf(!tools)("clean-up and the failed list", () => {
  test("a failed update keeps its record but loses its files; the launched update and its predecessor stay", () => {
    const out = run(["commit 1 2000", "commit 2 3000", "commit 3 4000", select(), "fatal 3", select(), "launched 2", "clean 3000", "status", "files"]);
    expect(chosen(out[5])).toBe("2");
    expect(out[8]).toBe("status=1:ready,2:ready,3:failed");
    expect(out[9]).toBe("files=1,2");
  });
});

describe.skipIf(!tools)("reset", () => {
  test("a token the store has not honoured forgets updates, the failed list and the marker, once", () => {
    const out = run(["commit 1 2000", "commit 2 3000", select(), "fatal 2", select(), "state", select(1, "qa-1"), "state", select(1, "qa-1"), "files"]);
    expect(out[5]).toContain("failed=1");
    expect(out[6]).toContain("forgotten=2");
    expect(chosen(out[6])).toBe("embedded");
    expect(out[7]).toContain("updates=0");
    expect(out[7]).toContain("failed=0");
    expect(out[7]).toContain("reset=qa-1");
    expect(out[8]).toContain("forgotten=-");
    expect(out[9]).toBe("files=");
  });
  test("a store with nothing in it never asks for the token", () => {
    const out = run([select(1, "qa-1"), "state", select(1, "qa-1")]);
    expect(out[0]).toContain("asked=false");
    expect(out[0]).toContain("forgotten=-");
  });
  test("a store with something in it asks, and a new token resets it again", () => {
    const out = run(["commit 1 2000", select(1, "-"), "launched 1", select(1, "qa-1"), "commit 2 3000", select(1, "qa-1"), select(1, "qa-2")]);
    expect(out[1]).toContain("asked=true");
    expect(out[3]).toContain("forgotten=1");
    expect(out[5]).toContain("forgotten=-");
    expect(chosen(out[5])).toBe("2");
    expect(out[6]).toContain("forgotten=1");
    expect(chosen(out[6])).toBe("embedded");
  });
  test("the standalone reset is honoured once per token and keeps the client id", () => {
    const out = run(["commit 1 2000", "state", "reset qa-1", "state", "reset qa-1"]);
    expect(out[2]).toBe("forgotten=1");
    expect(out[4]).toBe("forgotten=-");
    expect(/client=(\S+)/.exec(out[1])?.[1]).toBe(/client=(\S+)/.exec(out[3])?.[1]);
  });
});

describe.skipIf(!tools)("QaReset", () => {
  test("only the QA package reads the setting; any other package answers null without reading it", () => {
    const out = run(["qa io.example.svelteqa qa-1", "qa io.example.app qa-1", "qa io.example.svelteqa -", "qa io.example.svelteqa.other qa-1", "qa-throws"]);
    expect(out).toEqual(["token=qa-1 read=true", "token=- read=false", "token=- read=true", "token=- read=false", "token=-"]);
  });
});

describe.skipIf(!tools)("QaReset names", () => {
  test("the setting and package the compiled code honours are the ones the harness sets and the QA app has", () => {
    // qa/lib/reset.ts sets this setting; the harness test compares both ends.
    expect(run(["qa-setting"])).toEqual(["setting=svelte_qa_reset_updates package=io.example.svelteqa"]);
  });
});

describe.skipIf(!tools)("a damaged index", () => {
  test("no index is an empty store and the first select writes one", () => {
    const out = run(["index-exists", select(), "index-exists", "corrupt-file"]);
    expect(out[0]).toBe("index=false");
    expect(out[2]).toBe("index=true");
    expect(out[3]).toBe("corrupt=-");
  });
  test("an index that cannot be parsed is set aside as index.json.corrupt and the store starts empty", () => {
    const out = run(["commit 1 2000", select(), "corrupt {not json", select(), "corrupt-file", "state", "unreadable-field", select(), "corrupt-file"]);
    expect(chosen(out[3])).toBe("embedded");
    expect(out[4]).toBe("corrupt={not json");
    expect(out[5]).toContain("updates=0");
    expect(out[8]).toBe("corrupt={\"version\":1}");
  });
});

describe.skipIf(!tools)("the lock", () => {
  test("store objects for one directory share a lock: concurrent commits through different objects are not lost", () => {
    const out = run(["race 8", "state"]);
    expect(out[0]).toBe("updates=40");
  });
});

const sha256 = (text: string) => createHash("sha256").update(text).digest("base64url");
const EMPTY = sha256("");
const answer = (value: string | undefined) => Object.fromEntries((value ?? "").split(" ").map((pair) => pair.split("=") as [string, string]));

describe.skipIf(!tools)("the hash encoding", () => {
  test("base64url without padding is the same as java.util.Base64's for every length up to 70, and Node's for the empty file", () => {
    const out = run(["base64 70", "hash ", "hash hello world"]);
    expect(out[0]).toBe("different=-");
    expect(out[1]).toBe(EMPTY);
    expect(out[2]).toBe(sha256("hello world"));
  });
});

describe.skipIf(!tools)("which asset file is trusted", () => {
  test("an asset that is not in place is downloaded, checked against the manifest's hash, and left with no temporary file", () => {
    const out = run(["serve font the font bytes", "ensure assets/a.ttf font 1 the font bytes", "look assets/a.ttf"]);
    expect(answer(out[1])).toEqual({ hash: sha256("the font bytes"), requests: "1", damaged: "-" });
    expect(out[2]).toBe("content=the font bytes tmp=false");
  });
  test("an asset in place that hashes to the manifest's is kept without a request", () => {
    const out = run(["serve font the font bytes", "put assets/a.ttf the font bytes", "ensure assets/a.ttf font 1 the font bytes"]);
    expect(answer(out[2])).toEqual({ hash: sha256("the font bytes"), requests: "0", damaged: "-" });
  });
  test("an empty file in place (a download whose data a crash cut off) is not trusted: it is reported, downloaded again and replaced", () => {
    const out = run(["serve font the font bytes", "put assets/a.ttf", "ensure assets/a.ttf font 1 the font bytes", "look assets/a.ttf"]);
    expect(answer(out[2])).toEqual({ hash: sha256("the font bytes"), requests: "1", damaged: EMPTY });
    expect(out[3]).toBe("content=the font bytes tmp=false");
  });
  test("a file in place with other bytes is replaced the same way", () => {
    const out = run(["serve font the font bytes", "put assets/a.ttf torn", "ensure assets/a.ttf font 1 the font bytes", "look assets/a.ttf"]);
    expect(answer(out[2])).toEqual({ hash: sha256("the font bytes"), requests: "1", damaged: sha256("torn") });
    expect(out[3]).toBe("content=the font bytes tmp=false");
  });
  test("bytes from the server that are not the manifest's are rejected, whether or not a file was in place, and never take its place", () => {
    const out = run(["serve font other bytes", "ensure assets/a.ttf font 1 the font bytes", "look assets/a.ttf", "put assets/b.ttf torn", "ensure assets/b.ttf font 1 the font bytes", "look assets/b.ttf"]);
    expect(out[1]).toContain(`error IOException: Download of http://127.0.0.1:`);
    expect(out[1]).toContain(`has SHA-256 ${sha256("other bytes")}, expected ${sha256("the font bytes")}`);
    expect(out[2]).toBe("content=- tmp=false");
    expect(out[4]).toContain("has SHA-256");
    expect(out[5]).toBe("content=torn tmp=false");
  });
  test("a file that belongs to one update (the bundle, reuse off) is downloaded even when an intact one is in place", () => {
    const out = run(["serve bundle new bundle", "put updates/b.bundle new bundle", "ensure updates/b.bundle bundle 0 new bundle"]);
    expect(answer(out[2])).toEqual({ hash: sha256("new bundle"), requests: "1", damaged: "-" });
  });
  test("a server error is an error that names the status, and leaves nothing behind", () => {
    const out = run(["ensure assets/a.ttf missing 1 the font bytes", "look assets/a.ttf"]);
    expect(out[0]).toContain("failed with status 404");
    expect(out[1]).toBe("content=- tmp=false");
  });
});
