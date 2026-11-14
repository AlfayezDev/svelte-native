---
title: Hooks
---

`src/hooks.mobile.ts` is the native app's `hooks.client.ts`. It holds code that runs when the app starts, before any screen, and the hooks that remote functions use. SvelteKit doesn't read the file, so the web app keeps its own hooks.

```ts
/// file: src/hooks.mobile.ts
import type { ClientInit, HandleClientError } from '@sveltejs/kit/hooks';
import { report, startReporting } from '#lib/reporting.ts';

export { transport } from './hooks';

export const init: ClientInit = async () => {
	await startReporting();
};

export const handleError: HandleClientError = ({ kind, error }) => {
	if (kind === 'unknown') report(error);
	return { message: 'Something went wrong' };
};
```

Every export is optional, and the file is optional too. A `.js` file works as well as a `.ts` one.

## The top level

The file's top level runs right after Svelte Native's own start-up and before any of your modules: the layout, the routes, `src/lib`. Put code there that has to come before everything else, such as setting up a crash reporter, or a `TaskManager.defineTask(...)` call for a background task, which Expo needs at the top level of the bundle.

## init

`init` runs once, when the app's JavaScript starts. The first screen waits for the promise it returns, and the splash screen stays up while it does, so keep it short. `init` also runs when the app starts without a screen, as it does for a background task.

If `init` throws or rejects, a release build treats it as a fatal error, as it would a crash at start. In development the error screen shows it, and your next edit to the file runs `init` again.

## handleError

`handleError` is SvelteKit's client hook, for the calls of [remote functions](loading-data#remote-functions). It gets the error and its `kind`: `app` for an `error(...)` from your server code, `framework` for one of SvelteKit's own errors, such as a 404, and `unknown` for anything else, such as a lost connection. It returns the properties of `App.Error` to set, or nothing to keep the defaults. A failed query or form shows the result.

It doesn't see other errors, such as a throw in a component or an event handler. Those go to the app's global error handler, where a crash reporter's own handler sees them.

## transport

`transport` is the `transport` export of SvelteKit's universal hooks, `src/hooks.ts`: the custom types that the server and the app pass between them. Re-export the same object, as above, so that both sides agree.

`configureRemote({ transport, handleError })` replaces these two from code when you pass them.

## While you develop

When you save the file, its new exports take effect at once and the screens remount. `init` doesn't run again: reload the app to run it. The development server notices when you add or remove the file.
