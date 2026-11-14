import { applyBodyType, Body, BodyState, bodyStateOf, cloneBodyState, extractBody, setBodyState, type BodyInit, type BodySource } from "./body.ts";
import { copyHeaders, Headers, headersFromNative, setHeadersGuard, type HeadersInit } from "./headers.ts";
import type { NativeResponseHead } from "./native.ts";

/**
 * The Fetch standard's `Response`. A response from the network (`responseFromNative`) has immutable headers, the type "basic", and, while its body has not been touched, a body that is still
 * in native code: `arrayBuffer`, `text` and `blob` are one native call (`body.ts`).
 */
export type ResponseInit = { status?: number; statusText?: string; headers?: HeadersInit };

type ResponseState = { type: ResponseType; status: number; statusText: string; headers: Headers; url: string; redirected: boolean };

const responses = new WeakMap<object, ResponseState>();

function stateOf(response: object): ResponseState {
  const state = responses.get(response);
  if (state === undefined) throw new TypeError("Illegal invocation");
  return state;
}

const NULL_BODY_STATUSES = [101, 103, 204, 205, 304];
const REDIRECT_STATUSES = [301, 302, 303, 307, 308];

function made(state: ResponseState, body: BodyState): Response {
  const response = Object.create(Response.prototype) as Response;
  responses.set(response, state);
  setBodyState(response, body);
  return response;
}

/** A response for a head native code delivered; `source` is its body (null for none: HEAD, 204, 205, 304). */
export function responseFromNative(head: NativeResponseHead, source: BodySource | null): Response {
  return made({ type: "basic", status: head.status, statusText: head.statusText, headers: headersFromNative(head.headers), url: head.url, redirected: head.redirected }, new BodyState(source));
}

/** A response a JavaScript layer answers itself (a `data:` URL): 200, and the given headers and bytes. */
export function responseFromBytes(url: string, headers: HeadersInit, source: BodySource): Response {
  return made({ type: "basic", status: 200, statusText: "OK", headers: setHeadersGuard(new Headers(headers), "immutable"), url, redirected: false }, new BodyState(source));
}

export class Response extends Body {
  constructor(body?: BodyInit | null, init?: ResponseInit) {
    super();
    if (init !== undefined && init !== null && typeof init !== "object" && typeof init !== "function") throw new TypeError("Response init must be an object");
    const bag: ResponseInit = init ?? {};
    const status = bag.status === undefined ? 200 : Math.trunc(Number(bag.status)) % 65536;
    if (!(status >= 200 && status <= 599)) throw new RangeError(`init["status"] must be in the range of 200 to 599, inclusive.`);
    const statusText = bag.statusText === undefined ? "" : String(bag.statusText);
    if (!/^[\t\x20-\x7e\x80-\xff]*$/.test(statusText)) throw new TypeError("Invalid statusText");
    const headers = new Headers(bag.headers);
    let state: BodyState;
    if (body === undefined || body === null) {
      state = new BodyState(null);
    } else {
      if (NULL_BODY_STATUSES.includes(status)) throw new TypeError(`Response with null body status cannot have body`);
      const extracted = extractBody(body);
      applyBodyType(headers, extracted.type);
      state = new BodyState(extracted.source);
    }
    responses.set(this, { type: "default", status, statusText, headers, url: "", redirected: false });
    setBodyState(this, state);
  }

  static error(): Response {
    return made({ type: "error", status: 0, statusText: "", headers: setHeadersGuard(new Headers(), "immutable"), url: "", redirected: false }, new BodyState(null));
  }

  static redirect(url: string | URL, status = 302): Response {
    let location: string;
    try {
      location = new URL(String(url)).href;
    } catch (cause) {
      throw new TypeError(`Failed to parse URL from ${String(url)}`, { cause });
    }
    if (!REDIRECT_STATUSES.includes(status)) throw new RangeError(`Invalid status code ${status}`);
    const headers = new Headers({ location });
    return made({ type: "default", status, statusText: "", headers: setHeadersGuard(headers, "immutable"), url: "", redirected: false }, new BodyState(null));
  }

  static json(data: unknown, init?: ResponseInit): Response {
    const text = JSON.stringify(data);
    if (text === undefined) throw new TypeError("The data is not JSON serializable");
    const headers = new Headers(init?.headers);
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
    return new Response(text, { ...init, headers });
  }

  get type(): ResponseType {
    return stateOf(this).type;
  }

  get url(): string {
    return stateOf(this).url;
  }

  get redirected(): boolean {
    return stateOf(this).redirected;
  }

  get status(): number {
    return stateOf(this).status;
  }

  get ok(): boolean {
    const { status } = stateOf(this);
    return status >= 200 && status <= 299;
  }

  get statusText(): string {
    return stateOf(this).statusText;
  }

  get headers(): Headers {
    return stateOf(this).headers;
  }

  clone(): Response {
    const state = stateOf(this);
    return made({ ...state, headers: copyHeaders(state.headers) }, cloneBodyState(bodyStateOf(this)));
  }

  get [Symbol.toStringTag](): string {
    return "Response";
  }
}
