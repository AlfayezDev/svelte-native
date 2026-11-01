/**
 * The variant of a build and the file its route table is. Pure (no file system), so the generator, the Metro integration and the tests
 * share one reading of both.
 */

/** The variant a build is: `APP_VARIANT`, or `qa` when it is empty (the QA app, whatever the shell has). */
export const variantName = (env: NodeJS.ProcessEnv = process.env): string => env.APP_VARIANT || "qa";

/** Whether the variant carries the development lab: every variant but the product (`production`). */
export const labIncludedFor = (variant: string): boolean => variant !== "production";

/**
 * The route table of a variant, under `.svelte-native/`: `routes.production.ts`, `routes.qa.ts`, `routes.smoke.ts`. There is no table the
 * variants share, so a sync for one variant cannot change what a running Metro (or a warm graph) of another serves.
 */
export const routesTableFile = (variant: string): string => `routes.${variant.replace(/[^A-Za-z0-9_-]/g, "_")}.ts`;
