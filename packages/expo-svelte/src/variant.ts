/**
 * The variant of a build and the file its route table is. Pure (no file system), so the generator, the Metro integration and the tests
 * share one reading of both.
 */

/** The variant an app that names none is: its route table is `.expo-svelte/routes.app.ts`. */
export const DEFAULT_VARIANT = "app";

/** The variant a build is: `APP_VARIANT`, or `app` when it is empty or unset. An app with variants of its own (`qa`, `smoke`, `production`) sets `APP_VARIANT` for each. */
export const variantName = (env: NodeJS.ProcessEnv = process.env): string => env.APP_VARIANT || DEFAULT_VARIANT;

/** Whether the variant carries the development lab: every variant but the product (`production`). */
export const labIncludedFor = (variant: string): boolean => variant !== "production";

/**
 * The route table of a variant, under `.expo-svelte/`: `routes.app.ts` (no variant), `routes.production.ts`, `routes.qa.ts`, `routes.smoke.ts`. There is no table the
 * variants share, so a sync for one variant cannot change what a running Metro (or a warm graph) of another serves.
 */
export const routesTableFile = (variant: string): string => `routes.${variant.replace(/[^A-Za-z0-9_-]/g, "_")}.ts`;

/**
 * The class table of a variant, under `.expo-svelte/`: `classes.app.ts`, `classes.production.ts`, ... (`css/build.ts` writes it, Metro resolves
 * `expo-svelte/classes-table` to it). One per variant for the reason the route tables are: one Metro's rebuild never changes what another serves.
 */
export const classesTableFile = (variant: string): string => `classes.${variant.replace(/[^A-Za-z0-9_-]/g, "_")}.ts`;
