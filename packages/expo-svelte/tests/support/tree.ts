import type { Loader, PageRoute, StackNode } from "../../src/route-tree.ts";

/** A page of a hand-written tree: the fixtures give each route a loader of their own. */
export const page = (id: string, path: string, load: Loader, presentation: PageRoute["presentation"] = "push"): PageRoute => ({ kind: "page", id, path, presentation, load });
/** A stack of pages: the tree of a router that has no navigators below it. */
export const stackOf = (routes: PageRoute[], id = ""): StackNode => ({ kind: "stack", id, path: "/", routes });
