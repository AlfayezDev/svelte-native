import type { StackNode } from "./route-tree.js";
/**
 * The generated route table of the variant being bundled (`.svelte-native/routes.<variant>.ts`, written by `svelte-native sync`, the prebuild
 * plugin and the Metro integration). Metro resolves this specifier to that file; the declarations are what the type checker sees, and at
 * run time anywhere else (a test, the web build) the module is empty, so a reader treats a missing `lab` as false.
 */
/** The variant the table was made for (`production`, `qa`, `smoke`). */
export declare const variant: string;
/** Whether the table, and so the bundle, carries the development lab's routes. The app derives what it runs of the lab from this. */
export declare const lab: boolean;
export declare const tree: StackNode;
