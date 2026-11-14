// biome-ignore-all lint/suspicious/noExplicitAny: the values of a form are whatever its schema says, and SvelteKit's field proxy is untyped JavaScript
// The ambient declarations of the SvelteKit files this module imports (a script file of `declare module`s: it cannot be imported).
/// <reference path="./kit-modules.d.ts" />
/**
 * `form` for a native app: the client half of SvelteKit's remote `form` without a `<form>` element.
 *
 * Ported from `@sveltejs/kit/src/runtime/client/remote-functions/form.svelte.js` (3.1.1; compared with 3.0.0-next.27 when the pin moved: the messages moved to SvelteKit's message modules, and `for(key)` instances are held from inside the effect). What is the same: the state (`fields`,
 * `result`, `pending`, `submitted`), validation (`preflight`, `validate`, the server's issues merged with the client's), the request
 * (`remote_request`, the binary form format and `.updates(...)` of SvelteKit's own files), `for(key)` instances, `enhance`. What differs, because
 * a native screen has no DOM:
 *
 * - The values are set by `fields.x.set(value)` or by the props `fields.x.as(type)` returns (`value` and `onChangeText`/`onValueChange`), not
 *   read from inputs when the form is submitted. SvelteKit keeps a mirror of the DOM in `input`; here `input` is the source.
 * - `submit()` is what pressing a submit button is on the web: preflight, then the `enhance` callback (default: send, and reset on success).
 *   There is no `element`, no attachment, no `action`, and no file picker: a file field (`as("file")`) takes the `File`s a picker of the app's gives it.
 * - `reset()` returns the fields to their defaults (the web's `<form>.reset()`), and is what the default `enhance` does after a successful send.
 *   It invalidates pending validation/preflight, but does not cancel a request already sent to the server; that response can still update result/errors.
 * - Failed submissions focus the first rendered invalid field whose mounted host exposes `focus()`. Background validation never moves focus.
 *   An input whose host is replaced (an `{#if}` that swaps it) is focused through the newest host.
 * - What a submission carries is what the inputs show: SvelteKit reads it from the DOM (`new FormData(form)`: the inputs that are there, with the value
 *   they show, an unchecked box not at all), and so does this, from the inputs `as(type)` made and the host has on screen (`variants` below).
 * - A submission that fails is not thrown at the caller (the web's submit event has nobody to throw to): it goes through `handle_error` (the app's
 *   `handleError`), is shown by `form.error`, and `submit()` resolves `false`.
 * Every divergence is listed in REFERENCE.md ("The native form").
 */
import { tick } from "svelte";
import {
  BINARY_FORM_CONTENT_TYPE, build_path_string, create_field_proxy, DELETE_KEY, deep_get, deep_set, flatten_issues, normalize_issue, serialize_binary_form,
} from "@sveltejs/kit/src/runtime/form-utils.js";
import { categorize_updates, fail_unhandled_refreshes, remote_request } from "@sveltejs/kit/src/runtime/client/remote-functions/shared.svelte.js";
import { FormBytes, location } from "./globals.ts";
import { currentUrl } from "./link.ts";
import { parseLocalizedNumber } from "./number.ts";
import { assertReady } from "./ready.ts";
import { app_dir, base } from "./shims/paths.ts";
import { _goto, handle_error, refreshAll, set_nearest_error_page, type ClientError } from "./shims/client.ts";

/* eslint-disable @typescript-eslint/no-explicit-any -- the form's values are whatever the schema says; the public types live in types.ts */

type Path = (string | number)[];
type Issue = { name: string; path: Path; message: string; server: boolean };
type StandardSchema = { "~standard": { validate(value: unknown): { issues?: readonly { message: string; path?: readonly unknown[] }[] } | Promise<{ issues?: readonly { message: string; path?: readonly unknown[] }[] }> } };
/** What a submission sends: the bytes of one without files, or the `Blob` of its parts (the files' bytes stay where they are; `globals.ts`). */
const bodyOf = (blob: unknown): BodyInit => (blob instanceof FormBytes ? blob.bytes() : blob) as BodyInit;

type Submission = Promise<boolean> & { updates: (...updates: unknown[]) => Promise<boolean> };
/**
 * One input `as(type)` made: what it shows and what it contributes to a submission. The host tells `ref` when it has the element and when it is gone
 * (React's contract), so a field whose inputs are all gone is left out of the submission, as a browser leaves out an input that is not in the DOM. A variant the
 * host never told (no host: a test, a store) counts as on screen.
 */
type Variant = {
  name: string;
  path: Path;
  kind: "text" | "number" | "checkbox" | "list" | "radio" | "select" | "hidden" | "file";
  /** The value or choice the input is written with (`as("radio", "s")`: "s"), for the kinds that have one. */
  option: unknown;
  /** The value the input shows until it is edited. */
  initial: unknown;
  options?: readonly unknown[];
  props: Record<string, unknown>;
  mounted: number;
  /** The newest host's handle, while any host has these props (`mounted`). */
  handle?: { focus?: () => void };
  seen: boolean;
  /** What the input shows now. */
  shown: () => unknown;
};
const onScreen = (variant: Variant) => !variant.seen || variant.mounted > 0;

/** The props of `as(type)` that are the same for every text-like input: the keyboard the type asks for. */
const KEYBOARDS: Record<string, Record<string, unknown>> = {
  email: { keyboardType: "email-address", autoCapitalize: "none", autoCorrect: false, textContentType: "emailAddress", autoComplete: "email" },
  password: { secureTextEntry: true, autoCapitalize: "none", autoCorrect: false },
  tel: { keyboardType: "phone-pad", textContentType: "telephoneNumber", autoComplete: "tel" },
  url: { keyboardType: "url", autoCapitalize: "none", autoCorrect: false, textContentType: "URL" },
  search: { returnKeyType: "search", autoCapitalize: "none" },
  number: { keyboardType: "decimal-pad", inputMode: "decimal" },
  range: { keyboardType: "decimal-pad", inputMode: "decimal" },
};
const TEXT_TYPES = new Set(["text", "email", "password", "tel", "url", "search", "number", "range", "date", "time", "datetime-local", "month", "week", "color", "textarea"]);
const METHODS = new Set(["set", "value", "issues", "allIssues", "touched", "dirty"]);

/**
 * Merges the client's issues into the server's. The server's persist unless a client issue exists for the same field; they are listed in the
 * order the fields were first rendered (SvelteKit's order is the DOM's).
 */
function merge_with_server_issues(order: readonly string[], current_issues: Issue[], client_issues: Issue[]): Issue[] {
  const client_names = new Set(client_issues.map((issue) => issue.name));
  const merged = [...current_issues.filter((issue) => issue.server && !client_names.has(issue.name)), ...client_issues];
  return merged.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
}

/** Client-version of the `form` function from `$app/server`, for a native screen. */
export function form(id: string) {
  // (The maps here are bookkeeping of this module, not state a template reads.)
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const instances = new Map<unknown, { count: number; instance: any }>();
  let shared_preflight_schema: StandardSchema | null = null;

  function create_instance(key?: string | number | boolean) {
    const action_id_without_key = id;
    let input = $state<Record<string, any>>({});
    let error = $state.raw<ClientError | undefined>(undefined);
    let raw_issues = $state.raw<Issue[]>([]);
    const issues = $derived(flatten_issues(raw_issues));
    let result = $state.raw<any>(undefined);
    let pending_count = $state(0);
    let preflight_schema: StandardSchema | undefined;
    let touched = $state<Record<string, boolean>>({});
    let dirty = $state<Record<string, boolean>>({});
    let can_validate: Record<string, boolean> = {};
    let submitted = $state(false);
    let reset_id = 0;
    /** The text a number field shows while it is typed ("1." is the number 1 and must stay "1."). */
    let texts = $state<Record<string, string>>({});
    /** The order fields were first rendered in (issues are listed in it), and every input `as(type)` made. */
    const order: string[] = [];
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const variants = new Map<string, Variant>();
    /** The submit button pressed last: pressing another one takes this one's value out of the input, as the web form does. */
    let submitter: { name: string; path: Path } | undefined;
    let enhance_callback: ((instance: any) => any) | undefined;

    /**
     * The data a submission sends, as a browser would post the form: what was set or typed (also by inputs that are gone since: a native screen unmounts
     * inputs that scroll out of a list or sit in a closed modal), plus what the inputs on screen show where nothing was typed (a text input as its text, "" when
     * empty; a number as its number, or `undefined` when empty; a box that is checked; the radio and the select that are chosen; the hidden values), and an
     * unchecked box not at all. A field none of whose inputs are on screen and that was never edited or set contributes nothing.
     */
    function convert(): Record<string, any> {
      const data = create_field_proxy(context).value() as Record<string, any>;
      // eslint-disable-next-line svelte/prefer-svelte-reactivity
      const byName = new Map<string, Variant[]>();
      for (const variant of variants.values()) byName.set(variant.name, [...(byName.get(variant.name) ?? []), variant]);
      for (const [, group] of byName) {
        const { path } = group[0];
        const live = group.filter(onScreen);
        // No input of the field is on screen: what the user typed or the code set stays (a virtualized List unmounts the rows that scrolled away, a closed
        // Modal its inputs, a step of a wizard its fields; none of that is the user taking a value back), and what the inputs would have shown is not added.
        if (live.length === 0) continue;
        const set = (value: unknown) => deep_set(data, path.map(String), value);
        const shown = live.filter((variant) => variant.kind === "list" && variant.shown() === true).map((variant) => variant.option);
        for (const variant of live) {
          const value = variant.shown();
          switch (variant.kind) {
            case "text": if (deep_get(data, path) === undefined) set(value ?? ""); break;
            case "number": if (deep_get(data, path) === undefined) set(value); break;
            case "file":
            case "select": if (deep_get(data, path) === undefined && value !== undefined) set(value); break;
            case "hidden": set(value); break;
            case "checkbox": set(value === true ? true : DELETE_KEY); break;
            case "radio": if (value === true) set(variant.option); break;
            case "list": break;
          }
        }
        // The boxes of a list: the checked ones, in the order they were made; none checked is no field. Radios: none chosen is no field.
        if (live.some((variant) => variant.kind === "list")) set(shown.length > 0 ? shown : DELETE_KEY);
        if (live.every((variant) => variant.kind === "radio") && !live.some((variant) => variant.shown() === true)) set(DELETE_KEY);
      }
      if (key !== undefined && !("id" in data)) data.id = key;
      return data;
    }

    function reset(): void {
      // A validation started before reset must not repopulate the cleared errors.
      validate_id++;
      reset_id++;
      input = {};
      raw_issues = [];
      touched = {};
      dirty = {};
      can_validate = {};
      submitted = false;
      texts = {};
      submitter = undefined;
    }

    /** Sets a value from an input (SvelteKit's `handle_input`): the field is dirty, and not yet touched. */
    function edit(path: Path, value: unknown): void {
      deep_set(input, path.map(String), value);
      dirty[build_path_string(path)] = true;
    }

    /** The input lost the focus (SvelteKit's `handle_focusout`): the field is touched, and validated from now on if it was edited. */
    function blur(path: Path): void {
      const name = build_path_string(path);
      touched[name] = true;
      if (Object.hasOwn(dirty, name)) can_validate[name] = true;
    }

    const context = {
      form_id: action_id_without_key,
      get: () => input,
      set: (path: Path, value: any) => {
        if (path.length === 0) {
          input = value;
        } else if (value !== deep_get(input, path)) {
          deep_set(input, path.map(String), value);
          const name = build_path_string(path);
          touched[name] = true;
          dirty[name] = true;
          can_validate[name] = true;
        }
      },
      get_issues: () => issues,
      get_touched: () => touched,
      get_dirty: () => dirty,
    };
    const kit_fields = create_field_proxy(context) as any;

    async function preflight(data: Record<string, any>): Promise<boolean> {
      const reset_epoch = reset_id;
      const schema = preflight_schema ?? shared_preflight_schema;
      const validated = await schema?.["~standard"].validate(data);
      if (reset_epoch !== reset_id) return false;
      if (validated?.issues) {
        raw_issues = merge_with_server_issues(order, raw_issues, validated.issues.map((issue) => normalize_issue(issue as any, false)));
        return false;
      }
      // Preflight passed - clear stale client-side preflight issues
      if (preflight_schema) raw_issues = raw_issues.filter((issue) => issue.server);
      return true;
    }

    /** Sends the data. SvelteKit's `submit(form_data, should_preflight)` with the data taken when the submission started. */
    function send(data: Record<string, any>, should_preflight: boolean): Submission {
      // Keeps this instance from being forgotten while the request is in flight, as SvelteKit does.
      const entry = instances.get(key);
      if (entry) entry.count++;
      let overrides = null as Array<() => void> | null;
      let refreshes = null as Set<string> | null;
      let updates_error = undefined as Error | undefined;

      const promise = (async () => {
        try {
          await Promise.resolve();
          if (updates_error) throw updates_error;
          if (should_preflight && !(await preflight(data))) return false;
          const { blob } = serialize_binary_form(data, { remote_refreshes: Array.from(refreshes ?? []) });
          const response = await remote_request(
            `${base}/${app_dir}/remote/${action_id_without_key}`,
            { method: "POST", headers: { "Content-Type": BINARY_FORM_CONTENT_TYPE, "x-sveltekit-pathname": location.pathname, "x-sveltekit-search": location.search }, body: bodyOf(blob) },
            refreshes,
          );
          ({ issues: raw_issues = [], result } = response._ ?? {});
          // If the developer took control of updates via `.updates(...)` (even with no arguments), or the server performed explicit refreshes, don't refresh everything.
          const should_refresh = refreshes === null && !response.r;
          if (response.redirect) {
            await _goto(response.redirect);
            if (should_refresh) await refreshAll();
            return true;
          }
          const succeeded = raw_issues.length === 0;
          if (succeeded) {
            fail_unhandled_refreshes(refreshes);
            if (should_refresh) await refreshAll();
          }
          return succeeded;
        } catch (error) {
          result = undefined;
          raw_issues = [];
          throw error;
        } finally {
          for (const release of overrides ?? []) release();
          void tick().then(() => {
            if (entry && --entry.count === 0) instances.delete(key);
          });
        }
      })() as Submission;

      let updates_called = false;
      promise.updates = (...args) => {
        if (updates_called) {
          console.warn("Updates can only be sent once per form submission. Ignoring additional updates.");
          return promise;
        }
        updates_called = true;
        try {
          ({ refreshes, overrides } = categorize_updates(args as any[]));
        } catch (error) {
          updates_error = error as Error;
        }
        return promise;
      };
      return promise;
    }

    /** The type of a field's `as` call to the props a native input takes. */
    function native_as(path: Path) {
      const name = build_path_string(path);
      if (!order.includes(name)) order.push(name);
      /** The value, or `fallback` until the field has been edited (SvelteKit's `read`). */
      const read = (fallback?: unknown) => deep_get(input, path) ?? (fallback !== undefined && Object.hasOwn(dirty, name) ? undefined : fallback);

      /** The input of this kind that was made before, or a new one: the same props, so the host sees the same functions each time. */
      const variant = (kind: Variant["kind"], type: string, option: unknown, initial: unknown, make: (variant: Variant) => { props: Record<string, unknown>; shown: () => unknown }, options?: readonly unknown[]): Variant => {
        const id = `${name}\u0000${kind === "list" || kind === "radio" ? `${type}\u0000${String(option)}` : type}`;
        let found = variants.get(id);
        if (!found) {
          found = { name, path, kind, option, initial, options, props: {}, mounted: 0, seen: false, shown: () => undefined };
          const created = make(found);
          found.shown = created.shown;
          found.props = created.props;
          // The host's ref for this input: one function for the life of the variant, so it is not told "gone, back" at every render.
          const self = found;
          found.props.ref = (handle: unknown) => {
            self.seen = true;
            self.mounted = Math.max(0, self.mounted + (handle ? 1 : -1));
            // The newest host's handle. A host that replaces another is told before the old one's `null` (the renderer sweeps refs after the flush),
            // so the handle goes only with the last host.
            if (handle && typeof handle === "object") self.handle = handle as { focus?: () => void };
            else if (self.mounted === 0) self.handle = undefined;
          };
          variants.set(id, found);
        }
        found.initial = initial;
        found.options = options;
        return found;
      };
      const reactive = (props: Record<string, unknown>, shown: () => unknown, extra: Record<string, () => unknown> = {}) => {
        for (const [prop, get] of Object.entries({ value: shown, ...extra })) Object.defineProperty(props, prop, { enumerable: true, get });
        return props;
      };
      const handlers = { onBlur: () => blur(path) };

      return (type: string, option?: unknown, third?: unknown): Record<string, unknown> => {
        if (type === "image") throw new Error("Image submit buttons are not supported by native forms");
        if (type === "file" || type === "file multiple") {
          const multiple = type === "file multiple";
          return variant("file", type, undefined, undefined, () => {
            const shown = () => read(multiple ? [] : undefined);
            return {
              props: reactive({ multiple, ...handlers, onValueChange: (value: unknown) => {
                const isFile = (item: unknown) => typeof File !== "undefined" && item instanceof File;
                if (multiple ? !Array.isArray(value) || !value.every(isFile) : value !== undefined && !isFile(value)) {
                  throw new TypeError(`form.fields.${name}.as('${type}'): give ${multiple ? "an array of `File`s" : "a `File` (or undefined)"}, such as new File([await (await fetch(uri)).blob()], name, { type })`);
                }
                edit(path, Array.isArray(value) ? [...value] : value);
              } }, () => { const value = shown(); return Array.isArray(value) ? [...value] : value; }),
              shown,
            };
          }).props;
        }
        if (type === "submit") {
          return reactive({
            onPress: () => {
              // The button pressed before is not part of this submission (the web unsets the previous submitter).
              if (submitter && submitter.name !== name) deep_set(input, submitter.path.map(String), DELETE_KEY);
              submitter = { name, path };
              deep_set(input, path.map(String), option);
              api.submit();
            },
          }, () => option);
        }
        if (type === "hidden") {
          return variant("hidden", type, undefined, option, (self) => ({ props: reactive({}, () => self.initial), shown: () => self.initial })).props;
        }
        if (type === "select" || type === "select multiple") {
          const multiple = type === "select multiple";
          // Until a choice is made a select shows its first option, which is what a browser posts.
          const choices = third as readonly unknown[] | undefined;
          return variant("select", type, undefined, option, (self) => ({
            // (A copy: the app cannot edit the field through the array it is shown.)
            props: reactive({ multiple, onValueChange: (value: unknown) => edit(path, value), ...handlers }, () => { const value = self.shown(); return Array.isArray(value) ? [...value] : value; }),
            shown: () => read(self.initial ?? (multiple ? undefined : self.options?.[0])),
          }), choices).props;
        }
        if (type === "checkbox" || type === "radio") {
          const listed = type === "radio" || typeof option === "string";
          const checkedByDefault = listed ? Boolean(third) : Boolean(option);
          return variant(type === "radio" ? "radio" : listed ? "list" : "checkbox", type, option, checkedByDefault, (self) => {
            const shown = () => {
              const value = read();
              if (value == null) return Boolean(read(self.initial));
              if (type === "radio") return value === option;
              return listed ? (Array.isArray(value) ? value : []).includes(option) : Boolean(value);
            };
            return {
              props: reactive({
                onValueChange: (next: boolean) => {
                  if (type === "radio") { if (next) edit(path, option); return; }
                  if (!listed) return edit(path, next);
                  // The boxes of the list that are checked on screen (the ones that start checked included), in the order they were made.
                  const group = [...variants.values()].filter((other) => other.name === name && other.kind === "list" && onScreen(other));
                  edit(path, group.filter((other) => (other.option === option ? next : other.shown() === true)).map((other) => other.option));
                },
                ...handlers,
              }, shown),
              shown,
            };
          }).props;
        }
        if (!TEXT_TYPES.has(type)) throw new Error(`form.fields.${name}.as('${type}') is not a field type a native form knows`);
        const numeric = type === "number" || type === "range";
        return variant(numeric ? "number" : "text", type, undefined, option, (self) => {
          // A number default may be given as text; the input then shows that text.
          const parsedInitial = () => (typeof self.initial === "string" ? parseLocalizedNumber(self.initial) : (self.initial as number | undefined));
          /** The number the input holds: what was typed (or set), else the default until the field is edited. */
          const numberValue = (): number | undefined => {
            const value = deep_get(input, path) as number | undefined;
            if (value !== undefined) return value;
            return self.initial !== undefined && !Object.hasOwn(dirty, name) ? parsedInitial() : undefined;
          };
          /** The text it shows: as typed while the typed text still says that number, else the number. */
          const text = () => {
            const value = numberValue();
            const typed = texts[name];
            if (typed !== undefined && Object.is(parseLocalizedNumber(typed), value)) return typed;
            if (value === undefined || Number.isNaN(value)) return "";
            return typeof self.initial === "string" && deep_get(input, path) === undefined ? self.initial : String(value);
          };
          const shown = () => {
            const value = read(self.initial);
            return value === undefined ? "" : String(value);
          };
          return {
            props: reactive({
              ...KEYBOARDS[type],
              onChangeText: (typed: string) => {
                if (numeric) {
                  texts[name] = typed;
                  // Text that is not a number is not sent as the number it starts with: it is NaN, and the server's schema says what it makes of that.
                  edit(path, parseLocalizedNumber(typed));
                } else {
                  edit(path, typed);
                }
              },
              ...handlers,
            }, numeric ? text : shown),
            // What a submission carries is the number, not its text.
            shown: numeric ? numberValue : shown,
          };
        }).props;
      };
    }

    /** A node of `fields`: SvelteKit's methods (`value`, `set`, `issues`, …) from its own field proxy, and `as` for a native input. */
    function field(path: Path): any {
      return new Proxy({}, {
        get(_, prop) {
          if (typeof prop === "symbol") return undefined;
          if (prop === "as") return native_as(path);
          if (METHODS.has(prop)) return path.reduce((node, segment) => node[segment], kit_fields)[prop];
          return field([...path, /^\d+$/.test(prop) ? Number.parseInt(prop, 10) : prop]);
        },
      });
    }

    /** A failed submission should put the user at the first editable error, without screen-level ref plumbing. */
    function focus_invalid(): void {
      const invalid = raw_issues.map((issue) => issue.name);
      // Iterate field/render order, not the server schema's issue order. Only focus a known live host.
      for (const variant of variants.values()) {
        if (!invalid.includes(variant.name) || !onScreen(variant) || typeof variant.handle?.focus !== "function") continue;
        try { variant.handle.focus(); } catch { /* A native view may have disappeared during the focus call. */ }
        return;
      }
    }

    let validate_id = 0;
    const api: any = { method: "POST" };
    Object.defineProperties(api, {
      fields: { get: () => field([]) },
      result: { get: () => result },
      error: { get: () => error },
      pending: { get: () => pending_count },
      submitted: { get: () => submitted },
      reset: { value: reset },
      /**
       * What pressing the submit button of a web form does: preflight, then the `enhance` callback, which by default sends the data and, when
       * it was accepted, resets the form. Resolves to whether the data was accepted. A submission that fails (the network, the server, a callback that
       * throws) does not reject: it is handled as SvelteKit's form handles it, through `handleError`, and shown by `form.error`; it resolves `false`.
       * (Only a build with no host throws, here, at the call.)
       */
      submit: {
        value: (): Submission => {
          assertReady();
          const reset_epoch = reset_id;
          submitted = true;
          error = undefined;
          pending_count++;
          // From here on every way out undoes `pending_count` once, whatever fails: the data, the callback, the request, the app's `handleError`.
          let attempt: Submission;
          try {
            const data = convert();
            if (enhance_callback) {
              const callback = enhance_callback;
              let accepted = false;
              attempt = (async () => {
                if (!(await preflight(data))) return false;
                const { enhance: _enhance, ...descriptors } = Object.getOwnPropertyDescriptors(api);
                void _enhance;
                const instance = Object.defineProperties({}, {
                  ...descriptors,
                  submit: { value: () => { const sent = send(data, false); void sent.then((ok) => { accepted = ok; }, () => {}); return sent; } },
                });
                await callback(instance);
                return accepted;
              })() as Submission;
              attempt.updates = () => { throw new Error("With an enhance callback, call .updates(...) on the submit() inside it."); };
            } else {
              const sent = send(data, true);
              attempt = sent.then(async (ok) => { if (ok) { await tick(); reset(); } return ok; }) as Submission;
              attempt.updates = (...updates) => { sent.updates(...updates); return attempt; };
            }
          } catch (caught) {
            attempt = Promise.reject(caught) as Submission;
            attempt.updates = () => attempt;
          }
          const finished = attempt;
          const outcome = attempt.then(
            async (ok) => {
              if (!ok && raw_issues.length > 0) {
                // Focus is a courtesy: nothing in it may turn the submission into a rejection.
                try {
                  await tick();
                  if (reset_epoch === reset_id) focus_invalid();
                } catch (error) { console.error(error); }
              }
              return ok;
            },
            async (caught: unknown) => {
              // As SvelteKit's submit handler does: the app's `handleError` turns it into an `App.Error`, which is shown. A `handleError` that throws is the
              // app's bug and is reported as such; the submission still ends, with a plain 500.
              result = undefined;
              raw_issues = [];
              try {
                error = await handle_error(caught, { params: {}, route: { id: null }, url: currentUrl() });
                await set_nearest_error_page(error);
              } catch (hookFailed) {
                console.error(hookFailed);
                error = { status: 500, message: "Internal Error" };
              }
              return false;
            },
          ).finally(() => { pending_count--; }) as Submission;
          outcome.updates = (...updates) => { finished.updates(...updates); return outcome; };
          return outcome;
        },
      },
      preflight: {
        value: (schema: StandardSchema) => {
          preflight_schema = schema;
          if (key === undefined) shared_preflight_schema = schema;
          return api;
        },
      },
      validate: {
        /** Validates the current values: with the preflight schema, then (unless `preflightOnly`) with the server's. Only fields that were edited and left (or all, with `all`, or after a submit) show their issues. */
        value: async ({ all = false, preflightOnly = false }: { all?: boolean; preflightOnly?: boolean } = {}) => {
          const validation = ++validate_id;
          // Wait a tick in case the caller is validating right after set(), which takes time to propagate
          await tick();
          const data = convert();
          let array: Issue[] = [];
          const schema = preflight_schema ?? shared_preflight_schema;
          const validated = await schema?.["~standard"].validate(data);
          if (validate_id !== validation) return;
          if (validated?.issues) {
            array = validated.issues.map((issue) => normalize_issue(issue as any, false));
          } else if (!preflightOnly) {
            const response = await remote_request(`${base}/${app_dir}/remote/${action_id_without_key}`, {
              method: "POST",
              headers: { "Content-Type": BINARY_FORM_CONTENT_TYPE, "x-sveltekit-pathname": location.pathname, "x-sveltekit-search": location.search },
              body: bodyOf(serialize_binary_form(data, { validate_only: true }).blob),
            });
            if (validate_id !== validation) return;
            array = response._ as Issue[];
          }
          if (!all && !submitted) array = array.filter((issue) => can_validate[issue.name]);
          const is_server_validation = !validated?.issues && !preflightOnly;
          raw_issues = is_server_validation ? array : merge_with_server_issues(order, raw_issues, array);
        },
      },
      enhance: {
        /** Replaces what `submit()` does after the preflight; the callback gets the form with a `submit()` that sends the data it was started with. */
        value: (callback: (instance: any) => any) => {
          enhance_callback = callback;
          return api;
        },
      },
    });
    return api;
  }

  const instance = create_instance();
  Object.defineProperty(instance, "for", {
    /** An instance per key (`updateTodo.for(todo.id)`), shared while a screen holds it. */
    value: (key: string | number | boolean) => {
      const entry = instances.get(key) ?? { count: 0, instance: create_instance(key) };
      try {
        // SvelteKit 3.1: the instance is held from inside the effect, and a late sweep only frees the entry it was made for.
        $effect.pre(() => {
          entry.count += 1;
          instances.set(key, entry);
          return () => {
            entry.count--;
            void tick().then(() => { if (entry.count === 0 && instances.get(key) === entry) instances.delete(key); });
          };
        });
      } catch {
        // not in an effect context
      }
      return entry.instance;
    },
  });
  return instance;
}
