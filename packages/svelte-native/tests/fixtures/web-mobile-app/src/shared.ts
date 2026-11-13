import * as env from '$app/env';
import { browser, building, dev, mobile, version } from '$app/env';
import { mobile as deprecated } from '$app/environment';

/** Code shared with the device: what only one of them can do is asked of `mobile`. */
export const shared = mobile ? 'on a phone' : 'on the web';

/** `mobile` is a boolean, and `$app/env` is still SvelteKit's own module (its names are there, and a name it does not have is an error). */
export const typed: boolean = mobile;
/** The name SvelteKit 3 deprecates `$app/environment` under has it too (and the library declares that module, which SvelteKit 3 does not). */
export const typedDeprecated: boolean = deprecated;
export const kit: [boolean, boolean, boolean, string] = [browser, building, dev, version];
// @ts-expect-error SvelteKit's `$app/env` has no such export, and the library's declaration adds `mobile` only
export const nothing = env.nothing;
