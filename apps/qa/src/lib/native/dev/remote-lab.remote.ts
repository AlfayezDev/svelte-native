// The server half of the remote functions lab (`/__dev/remote`): one function of each kind, in memory. Development only: the web dev server loads this file
// (`vite.config.ts`, `server.warmup`, `remote-lab.ts`), `vite preview` and builds have neither it nor the `remote` flag, and the lab's native page calls it exactly
// as a web page would. Nothing here is a secret or needs a login: the state is a few counters and a list of names, and the dev server listens on the LAN
// (`host: true`) with all the routes of the app, which are as reachable as these.
// packages/expo-svelte/README.md, "Remote functions", lists what to check on a device.
import { command, form, getRequestEvent, prerender, query, requested } from "$app/server";
import { error, invalid, redirect } from "@sveltejs/kit";
import * as v from "valibot";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let count = 0;
let counterRuns = 0;
let liveOpen = 0;
const batches: number[] = [];
const signups: string[] = [];

export const labHello = query(v.string(), async (name) => `hello ${name}`);
/** devalue's types, and an argument that is not JSON, in both directions. */
export const labTypes = query(v.any(), async (argument: { when: Date; seen: Map<string, Set<number>> }) => ({ echoed: argument, date: new Date("2026-01-02T03:04:05Z"), big: 12345678901234567890n }));
export const labTeapot = query(async () => error(418, "short and stout"));
export const labBounce = query(async () => redirect(303, "/__dev/remote?redirected=1"));

export const labCounter = query(async () => {
  counterRuns++;
  return count;
});
export const labStats = query(async () => ({ counterRuns, liveOpen, batches: [...batches], signups: [...signups] }));
export const labDouble = query.batch(v.number(), async (numbers) => {
  batches.push(numbers.length);
  return (number) => number * 2;
});
/** 1, 2, 3, … every 400 ms up to `upTo`; the stream is open on the server while `liveOpen` counts it. */
export const labClock = query.live(v.optional(v.number(), 3), async function* (upTo) {
  liveOpen++;
  try {
    for (let tick = 1; tick <= upTo; tick++) {
      yield tick;
      await sleep(400);
    }
  } finally {
    liveOpen--;
  }
});

/** The server refreshes `labCounter` itself: the new value is in the command's response. */
export const labIncrement = command(v.number(), async (by) => {
  count += by;
  await labCounter().refresh();
  return count;
});
/** The client asked for the refresh (`.updates(labCounter)`): the command answers it. */
export const labIncrementRequested = command(v.number(), async (by) => {
  count += by;
  await requested(labCounter, 5).refreshAll();
  return count;
});
export const labReset = command(async () => {
  count = 0;
  counterRuns = 0;
  batches.length = 0;
  signups.length = 0;
});
/** What the server saw: the Origin header (SvelteKit's CSRF check compares it with its own origin), the screen's URL and the lab's own cookie (not the others the origin has). */
export const labProbe = command(async () => {
  const { request, url, cookies } = getRequestEvent();
  return { origin: request.headers.get("origin"), pathname: url.pathname, search: url.search, labSession: cookies.get("lab-session") ?? null };
});
export const labLogin = command(v.string(), async (name) => {
  getRequestEvent().cookies.set("lab-session", name, { path: "/", httpOnly: true, sameSite: "lax", secure: false });
  return name;
});
export const labWhoAmI = query(async () => getRequestEvent().cookies.get("lab-session") ?? null);

export const labSignup = form(
  v.object({
    name: v.pipe(v.string(), v.minLength(2, "Name is too short")),
    age: v.pipe(v.number("Age is a number"), v.minValue(18, "Must be 18 or older")),
    subscribe: v.optional(v.boolean(), false),
  }),
  async ({ name, age, subscribe }, issue) => {
    if (name.toLowerCase() === "taken") invalid(issue.name("That name is taken"));
    signups.push(name);
    return { id: signups.length, name, age, subscribe };
  },
);

export const labBuildInfo = prerender(async () => ({ built: "remote lab", answer: 42 }));
