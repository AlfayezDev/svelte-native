// Svelte's client runtime, shown as the "svelte" phase (the app's components are compiled against it).
import { mark } from "../boot-marks.ts";
import { mount, unmount, untrack, type Component } from "svelte";
mark("svelte");
export { mount, unmount, untrack };
export type { Component };
