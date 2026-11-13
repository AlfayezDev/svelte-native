import { followSignal, isAbortSignal } from "./abort.ts";
import { Body, BodyState, bodyStateOf, cloneBodyState, extractBody, isReadableStream, setBodyState, takeBodyState, type BodyInit } from "./body.ts";
import { Headers, isToken, type HeadersInit } from "./headers.ts";

/**
 * The Fetch standard's `Request`. `new Request(request, init)` copies the request and applies `init` over it (headers are replaced as a whole, not merged) and takes its body: the
 * request it was built from is then used up. A request keeps the signal it was given; `request.signal` is a signal that follows it, made when first read.
 */
export type RequestInit = {
  method?: string;
  headers?: HeadersInit;
  body?: BodyInit | null;
  referrer?: string;
  referrerPolicy?: ReferrerPolicy;
  mode?: RequestMode;
  credentials?: RequestCredentials;
  cache?: RequestCache;
  redirect?: RequestRedirect;
  integrity?: string;
  keepalive?: boolean;
  signal?: AbortSignal | null;
  duplex?: "half";
};
export type RequestInfo = Request | URL | string;

export type RequestState = {
  method: string;
  url: string;
  headers: Headers;
  referrer: string;
  referrerPolicy: string;
  mode: string;
  credentials: string;
  cache: string;
  redirect: string;
  integrity: string;
  keepalive: boolean;
  signal: AbortSignal | null;
  follower: AbortSignal | undefined;
};

const requests = new WeakMap<object, RequestState>();

export function requestStateOf(request: object): RequestState {
  const state = requests.get(request);
  if (state === undefined) throw new TypeError("Illegal invocation");
  return state;
}

const enumeration = <T extends string>(value: unknown, allowed: readonly T[], type: string): T => {
  const text = String(value);
  if (!allowed.includes(text as T)) throw new TypeError(`The provided value '${text}' is not a valid enum value of type ${type}`);
  return text as T;
};

/** The URL a request is for, serialized. Credentials in a URL are refused, as are relative URLs (there is no base to resolve them against in an app). */
export function parseRequestURL(input: unknown): string {
  let url: URL;
  try {
    url = new URL(String(input));
  } catch (cause) {
    throw new TypeError(`Failed to parse URL from ${String(input)}`, { cause });
  }
  if (url.username !== "" || url.password !== "") throw new TypeError(`Request cannot be constructed from a URL that includes credentials: ${url.protocol}//${url.host}${url.pathname}`);
  return url.href;
}

const STANDARD_METHODS = ["DELETE", "GET", "HEAD", "OPTIONS", "POST", "PUT"];

function parseMethod(value: unknown): string {
  const text = String(value);
  if (!isToken(text)) throw new TypeError(`'${text}' is not a valid HTTP method.`);
  const upper = text.toUpperCase();
  if (upper === "CONNECT" || upper === "TRACE" || upper === "TRACK") throw new TypeError(`'${text}' HTTP method is unsupported.`);
  return STANDARD_METHODS.includes(upper) ? upper : text;
}

function parseReferrer(value: unknown): string {
  const text = String(value);
  if (text === "") return "no-referrer";
  try {
    return new URL(text).href;
  } catch (cause) {
    throw new TypeError(`Referrer '${text}' is not a valid URL`, { cause });
  }
}

/** A Request over a state and a body that already exist (`clone`). */
function made(state: RequestState, body: BodyState): Request {
  const request = Object.create(Request.prototype) as Request;
  requests.set(request, state);
  setBodyState(request, body);
  return request;
}

export class Request extends Body {
  constructor(input: RequestInfo, init?: RequestInit) {
    super();
    if (init !== undefined && init !== null && typeof init !== "object" && typeof init !== "function") throw new TypeError("Request init must be an object");
    const bag: RequestInit = init ?? {};
    const from = typeof input === "object" && input !== null ? requests.get(input) : undefined;
    const state: RequestState = from === undefined
      ? { method: "GET", url: parseRequestURL(input), headers: new Headers(), referrer: "about:client", referrerPolicy: "", mode: "cors", credentials: "same-origin", cache: "default", redirect: "follow", integrity: "", keepalive: false, signal: null, follower: undefined }
      : { ...from, headers: new Headers(from.headers), follower: undefined };
    const inputBody = from === undefined ? null : bodyStateOf(input as object);

    if (bag.method !== undefined) state.method = parseMethod(bag.method);
    if (bag.signal !== undefined && bag.signal !== null && !isAbortSignal(bag.signal)) throw new TypeError("Request init's signal is not an AbortSignal");
    if (bag.signal !== undefined) state.signal = bag.signal;
    if (bag.mode !== undefined) state.mode = enumeration(bag.mode, ["same-origin", "cors", "no-cors", "navigate"], "RequestMode");
    if (state.mode === "navigate") throw new TypeError("Request constructor: invalid request mode navigate.");
    if (bag.credentials !== undefined) state.credentials = enumeration(bag.credentials, ["omit", "same-origin", "include"], "RequestCredentials");
    if (bag.cache !== undefined) state.cache = enumeration(bag.cache, ["default", "no-store", "reload", "no-cache", "force-cache", "only-if-cached"], "RequestCache");
    if (state.cache === "only-if-cached" && state.mode !== "same-origin") throw new TypeError("'only-if-cached' can be set only with 'same-origin' mode");
    if (bag.redirect !== undefined) state.redirect = enumeration(bag.redirect, ["follow", "error", "manual"], "RequestRedirect");
    if (bag.referrerPolicy !== undefined && String(bag.referrerPolicy) !== "") {
      state.referrerPolicy = enumeration(bag.referrerPolicy, ["no-referrer", "no-referrer-when-downgrade", "same-origin", "origin", "strict-origin", "origin-when-cross-origin", "strict-origin-when-cross-origin", "unsafe-url"], "ReferrerPolicy");
    }
    if (bag.referrer !== undefined) state.referrer = parseReferrer(bag.referrer);
    if (bag.integrity !== undefined) state.integrity = String(bag.integrity);
    if (bag.keepalive !== undefined) state.keepalive = Boolean(bag.keepalive);
    if (bag.duplex !== undefined) enumeration(bag.duplex, ["half"], "RequestDuplex");
    if (bag.headers !== undefined) state.headers = new Headers(bag.headers);

    const given = bag.body !== undefined && bag.body !== null;
    if ((given || inputBody?.source != null) && (state.method === "GET" || state.method === "HEAD")) throw new TypeError("Request with GET/HEAD method cannot have body.");
    let body: BodyState;
    if (given) {
      const extracted = extractBody(bag.body);
      if (isReadableStream(bag.body) && bag.duplex !== "half") throw new TypeError("RequestInit: duplex option is required when sending a body.");
      if (extracted.type !== null && !state.headers.has("content-type")) state.headers.append("content-type", extracted.type);
      body = new BodyState(extracted.source);
    } else {
      body = inputBody === null ? new BodyState(null) : takeBodyState(inputBody);
    }
    requests.set(this, state);
    setBodyState(this, body);
  }

  get method(): string {
    return requestStateOf(this).method;
  }

  get url(): string {
    return requestStateOf(this).url;
  }

  get headers(): Headers {
    return requestStateOf(this).headers;
  }

  get destination(): RequestDestination {
    requestStateOf(this);
    return "";
  }

  get referrer(): string {
    const { referrer } = requestStateOf(this);
    return referrer === "no-referrer" ? "" : referrer;
  }

  get referrerPolicy(): ReferrerPolicy {
    return requestStateOf(this).referrerPolicy as ReferrerPolicy;
  }

  get mode(): RequestMode {
    return requestStateOf(this).mode as RequestMode;
  }

  get credentials(): RequestCredentials {
    return requestStateOf(this).credentials as RequestCredentials;
  }

  get cache(): RequestCache {
    return requestStateOf(this).cache as RequestCache;
  }

  get redirect(): RequestRedirect {
    return requestStateOf(this).redirect as RequestRedirect;
  }

  get integrity(): string {
    return requestStateOf(this).integrity;
  }

  get keepalive(): boolean {
    return requestStateOf(this).keepalive;
  }

  get isReloadNavigation(): boolean {
    requestStateOf(this);
    return false;
  }

  get isHistoryNavigation(): boolean {
    requestStateOf(this);
    return false;
  }

  get duplex(): "half" {
    requestStateOf(this);
    return "half";
  }

  get signal(): AbortSignal {
    const state = requestStateOf(this);
    state.follower ??= state.signal === null ? new AbortController().signal : followSignal(state.signal);
    return state.follower;
  }

  clone(): Request {
    const state = requestStateOf(this);
    return made({ ...state, headers: new Headers(state.headers), follower: undefined }, cloneBodyState(bodyStateOf(this)));
  }

  get [Symbol.toStringTag](): string {
    return "Request";
  }
}
