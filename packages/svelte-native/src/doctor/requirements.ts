/**
 * The tools the repository is built and tested with. Node is the repository's `engines.node` (and `devEngines`) and pnpm its
 * `packageManager`, both in the root package.json (`tests/doctor-repository.test.ts` keeps this in step): the CLI, Metro's and Expo's configs
 * load the library's TypeScript sources, which needs Node's type stripping, and the patches are applied by pnpm's `patchedDependencies`.
 */
export const requirements = {
  node: ">=25.0.0",
  pnpm: ">=12.3.4",
} as const;
