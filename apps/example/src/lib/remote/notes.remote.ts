// The server half of the Remote functions screen: SvelteKit remote functions, written exactly as in a web app. This module runs on the SvelteKit
// server (it imports `$app/server`); the phone never loads it. Metro replaces it with a stub that calls the server over HTTP, so the screen
// imports `hello`, `visit` and `addNote` and calls them like local functions.
//
// To try it, put this file in a SvelteKit app at the same path (`src/lib/remote/notes.remote.ts` from that app's root: the function ids are a hash
// of the path), with `experimental: { remoteFunctions: true }` in its options and the module known to the server (list it in `server.warmup.ssrFiles`
// for `vite dev`, or import it from `hooks.server.ts`). Then build this app with `SVELTE_NATIVE_REMOTE_ORIGIN` set to the server's origin.
// Every export has to be `export const name = query(...)`, `command(...)`, `form(...)` or one of the other kinds.
import { command, form, query } from "$app/server";
import * as v from "valibot";

let visitors = 0;
const notes: string[] = [];

/** A query reads. It takes one argument, checked by a Standard Schema (valibot here). */
export const hello = query(v.string(), async (name) => `Hello ${name}, from the server`);

export const visits = query(async () => visitors);

/** A command changes something. Refreshing `visits` here sends the new number back in the same response. */
export const visit = command(async () => {
  visitors += 1;
  await visits().refresh();
  return visitors;
});

export const listNotes = query(async () => [...notes]);

/** A form takes the fields of an input: the schema says what is valid, and its messages become the field's issues on the phone. */
export const addNote = form(
  v.object({ text: v.pipe(v.string(), v.minLength(3, "Write at least three characters")) }),
  async ({ text }) => {
    notes.push(text);
    return { saved: notes.length };
  },
);
