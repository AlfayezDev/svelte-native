import type { ClassTable } from "./table.ts";

/**
 * The class table of an app with no `css` option (`withSvelteNative`): `@rasheed/svelte-native/classes-table` is this module there, and
 * wherever Metro does not resolve the id (a test, a web build). The declarations an app's type check reads are this module's too.
 */
const table: ClassTable = { version: 1, classes: {} };
export default table;
