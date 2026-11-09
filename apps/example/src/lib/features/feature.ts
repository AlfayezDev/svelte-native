// What a feature is, and the order of the groups the home screen shows. The features themselves are listed in two files, `core.ts` and
// `native.ts`, so two people can add features without editing the same file; the home screen merges them.

/** The headings of the home screen, in the order they appear. A group with no feature is not shown. */
export const groups = [
  "Basics",
  "Layout and style",
  "Lists and input",
  "Navigation",
  "Motion and touch",
  "Native views",
  "Platform",
] as const;

export type Group = (typeof groups)[number];

export type Feature = {
  /** The name on the home screen. */
  title: string;
  /** One line under the name. */
  summary: string;
  group: Group;
  /** The route of its screen, for example `/layout` (a folder of `src/routes`). */
  route: string;
  /** The other routes of the feature (a detail screen, the panes of a tab bar): every route has to be listed somewhere. */
  also?: string[];
};
