import { command, form, getRequestEvent, prerender, query, requested } from "$app/server";
import { error, invalid, redirect } from "@sveltejs/kit";
import * as v from "valibot";

// A small SvelteKit server with one of each kind of remote function, for the package's end-to-end test (tests/remote-e2e.test.ts).
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let count = 0;
let counterRuns = 0;
let liveOpen = 0;
let liveStarted = 0;
const batches: number[] = [];
const signups: string[] = [];

export const hello = query(v.string(), async (name) => `hello ${name}`);

// devalue types: Date, Map, bigint and a custom class survive the round trip.
export const types = query(async () => ({ date: new Date("2026-01-02T03:04:05Z"), map: new Map([[1, "one"]]), big: 12345678901234567890n, set: new Set(["a"]) }));
export const echoArgument = query(v.any(), async (argument) => ({ argument }));

export const teapot = query(async () => error(418, "short and stout"));
export const bounce = query(async () => redirect(303, "/elsewhere"));

export const counter = query(async () => {
  counterRuns++;
  return count;
});
export const stats = query(async () => ({ counterRuns, liveOpen, liveStarted, batches: [...batches], signups: [...signups] }));

export const double = query.batch(v.number(), async (numbers) => {
  batches.push(numbers.length);
  return (number) => number * 2;
});

// Yields 1, 2, 3 and ends; `liveOpen` is how many streams the server still has open.
export const clock = query.live(v.optional(v.number(), 3), async function* (upTo) {
  liveOpen++;
  liveStarted++;
  try {
    for (let tick = 1; tick <= upTo; tick++) {
      yield tick;
      await sleep(40);
    }
  } finally {
    liveOpen--;
  }
});
// Never ends: only the client closing it stops it.
export const endless = query.live(async function* () {
  liveOpen++;
  liveStarted++;
  try {
    for (let tick = 1; ; tick++) {
      yield tick;
      await sleep(40);
    }
  } finally {
    liveOpen--;
  }
});

// The server refreshes the query itself: the new value is in the response (single-flight).
export const increment = command(v.number(), async (by) => {
  count += by;
  await counter().refresh();
  return count;
});
// The client asked for the refresh with .updates(counter): the command answers it with `requested`.
export const incrementRequested = command(v.number(), async (by) => {
  count += by;
  await requested(counter, 5).refreshAll();
  return count;
});
// Forgets to answer a requested refresh.
export const incrementIgnoring = command(v.number(), async (by) => {
  count += by;
  return count;
});
export const reset = command(async () => {
  count = 0;
  counterRuns = 0;
  batches.length = 0;
  signups.length = 0;
});

// What the server saw of the request.
export const probe = command(async () => {
  const { request, url } = getRequestEvent();
  return { origin: request.headers.get("origin"), pathname: url.pathname, search: url.search, cookie: request.headers.get("cookie") };
});
export const login = command(v.string(), async (name) => {
  getRequestEvent().cookies.set("session", name, { path: "/", httpOnly: true, sameSite: "lax", secure: false });
  return name;
});
export const me = query(async () => getRequestEvent().cookies.get("session") ?? null);
export const redirecting = command(async () => redirect(303, "/elsewhere"));

export const signup = form(
  v.object({
    name: v.pipe(v.string(), v.minLength(2, "Name is too short")),
    age: v.pipe(v.number(), v.minValue(18, "Must be 18 or older")),
    agree: v.optional(v.boolean(), false),
    topics: v.optional(v.array(v.string()), []),
  }),
  async ({ name, age, agree, topics }, issue) => {
    if (name === "taken") invalid(issue.name("That name is taken"));
    signups.push(name);
    return { id: signups.length, name, age, agree, topics };
  },
);
export const sendMail = form(v.object({ to: v.pipe(v.string(), v.email()) }), async ({ to }) => redirect(303, `/sent?to=${encodeURIComponent(to)}`));

export const buildInfo = prerender(async () => ({ built: "fixture", answer: 42 }));
export const greeting = prerender(v.string(), async (name) => `prerendered ${name}`, { inputs: () => ["ada"], dynamic: true });
