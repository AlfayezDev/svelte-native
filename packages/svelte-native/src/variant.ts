/**
 * The variant of a build and what the generated route table records of it. Pure (no file system), so the generator, the Metro
 * integration and the tests share one reading of both.
 */

/** The variant a build is: `APP_VARIANT`, or `qa` when it is empty (the QA app, whatever the shell has). */
export const variantName = (env: NodeJS.ProcessEnv = process.env): string => env.APP_VARIANT || "qa";

/** Whether the variant carries the development lab: every variant but the product (`production`). */
export const labIncludedFor = (variant: string): boolean => variant !== "production";

/** The first line of `.svelte-native/routes.ts`: the variant the table was synced for and whether it names the lab's routes. */
export const routesHeader = (variant: string, lab: boolean): string => `// svelte-native routes: variant=${variant} lab=${lab ? "yes" : "no"}\n`;

/** What the first line of a route table records, or `null` for a table that records nothing (one made by an older sync, or by hand). */
export function routesHeaderOf(table: string): { variant: string; lab: boolean } | null {
  const match = /^\/\/ svelte-native routes: variant=(\S+) lab=(yes|no)\n/.exec(table);
  return match ? { variant: match[1], lab: match[2] === "yes" } : null;
}
