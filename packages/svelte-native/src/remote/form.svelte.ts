// biome-ignore-all lint/suspicious/noExplicitAny: the values of a form are whatever its schema says, and SvelteKit's field proxy is untyped JavaScript
// The ambient declarations of the SvelteKit files this module imports (a script file of `declare module`s: it cannot be imported).
/// <reference path="./kit-modules.d.ts" />
/**
 * `form` for a native app: the client half of SvelteKit's remote `form` without a `<form>` element.
 *
 * Ported from `@sveltejs/kit/src/runtime/client/remote-functions/form.svelte.js` (3.0.0-next.27). What is the same: the state (`fields`,
 * `result`, `pending`, `submitted`), validation (`preflight`, `validate`, the server's issues merged with the client's), the request
 * (`remote_request`, the binary form format and `.updates(...)` of SvelteKit's own files), `for(key)` instances, `enhance`. What differs, because
 * a native screen has no DOM:
 *
 * - The values are set by `fields.x.set(value)` or by the props `fields.x.as(type)` returns (`value` and `onChangeText`/`onValueChange`), not
 *   read from inputs when the form is submitted. SvelteKit keeps a mirror of the DOM in `input`; here `input` is the source.
 * - `submit()` is what pressing a submit button is on the web: preflight, then the `enhance` callback (default: send, and reset on success).
 *   There is no `element`, no attachment, no `action`, and no file fields.
 * - `reset()` returns the fields to their defaults (the web's `<form>.reset()`), and is what the default `enhance` does after a successful send.
 */
import { tick } from "svelte";
import {
  BINARY_FORM_CONTENT_TYPE, build_path_string, coerce_form_value, create_field_proxy, deep_get, deep_set, flatten_issues, normalize_issue, serialize_binary_form,
} from "@sveltejs/kit/src/runtime/form-utils.js";
import { categorize_updates, fail_unhandled_refreshes, remote_request } from "@sveltejs/kit/src/runtime/client/remote-functions/shared.svelte.js";
import { location } from "./globals.ts";
import { app_dir, base } from "./shims/paths.ts";
import { _goto, refreshAll } from "./shims/client.ts";

/* eslint-disable @typescript-eslint/no-explicit-any -- the form's values are whatever the schema says; the public types live in types.ts */

type Path = (string | number)[];
type Issue = { name: string; path: Path; message: string; server: boolean };
type StandardSchema = { "~standard": { validate(value: unknown): { issues?: readonly { message: string; path?: readonly unknown[] }[] } | Promise<{ issues?: readonly { message: string; path?: readonly unknown[] }[] }> } };
type Submission = Promise<boolean> & { updates: (...updates: unknown[]) => Promise<boolean> };

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
    let raw_issues = $state.raw<Issue[]>([]);
    const issues = $derived(flatten_issues(raw_issues));
    let result = $state.raw<any>(undefined);
    let pending_count = $state(0);
    let preflight_schema: StandardSchema | undefined;
    let touched = $state<Record<string, boolean>>({});
    let dirty = $state<Record<string, boolean>>({});
    let can_validate: Record<string, boolean> = {};
    let submitted = $state(false);
    /** The text a number field shows while it is typed ("1." is the number 1 and must stay "1."). */
    let texts = $state<Record<string, string>>({});
    /**
     * Fields as `as(type)` first saw them: their order, the ones rendered as a text input (sent as "" until edited, and a number as `undefined`, as a
     * browser sends an empty input and SvelteKit reads it) and the hidden ones.
     */
    const order: string[] = [];
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const texty = new Map<string, { path: Path; empty: "" | undefined }>();
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const hidden = new Map<string, { path: Path; value: unknown }>();
    let enhance_callback: ((instance: any) => any) | undefined;

    /** The data a submission sends: a copy of the input, with the rendered text fields that were never edited as "" and the hidden ones. */
    function convert(): Record<string, any> {
      const data = create_field_proxy(context).value() as Record<string, any>;
      for (const { path, empty } of texty.values()) if (deep_get(data, path) === undefined) deep_set(data, path.map(String), empty);
      for (const { path, value } of hidden.values()) deep_set(data, path.map(String), value);
      if (key !== undefined && !("id" in data)) data.id = key;
      return data;
    }

    function reset(): void {
      input = {};
      raw_issues = [];
      touched = {};
      dirty = {};
      can_validate = {};
      submitted = false;
      texts = {};
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
      const schema = preflight_schema ?? shared_preflight_schema;
      const validated = await schema?.["~standard"].validate(data);
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
            { method: "POST", headers: { "Content-Type": BINARY_FORM_CONTENT_TYPE, "x-sveltekit-pathname": location.pathname, "x-sveltekit-search": location.search }, body: blob.bytes() as unknown as BodyInit },
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
      const reactive = (props: Record<string, unknown>, getters: Record<string, () => unknown>) => {
        for (const [prop, get] of Object.entries(getters)) Object.defineProperty(props, prop, { enumerable: true, get });
        return props;
      };
      const handlers = { onBlur: () => blur(path) };

      return (type: string, option?: unknown, checked?: boolean) => {
        if (type === "file" || type === "file multiple" || type === "image") throw new Error(`form.fields.${name}.as('${type}'): files are not supported by native forms`);
        if (type === "submit") {
          return reactive({ onPress: () => { deep_set(input, path.map(String), option); api.submit().catch((error: unknown) => console.error(error)); } }, { value: () => option });
        }
        if (type === "hidden") {
          hidden.set(name, { path, value: option });
          return { value: option };
        }
        if (type === "select" || type === "select multiple") {
          texty.delete(name);
          return reactive({ multiple: type === "select multiple", onValueChange: (value: unknown) => edit(path, value), ...handlers }, { value: () => read(option) });
        }
        if (type === "checkbox" || type === "radio") {
          const has_option = type === "radio" || typeof option === "string";
          const initial = has_option ? checked : (option as boolean | undefined);
          return reactive({
            onValueChange: (next: boolean) => {
              if (type === "radio") { if (next) edit(path, option); return; }
              if (!has_option) return edit(path, next);
              const selected = (Array.isArray(read()) ? (read() as unknown[]) : []).filter((item) => item !== option);
              edit(path, next ? [...selected, option] : selected);
            },
            ...handlers,
          }, {
            value: () => {
              const value = read();
              if (value == null) return Boolean(read(initial));
              if (type === "radio") return value === option;
              return has_option ? (value as unknown[]).includes(option) : Boolean(value);
            },
          });
        }
        if (!TEXT_TYPES.has(type)) throw new Error(`form.fields.${name}.as('${type}') is not a field type a native form knows`);
        const numeric = type === "number" || type === "range";
        texty.set(name, { path, empty: numeric ? undefined : "" });
        return reactive({
          ...KEYBOARDS[type],
          onChangeText: (text: string) => {
            if (numeric) {
              texts[name] = text;
              const number = coerce_form_value("number", text) as number | undefined;
              edit(path, Number.isNaN(number) ? undefined : number);
            } else {
              edit(path, text);
            }
          },
          ...handlers,
        }, {
          value: () => {
            const value = read(option);
            if (numeric) {
              const typed = texts[name];
              return typed !== undefined && coerce_form_value("number", typed) === value ? typed : String(value ?? "");
            }
            return String(value ?? "");
          },
        });
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

    let validate_id = 0;
    const api: any = { method: "POST" };
    Object.defineProperties(api, {
      fields: { get: () => field([]) },
      result: { get: () => result },
      pending: { get: () => pending_count },
      submitted: { get: () => submitted },
      reset: { value: reset },
      /**
       * What pressing the submit button of a web form does: preflight, then the `enhance` callback, which by default sends the data and, when
       * it was accepted, resets the form. Resolves to whether the data was accepted. Await it or catch it: a failed request rejects.
       */
      submit: {
        value: (): Submission => {
          submitted = true;
          pending_count++;
          const data = convert();
          if (enhance_callback) {
            const callback = enhance_callback;
            let accepted = false;
            const run = (async () => {
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
            run.updates = () => { throw new Error("With an enhance callback, call .updates(...) on the submit() inside it."); };
            void run.then(() => { pending_count--; }, () => { pending_count--; });
            return run;
          }
          const sent = send(data, true);
          const done = sent.then(async (ok) => { if (ok) { await tick(); reset(); } return ok; });
          const submission = done as Submission;
          submission.updates = (...updates) => { sent.updates(...updates); return submission; };
          void done.then(() => { pending_count--; }, () => { pending_count--; });
          return submission;
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
              body: serialize_binary_form(data, { validate_only: true }).blob.bytes() as unknown as BodyInit,
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
        $effect.pre(() => () => {
          entry.count--;
          void tick().then(() => { if (entry.count === 0) instances.delete(key); });
        });
        entry.count += 1;
        instances.set(key, entry);
      } catch {
        // not in an effect context
      }
      return entry.instance;
    },
  });
  return instance;
}
