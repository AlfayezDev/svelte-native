// Svelte's client runtime, shown as the "svelte" phase (the app's components are compiled against it).
import { mark } from "../boot-marks.ts";
import { mount, unmount, type Component } from "svelte";
mark("svelte");
export { mount, unmount };
export type { Component };
