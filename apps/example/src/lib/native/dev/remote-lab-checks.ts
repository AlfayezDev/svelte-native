// The checks of the remote functions lab (`/__dev/remote`), apart from the page so a host test can run them against the lab's own server module:
// each one calls remote functions the way a screen does and throws when what comes back is not what the server sends.
import { configureRemote, native, remoteHost } from "@rasheed/svelte-native/remote";
import {
  labBounce, labBuildInfo, labClock, labCounter, labDouble, labHello, labIncrement, labIncrementRequested, labLogin, labProbe, labReset, labSignup, labStats, labTeapot, labTypes, labWhoAmI,
} from "./remote-lab.remote.ts";

export type Check = { id: string; title: string; run: () => Promise<string> };
const expect = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
const same = (actual: unknown, expected: unknown, what: string) => expect(JSON.stringify(actual) === JSON.stringify(expected), `${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
/** A query is not a Promise: the error it rejects with, or undefined. */
async function rejection(thenable: PromiseLike<unknown>): Promise<{ status?: number; body?: { message?: string } } | undefined> {
  try { await thenable; } catch (error) { return error as never; }
  return undefined;
}

export const checks: Check[] = [
  { id: "query", title: "query", run: async () => { const hello = labHello("lab"); same(await hello, "hello lab", "labHello"); expect(hello.ready && !hello.loading, "ready after await"); return `hello lab, ready ${hello.ready}`; } },
  { id: "types", title: "query: Date, Map, Set, bigint", run: async () => {
    const result = await labTypes({ when: new Date("2026-05-06T07:08:09Z"), seen: new Map([["k", new Set([1, 2])]]) });
    expect(result.echoed.when.getTime() === Date.parse("2026-05-06T07:08:09Z"), "Date back");
    same([...(result.echoed.seen.get("k") ?? [])], [1, 2], "Set in Map");
    expect(result.date instanceof Date && result.big === 12345678901234567890n, "Date and bigint from the server");
    return "round trip ok";
  } },
  { id: "error", title: "error() from the server", run: async () => { const failing = labTeapot(); const error = await rejection(failing); expect(error?.status === 418, `status ${error?.status}`); expect(failing.error?.message === "short and stout", "App.Error"); return "418 short and stout"; } },
  { id: "batch", title: "query.batch", run: async () => {
    await labReset();
    same(await Promise.all([labDouble(1), labDouble(2), labDouble(3)]), [2, 4, 6], "doubled");
    const stats = labStats();
    await stats.refresh();
    same(stats.current?.batches, [3], "one request for three calls");
    return "3 calls, 1 request";
  } },
  { id: "live", title: "query.live", run: async () => {
    const clock = labClock(3);
    const seen: number[] = [];
    for await (const tick of clock) seen.push(tick);
    same(seen, [1, 2, 3], "ticks");
    expect(clock.done && !clock.connected, "finished and disconnected");
    return `ticks ${seen.join(",")}, done`;
  } },
  { id: "command", title: "command: single-flight", run: async () => {
    await labReset();
    const counter = labCounter();
    await counter.refresh();
    same(counter.current, 0, "counter");
    same(await labIncrement(5), 5, "labIncrement");
    same(counter.current, 5, "counter refreshed by the response");
    return "5, in the response";
  } },
  { id: "updates", title: "command: .updates(query), withOverride", run: async () => {
    await labReset();
    const counter = labCounter();
    await counter.refresh();
    const sending = labIncrementRequested(2).updates(counter.withOverride((n: number) => n + 100));
    same(counter.current, 100, "override while pending");
    same(await sending, 2, "labIncrementRequested");
    same(counter.current, 2, "refreshed value replaces the override");
    return "override 100, then 2";
  } },
  { id: "probe", title: "request: Origin, URL, cookie", run: async () => {
    const seen = await labProbe();
    const origin = remoteHost().origin;
    expect(seen.origin === origin, `Origin ${seen.origin} should be ${origin}`);
    expect(seen.pathname === "/__dev/remote", `pathname ${seen.pathname}`);
    await labLogin("lab-user");
    await labWhoAmI().refresh();
    same(await labWhoAmI(), "lab-user", "cookie round trip");
    same((await labProbe()).labSession, "lab-user", "cookie sent");
    return `Origin ${seen.origin}, ${seen.pathname}, cookie`;
  } },
  { id: "prerender", title: "prerender", run: async () => { same(await labBuildInfo(), { built: "remote lab", answer: 42 }, "labBuildInfo"); return "answered live"; } },
  { id: "redirect", title: "redirect() goes through goto", run: async () => {
    const gone: string[] = [];
    configureRemote({ goto: (location) => { gone.push(location); } });
    try { await labBounce(); } finally { configureRemote({ goto: null }); }
    same(gone, ["/__dev/remote?redirected=1"], "location");
    return gone[0];
  } },
  { id: "form", title: "form: issues, then success", run: async () => {
    const form = native(labSignup);
    form.reset();
    // (The page renders these two as inputs; an input that was never typed in is sent as an empty string, as a browser sends it.)
    form.fields.name.as("text");
    form.fields.age.as("number");
    same(await form.submit(), false, "empty form");
    expect(form.fields.name.issues()?.[0]?.message === "Name is too short", "name issue");
    form.fields.set({ name: "taken", age: 40 });
    same(await form.submit(), false, "taken name");
    expect(form.fields.name.issues()?.[0]?.message === "That name is taken", "handler issue");
    form.fields.set({ name: "Lab", age: 40 });
    same(await form.submit(), true, "valid form");
    expect(form.result?.name === "Lab", "result");
    return `result ${JSON.stringify(form.result)}`;
  } },
];
