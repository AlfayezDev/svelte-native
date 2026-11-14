import type { HeaderList } from "./native.ts";

/**
 * The Fetch standard's `Headers`: a list of name/value entries (names lower-cased; an appended name is a second entry, not a joined value), read back combined. `get` joins the values of a
 * name with ", "; iteration is sorted by name and combined too, except that every `Set-Cookie` is its own entry (`getSetCookie` returns them). The guard of a response from the network is
 * "immutable": it throws on every change.
 */
type Guard = "none" | "immutable";
type State = { list: [name: string, value: string][]; guard: Guard; version: number; sorted?: { version: number; pairs: [string, string][] } };

const states = new WeakMap<Headers, State>();

function stateOf(headers: Headers): State {
  const state = states.get(headers);
  if (state === undefined) throw new TypeError("Illegal invocation");
  return state;
}

const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/** Whether a string is an HTTP token: what a header name and a method must be. */
export const isToken = (text: string): boolean => TOKEN.test(text);

function checkName(name: string): string {
  const text = String(name);
  if (!TOKEN.test(text)) throw new TypeError(`Invalid header name: ${JSON.stringify(text)}`);
  return text.toLowerCase();
}

/** A header value as the standard has it: a ByteString (no character above U+00FF) without a leading or trailing tab, newline, carriage return or space, and without NUL, CR or LF inside. */
function checkValue(value: string): string {
  const text = String(value).replace(/^[\t\n\r ]+|[\t\n\r ]+$/g, "");
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit > 0xff) throw new TypeError(`Invalid header value: the character at ${i} is not a ByteString character`);
    if (unit === 0 || unit === 10 || unit === 13) throw new TypeError("Invalid header value: it contains a NUL, CR or LF character");
  }
  return text;
}

export type HeadersInit = Headers | Iterable<readonly [string, string]> | Record<string, string>;

function fill(state: State, init: unknown): void {
  if (init instanceof Headers) {
    for (const [name, value] of stateOf(init).list) state.list.push([name, value]);
    return;
  }
  if (typeof init !== "object" || init === null) throw new TypeError("Headers init must be an object: a Headers, an iterable of [name, value] pairs, or a record");
  const iterator = (init as { [Symbol.iterator]?: unknown })[Symbol.iterator];
  if (iterator !== undefined && iterator !== null) {
    if (typeof iterator !== "function") throw new TypeError("Headers init's Symbol.iterator is not a function");
    for (const pair of init as Iterable<unknown>) {
      if (typeof pair !== "object" || pair === null || typeof (pair as { [Symbol.iterator]?: unknown })[Symbol.iterator] !== "function") throw new TypeError("Each Headers init pair must be an iterable of two strings");
      const entry = [...(pair as Iterable<string>)];
      if (entry.length !== 2) throw new TypeError("Each Headers init pair must have exactly two items: a name and a value");
      state.list.push([checkName(entry[0]!), checkValue(entry[1]!)]);
    }
    return;
  }
  for (const key of Reflect.ownKeys(init)) {
    if (typeof key !== "string" || !Reflect.getOwnPropertyDescriptor(init, key)?.enumerable) continue;
    state.list.push([checkName(key), checkValue((init as Record<string, string>)[key]!)]);
  }
}

function changed(state: State): void {
  if (state.guard === "immutable") throw new TypeError("Headers are immutable");
}

function sortedPairs(state: State): [string, string][] {
  if (state.sorted?.version === state.version) return state.sorted.pairs;
  const names = [...new Set(state.list.map(([name]) => name))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const pairs: [string, string][] = [];
  for (const name of names) {
    const values = state.list.filter(([entry]) => entry === name).map(([, value]) => value);
    if (name === "set-cookie") for (const value of values) pairs.push([name, value]);
    else pairs.push([name, values.join(", ")]);
  }
  state.sorted = { version: state.version, pairs };
  return pairs;
}

export class Headers {
  constructor(init?: HeadersInit) {
    const state: State = { list: [], guard: "none", version: 0 };
    states.set(this, state);
    if (init !== undefined) fill(state, init);
  }

  append(...args: [name: string, value: string]): void {
    if (args.length < 2) throw new TypeError("Headers.append requires 2 arguments: a name and a value");
    const state = stateOf(this);
    const name = checkName(args[0]);
    const value = checkValue(args[1]);
    changed(state);
    state.list.push([name, value]);
    state.version++;
  }

  delete(...args: [name: string]): void {
    if (args.length < 1) throw new TypeError("Headers.delete requires 1 argument: a name");
    const state = stateOf(this);
    const name = checkName(args[0]);
    changed(state);
    state.list = state.list.filter(([entry]) => entry !== name);
    state.version++;
  }

  get(...args: [name: string]): string | null {
    if (args.length < 1) throw new TypeError("Headers.get requires 1 argument: a name");
    const name = checkName(args[0]);
    const values = stateOf(this).list.filter(([entry]) => entry === name);
    return values.length === 0 ? null : values.map(([, value]) => value).join(", ");
  }

  getSetCookie(): string[] {
    return stateOf(this).list.filter(([name]) => name === "set-cookie").map(([, value]) => value);
  }

  has(...args: [name: string]): boolean {
    if (args.length < 1) throw new TypeError("Headers.has requires 1 argument: a name");
    const name = checkName(args[0]);
    return stateOf(this).list.some(([entry]) => entry === name);
  }

  set(...args: [name: string, value: string]): void {
    if (args.length < 2) throw new TypeError("Headers.set requires 2 arguments: a name and a value");
    const state = stateOf(this);
    const name = checkName(args[0]);
    const value = checkValue(args[1]);
    changed(state);
    const first = state.list.findIndex(([entry]) => entry === name);
    if (first === -1) state.list.push([name, value]);
    else state.list = state.list.filter(([entry], index) => entry !== name || index === first).map((pair, index) => (index === first ? [name, value] : pair));
    state.version++;
  }

  forEach(callback: (value: string, name: string, headers: Headers) => void, thisArg?: unknown): void {
    if (typeof callback !== "function") throw new TypeError("Headers.forEach requires a function");
    for (const [name, value] of this.entries()) callback.call(thisArg, value, name, this);
  }

  /** Iteration follows the headers as they are at each step: a header added or removed by a callback is seen (or skipped) as in the standard. */
  *entries(): IterableIterator<[string, string]> {
    const state = stateOf(this);
    for (let index = 0; ; index++) {
      const pair = sortedPairs(state)[index];
      if (pair === undefined) return;
      yield [pair[0], pair[1]];
    }
  }

  *keys(): IterableIterator<string> {
    for (const [name] of this.entries()) yield name;
  }

  *values(): IterableIterator<string> {
    for (const [, value] of this.entries()) yield value;
  }

  [Symbol.iterator](): IterableIterator<[string, string]> {
    return this.entries();
  }

  get [Symbol.toStringTag](): string {
    return "Headers";
  }
}

/** The entries in the order they were added, names lower case, a repeated name as repeated entries. */
export function headerPairs(headers: Headers): HeaderList {
  return stateOf(headers).list.map(([name, value]) => [name, value]);
}

/**
 * What `fetch` sends: one entry per name, at the place the name first appeared, a repeated name's values joined with ", " (as a browser sends a header added twice: HTTP
 * allows it, and native clients differ in whether they repeat the line or keep the last).
 */
export function combinedHeaderPairs(headers: Headers): HeaderList {
  const combined = new Map<string, string>();
  for (const [name, value] of stateOf(headers).list) combined.set(name, combined.has(name) ? `${combined.get(name)}, ${value}` : value);
  return [...combined];
}

/** A copy that keeps the guard (a cloned response's headers are as immutable as the original's). */
export function copyHeaders(headers: Headers): Headers {
  const copy = new Headers(headers);
  stateOf(copy).guard = stateOf(headers).guard;
  return copy;
}

export function setHeadersGuard(headers: Headers, guard: Guard): Headers {
  stateOf(headers).guard = guard;
  return headers;
}

/** A cookie header the system joined with ", " (iOS gives no other view) is split where a comma is followed by a new `name=`; a comma inside an `Expires` date is not. */
const COOKIE_BOUNDARY = /,(?=\s*[^\s=;,]+=)/;

/** The headers of a response from native code: immutable, entries as received, nothing validated (the wire is what it is). */
export function headersFromNative(list: HeaderList): Headers {
  const headers = new Headers();
  const state = stateOf(headers);
  for (const [name, value] of list) {
    const lower = name.toLowerCase();
    if (lower === "set-cookie") for (const cookie of value.split(COOKIE_BOUNDARY)) state.list.push([lower, cookie.trim()]);
    else state.list.push([lower, value.replace(/^[\t\n\r ]+|[\t\n\r ]+$/g, "")]);
  }
  state.guard = "immutable";
  return headers;
}
