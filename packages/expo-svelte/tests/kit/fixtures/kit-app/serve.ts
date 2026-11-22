// Starts the fixture's SvelteKit server for tests/kit/remote-e2e.test.ts and prints `READY <origin>` once it listens.
//   node serve.ts dev       the Vite dev server (no CSRF check)
//   node serve.ts preview   a production build served by `vite preview` (the CSRF check, the prebuilt manifest)
import { createServer as listen } from "node:net";
import { fileURLToPath } from "node:url";
import { sveltekit } from "@sveltejs/kit/vite";
import { createBuilder, createServer, preview, type InlineConfig } from "vite";

const mode = process.argv[2] === "dev" ? "dev" : "preview";
const root = fileURLToPath(new URL(".", import.meta.url));

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = listen();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });
}

const config = (port: number): InlineConfig => ({
  root,
  configFile: false,
  logLevel: "warn",
  plugins: [sveltekit({ experimental: { remoteFunctions: true } })],
  // The dev server learns a remote module when it first transforms it; asking for it up front is what lets a native app (no page) call it.
  server: { host: "127.0.0.1", port, strictPort: true, warmup: { ssrFiles: ["src/**/*.remote.ts"] } },
  preview: { host: "127.0.0.1", port, strictPort: true },
});

const port = await freePort();
if (mode === "dev") {
  const server = await createServer(config(port));
  await server.listen();
} else {
  await (await createBuilder(config(port))).buildApp();
  await preview(config(port));
}
console.log(`READY http://127.0.0.1:${port}`);
