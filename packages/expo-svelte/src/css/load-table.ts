import table from "expo-svelte/classes-table";
import { setClassResolver } from "../classes.ts";
import { resolveClasses, setClassTable } from "./runtime.ts";

// What `init.ts` imports: the class resolver (`runtime.ts`) becomes the one every component's `class` goes through, with the app's class table
// (Metro serves `expo-svelte/classes-table`: the table `css/build.ts` wrote, or an empty one), which nothing else imports.
//
// In development the build writes the table again whenever a source or the CSS changes. Metro applies an update by re-running the changed module and
// every module between it and one that accepts the update: the table's importers, up to the entry, which would re-run the library. This module accepts
// it instead, so only the table and this module run again, and the resolver (which is not re-run: it keeps its caches and subscribers) gets the new
// table and the views that read it draw again.
declare const module: { hot?: { accept(): void } } | undefined;
setClassResolver(resolveClasses);
setClassTable(table);
if (typeof __DEV__ !== "undefined" && __DEV__ && typeof module !== "undefined") module?.hot?.accept();
