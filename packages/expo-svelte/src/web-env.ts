import type { Plugin } from "vite";

/**
 * `mobile` in the web build: `import { mobile } from "$app/env"` (or `$app/environment`, the name SvelteKit 3 deprecates it under) is `false` in the browser and on the server, where
 * on the device it is `true` (`kit/env.ts`). The plugin answers the import with a module that re-exports SvelteKit's own and adds `export const mobile = false`.
 *
 * SvelteKit's Vite plugin aliases `$app` to its `src/runtime/app` directory, and Vite applies an alias before any plugin sees the import, so the plugin is asked for the directory
 * (`…/@sveltejs/kit/src/runtime/app/env`), not for `$app/env`; it matches both, and asks the rest of the chain what each resolves to, which is SvelteKit's real file. The module it
 * makes imports that file by its path, and an import that comes from that module is let through (`importer`).
 */
const MODULE = /^\$app\/env(?:ironment)?$|[\\/]@sveltejs[\\/]kit[\\/]src[\\/]runtime[\\/]app[\\/]env(?:ironment)?(?:[\\/]index\.js)?$/;
const PREFIX = "\0expo-svelte:mobile:";

export function mobileFlag(): Plugin {
  return {
    name: "expo-svelte:mobile",
    enforce: "pre",
    resolveId: {
      filter: { id: MODULE },
      async handler(id, importer, options) {
        if (importer?.startsWith(PREFIX)) return undefined;
        const real = await this.resolve(id, importer, { ...options, skipSelf: true });
        return real && !real.external ? `${PREFIX}${real.id}` : real;
      },
    },
    load: {
      filter: { id: { include: [new RegExp(`^${PREFIX.replace("\0", "\\0")}`)] } },
      handler(id) {
        return `export * from ${JSON.stringify(id.slice(PREFIX.length))};\nexport const mobile = false;\n`;
      },
    },
  };
}
