import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { findHostJars } from "../support/host-tools.ts";
import { hostTools, kotlinHost } from "../support/native-host.ts";

/**
 * The Android updates store (`UpdateStore.kt`), the QA reset decision (`QaReset.kt`) and the asset download (`Http.kt`) compiled for the
 * host and driven by scripted commands against a real directory (the download against a local HTTP server): launch selection, the
 * launch marker and its failure rules, clean-up, reset, a corrupt index, the per-directory lock, and which asset file is trusted. Skipped when `kotlinc`, `java`, an Android SDK `android.jar` (compile-time types only) or the `org.json`
 * jar (the real implementation Android provides) is not found (`support/host-tools.ts` says where they are looked for; under CI=1
 * `native-tools.test.ts` fails instead of letting this skip).
 *
 * One JVM runs every scenario (a JVM start is most of what a scenario costs): each starts with `fresh`, which gives the host an empty store directory and an empty server, and the
 * first test that asks for its answers starts the run.
 */
const module = resolve(import.meta.dirname, "../../native/svelte-core/android/src/main/java/expo/modules/svelteupdates");
const sources = ["UpdateStore.kt", "UpdatesConfig.kt", "QaReset.kt", "Http.kt"].map((file) => join(module, file)).concat(resolve(import.meta.dirname, "fixtures/UpdateStoreHost.kt"));

const { androidJar, jsonJar } = findHostJars();
// The first run compiles the host (about ten seconds).
setDefaultTimeout(120_000);
const tools = hostTools("kotlinc", "java") && androidJar && jsonJar;
const host = tools ? kotlinHost({ name: "updates-store", sources, classpath: [jsonJar, androidJar], mainClass: "expo.modules.svelteupdates.UpdateStoreHostKt" }) : null;

/** One scenario of commands per run, each in a store of its own; `check` gets the answers, one per command. */
type Case = { name: string; runs: string[][]; check: (first: string[], second: string[]) => void };

const EMBEDDED = 1000;
const select = (markFailure = 1, token = "-") => `select ${EMBEDDED} ${markFailure} ${token}`;
const chosen = (answer: string | undefined) => /chosen=(\S+)/.exec(answer ?? "")?.[1];
const sha256 = (text: string) => createHash("sha256").update(text).digest("base64url");
const EMPTY = sha256("");
const answer = (value: string | undefined) => Object.fromEntries((value ?? "").split(" ").map((pair) => pair.split("=") as [string, string]));

const groups: Record<string, Case[]> = {
  "launch selection": [
    {
      name: "the newest ready update newer than the embedded bundle wins; the embedded bundle wins when none is",
      runs: [[select(), "commit 1 2000", "commit 2 3000", "commit 3 500", select(), "launched 2", select()]],
      check: (out) => {
        expect(chosen(out[0])).toBe("embedded");
        expect(chosen(out[4])).toBe("2");
        expect(chosen(out[6])).toBe("2");
      },
    },
    {
      name: "an update older than the embedded bundle is never launched",
      runs: [["commit 1 900", select()]],
      check: (out) => expect(chosen(out[1])).toBe("embedded"),
    },
  ],

  "the launch marker": [
    {
      name: "a confirmed launch leaves no marker and no count",
      runs: [["commit 1 2000", select(), "state", "launched 1", "state", select(), "state"]],
      check: (out) => {
        expect(out[2]).toContain("pending=1");
        expect(out[4]).toContain("pending=-");
        expect(out[4]).toContain("unconfirmed={}");
        expect(chosen(out[5])).toBe("1");
      },
    },
    {
      name: "a recorded fatal fails the update at the next start, and the start falls back to the embedded bundle",
      runs: [["commit 1 2000", select(), "fatal 1", select(), "status", "state"]],
      check: (out) => {
        expect(chosen(out[3])).toBe("embedded");
        expect(out[3]).toContain("recorded a fatal error");
        expect(out[4]).toBe("status=1:failed");
        expect(out[5]).toContain("failed=1");
      },
    },
    {
      name: "a fatal falls back to the previous good update",
      runs: [["commit 1 2000", select(), "launched 1", "commit 2 3000", select(), "fatal 2", select()]],
      check: (out) => {
        expect(chosen(out[4])).toBe("2");
        expect(chosen(out[6])).toBe("1");
      },
    },
    {
      name: "a launch that is never confirmed and records no fatal does not fail the update the first time",
      runs: [["commit 1 2000", select(), select(), "state"]],
      check: (out) => {
        expect(chosen(out[2])).toBe("1");
        expect(out[2]).toContain("launch 1 of 2");
        expect(out[3]).toContain('unconfirmed={"00000000-0000-0000-0000-000000000001":1}');
        expect(out[3]).toContain("pending=1");
      },
    },
    {
      name: "two unconfirmed launches in a row fail it",
      runs: [["commit 1 2000", select(), select(), select(), "status"]],
      check: (out) => {
        expect(chosen(out[1])).toBe("1");
        expect(chosen(out[2])).toBe("1");
        expect(chosen(out[3])).toBe("embedded");
        expect(out[3]).toContain("did not confirm its launch 2 times in a row");
        expect(out[4]).toBe("status=1:failed");
      },
    },
    {
      name: "an unconfirmed launch, then a confirmed one: the count starts again",
      runs: [["commit 1 2000", select(), select(), "launched 1", select(), select(), "status"]],
      check: (out) => {
        expect(chosen(out[5])).toBe("1");
        expect(out[6]).toBe("status=1:ready");
      },
    },
    {
      name: "an unconfirmed launch, then a launch that records a fatal: failed at the start after (both orders)",
      runs: [
        ["commit 1 2000", select(), select(), "fatal 1", select(), "status"],
        // The fatal first, then the update is fixed by a newer one: the failed one stays failed and the newer one runs.
        ["commit 1 2000", select(), "fatal 1", select(), "commit 2 3000", select(), "status"],
      ],
      check: (unconfirmedFirst, fatalFirst) => {
        expect(unconfirmedFirst[4]).toContain("recorded a fatal error");
        expect(unconfirmedFirst[5]).toBe("status=1:failed");
        expect(chosen(fatalFirst[5])).toBe("2");
        expect(fatalFirst[6]).toBe("status=1:failed,2:ready");
      },
    },
    {
      name: "a fatal reported after the launch was confirmed changes nothing",
      runs: [["commit 1 2000", select(), "launched 1", "fatal 1", select(), "status"]],
      check: (out) => {
        expect(chosen(out[4])).toBe("1");
        expect(out[5]).toBe("status=1:ready");
      },
    },
    {
      name: "a fatal for an update that is not the pending one changes nothing",
      runs: [["commit 1 2000", "commit 2 3000", select(), "fatal 1", select(), "status"]],
      check: (out) => expect(chosen(out[4])).toBe("2"),
    },
    {
      name: "a reload within a run (markFailure off) leaves the marker alone",
      runs: [["commit 1 2000", select(), "fatal 1", select(0), "state"]],
      check: (out) => {
        expect(out[3]).toContain("chosen=1");
        expect(out[4]).toContain("pending=1");
      },
    },
  ],

  "clean-up and the failed list": [
    {
      name: "a failed update keeps its record but loses its files; the launched update and its predecessor stay",
      runs: [["commit 1 2000", "commit 2 3000", "commit 3 4000", select(), "fatal 3", select(), "launched 2", "clean 3000", "status", "files"]],
      check: (out) => {
        expect(chosen(out[5])).toBe("2");
        expect(out[8]).toBe("status=1:ready,2:ready,3:failed");
        expect(out[9]).toBe("files=1,2");
      },
    },
  ],

  reset: [
    {
      name: "a token the store has not honoured forgets updates, the failed list and the marker, once",
      runs: [["commit 1 2000", "commit 2 3000", select(), "fatal 2", select(), "state", select(1, "qa-1"), "state", select(1, "qa-1"), "files"]],
      check: (out) => {
        expect(out[5]).toContain("failed=1");
        expect(out[6]).toContain("forgotten=2");
        expect(chosen(out[6])).toBe("embedded");
        expect(out[7]).toContain("updates=0");
        expect(out[7]).toContain("failed=0");
        expect(out[7]).toContain("reset=qa-1");
        expect(out[8]).toContain("forgotten=-");
        expect(out[9]).toBe("files=");
      },
    },
    {
      name: "a store with nothing in it never asks for the token",
      runs: [[select(1, "qa-1"), "state", select(1, "qa-1")]],
      check: (out) => {
        expect(out[0]).toContain("asked=false");
        expect(out[0]).toContain("forgotten=-");
      },
    },
    {
      name: "a store with something in it asks, and a new token resets it again",
      runs: [["commit 1 2000", select(1, "-"), "launched 1", select(1, "qa-1"), "commit 2 3000", select(1, "qa-1"), select(1, "qa-2")]],
      check: (out) => {
        expect(out[1]).toContain("asked=true");
        expect(out[3]).toContain("forgotten=1");
        expect(out[5]).toContain("forgotten=-");
        expect(chosen(out[5])).toBe("2");
        expect(out[6]).toContain("forgotten=1");
        expect(chosen(out[6])).toBe("embedded");
      },
    },
    {
      name: "the standalone reset is honoured once per token and keeps the client id",
      runs: [["commit 1 2000", "state", "reset qa-1", "state", "reset qa-1"]],
      check: (out) => {
        expect(out[2]).toBe("forgotten=1");
        expect(out[4]).toBe("forgotten=-");
        expect(/client=(\S+)/.exec(out[1] ?? "")?.[1]).toBe(/client=(\S+)/.exec(out[3] ?? "")?.[1]);
      },
    },
  ],

  QaReset: [
    {
      name: "only the QA package reads the setting; any other package answers null without reading it",
      runs: [["qa dev.alfayez.exposvelte.qa qa-1", "qa com.example.app qa-1", "qa dev.alfayez.exposvelte.qa -", "qa dev.alfayez.exposvelte.qa.other qa-1", "qa-throws"]],
      check: (out) => expect(out).toEqual(["token=qa-1 read=true", "token=- read=false", "token=- read=true", "token=- read=false", "token=-"]),
    },
    {
      // qa/lib/reset.ts sets this setting; the harness test compares both ends.
      name: "the setting and package the compiled code honours are the ones the harness sets and the QA app has",
      runs: [["qa-setting"]],
      check: (out) => expect(out).toEqual(["setting=svelte_qa_reset_updates package=dev.alfayez.exposvelte.qa"]),
    },
  ],

  "a damaged index": [
    {
      name: "no index is an empty store and the first select writes one",
      runs: [["index-exists", select(), "index-exists", "corrupt-file"]],
      check: (out) => {
        expect(out[0]).toBe("index=false");
        expect(out[2]).toBe("index=true");
        expect(out[3]).toBe("corrupt=-");
      },
    },
    {
      name: "an index that cannot be parsed is set aside as index.json.corrupt and the store starts empty",
      runs: [["commit 1 2000", select(), "corrupt {not json", select(), "corrupt-file", "state", "unreadable-field", select(), "corrupt-file"]],
      check: (out) => {
        expect(chosen(out[3])).toBe("embedded");
        expect(out[4]).toBe("corrupt={not json");
        expect(out[5]).toContain("updates=0");
        expect(out[8]).toBe('corrupt={"version":1}');
      },
    },
  ],

  "the lock": [
    {
      name: "store objects for one directory share a lock: concurrent commits through different objects are not lost",
      runs: [["race 8", "state"]],
      check: (out) => expect(out[0]).toBe("updates=40"),
    },
  ],

  "the hash encoding": [
    {
      name: "base64url without padding is the same as java.util.Base64's for every length up to 70, and Node's for the empty file",
      runs: [["base64 70", "hash ", "hash hello world"]],
      check: (out) => {
        expect(out[0]).toBe("different=-");
        expect(out[1]).toBe(EMPTY);
        expect(out[2]).toBe(sha256("hello world"));
      },
    },
  ],

  "which asset file is trusted": [
    {
      name: "an asset that is not in place is downloaded, checked against the manifest's hash, and left with no temporary file",
      runs: [["serve font the font bytes", "ensure assets/a.ttf font 1 the font bytes", "look assets/a.ttf"]],
      check: (out) => {
        expect(answer(out[1])).toEqual({ hash: sha256("the font bytes"), requests: "1", damaged: "-" });
        expect(out[2]).toBe("content=the font bytes tmp=false");
      },
    },
    {
      name: "an asset in place that hashes to the manifest's is kept without a request",
      runs: [["serve font the font bytes", "put assets/a.ttf the font bytes", "ensure assets/a.ttf font 1 the font bytes"]],
      check: (out) => expect(answer(out[2])).toEqual({ hash: sha256("the font bytes"), requests: "0", damaged: "-" }),
    },
    {
      name: "an empty file in place (a download whose data a crash cut off) is not trusted: it is reported, downloaded again and replaced",
      runs: [["serve font the font bytes", "put assets/a.ttf", "ensure assets/a.ttf font 1 the font bytes", "look assets/a.ttf"]],
      check: (out) => {
        expect(answer(out[2])).toEqual({ hash: sha256("the font bytes"), requests: "1", damaged: EMPTY });
        expect(out[3]).toBe("content=the font bytes tmp=false");
      },
    },
    {
      name: "a file in place with other bytes is replaced the same way",
      runs: [["serve font the font bytes", "put assets/a.ttf torn", "ensure assets/a.ttf font 1 the font bytes", "look assets/a.ttf"]],
      check: (out) => {
        expect(answer(out[2])).toEqual({ hash: sha256("the font bytes"), requests: "1", damaged: sha256("torn") });
        expect(out[3]).toBe("content=the font bytes tmp=false");
      },
    },
    {
      name: "bytes from the server that are not the manifest's are rejected, whether or not a file was in place, and never take its place",
      runs: [["serve font other bytes", "ensure assets/a.ttf font 1 the font bytes", "look assets/a.ttf", "put assets/b.ttf torn", "ensure assets/b.ttf font 1 the font bytes", "look assets/b.ttf"]],
      check: (out) => {
        expect(out[1]).toContain("error IOException: Download of http://127.0.0.1:");
        expect(out[1]).toContain(`has SHA-256 ${sha256("other bytes")}, expected ${sha256("the font bytes")}`);
        expect(out[2]).toBe("content=- tmp=false");
        expect(out[4]).toContain("has SHA-256");
        expect(out[5]).toBe("content=torn tmp=false");
      },
    },
    {
      name: "a file that belongs to one update (the bundle, reuse off) is downloaded even when an intact one is in place",
      runs: [["serve bundle new bundle", "put updates/b.bundle new bundle", "ensure updates/b.bundle bundle 0 new bundle"]],
      check: (out) => expect(answer(out[2])).toEqual({ hash: sha256("new bundle"), requests: "1", damaged: "-" }),
    },
    {
      name: "a server error is an error that names the status, and leaves nothing behind",
      runs: [["ensure assets/a.ttf missing 1 the font bytes", "look assets/a.ttf"]],
      check: (out) => {
        expect(out[0]).toContain("failed with status 404");
        expect(out[1]).toBe("content=- tmp=false");
      },
    },
  ],
};

const every = Object.values(groups).flat();
let answered: Map<Case, string[][]> | undefined;

/** The answers of a case's scenarios: the whole table runs in one JVM the first time one is asked for. */
function answersOf(one: Case): string[][] {
  if (!answered) {
    const out = (host as NonNullable<typeof host>).run(every.flatMap((each) => each.runs.flatMap((lines) => ["fresh", ...lines])));
    answered = new Map();
    let at = 0;
    for (const each of every) {
      answered.set(each, each.runs.map((lines) => {
        const answers = out.slice(at + 1, at + 1 + lines.length);
        at += 1 + lines.length;
        return answers;
      }));
    }
  }
  return answered.get(one) as string[][];
}

for (const [group, cases] of Object.entries(groups)) {
  describe.skipIf(!tools)(group, () => {
    for (const one of cases) test(one.name, () => { const [first = [], second = []] = answersOf(one); one.check(first, second); });
  });
}
