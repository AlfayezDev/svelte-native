/**
 * The tools the doctor asks for. Node has two ranges, because the repository and an app are different things:
 *
 * - `node.repository` is the repository's `engines.node` (and `devEngines`) in the root package.json, which `tests/cli/doctor-repository.test.ts` keeps in step. Its scripts and tests
 *   run TypeScript through Node's type stripping. The doctor applies it to the apps that are members of the repository's workspace (`apps/qa`, `apps/example`).
 * - `node.app` is the Node an app outside the repository installs and builds under. The library's Node-side code ships as JavaScript (`dist/node/`), so an app needs no type
 *   stripping; what limits the range is the tooling a fresh install takes. React Native 0.88.1 and its tools (`@react-native/js-polyfills`, Metro 0.87) allow
 *   `^22.13.0 || ^24.3.0 || >=26.0.0`, and the SvelteKit that `sv create` installs (3.1.1) asks for Node 22.17 or newer. `sv` writes `engineStrict: true`, so pnpm stops with
 *   `ERR_PNPM_UNSUPPORTED_ENGINE` on Node 25 at the first `pnpm add`, before `init` can run (docs/60-appendix/20-troubleshooting.md).
 *
 * pnpm is the root `packageManager` for both: the patches are applied by pnpm's `patchedDependencies`.
 */
export const requirements = {
  node: {
    repository: ">=25.0.0",
    app: "^22.17.0 || ^24.3.0 || >=26.0.0",
  },
  pnpm: ">=12.3.4",
} as const;

/** What to do when the Node does not satisfy its range (or cannot be found). */
export const nodeAdvice = {
  repository: "install Node 25.0.0 or newer (the repository pins 25.0.0) and put it on the PATH",
  app: "install Node 24 LTS (24.3 or newer; Node 22.17 or newer and Node 26 or newer work too) and put it on the PATH. Node 25 is not supported: React Native 0.88 and its tools exclude it, and pnpm stops with ERR_PNPM_UNSUPPORTED_ENGINE (docs/60-appendix/20-troubleshooting.md)",
} as const;
