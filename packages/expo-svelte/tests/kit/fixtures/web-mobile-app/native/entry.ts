// What a screen of the device imports: the router (through which an app's type check reaches the library's declaration of `mobile`) and the module it shares with the web.
import { rootRouter } from '../../../../../src/router.svelte.ts';
import { shared, typed } from '../src/shared.ts';

export const screen = [rootRouter, shared, typed];
